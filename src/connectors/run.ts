import type { IngestFailure, IngestPreparedOptions, IngestPreparedReport } from '../api/ingest.js';
import {
  IngestCancelledError,
  IngestReadinessError,
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
  'github', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
]);
const REQUEST_KEYS = new Set(['connectorId', 'documents', 'awaitSearchable']);
// This queue only prevents lost deltas inside one process. The store's put
// result remains authoritative; it is not a cross-instance compare-and-swap.
const observationUpdates = new Map<string, Promise<void>>();

export interface ConnectorRunRequest {
  readonly connectorId: ConnectorId;
  readonly documents: readonly ConnectorDocumentInput[];
  readonly awaitSearchable: boolean;
}

export interface ConnectorRunOptions {
  readonly signal?: AbortSignal;
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
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: ConnectorFailureCode | null;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly observationWrite: ConnectorPutResult | 'failed';
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
}

function failureCode(error: unknown): ConnectorFailureCode {
  if (error instanceof ConnectorNormalizationError) return 'validation_failed';
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

async function serializeObservationUpdate<T>(key: string, update: () => Promise<T>): Promise<T> {
  const previous = observationUpdates.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(update);
  const settled = operation.then(() => undefined, () => undefined);
  observationUpdates.set(key, settled);
  try {
    return await operation;
  } finally {
    if (observationUpdates.get(key) === settled) observationUpdates.delete(key);
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
    acceptedRecords: result.acceptedRecords,
    refusedRecords: result.refusedRecords,
    failure: result.failure,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    observationWrite: result.observationWrite,
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
          });
          if (typeof report === 'string') {
            return {
              accepted: false,
              searchable: false,
              acceptedRecords: 0,
              refusedRecords: 0,
              failure: 'parse_failed',
            };
          }
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
      if (outcomes.some((outcome) => outcome.cancelled === true) && !acceptedBeforeCancellation) {
        throw new ConnectorRunCancelledError();
      }
      if (isAborted(options.signal)) {
        if (!acceptedBeforeCancellation) throw new ConnectorRunCancelledError();
        outcomes = outcomes.map((outcome) => ({
          ...outcome,
          searchable: false,
          failure: outcome.failure ?? 'readiness_failed',
        }));
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
    const failedDocuments = outcomes.filter((outcome) => outcome.failure !== null).length
      + (outcomes.length === 0 && failure !== null ? request.documents.length : 0);
    const acceptedRecords = outcomes.reduce((sum, outcome) => sum + outcome.acceptedRecords, 0);
    const refusedRecords = outcomes.reduce((sum, outcome) => sum + outcome.refusedRecords, 0);
    const completedAt = iso(this.#now);
    let observationWrite: ConnectorPutResult | 'failed' = 'failed';
    let resultFailure = failure;
    const observationKey = `${workspace}:${request.connectorId}`;
    try {
      observationWrite = await serializeObservationUpdate(observationKey, async () => {
        const previous = (await this.#store.get(workspace))[request.connectorId] ?? emptyObservation();
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
        return this.#store.put(workspace, request.connectorId, observation);
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
      acceptedRecords,
      refusedRecords,
      failure: resultFailure,
      startedAt,
      completedAt,
      observationWrite,
    });
  }
}
