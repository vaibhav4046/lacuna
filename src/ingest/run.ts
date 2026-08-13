import { HydraClient, type QueryRequest } from '../hydra/client';
import { mergeEdge, upsertVertices, verticesByLabel } from '../hydra/queries';
import { rowsToObjects } from '../hydra/values';

import { IngestCollisionError, IngestError } from './errors';
import { NODE_LABELS, type IngestPlan, type NodeLabel } from './plan';

/**
 * Plan to graph. The I/O half of ingestion; `plan.ts` decided what goes in.
 *
 * Three phases, in this order and for this reason:
 *
 *   verify    read back the key already stored on every id we are about to
 *             write. ADR 0002 stores the full canonical key on every node so a
 *             52-bit truncation collision is detectable rather than silent, and
 *             this is the read side of that check. It runs first because the
 *             point is to refuse before touching anything.
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

/** Progress is reported on a stride so a logging caller does not get 5,693 lines. */
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
 * Reads every node carrying `label` and checks the ids we are about to write.
 *
 * A node under a planned id whose stored key is anything other than the planned
 * one means the derivation collided, or that something else owns that id. Either
 * way the write would overwrite real data, so it is refused rather than merged.
 * Nodes outside the plan are left alone; a graph is allowed to hold other things.
 *
 * Returns how many planned ids were already present, which is what makes a
 * second ingest visibly a no-op rather than merely a fast one.
 */
async function verifyLabel(
  client: HydraClient,
  plan: IngestPlan,
  label: NodeLabel,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  const ids = plannedIds(plan, label);
  if (ids.size === 0) return 0;

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
      const id = row['id'];
      if (typeof id !== 'number') {
        throw new IngestError(
          `${label} read-back returned a non-numeric id: ${JSON.stringify(id)}`,
        );
      }
      if (!ids.has(id)) continue;

      const planned = plan.keys.get(id);
      if (planned === undefined) {
        // Unreachable: ids came out of the same plan. Checked anyway, because
        // the alternative to checking is comparing against undefined.
        throw new IngestError(`planned id ${id} has no canonical key`);
      }

      const stored = row['key'];
      if (stored !== planned) {
        throw new IngestCollisionError(id, typeof stored === 'string' ? stored : null, planned);
      }
      present += 1;
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
      alreadyPresent += await verifyLabel(client, plan, label, timeoutMs, signal);
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
