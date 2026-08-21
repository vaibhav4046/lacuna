import type { IngestFailure, IngestPreparedOptions, IngestPreparedReport } from '../api/ingest.js';
import { IngestReadinessError } from '../api/ingest.js';
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

export interface ConnectorRunRequest {
  readonly connectorId: ConnectorId;
  readonly documents: readonly ConnectorDocumentInput[];
  readonly awaitSearchable: boolean;
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

function iso(now: () => number): string {
  return new Date(now()).toISOString();
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

  async run(workspace: string, request: ConnectorRunRequest): Promise<ConnectorRunResult> {
    if (!WORKSPACE_SHAPE.test(workspace)) throw new Error('invalid workspace');
    const startedAt = iso(this.#now);
    let previous = emptyObservation();
    try {
      previous = (await this.#store.get(workspace))[request.connectorId] ?? previous;
    } catch {
      // The final put remains the authoritative observation attempt. If it is
      // also unavailable, observationWrite reports that instead of claiming persistence.
    }

    let duplicateDocuments = 0;
    let outcomes: readonly DocumentOutcome[] = [];
    let failure: ConnectorFailureCode | null = null;
    try {
      const batch = prepareConnectorBatch(request.documents);
      if (batch.documents.some((document) => document.provenance.connectorId !== request.connectorId)) {
        throw new ConnectorNormalizationError('invalid_provenance');
      }
      duplicateDocuments = batch.duplicates;
      outcomes = await mapConcurrent(batch.documents, 2, async (document): Promise<DocumentOutcome> => {
        try {
          const report = await this.#ingest(workspace, document, { awaitSearchable: request.awaitSearchable });
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
          return {
            accepted: report.accepted > 0,
            searchable: report.searchable,
            acceptedRecords: report.accepted,
            refusedRecords,
            failure: refusedRecords > 0 ? 'receipt_refused' : null,
          };
        } catch (error) {
          return {
            accepted: false,
            searchable: false,
            acceptedRecords: 0,
            refusedRecords: 0,
            failure: failureCode(error),
          };
        }
      });
      failure = outcomes.find((outcome) => outcome.failure !== null)?.failure ?? null;
    } catch (error) {
      failure = failureCode(error);
    }

    const acceptedDocuments = outcomes.filter((outcome) => outcome.accepted).length;
    const searchableDocuments = outcomes.filter((outcome) => outcome.searchable).length;
    const failedDocuments = outcomes.filter((outcome) => outcome.failure !== null).length
      + (outcomes.length === 0 && failure !== null ? request.documents.length : 0);
    const acceptedRecords = outcomes.reduce((sum, outcome) => sum + outcome.acceptedRecords, 0);
    const refusedRecords = outcomes.reduce((sum, outcome) => sum + outcome.refusedRecords, 0);
    const completedAt = iso(this.#now);
    const observation: ConnectorObservation = {
      configuredAt: previous.configuredAt,
      lastAttemptAt: startedAt,
      lastSuccessAt: acceptedDocuments > 0 ? completedAt : previous.lastSuccessAt,
      lastFailure: failure,
      importedDocuments: Math.min(MAX_STORED_DOCUMENTS, previous.importedDocuments + acceptedDocuments),
    };
    let observationWrite: ConnectorPutResult | 'failed' = 'failed';
    let resultFailure = failure;
    try {
      observationWrite = await this.#store.put(workspace, request.connectorId, observation);
    } catch {
      // A completed Hydra ingest and a failed observation write are different
      // facts. The result keeps the ingest counts and refuses to claim storage.
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
