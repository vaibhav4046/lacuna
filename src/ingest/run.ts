import { HydraClient, type QueryRequest } from '../hydra/client.js';
import { mergeEdge, upsertVertices, verticesByLabel, vertexKeyById } from '../hydra/queries.js';
import { rowsToObjects } from '../hydra/values.js';

import { IngestCollisionError, IngestError } from './errors.js';
import { NODE_LABELS, type IngestPlan, type NodeLabel } from './plan.js';

/**
 * Plan to graph. The I/O half of ingestion; `plan.ts` decided what goes in.
 *
 * Three phases, in this order and for this reason:
 *
 *   verify    read back the key already stored on every id we are about to
 *             write. ADR 0002 stores the full canonical key on every node so a
 *             52-bit truncation collision is detectable rather than silent, and
 *             this is the read side of that check. It runs first because the
 *             point is to refuse before touching anything. Two ways to read it,
 *             picked per label by how many ids the plan holds: see
 *             `VerifyStrategy` and D-053.
 *   vertices  batched UNWIND upserts, serial. 15 requests for the demo corpus.
 *   edges     one request each, because the engine refuses batched edge writes
 *             (D-011). Bounded concurrency, which is what keeps this from being
 *             the slowest part of the demo by an order of magnitude.
 *
 * Every write is a MERGE on a deterministic id, so running this twice is a
 * no-op the second time. That is not a hope: tests/contract/ingest.contract.test.ts
 * ingests twice against a live node and diffs the counts.
 */

export type IngestPhase = 'verify' | 'vertices' | 'edges';

/**
 * How the pre-write key check reads the graph.
 *
 * `scan` reads every node carrying the label and picks the planned ids out of
 * what comes back. One request per page, and its cost is the size of the graph
 * rather than the size of the plan.
 *
 * `id` reads each planned id on its own, which the engine answers off an index.
 * Its cost is the size of the plan rather than the size of the graph.
 *
 * Neither dominates, which is why both are here. Loading a 5,642 node corpus
 * into an empty graph is five scans returning nothing, against 5,642 round
 * trips. Adding fourteen nodes to a graph that already holds that corpus is the
 * mirror image: fourteen round trips at ~11 ms each, against a paged scan of the
 * 5,268 messages already there, measured at six pages and 2.6 seconds, to answer
 * a question about four of them.
 *
 * `auto` picks per label by plan size and is what everything but the tests uses.
 */
export type VerifyStrategy = 'auto' | 'scan' | 'id';

export interface IngestProgress {
  readonly phase: IngestPhase;
  readonly done: number;
  readonly total: number;
}

export interface IngestOptions {
  /** Edge writes in flight at once. Vertex batches are always serial. */
  readonly concurrency?: number;
  /** Skips the pre-write collision read. Only sensible against a graph you just created. */
  readonly verifyKeys?: boolean;
  /** Defaults to `auto`. Forcing one is for tests and for a graph that surprises you. */
  readonly verifyStrategy?: VerifyStrategy;
  readonly timeoutMs?: number;
  readonly onProgress?: (progress: IngestProgress) => void;
  readonly signal?: AbortSignal;
}

export interface IngestTimings {
  readonly verifyMs: number;
  readonly verticesMs: number;
  readonly edgesMs: number;
  readonly totalMs: number;
}

export interface IngestReport {
  /** Planned ids that were already in the graph before this run. */
  readonly alreadyPresent: number;
  readonly vertices: number;
  readonly batches: number;
  readonly edges: number;
  /** Causally after every write this run made. Pin verification reads to it. */
  readonly bookmark: string | null;
  readonly timings: IngestTimings;
}

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Rows per read-back page. The client's own `query` accumulates every page and
 * caps the total at 5,000 rows, which is fewer than the corpus has messages, so
 * the read-back drives `queryPage` directly and compares one page at a time.
 * Nothing is accumulated, so the corpus can grow without this needing a knob.
 */
const VERIFY_PAGE_SIZE = 1_000;
const MAX_VERIFY_PAGES = 1_024;

/**
 * Planned ids for one label above which `auto` scans instead of reading each id.
 *
 * 256 lookups at the ~25 ms an indexed id read costs is 6.4 seconds serially and
 * under a second at the default concurrency, so the strategy this picks is
 * bounded either way. It also sits an order of magnitude above any incremental
 * ingest of a session or two and an order of magnitude below a corpus load,
 * which is the gap that matters: those are the two things anyone actually runs.
 */
const ID_READ_MAX_IDS = 256;

/** Progress is reported on a stride so a logging caller does not get 5,705 lines. */
const PROGRESS_STRIDE = 100;

function assertPositiveInteger(value: number, role: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new IngestError(`${role} must be a positive integer, got ${value}`);
  }
  return value;
}

/** Planned ids for one label, in batch order. */
function plannedIds(plan: IngestPlan, label: NodeLabel): Set<number> {
  const ids = new Set<number>();
  for (const batch of plan.batches) {
    if (batch.label !== label) continue;
    for (const row of batch.rows) ids.add(row.id);
  }
  return ids;
}

/**
 * Checks one read-back row against the plan.
 *
 * Returns true when the row is a planned id carrying the key the plan expects,
 * which is the only case that counts towards `alreadyPresent`. A planned id
 * carrying anything else throws: the derivation collided, or something else owns
 * that id, and either way the write would overwrite real data. Rows outside the
 * plan return false rather than throwing, because a graph is allowed to hold
 * things this corpus did not put there.
 *
 * `nullKey` says what a missing key means, because the two reads disagree about
 * it. A scan returns nodes that carry the label, so one without a canonical key
 * is a node this corpus never wrote sitting on an id it is about to write, and
 * that is a collision. An id read addresses a vertex slot rather than filtering
 * stored nodes, so `MATCH (n {id: $absent}) RETURN n.id AS id, n.key AS key`
 * answers for an id nothing has ever written, as one row carrying the id it was
 * asked for and a null key, where the same id under a label returns no rows.
 * There it means nothing is stored, and refusing it would refuse every ingest
 * into an empty graph. Measured against a live node; see DECISIONS.md D-053.
 */
function isPresent(
  plan: IngestPlan,
  label: NodeLabel,
  ids: ReadonlySet<number>,
  row: Record<string, unknown>,
  nullKey: 'nothing' | 'collision',
): boolean {
  const id = row['id'];
  if (typeof id !== 'number') {
    throw new IngestError(
      `${label} read-back returned a non-numeric id: ${JSON.stringify(id)}`,
    );
  }
  if (!ids.has(id)) return false;

  const planned = plan.keys.get(id);
  if (planned === undefined) {
    // Unreachable: ids came out of the same plan. Checked anyway, because
    // the alternative to checking is comparing against undefined.
    throw new IngestError(`planned id ${id} has no canonical key`);
  }

  const stored = row['key'];
  if ((stored === null || stored === undefined) && nullKey === 'nothing') return false;
  if (stored !== planned) {
    throw new IngestCollisionError(id, typeof stored === 'string' ? stored : null, planned);
  }
  return true;
}

/**
 * Reads each planned id for `label` on its own and checks what came back.
 *
 * Bounded concurrency, for the same reason the edge phase has it: these are
 * small independent round trips and running them one after another wastes the
 * wait. The pool stops handing out work on the first failure, so a collision
 * still refuses before anything is written.
 *
 * Two nodes answering to one id is its own kind of wrong, and it is reported as
 * a collision rather than counted twice, because that is the state where the
 * unlabelled reads everything else in this codebase does are no longer answering
 * about one node.
 */
async function verifyByIds(
  client: HydraClient,
  plan: IngestPlan,
  label: NodeLabel,
  ids: ReadonlySet<number>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  concurrency: number,
): Promise<number> {
  let present = 0;

  await runPool([...ids], concurrency, async (id) => {
    const prepared = vertexKeyById(id);
    const request: QueryRequest = signal === undefined
      ? { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs }
      : { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs, signal };

    const rows = await client.queryObjects(request);
    if (rows.length > 1) {
      throw new IngestError(
        `${rows.length} nodes answer to id ${id}; ids are meant to address one node`,
      );
    }
    for (const row of rows) {
      if (isPresent(plan, label, ids, row, 'nothing')) present += 1;
    }
  });

  return present;
}

/**
 * Reads every node carrying `label` and checks the ids we are about to write.
 *
 * Returns how many planned ids were already present, which is what makes a
 * second ingest visibly a no-op rather than merely a fast one.
 */
async function verifyByScan(
  client: HydraClient,
  plan: IngestPlan,
  label: NodeLabel,
  ids: ReadonlySet<number>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const { cypher } = verticesByLabel(label);
  const request: QueryRequest = signal === undefined
    ? { cypher, timeoutMs, pageSize: VERIFY_PAGE_SIZE }
    : { cypher, timeoutMs, pageSize: VERIFY_PAGE_SIZE, signal };

  const queryId = HydraClient.mintQueryId();
  let cursor: number | undefined;
  let pages = 0;
  let present = 0;

  for (;;) {
    const page = await client.queryPage(
      request,
      cursor === undefined ? { queryId } : { queryId, cursor },
    );

    for (const row of rowsToObjects(page.columns, page.rows)) {
      if (isPresent(plan, label, ids, row, 'collision')) present += 1;
    }

    if (page.nextCursor === null) return present;
    cursor = page.nextCursor;
    pages += 1;
    if (pages > MAX_VERIFY_PAGES) {
      throw new IngestError(
        `${label} read-back did not end after ${pages} pages`,
      );
    }
  }
}

/** Picks the read that is bounded by the smaller of the plan and the graph. */
async function verifyLabel(
  client: HydraClient,
  plan: IngestPlan,
  label: NodeLabel,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  strategy: VerifyStrategy,
  concurrency: number,
): Promise<number> {
  const ids = plannedIds(plan, label);
  if (ids.size === 0) return 0;

  const chosen = strategy === 'auto'
    ? (ids.size <= ID_READ_MAX_IDS ? 'id' : 'scan')
    : strategy;

  return chosen === 'id'
    ? verifyByIds(client, plan, label, ids, timeoutMs, signal, concurrency)
    : verifyByScan(client, plan, label, ids, timeoutMs, signal);
}

/**
 * Runs `worker` over `items` with at most `concurrency` in flight.
 *
 * On the first failure it stops handing out work but lets what is already in
 * flight settle before rethrowing, so nothing lands after the error is raised.
 */
async function runPool<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  let stopped = false;
  const width = Math.min(concurrency, items.length);

  const runners = Array.from({ length: width }, async () => {
    for (;;) {
      if (stopped) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      try {
        await worker(item, index);
      } catch (cause) {
        stopped = true;
        throw cause;
      }
    }
  });

  const settled = await Promise.allSettled(runners);
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure !== undefined && failure.status === 'rejected') {
    throw failure.reason;
  }
}

export async function runIngest(
  client: HydraClient,
  plan: IngestPlan,
  options: IngestOptions = {},
): Promise<IngestReport> {
  const concurrency = assertPositiveInteger(
    options.concurrency ?? DEFAULT_CONCURRENCY,
    'concurrency',
  );
  const timeoutMs = assertPositiveInteger(
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    'timeoutMs',
  );
  const verifyKeys = options.verifyKeys ?? true;
  const verifyStrategy = options.verifyStrategy ?? 'auto';
  const { onProgress, signal } = options;
  const report = (phase: IngestPhase, done: number, total: number): void => {
    onProgress?.({ phase, done, total });
  };

  const startedAt = performance.now();

  // Phase 1: refuse before writing.
  let alreadyPresent = 0;
  if (verifyKeys) {
    const labels = NODE_LABELS.filter((label) => plan.counts.vertices[label] > 0);
    for (const [index, label] of labels.entries()) {
      alreadyPresent += await verifyLabel(
        client, plan, label, timeoutMs, signal, verifyStrategy, concurrency,
      );
      report('verify', index + 1, labels.length);
    }
  }
  const verifiedAt = performance.now();

  // Phase 2: vertices. Serial, because there are 15 of them and each is large.
  let vertices = 0;
  for (const [index, batch] of plan.batches.entries()) {
    const prepared = upsertVertices({
      label: batch.label,
      properties: batch.properties,
      rows: batch.rows,
    });
    const request: QueryRequest = signal === undefined
      ? { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs }
      : { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs, signal };
    await client.write(request);
    vertices += batch.rows.length;
    report('vertices', index + 1, plan.batches.length);
  }
  const verticesAt = performance.now();

  /*
   * Every edge write is pinned to the bookmark the vertex phase ended on, so
   * each MERGE observes both of its endpoints. Pinning explicitly rather than
   * letting the client use its own last-write bookmark is what makes the edge
   * phase safe to run concurrently: concurrent writes race on that field, and a
   * pinned read selector does not care who won.
   */
  const pinned = client.lastWriteBookmark;
  let written = 0;

  await runPool(plan.edges, concurrency, async (edge) => {
    const prepared = mergeEdge(edge.type, edge.src, edge.dst);
    const request: QueryRequest = signal === undefined
      ? { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs, bookmark: pinned }
      : {
        cypher: prepared.cypher,
        parameters: prepared.parameters,
        timeoutMs,
        bookmark: pinned,
        signal,
      };
    await client.write(request);
    written += 1;
    if (written % PROGRESS_STRIDE === 0) report('edges', written, plan.edges.length);
  });
  report('edges', written, plan.edges.length);

  /*
   * One edge re-merged, serially, after everything else has settled.
   *
   * The concurrent phase leaves the client's remembered bookmark set by whoever
   * finished last, which is not necessarily the latest. This write is the only
   * one in flight when it runs, so the bookmark it returns is unambiguously
   * after every write above. It costs one round trip and changes no state,
   * because MERGE on the same edge is the idempotence this whole design rests on.
   */
  let bookmark = client.lastWriteBookmark;
  const last = plan.edges.at(-1);
  if (last !== undefined) {
    const prepared = mergeEdge(last.type, last.src, last.dst);
    const settle = await client.write(
      signal === undefined
        ? { cypher: prepared.cypher, parameters: prepared.parameters, timeoutMs, bookmark: pinned }
        : {
          cypher: prepared.cypher,
          parameters: prepared.parameters,
          timeoutMs,
          bookmark: pinned,
          signal,
        },
    );
    bookmark = settle.bookmark;
  }

  const finishedAt = performance.now();
  return {
    alreadyPresent,
    vertices,
    batches: plan.batches.length,
    edges: written,
    bookmark,
    timings: {
      verifyMs: verifiedAt - startedAt,
      verticesMs: verticesAt - verifiedAt,
      edgesMs: finishedAt - verticesAt,
      totalMs: finishedAt - startedAt,
    },
  };
}
