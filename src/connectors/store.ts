import { createHash } from 'node:crypto';

import type { HydraCloud, IngestResult, InspectedSource } from '../hydra/cloud.js';
import type {
  ConnectorFailureCode,
  ConnectorId,
  ConnectorObservation,
  ConnectorPutResult,
  ConnectorStore,
  ConnectorWorkspaceState,
} from './types.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;
const DIGEST_SHAPE = /^[0-9a-f]{32}$/u;
const COLLECTION = 'lacuna-connectors';
const MAX_IMPORTED_DOCUMENTS = 1_000_000;
const DEFAULT_READBACK_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const CONNECTOR_IDS: readonly ConnectorId[] = [
  'github', 'markdown', 'text', 'pdf', 'docx', 'https_api', 'webhook',
];
const CONNECTOR_ID_SET = new Set<string>(CONNECTOR_IDS);
const FAILURE_CODES = new Set<ConnectorFailureCode>([
  'validation_failed',
  'transport_failed',
  'parse_failed',
  'receipt_refused',
  'readiness_failed',
  'readiness_timeout',
  'signing_not_configured',
]);
const RECORD_KEYS = new Set(['version', 'workspaceDigest', 'connectorId', 'observation']);
const OBSERVATION_KEYS = new Set([
  'configuredAt', 'lastAttemptAt', 'lastSuccessAt', 'lastFailure', 'importedDocuments',
]);
const ACCEPTED_RECEIPTS = new Set(['queued', 'completed']);

interface StoredConnectorState {
  readonly version: 1;
  readonly workspaceDigest: string;
  readonly connectorId: ConnectorId;
  readonly observation: ConnectorObservation;
}

export interface CloudConnectorStoreOptions {
  readonly readbackTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export class ConnectorStoreError extends Error {
  override readonly name = 'ConnectorStoreError';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function nullableInstant(value: unknown): value is string | null {
  return value === null || canonicalInstant(value);
}

function failureCode(value: unknown): value is ConnectorFailureCode | null {
  return value === null || (typeof value === 'string' && FAILURE_CODES.has(value as ConnectorFailureCode));
}

function observationFrom(value: unknown, strict: boolean): ConnectorObservation {
  if (!isRecord(value) || (strict && !hasExactKeys(value, OBSERVATION_KEYS))
    || !nullableInstant(value['configuredAt'])
    || !nullableInstant(value['lastAttemptAt'])
    || !nullableInstant(value['lastSuccessAt'])
    || !failureCode(value['lastFailure'])
    || !Number.isInteger(value['importedDocuments'])
    || (value['importedDocuments'] as number) < 0
    || (value['importedDocuments'] as number) > MAX_IMPORTED_DOCUMENTS) {
    throw new ConnectorStoreError('invalid connector observation');
  }
  return {
    configuredAt: value['configuredAt'],
    lastAttemptAt: value['lastAttemptAt'],
    lastSuccessAt: value['lastSuccessAt'],
    lastFailure: value['lastFailure'],
    importedDocuments: value['importedDocuments'] as number,
  };
}

function assertConnectorId(id: string): asserts id is ConnectorId {
  if (!CONNECTOR_ID_SET.has(id)) throw new ConnectorStoreError('invalid connector id');
}

function workspaceDigest(workspace: string): string {
  if (!WORKSPACE_SHAPE.test(workspace)) throw new ConnectorStoreError('invalid workspace');
  return createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32);
}

function idFor(digest: string, connectorId: ConnectorId): string {
  if (!DIGEST_SHAPE.test(digest)) throw new ConnectorStoreError('invalid workspace digest');
  return `lacuna:connector-state:${digest}:${connectorId}`;
}

function unwrap(source: InspectedSource, expectedId: string): string {
  if (source.id !== expectedId) throw new ConnectorStoreError('connector state id mismatch');
  try {
    const value: unknown = JSON.parse(source.envelope);
    if (!isRecord(value)) throw new ConnectorStoreError('invalid connector state envelope');
    const content = value['content'];
    if (!isRecord(content) || typeof content['text'] !== 'string') {
      throw new ConnectorStoreError('invalid connector state envelope');
    }
    return content['text'];
  } catch (error) {
    if (error instanceof ConnectorStoreError) throw error;
    throw new ConnectorStoreError('invalid connector state envelope');
  }
}

function parse(text: string, expectedDigest: string, expectedConnectorId: ConnectorId): StoredConnectorState {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value) || !hasExactKeys(value, RECORD_KEYS)
      || value['version'] !== 1
      || value['workspaceDigest'] !== expectedDigest
      || value['connectorId'] !== expectedConnectorId) {
      throw new ConnectorStoreError('invalid connector state record');
    }
    const connectorId = value['connectorId'];
    if (typeof connectorId !== 'string') throw new ConnectorStoreError('invalid connector state record');
    assertConnectorId(connectorId);
    return {
      version: 1,
      workspaceDigest: expectedDigest,
      connectorId,
      observation: observationFrom(value['observation'], true),
    };
  } catch (error) {
    if (error instanceof ConnectorStoreError) throw error;
    throw new ConnectorStoreError('invalid connector state record');
  }
}

function storedState(
  digest: string,
  connectorId: ConnectorId,
  next: ConnectorObservation,
): StoredConnectorState {
  assertConnectorId(connectorId);
  return {
    version: 1,
    workspaceDigest: digest,
    connectorId,
    observation: observationFrom(next, false),
  };
}

function chronology(observation: ConnectorObservation): string {
  return observation.lastAttemptAt
    ?? observation.configuredAt
    ?? observation.lastSuccessAt
    ?? '1970-01-01T00:00:00.000Z';
}

function sameObservation(left: ConnectorObservation, right: ConnectorObservation): boolean {
  return left.configuredAt === right.configuredAt
    && left.lastAttemptAt === right.lastAttemptAt
    && left.lastSuccessAt === right.lastSuccessAt
    && left.lastFailure === right.lastFailure
    && left.importedDocuments === right.importedDocuments;
}

function nonNegativeInteger(value: number | undefined, fallback: number, name: string): number {
  const held = value ?? fallback;
  if (!Number.isSafeInteger(held) || held < 0) throw new ConnectorStoreError(`invalid ${name}`);
  return held;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Exact per-connector records outside workspace memory.
 *
 * Mutations for one record are ordered inside this process. Hydra exposes no
 * compare-and-swap primitive, so this deliberately does not claim atomic
 * ordering between different serverless instances. Exact readback makes a
 * lost or superseded write visible to the caller whenever it is observed.
 */
export class CloudConnectorStore implements ConnectorStore {
  readonly #cloud: HydraCloud;
  readonly #readbackTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #now: () => number;
  readonly #wait: (milliseconds: number) => Promise<void>;
  readonly #mutations = new Map<string, Promise<void>>();

  constructor(cloud: HydraCloud, options: CloudConnectorStoreOptions = {}) {
    this.#cloud = cloud;
    this.#readbackTimeoutMs = nonNegativeInteger(
      options.readbackTimeoutMs,
      DEFAULT_READBACK_TIMEOUT_MS,
      'readback timeout',
    );
    this.#pollIntervalMs = nonNegativeInteger(
      options.pollIntervalMs,
      DEFAULT_POLL_INTERVAL_MS,
      'poll interval',
    );
    if (this.#readbackTimeoutMs > 0 && this.#pollIntervalMs === 0) {
      throw new ConnectorStoreError('invalid poll interval');
    }
    this.#now = options.now ?? (() => Date.now());
    this.#wait = options.wait ?? delay;
  }

  async #readOne(digest: string, connectorId: ConnectorId): Promise<StoredConnectorState | null> {
    const id = idFor(digest, connectorId);
    const source = await this.#cloud.inspect(id, 10_000, COLLECTION);
    if (source === null) return null;
    return parse(unwrap(source, id), digest, connectorId);
  }

  async get(workspace: string): Promise<ConnectorWorkspaceState> {
    const digest = workspaceDigest(workspace);
    const result: Partial<Record<ConnectorId, ConnectorObservation>> = {};
    const states = await Promise.all(CONNECTOR_IDS.map(
      (connectorId) => this.#readOne(digest, connectorId),
    ));
    for (let index = 0; index < CONNECTOR_IDS.length; index += 1) {
      const connectorId = CONNECTOR_IDS[index];
      const state = states[index];
      if (connectorId === undefined) continue;
      if (state !== null && state !== undefined) result[connectorId] = state.observation;
    }
    return result;
  }

  async #verifyReadback(
    digest: string,
    connectorId: ConnectorId,
    expectedText: string,
  ): Promise<void> {
    const id = idFor(digest, connectorId);
    const deadline = this.#now() + this.#readbackTimeoutMs;
    let sawMismatch = false;
    for (;;) {
      const inspectBudget = Math.max(1, Math.min(10_000, deadline - this.#now()));
      const source = await this.#cloud.inspect(id, inspectBudget, COLLECTION);
      if (source !== null) {
        const text = unwrap(source, id);
        parse(text, digest, connectorId);
        if (text === expectedText) return;
        sawMismatch = true;
      }
      const remaining = deadline - this.#now();
      if (remaining <= 0) {
        throw new ConnectorStoreError(
          sawMismatch
            ? 'connector state readback did not match'
            : 'connector state was not readable',
        );
      }
      await this.#wait(Math.min(this.#pollIntervalMs, remaining));
    }
  }

  async #write(
    digest: string,
    connectorId: ConnectorId,
    next: ConnectorObservation,
  ): Promise<ConnectorPutResult> {
    const current = await this.#readOne(digest, connectorId);
    if (current !== null) {
      const order = chronology(next).localeCompare(chronology(current.observation));
      if (order < 0) return 'stale';
      if (order === 0) return sameObservation(next, current.observation) ? 'unchanged' : 'stale';
    }

    const state = storedState(digest, connectorId, next);
    const id = idFor(digest, connectorId);
    const text = JSON.stringify(state);
    const results: readonly IngestResult[] = await this.#cloud.ingestApp([{
      id,
      title: 'Lacuna connector state',
      type: 'custom',
      timestamp: chronology(next),
      text,
      metadata: { lacuna_record: 'connector_state', connector_id: connectorId },
    }], COLLECTION);
    const receipt = results[0];
    if (results.length !== 1 || receipt?.id !== id
      || !ACCEPTED_RECEIPTS.has(receipt.status)
      || (receipt.error !== null && receipt.error !== '')) {
      throw new ConnectorStoreError('connector state write was refused');
    }
    await this.#verifyReadback(digest, connectorId, text);
    return 'stored';
  }

  async put(
    workspace: string,
    connectorId: ConnectorId,
    next: ConnectorObservation,
  ): Promise<ConnectorPutResult> {
    const digest = workspaceDigest(workspace);
    assertConnectorId(connectorId);
    const sanitized = observationFrom(next, false);
    const key = idFor(digest, connectorId);
    const previous = this.#mutations.get(key) ?? Promise.resolve();
    const operation = previous.catch(() => undefined).then(
      () => this.#write(digest, connectorId, sanitized),
    );
    const settled = operation.then(() => undefined, () => undefined);
    this.#mutations.set(key, settled);
    try {
      return await operation;
    } finally {
      if (this.#mutations.get(key) === settled) this.#mutations.delete(key);
    }
  }
}
