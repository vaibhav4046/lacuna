import { createHash } from 'node:crypto';

import type { HydraCloud, IngestResult } from '../hydra/cloud.js';
import type {
  ConnectorFailureCode,
  ConnectorId,
  ConnectorObservation,
  ConnectorStore,
  ConnectorWorkspaceState,
} from './types.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;
const DIGEST_SHAPE = /^[0-9a-f]{32}$/u;
const COLLECTION = 'lacuna-connectors';
const MAX_IMPORTED_DOCUMENTS = 1_000_000;
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
const OBSERVATION_KEYS = new Set([
  'configuredAt', 'lastAttemptAt', 'lastSuccessAt', 'lastFailure', 'importedDocuments',
]);

interface StoredConnectorWorkspaceState {
  readonly version: 1;
  readonly workspaceDigest: string;
  readonly connectors: Readonly<Record<string, ConnectorObservation>>;
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

function observationFrom(value: unknown, strict: boolean): ConnectorObservation | null {
  if (!isRecord(value) || (strict && !hasExactKeys(value, OBSERVATION_KEYS))) return null;
  if (!nullableInstant(value['configuredAt'])
    || !nullableInstant(value['lastAttemptAt'])
    || !nullableInstant(value['lastSuccessAt'])
    || !failureCode(value['lastFailure'])
    || !Number.isInteger(value['importedDocuments'])
    || (value['importedDocuments'] as number) < 0
    || (value['importedDocuments'] as number) > MAX_IMPORTED_DOCUMENTS) return null;
  return {
    configuredAt: value['configuredAt'],
    lastAttemptAt: value['lastAttemptAt'],
    lastSuccessAt: value['lastSuccessAt'],
    lastFailure: value['lastFailure'],
    importedDocuments: value['importedDocuments'] as number,
  };
}

function workspaceDigest(workspace: string): string {
  if (!WORKSPACE_SHAPE.test(workspace)) throw new ConnectorStoreError('invalid workspace');
  return createHash('sha256').update(workspace, 'utf8').digest('hex').slice(0, 32);
}

function idFor(digest: string): string {
  if (!DIGEST_SHAPE.test(digest)) throw new ConnectorStoreError('invalid workspace digest');
  return `lacuna:connector-state:${digest}`;
}

function unwrap(envelope: string): string | null {
  try {
    const value: unknown = JSON.parse(envelope);
    if (!isRecord(value)) return null;
    const content = value['content'];
    if (!isRecord(content)) return null;
    return typeof content['text'] === 'string' ? content['text'] : null;
  } catch {
    return null;
  }
}

function parse(text: string, expectedDigest: string): ConnectorWorkspaceState | null {
  try {
    const value: unknown = JSON.parse(text);
    if (!isRecord(value)
      || !hasExactKeys(value, new Set(['version', 'workspaceDigest', 'connectors']))
      || value['version'] !== 1
      || value['workspaceDigest'] !== expectedDigest
      || !isRecord(value['connectors'])) return null;
    const connectors = value['connectors'];
    const keys = Object.keys(connectors);
    if (keys.length > CONNECTOR_IDS.length || keys.some((key) => !CONNECTOR_ID_SET.has(key))) return null;
    const result: Partial<Record<ConnectorId, ConnectorObservation>> = {};
    for (const key of keys) {
      const observation = observationFrom(connectors[key], true);
      if (observation === null) return null;
      result[key as ConnectorId] = observation;
    }
    return result;
  } catch {
    return null;
  }
}

function storedState(digest: string, next: ConnectorWorkspaceState): StoredConnectorWorkspaceState {
  const connectors: Partial<Record<ConnectorId, ConnectorObservation>> = {};
  for (const id of CONNECTOR_IDS) {
    const value = next[id];
    if (value === undefined) continue;
    const observation = observationFrom(value, false);
    if (observation === null) throw new ConnectorStoreError('invalid connector observation');
    connectors[id] = observation;
  }
  return { version: 1, workspaceDigest: digest, connectors };
}

function recordTimestamp(state: StoredConnectorWorkspaceState): string {
  const candidates = Object.values(state.connectors).flatMap((observation) => [
    observation.configuredAt,
    observation.lastAttemptAt,
    observation.lastSuccessAt,
  ]).filter((value): value is string => value !== null);
  return candidates.sort().at(-1) ?? '1970-01-01T00:00:00.000Z';
}

/** Exact-id connector observations, separate from every workspace memory collection. */
export class CloudConnectorStore implements ConnectorStore {
  readonly #cloud: HydraCloud;
  readonly #collection: string;

  constructor(cloud: HydraCloud, collection = COLLECTION) {
    this.#cloud = cloud;
    this.#collection = collection;
  }

  async get(workspace: string): Promise<ConnectorWorkspaceState> {
    const digest = workspaceDigest(workspace);
    const id = idFor(digest);
    const source = await this.#cloud.inspect(id, 10_000, this.#collection);
    if (source === null || source.id !== id) return {};
    const text = unwrap(source.envelope);
    if (text === null) return {};
    return parse(text, digest) ?? {};
  }

  async put(workspace: string, next: ConnectorWorkspaceState): Promise<void> {
    const digest = workspaceDigest(workspace);
    const state = storedState(digest, next);
    const id = idFor(digest);
    const results: readonly IngestResult[] = await this.#cloud.ingestApp([{
      id,
      title: 'Lacuna connector state',
      type: 'custom',
      timestamp: recordTimestamp(state),
      text: JSON.stringify(state),
      metadata: { lacuna_record: 'connector_state' },
    }], this.#collection);
    const result = results[0];
    if (results.length !== 1 || result?.id !== id
      || !new Set(['queued', 'completed']).has(result.status)
      || (result.error !== null && result.error !== '')) {
      throw new ConnectorStoreError('connector state write was refused');
    }
  }
}
