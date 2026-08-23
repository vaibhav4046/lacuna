import { createHash } from 'node:crypto';

import type { HydraCloud, IngestResult, InspectedSource, SourceStatus } from '../hydra/cloud.js';
import { INDEX_ID } from '../hydra/cloud-graph.js';
import type { BuiltGraph, IndexRecord } from '../hydra/cloud-graph.js';
import { buildCloudGraph, entityRecordId, toAppRecords, unwrapEnvelope } from '../hydra/cloud-graph.js';
import type { EntityRecord } from '../hydra/cloud-graph.js';
import { HydraDecodeError, HydraIngestIndeterminateError, HydraTransportError } from '../hydra/errors.js';
import { extract } from '../extract/extract.js';
import { toCorpus } from '../extract/adapt.js';
import { buildPlan } from '../ingest/plan.js';
import {
  ConnectorNormalizationError,
  prepareConnectorDocument,
  type PreparedConnectorDocument,
} from '../connectors/normalize.js';
import { decodePersistedConnectorEvidence, persistedEvidenceFor } from '../connectors/evidence.js';
import { abortAndDrain } from '../connectors/abort-drain.js';

/**
 * A transcript somebody pasted, turned into memory they can then ask about.
 *
 * This is the path the product was missing. Everything else reads a corpus that
 * shipped with the repository, so a signed-in stranger reached an empty
 * workspace and had no way to fill it, which makes every claim about the
 * product a claim about a demo.
 *
 * One path rather than five connectors. Text in, and the same pipeline the
 * benchmarks use runs over it: the extractor decides what may become a claim,
 * the planner builds the graph, and the records go to HydraDB Cloud.
 *
 * Two things it deliberately does not do. It does not invent structure the
 * prose did not carry, so a transcript the frame table cannot read produces no
 * claims and says so rather than filling a workspace with guesses. And it does
 * not write anywhere the public demo can be read from: every workspace gets its
 * own collection, because ingesting one person's conversation into the
 * collection `/demo/*` serves would publish it.
 */

/** Long enough for a real meeting, short enough to extract inside a request. */
export const MAX_SOURCE_CHARS = 20_000;

/** The service's own vocabulary caps how much goes in one call. */
const BATCH = 25;

export type IngestFailure =
  | 'text_required'
  | 'text_too_long'
  | 'title_required'
  | 'nothing_extracted';

export interface IngestReport {
  readonly sourceKey: string;
  readonly collection: string;
  readonly turns: number;
  readonly claims: number;
  readonly entities: number;
  /** Records the service accepted for indexing. */
  readonly accepted: number;
  readonly refused: readonly { readonly id: string; readonly error: string }[];
  readonly ms: number;
  readonly truncated: boolean;
}

export interface IngestPreparedReport extends IngestReport {
  readonly searchable: boolean;
  readonly indexing: 'accepted' | 'completed';
}

export interface IngestPreparedOptions {
  readonly awaitSearchable: boolean;
  readonly readiness?: { readonly timeoutMs?: number; readonly intervalMs?: number };
  readonly signal?: AbortSignal;
  readonly deadlines?: {
    readonly prewriteDeadlineMs: number;
    readonly submissionDeadlineMs: number;
    readonly readinessDeadlineMs: number;
  };
}

export class IngestCancelledError extends Error {
  override readonly name = 'IngestCancelledError';

  constructor() {
    super('cancelled');
  }
}

export class IngestReadinessError extends Error {
  override readonly name = 'IngestReadinessError';
  readonly reason: 'failed' | 'timeout';
  readonly acceptedRecords: number;
  readonly refusedRecords: number;

  constructor(reason: 'failed' | 'timeout', acceptedRecords = 0, refusedRecords = 0) {
    super(reason);
    this.reason = reason;
    this.acceptedRecords = acceptedRecords;
    this.refusedRecords = refusedRecords;
  }
}

/** The one submitted Hydra POST may have landed, but no exact receipt survived. */
export class IngestSubmissionIndeterminateError extends Error {
  override readonly name = 'IngestSubmissionIndeterminateError';

  constructor() {
    super('indeterminate_submission');
  }
}

export class IngestGraphLimitError extends Error {
  override readonly name = 'IngestGraphLimitError';
  readonly code = 'too_many_records';

  constructor() {
    super('too_many_records');
  }
}

export interface RouterSafeIngestReport {
  readonly sourceKey: string;
  readonly turns: number;
  readonly claims: number;
  readonly entities: number;
  readonly accepted: number;
  readonly refused: number;
  readonly ms: number;
  readonly truncated: boolean;
  readonly searchable: boolean;
  readonly indexing: 'accepted' | 'completed';
}

/** Allowlist for JSON boundaries. Internal ids, errors, and collection scope never pass it. */
export function serializeIngestReport(report: IngestReport | IngestPreparedReport): RouterSafeIngestReport {
  const prepared = report as Partial<IngestPreparedReport>;
  return {
    sourceKey: report.sourceKey,
    turns: report.turns,
    claims: report.claims,
    entities: report.entities,
    accepted: report.accepted,
    refused: report.refused.length,
    ms: report.ms,
    truncated: report.truncated,
    searchable: prepared.searchable === true,
    indexing: prepared.indexing === 'completed' ? 'completed' : 'accepted',
  };
}

/**
 * The collection one account's memory lives in.
 *
 * Derived from the address rather than stored, so it is the same on every
 * request without a lookup, and hashed rather than spelled so the collection
 * names held by the service are not a list of who has signed up. The prefix
 * keeps them identifiable as this product's, beside whatever else shares the
 * database.
 */
/**
 * The stored index for this collection, with the new graph's entries added.
 *
 * A missing index is empty because the first ingest into a workspace has none.
 * A failed read is not a miss: continuing after one would replace the index
 * without the records the store temporarily failed to return.
 */
function storedText(source: InspectedSource | null, record: 'index' | 'entity'): string | null {
  if (source === null) return null;
  const text = unwrapEnvelope(source.envelope);
  if (text === null || text.trim() === '') {
    throw new HydraDecodeError(`stored ${record} envelope is unreadable`);
  }
  return text;
}

function parsedJson(text: string, record: 'index' | 'entity'): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HydraDecodeError(`stored ${record} is not readable JSON`);
  }
}

function stringMap(value: unknown): value is Record<string, string> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}

function storedIndex(text: string): IndexRecord {
  const parsed = parsedJson(text, 'index');
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new HydraDecodeError('stored index is missing required maps');
  }
  const value = parsed as Record<string, unknown>;
  if (!stringMap(value['claims']) || !stringMap(value['entities'])) {
    throw new HydraDecodeError('stored index is missing required maps');
  }
  return { claims: value['claims'], entities: value['entities'] };
}

function storedEntity(text: string): EntityRecord {
  const parsed = parsedJson(text, 'entity');
  const value = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : null;
  if (value === null
    || typeof value['id'] !== 'number'
    || typeof value['name'] !== 'string'
    || (value['kind'] !== null && typeof value['kind'] !== 'string')
    || !Array.isArray(value['claims'])
    || !Array.isArray(value['mentions'])
    || !Array.isArray(value['dependents'])
    || typeof value['evidence'] !== 'object'
    || value['evidence'] === null
    || Array.isArray(value['evidence'])) {
    throw new HydraDecodeError('stored entity is missing required fields');
  }
  for (const entries of Object.values(value['evidence'])) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null
        || !Object.prototype.hasOwnProperty.call(entry, 'connector')) continue;
      const decoded = decodePersistedConnectorEvidence((entry as { connector?: unknown }).connector);
      if (decoded === null) throw new HydraDecodeError('stored entity has invalid connector evidence');
    }
  }
  return value as unknown as EntityRecord;
}

async function mergeIndex(
  scoped: HydraCloud,
  graph: BuiltGraph,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BuiltGraph> {
  const source = await scoped.inspect(INDEX_ID, timeoutMs, scoped.collection, signal);
  const text = storedText(source, 'index');
  const existing = text === null ? null : storedIndex(text);
  if (existing === null) return graph;

  return {
    ...graph,
    index: {
      claims: { ...existing.claims, ...graph.index.claims },
      entities: { ...existing.entities, ...graph.index.entities },
    },
  };
}

/**
 * The entity records this graph is about to write, with what is already there.
 *
 * An entity record is addressed by the entity's name, so a second ingest that
 * mentions the same subject wrote a record holding only its own claims and the
 * earlier ones stopped existing. That is the index bug again, one level down,
 * and it is worse: the index losing a pointer left the claims recoverable,
 * while this erased them.
 *
 * It matters most for the case this store exists for. Two assistants writing to
 * one workspace, the second correcting the first, looked like it worked: the
 * answer changed to the new value. It changed because the old claim was gone,
 * not because anything superseded it, so the history this product promises to
 * keep had been quietly deleted and the timeline showed a single claim that had
 * apparently always been true.
 *
 * Merging by claim id rather than by value, because the same fact stated twice
 * is one claim and two different facts about one predicate are a disagreement
 * the resolver is supposed to see.
 */
async function mergeEntities(
  scoped: HydraCloud,
  graph: BuiltGraph,
  /** `subject predicate` for every pair this source explicitly corrects. */
  corrections: ReadonlySet<string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<BuiltGraph> {
  const merged = await abortAndDrain(graph.entities.map((entity) => async (
    operationSignal: AbortSignal,
  ): Promise<EntityRecord> => {
    const source = await scoped.inspect(
      entityRecordId(entity.name),
      timeoutMs,
      scoped.collection,
      operationSignal,
    );
    const text = storedText(source, 'entity');
    const held = text === null ? null : storedEntity(text);
    if (held === null) return entity;

    const byId = new Map(held.claims.map((claim) => [claim.id, claim]));
    for (const claim of entity.claims) byId.set(claim.id, claim);

    /**
     * A correction reaching back to what a different source already said.
     *
     * Supersession is worked out inside one extraction, so a sentence arriving
     * later has no way to point at a claim it never saw. Left alone, one
     * assistant correcting another produced two live values and the resolver
     * reported a disagreement, which is a true statement about the records and
     * the wrong answer about what happened: somebody said "correction, it is X
     * now" and meant it.
     *
     * Only an explicit correction does this. A plain statement that happens to
     * differ from an older one stays a disagreement, because deciding that the
     * newer of two unrelated claims wins on recency is exactly the guess this
     * whole store exists to refuse.
     */
    for (const fresh of entity.claims) {
      if (!corrections.has(`${entity.name} ${fresh.predicate}`)) continue;
      for (const older of held.claims) {
        if (older.predicate !== fresh.predicate || older.id === fresh.id) continue;
        const marked = byId.get(older.id);
        if (marked === undefined || marked.supersededBy.includes(fresh.id)) continue;
        byId.set(older.id, { ...marked, supersededBy: [...marked.supersededBy, fresh.id] });
      }
    }

    return {
      ...entity,
      // The earlier record's kind survives when this ingest could not tell.
      kind: entity.kind ?? held.kind,
      claims: [...byId.values()].sort((a, b) => a.id - b.id),
      mentions: [...held.mentions, ...entity.mentions],
      dependents: [...held.dependents, ...entity.dependents],
      evidence: { ...held.evidence, ...entity.evidence },
    };
  }), signal);
  if (signal?.aborted === true) throw new IngestCancelledError();

  return { ...graph, entities: merged };
}

export function workspaceCollection(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
  return `lacuna-ws-${digest.slice(0, 32)}`;
}

export function validateSource(title: unknown, text: unknown): IngestFailure | null {
  if (typeof title !== 'string' || title.trim() === '') return 'title_required';
  if (typeof text !== 'string' || text.trim() === '') return 'text_required';
  if (text.length > MAX_SOURCE_CHARS * 4) return 'text_too_long';
  return null;
}

function assertCompleteReceipts(
  submitted: readonly { readonly id: string }[],
  results: readonly IngestResult[],
): void {
  const expected = new Set(submitted.map((record) => record.id));
  const seen = new Set<string>();

  for (const result of results) {
    if (!expected.has(result.id)) {
      throw new HydraDecodeError('ingest response contains an unexpected record id');
    }
    if (seen.has(result.id)) {
      throw new HydraDecodeError('ingest response contains a duplicate record id');
    }
    seen.add(result.id);
  }

  if (seen.size !== expected.size) {
    throw new HydraDecodeError('ingest response omits a submitted record id');
  }
}

interface WorkspaceWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  abort?: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface WorkspaceLock {
  held: boolean;
  readonly waiters: WorkspaceWaiter[];
}

const workspaceMutations = new Map<string, WorkspaceLock>();
const MAX_WORKSPACE_WAITERS = 32;

/**
 * Orders the shared index/entity read-modify-write phase inside one process.
 * HydraDB has no compare-and-swap across serverless instances. Deterministic
 * ids, upserts, and exact receipts remain the cross-instance convergence boundary.
 */
function workspaceRelease(workspace: string, lock: WorkspaceLock): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lock.waiters.shift();
    if (next === undefined) {
      lock.held = false;
      workspaceMutations.delete(workspace);
      return;
    }
    clearTimeout(next.timer);
    if (next.signal !== undefined && next.abort !== undefined) {
      next.signal.removeEventListener('abort', next.abort);
    }
    next.resolve(workspaceRelease(workspace, lock));
  };
}

async function acquireWorkspaceMutation(
  workspace: string,
  deadlineMs: number,
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted === true || deadlineMs <= Date.now()) throw new IngestCancelledError();
  const held = workspaceMutations.get(workspace);
  if (held === undefined) {
    const lock: WorkspaceLock = { held: true, waiters: [] };
    workspaceMutations.set(workspace, lock);
    return workspaceRelease(workspace, lock);
  }
  if (held.waiters.length >= MAX_WORKSPACE_WAITERS) throw new IngestCancelledError();
  return new Promise<() => void>((resolve, reject) => {
    let waiter: WorkspaceWaiter;
    const fail = () => {
      const index = held.waiters.indexOf(waiter);
      if (index >= 0) held.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      if (waiter.signal !== undefined && waiter.abort !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.abort);
      }
      reject(new IngestCancelledError());
    };
    waiter = {
      resolve,
      reject,
      ...(signal === undefined ? {} : { signal }),
      timer: setTimeout(fail, Math.max(1, deadlineMs - Date.now())),
    };
    if (signal !== undefined) {
      waiter.abort = fail;
      signal.addEventListener('abort', fail, { once: true });
    }
    held.waiters.push(waiter);
  });
}

interface MutationReceipts {
  readonly accepted: readonly string[];
  readonly refused: readonly { readonly id: string; readonly error: string }[];
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function writeGraph(
  cloud: HydraCloud,
  collection: string,
  graph: BuiltGraph,
  corrections: ReadonlySet<string>,
  options: IngestPreparedOptions,
  oneBatch: boolean,
): Promise<MutationReceipts> {
  const signal = options.signal;
  // Queue acquisition and every index/entity read share one 20-second phase.
  // A later outer deadline must never silently expand that pre-write budget.
  const prewriteDeadlineMs = Math.min(
    options.deadlines?.prewriteDeadlineMs ?? Number.POSITIVE_INFINITY,
    Date.now() + 20_000,
  );
  const release = await acquireWorkspaceMutation(collection, prewriteDeadlineMs, signal);
  try {
    const scoped = cloud.withCollection(collection);
    if (isAborted(signal)) throw new IngestCancelledError();
    let merged: BuiltGraph;
    try {
      merged = await mergeEntities(
        scoped,
        await mergeIndex(scoped, graph, Math.max(1, Math.min(15_000, prewriteDeadlineMs - Date.now())), signal),
        corrections,
        Math.max(1, Math.min(15_000, prewriteDeadlineMs - Date.now())),
        signal,
      );
    } catch (error) {
      if (isAborted(signal)) throw new IngestCancelledError();
      throw error;
    }
    if (isAborted(signal)) throw new IngestCancelledError();
    const records = toAppRecords(merged);
    if (oneBatch && records.length > BATCH) throw new IngestGraphLimitError();
    const accepted: string[] = [];
    const refused: { id: string; error: string }[] = [];
    for (let at = 0; at < records.length; at += BATCH) {
      if (isAborted(signal)) {
        if (accepted.length > 0 || refused.length > 0) {
          throw new IngestReadinessError('failed', accepted.length, refused.length);
        }
        throw new IngestCancelledError();
      }
      const batch = records.slice(at, at + BATCH);
      // Once submitted, await the exact receipt. Aborting this request would
      // turn a possibly durable write into unknown state.
      let results: readonly IngestResult[];
      try {
        results = await scoped.ingestApp(batch, collection, {
          ...(signal === undefined ? {} : { signal }),
          ...(options.deadlines === undefined ? {} : { deadlineMs: options.deadlines.submissionDeadlineMs }),
        });
        assertCompleteReceipts(batch, results);
      } catch (error) {
        if (error instanceof HydraIngestIndeterminateError || error instanceof HydraDecodeError) {
          throw new IngestSubmissionIndeterminateError();
        }
        throw error;
      }
      for (const result of results) {
        if (result.error === null || result.error === '') accepted.push(result.id);
        else refused.push({ id: result.id, error: result.error });
      }
      if (isAborted(signal)) {
        throw new IngestReadinessError('failed', accepted.length, refused.length);
      }
    }
    return { accepted, refused };
  } finally {
    release();
  }
}

async function preparedIngest(
  cloud: HydraCloud,
  collection: string,
  prepared: PreparedConnectorDocument,
  options: IngestPreparedOptions,
  started: number,
  now: () => number,
  legacyTruncated = false,
): Promise<IngestPreparedReport | IngestFailure> {
  if (isAborted(options.signal)) throw new IngestCancelledError();
  if (prepared.text.length > MAX_SOURCE_CHARS) {
    throw new ConnectorNormalizationError('document_too_long');
  }
  const extraction = extract(prepared.text, {
    sessionKey: prepared.sourceKey,
    title: prepared.title,
    startedAt: prepared.provenance.observedAt,
  });
  if (extraction.claims.length === 0) return 'nothing_extracted';

  const corpus = toCorpus(extraction, {
    sessionKey: prepared.sourceKey,
    title: prepared.title,
    startedAt: prepared.provenance.observedAt,
  });
  const graph = buildCloudGraph(buildPlan(corpus), persistedEvidenceFor(prepared));
  const corrections = new Set(
    extraction.claims
      .filter((claim) => claim.mode === 'CORRECTION')
      .map((claim) => `${claim.subject}\u0000${claim.predicate}`),
  );
  if (isAborted(options.signal)) throw new IngestCancelledError();
  const receipts = await writeGraph(
    cloud,
    collection,
    graph,
    corrections,
    options,
    prepared.provenance.connectorId === 'webhook',
  );
  if (isAborted(options.signal)) {
    throw new IngestReadinessError('failed', receipts.accepted.length, receipts.refused.length);
  }

  /**
   * The records whose search index a reader can actually be waiting on.
   *
   * `lacuna:index` is a lookup map from subject to record id. It is written as
   * a record because it has to be durable, and it is only ever read by id
   * through `/context/inspect`. Nothing searches it, and its text is a JSON
   * object rather than prose.
   *
   * HydraDB's graph-creation stage errors on it, every time, with E6005. The
   * entity and session records beside it reach `completed` inside twenty-four
   * seconds; the index sits in `graph_creation` and then errors at around
   * forty. Measured per record against a live workspace collection, and the
   * same collection indexes an ordinary uploaded document without complaint.
   *
   * Waiting on it made every successful import end in `readiness_failed`, and
   * the errored status persists, so once a workspace held one bad index record
   * every later import failed readiness immediately. Readiness is a question
   * about the claims, so it is asked about the records that hold them.
   */
  const searchableIds = receipts.accepted.filter((id) => id !== INDEX_ID);

  let searchable = false;
  let indexing: 'accepted' | 'completed' = 'accepted';
  if (options.awaitSearchable && searchableIds.length > 0) {
    let statuses: readonly SourceStatus[];
    try {
      const readinessTimeout = options.deadlines === undefined
        ? options.readiness?.timeoutMs
        : Math.max(1, Math.min(
          options.readiness?.timeoutMs ?? 300_000,
          options.deadlines.readinessDeadlineMs - Date.now(),
        ));
      statuses = await cloud.withCollection(collection).waitForIndexing(searchableIds, {
        ...options.readiness,
        ...(readinessTimeout === undefined ? {} : { timeoutMs: readinessTimeout }),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      // A caller cancellation is still a readiness failure because the
      // operation was intentionally interrupted. A transport deadline after
      // exact receipts, however, only means that indexing could not be
      // confirmed in this request; the accepted records remain durable.
      if (isAborted(options.signal) || !(error instanceof HydraTransportError)) {
        throw new IngestReadinessError('failed', receipts.accepted.length, receipts.refused.length);
      }
      statuses = [];
    }
    if (statuses.some((status) => status.indexingStatus === 'failed' || status.indexingStatus === 'errored')) {
      throw new IngestReadinessError('failed', receipts.accepted.length, receipts.refused.length);
    }
    const completed = new Set(
      statuses.filter((status) => status.indexingStatus === 'completed').map((status) => status.id),
    );
    // Exact receipts are durable even when the provider has not finished
    // indexing by the request deadline. Preserve that accepted state so the
    // connector can report a pending search index instead of a false failure.
    if (searchableIds.every((id) => completed.has(id))) {
      searchable = true;
      indexing = 'completed';
    }
  }
  return {
    sourceKey: prepared.sourceKey,
    collection,
    turns: extraction.turns.length,
    claims: extraction.claims.length,
    entities: graph.entities.length,
    accepted: receipts.accepted.length,
    refused: receipts.refused,
    ms: now() - started,
    truncated: legacyTruncated,
    searchable,
    indexing,
  };
}

export async function ingestPreparedSource(
  cloud: HydraCloud,
  workspace: string,
  prepared: PreparedConnectorDocument,
  options: IngestPreparedOptions,
): Promise<IngestPreparedReport | IngestFailure> {
  const now = Date.now;
  return preparedIngest(cloud, workspace, prepared, options, now(), now);
}

/**
 * Runs one source all the way into the store.
 *
 * The whole pipeline is the shipped one: `extract` reads the prose, `toCorpus`
 * puts the claims in the shape `buildPlan` already consumes, and
 * `buildCloudGraph` produces the same record layout the demo corpus was written
 * with. Nothing here is a second implementation, which is why a claim ingested
 * this way answers through exactly the same resolver.
 */
export async function ingestSource(
  cloud: HydraCloud,
  collection: string,
  title: string,
  rawText: string,
  now: () => number = Date.now,
): Promise<IngestReport | IngestFailure> {
  const started = now();
  const legacyTruncated = rawText.length > MAX_SOURCE_CHARS;
  const legacyText = legacyTruncated ? rawText.slice(0, MAX_SOURCE_CHARS) : rawText;
  const normalized = prepareConnectorDocument({
    title: title.trim().slice(0, 120),
    text: legacyText,
    provenance: {
      connectorId: 'text',
      sourceUrl: null,
      mediaType: 'text/plain',
      observedAt: new Date(started).toISOString(),
    },
  });
  const prepared: PreparedConnectorDocument = {
    ...normalized,
    // Preserve the pre-connector identity so an old manual paste upserts the
    // records it already owns instead of forking them after this refactor.
    sourceKey: `src-${createHash('sha256').update(`${title}\n${legacyText}`, 'utf8').digest('hex').slice(0, 24)}`,
  };
  return preparedIngest(cloud, collection, prepared, { awaitSearchable: false }, started, now, legacyTruncated);
}
