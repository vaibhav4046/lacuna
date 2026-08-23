import type { IngestFailure, IngestPreparedOptions, IngestPreparedReport } from '../api/ingest.js';
import {
  IngestCancelledError,
  IngestGraphLimitError,
  IngestReadinessError,
  IngestSubmissionIndeterminateError,
  MAX_SOURCE_CHARS,
} from '../api/ingest.js';
import { HydraDecodeError, HydraTransportError } from '../hydra/errors.js';
import {
  ConnectorNormalizationError,
  prepareConnectorBatch,
  type ConnectorDocumentInput,
  type PreparedConnectorDocument,
} from './normalize.js';
import type {
  ConnectorFailureCode,
  ConnectorId,
  ConnectorObservation,
  ConnectorPutResult,
  ConnectorStore,
} from './types.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;
const MAX_STORED_DOCUMENTS = 1_000_000;
const CONNECTOR_IDS = new Set<ConnectorId>([
  'github', 'gitlab', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
]);
const REQUEST_KEYS = new Set(['connectorId', 'documents', 'awaitSearchable']);
// This queue only prevents lost deltas inside one process. The store's put
// result remains authoritative; it is not a cross-instance compare-and-swap.
interface ObservationWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface ObservationLock {
  readonly waiters: ObservationWaiter[];
}

const observationUpdates = new Map<string, ObservationLock>();
const MAX_OBSERVATION_WAITERS = 32;

export interface ConnectorRunRequest {
  readonly connectorId: ConnectorId;
  readonly documents: readonly ConnectorDocumentInput[];
  readonly awaitSearchable: boolean;
}

export interface ConnectorRunOptions {
  readonly signal?: AbortSignal;
  readonly settlementDeadlineMs?: number;
}

export class ConnectorRunCancelledError extends Error {
  override readonly name = 'ConnectorRunCancelledError';

  constructor() {
    super('cancelled');
  }
}

export interface ConnectorRunResult {
  readonly connectorId: ConnectorId;
  readonly submittedDocuments: number;
  readonly duplicateDocuments: number;
  readonly acceptedDocuments: number;
  readonly searchableDocuments: number;
  readonly failedDocuments: number;
  /**
   * Read without trouble, and holding no claim the extractor could justify.
   *
   * Counted apart from `failedDocuments` because it is not a failure. The
   * frame table reads eleven sentence shapes, so a licence notice, a changelog
   * or a page of installation commands produces nothing, and that is the
   * answer rather than a fault in the import. Folding it into the failure
   * count is what made a working connector look broken.
   */
  readonly emptyDocuments: number;
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: ConnectorFailureCode | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly observationWrite: ConnectorPutResult | 'failed';
  /** True when the Hydra submission may have landed but no exact receipt was available. */
  readonly indeterminateSubmission: boolean;
}

export type ConnectorIngestBoundary = (
  workspace: string,
  prepared: PreparedConnectorDocument,
  options: IngestPreparedOptions,
) => Promise<IngestPreparedReport | IngestFailure>;

export interface ConnectorRunnerOptions {
  readonly store: ConnectorStore;
  readonly ingest: ConnectorIngestBoundary;
  readonly now?: () => number;
}

interface DocumentOutcome {
  readonly accepted: boolean;
  readonly searchable: boolean;
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: ConnectorFailureCode | null;
  readonly cancelled?: boolean;
  readonly indeterminate?: boolean;
  /** The source was read and stated nothing this can record. Not a failure. */
  readonly empty?: boolean;
}

/**
 * What the ingest boundary said, when it answered with a word rather than a
 * report.
 *
 * Every one of those words was being turned into `parse_failed`, which is
 * wrong twice over. `nothing_extracted` is not a failure at all: the document
 * arrived, was decoded, was read, and held no sentence the frame table could
 * justify a claim from. Absence is the answer this product is built to give,
 * and reporting it as a document that could not be parsed teaches a reader to
 * distrust every other absence it reports.
 *
 * The rest are refusals of the input rather than of the parse, so they are
 * `validation_failed`, which is the code the runner already uses for exactly
 * that. Nothing here is a parse failure, so `parse_failed` no longer appears.
 */
function ingestRefusal(reason: IngestFailure): DocumentOutcome {
  const empty = reason === 'nothing_extracted';
  return {
    accepted: false,
    searchable: false,
    acceptedRecords: 0,
    refusedRecords: 0,
    failure: empty ? null : 'validation_failed',
    ...(empty ? { empty: true } : {}),
  };
}

function failureCode(error: unknown): ConnectorFailureCode {
  if (error instanceof ConnectorNormalizationError) return 'validation_failed';
  if (error instanceof IngestGraphLimitError) return 'validation_failed';
  if (error instanceof IngestReadinessError) {
    return error.reason === 'timeout' ? 'readiness_timeout' : 'readiness_failed';
  }
  if (error instanceof HydraDecodeError) return 'parse_failed';
  if (error instanceof HydraTransportError) return 'transport_failed';
  return 'transport_failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertConnectorRequest(value: unknown): asserts value is ConnectorRunRequest {
  if (!isRecord(value)) throw new Error('invalid connector request');
  const keys = Object.keys(value);
  if (keys.length !== REQUEST_KEYS.size || keys.some((key) => !REQUEST_KEYS.has(key))
    || typeof value['connectorId'] !== 'string'
    || !CONNECTOR_IDS.has(value['connectorId'] as ConnectorId)
    || !Array.isArray(value['documents'])
    || typeof value['awaitSearchable'] !== 'boolean') {
    throw new Error('invalid connector request');
  }
}

function iso(now: () => number): string {
  return new Date(now()).toISOString();
}

function isAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

async function mapConcurrent<T, U>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<U>,
): Promise<readonly U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value === undefined) return;
      results[index] = await operation(value);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return results;
}

function emptyObservation(): ConnectorObservation {
  return {
    configuredAt: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailure: null,
    importedDocuments: 0,
  };
}

function nextInstant(candidate: string, held: string | null): string {
  const candidateMs = Date.parse(candidate);
  const heldMs = held === null ? 0 : Date.parse(held);
  return new Date(Math.max(candidateMs, heldMs + 1)).toISOString();
}

function observationRelease(key: string, lock: ObservationLock): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = lock.waiters.shift();
    if (next === undefined) {
      observationUpdates.delete(key);
      return;
    }
    clearTimeout(next.timer);
    next.resolve(observationRelease(key, lock));
  };
}

async function acquireObservation(
  key: string,
  deadlineMs: number,
  now: () => number,
): Promise<() => void> {
  if (deadlineMs <= now()) throw new Error('observation deadline');
  const held = observationUpdates.get(key);
  if (held === undefined) {
    const lock: ObservationLock = { waiters: [] };
    observationUpdates.set(key, lock);
    return observationRelease(key, lock);
  }
  if (held.waiters.length >= MAX_OBSERVATION_WAITERS) throw new Error('observation queue full');
  return new Promise<() => void>((resolve, reject) => {
    let waiter: ObservationWaiter;
    const fail = () => {
      const index = held.waiters.indexOf(waiter);
      if (index >= 0) held.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      reject(new Error('observation deadline'));
    };
    waiter = {
      resolve,
      reject,
      timer: setTimeout(fail, Math.max(1, deadlineMs - now())),
    };
    held.waiters.push(waiter);
  });
}

async function serializeObservationUpdate<T>(
  key: string,
  deadlineMs: number,
  now: () => number,
  update: () => Promise<T>,
): Promise<T> {
  const release = await acquireObservation(key, deadlineMs, now);
  try {
    return await update();
  } finally {
    release();
  }
}

/** Dedicated allowlist for connector JSON routes. */
export function serializeConnectorRunResult(result: ConnectorRunResult): ConnectorRunResult {
  return {
    connectorId: result.connectorId,
    submittedDocuments: result.submittedDocuments,
    duplicateDocuments: result.duplicateDocuments,
    acceptedDocuments: result.acceptedDocuments,
    searchableDocuments: result.searchableDocuments,
    failedDocuments: result.failedDocuments,
    emptyDocuments: result.emptyDocuments,
    acceptedRecords: result.acceptedRecords,
    refusedRecords: result.refusedRecords,
    failure: result.failure,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    observationWrite: result.observationWrite,
    indeterminateSubmission: result.indeterminateSubmission,
  };
}

export class ConnectorRunner {
  readonly #store: ConnectorStore;
  readonly #ingest: ConnectorIngestBoundary;
  readonly #now: () => number;

  constructor(options: ConnectorRunnerOptions) {
    this.#store = options.store;
    this.#ingest = options.ingest;
    this.#now = options.now ?? Date.now;
  }

  async run(
    workspace: string,
    request: ConnectorRunRequest,
    options: ConnectorRunOptions = {},
  ): Promise<ConnectorRunResult> {
    if (!WORKSPACE_SHAPE.test(workspace)) throw new Error('invalid workspace');
    assertConnectorRequest(request);
    if (isAborted(options.signal)) throw new ConnectorRunCancelledError();
    const startedAt = iso(this.#now);
    const settlementDeadlineMs = options.settlementDeadlineMs;
    if (settlementDeadlineMs !== undefined && settlementDeadlineMs - this.#now() < 200_000) {
      throw new ConnectorRunCancelledError();
    }
    const deadlines = settlementDeadlineMs === undefined ? undefined : {
      prewriteDeadlineMs: settlementDeadlineMs - 180_000,
      submissionDeadlineMs: settlementDeadlineMs - 60_000,
      readinessDeadlineMs: settlementDeadlineMs - 30_000,
    };

    let duplicateDocuments = 0;
    let outcomes: readonly DocumentOutcome[] = [];
    let failure: ConnectorFailureCode | null = null;
    try {
      const batch = prepareConnectorBatch(request.documents);
      if (batch.documents.some((document) => document.provenance.connectorId !== request.connectorId)) {
        throw new ConnectorNormalizationError('invalid_provenance');
      }
      if (batch.documents.some((document) => document.text.length > MAX_SOURCE_CHARS)) {
        throw new ConnectorNormalizationError('document_too_long');
      }
      if (isAborted(options.signal)) throw new ConnectorRunCancelledError();
      duplicateDocuments = batch.duplicates;
      outcomes = await mapConcurrent(batch.documents, 2, async (document): Promise<DocumentOutcome> => {
        try {
          if (isAborted(options.signal)) throw new IngestCancelledError();
          const report = await this.#ingest(workspace, document, {
            awaitSearchable: request.awaitSearchable,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
            ...(deadlines === undefined ? {} : { deadlines }),
          });
          if (typeof report === 'string') return ingestRefusal(report);
          const refusedRecords = report.refused.length;
          if (isAborted(options.signal)) {
            if (report.accepted > 0) {
              return {
                accepted: true,
                searchable: false,
                acceptedRecords: report.accepted,
                refusedRecords,
                failure: 'readiness_failed',
              };
            }
            throw new IngestCancelledError();
          }
          return {
            accepted: report.accepted > 0,
            searchable: report.searchable,
            acceptedRecords: report.accepted,
            refusedRecords,
            failure: refusedRecords > 0 ? 'receipt_refused' : null,
          };
        } catch (error) {
          if (error instanceof IngestSubmissionIndeterminateError) {
            return {
              accepted: false,
              searchable: false,
              acceptedRecords: 0,
              refusedRecords: 0,
              failure: 'transport_failed',
              indeterminate: true,
            };
          }
          if (error instanceof IngestCancelledError) {
            return {
              accepted: false,
              searchable: false,
              acceptedRecords: 0,
              refusedRecords: 0,
              failure: 'readiness_failed',
              cancelled: true,
            };
          }
          if (error instanceof IngestReadinessError) {
            return {
              accepted: error.acceptedRecords > 0,
              searchable: false,
              acceptedRecords: error.acceptedRecords,
              refusedRecords: error.refusedRecords,
              failure: failureCode(error),
            };
          }
          return {
            accepted: false,
            searchable: false,
            acceptedRecords: 0,
            refusedRecords: 0,
            failure: failureCode(error),
          };
        }
      });
      const acceptedBeforeCancellation = outcomes.some((outcome) => outcome.accepted);
      const submittedBeforeCancellation = outcomes.some((outcome) => outcome.indeterminate === true);
      if (outcomes.some((outcome) => outcome.cancelled === true)
        && !acceptedBeforeCancellation && !submittedBeforeCancellation) {
        throw new ConnectorRunCancelledError();
      }
      if (isAborted(options.signal) && !acceptedBeforeCancellation && !submittedBeforeCancellation) {
        throw new ConnectorRunCancelledError();
      }
      failure = outcomes.find((outcome) => outcome.failure !== null)?.failure ?? null;
    } catch (error) {
      if (error instanceof ConnectorRunCancelledError || error instanceof IngestCancelledError) {
        throw new ConnectorRunCancelledError();
      }
      failure = failureCode(error);
    }

    const acceptedDocuments = outcomes.filter((outcome) => outcome.accepted).length;
    const searchableDocuments = outcomes.filter((outcome) => outcome.searchable).length;
    /**
     * A document that was accepted is not a failed document.
     *
     * `readiness_failed` and `readiness_timeout` say the store took the
     * records and did not confirm the index in time. The document itself
     * arrived and its claims are readable, which is why `acceptedDocuments`
     * counts it. Counting the same one submitted document as both accepted
     * and failed produced a receipt reading "ACCEPTED 1 ... FAILED 1 ... 1
     * submitted document failed" for an import that had just written eight
     * records, and a reader believes the failure line.
     *
     * The run still carries the readiness failure code, and the receipt still
     * has its own sentence for it, so nothing is hidden: what changes is that
     * the failure is reported as the indexing state it is rather than as a
     * document that did not make it.
     */
    const failedDocuments = outcomes.filter((outcome) => (
      outcome.failure !== null && outcome.indeterminate !== true && !outcome.accepted
    )).length
      + (outcomes.length === 0 && failure !== null ? request.documents.length : 0);
    const emptyDocuments = outcomes.filter((outcome) => outcome.empty === true).length;
    const acceptedRecords = outcomes.reduce((sum, outcome) => sum + outcome.acceptedRecords, 0);
    const refusedRecords = outcomes.reduce((sum, outcome) => sum + outcome.refusedRecords, 0);
    const indeterminateSubmission = outcomes.some((outcome) => outcome.indeterminate === true);
    const completedAt = iso(this.#now);
    let observationWrite: ConnectorPutResult | 'failed' = 'failed';
    let resultFailure = failure;
    const observationKey = `${workspace}:${request.connectorId}`;
    try {
      const observationDeadlineMs = settlementDeadlineMs === undefined
        ? this.#now() + 20_000
        : settlementDeadlineMs - 10_000;
      const observationControl = { deadlineMs: observationDeadlineMs };
      observationWrite = await serializeObservationUpdate(
        observationKey,
        observationDeadlineMs,
        this.#now,
        async () => {
        const previous = (await this.#store.get(workspace, observationControl))[request.connectorId] ?? emptyObservation();
        const lastAttemptAt = nextInstant(completedAt, previous.lastAttemptAt);
        const observation: ConnectorObservation = {
          configuredAt: previous.configuredAt,
          lastAttemptAt,
          lastSuccessAt: acceptedDocuments > 0
            ? nextInstant(completedAt, previous.lastSuccessAt)
            : previous.lastSuccessAt,
          lastFailure: failure,
          importedDocuments: Math.min(MAX_STORED_DOCUMENTS, previous.importedDocuments + acceptedDocuments),
        };
        return this.#store.put(workspace, request.connectorId, observation, observationControl);
      });
    } catch {
      // Never absolute-write from a missing/stale snapshot. Accepted Hydra work
      // remains in the result while observation persistence is reported failed.
      resultFailure = 'transport_failed';
    }
    return serializeConnectorRunResult({
      connectorId: request.connectorId,
      submittedDocuments: request.documents.length,
      duplicateDocuments,
      acceptedDocuments,
      searchableDocuments,
      failedDocuments,
      emptyDocuments,
      acceptedRecords,
      refusedRecords,
      failure: resultFailure,
      startedAt,
      completedAt,
      observationWrite,
      indeterminateSubmission,
    });
  }
}
