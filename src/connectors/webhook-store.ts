import type { HydraCloud, IngestResult, InspectedSource } from '../hydra/cloud.js';

export interface WebhookStoreControl {
  readonly signal?: AbortSignal;
  readonly deadlineMs?: number;
}

export interface StoredWebhookEndpoint {
  readonly version: 1;
  readonly keyFingerprint: string;
  readonly endpointId: string;
  readonly ownerDigest: string;
  readonly workspaceCiphertext: string;
  readonly workspaceIv: string;
  readonly workspaceTag: string;
  readonly lifecycle: 'active' | 'revoked';
  readonly createdAt: string;
  readonly revokedAt: string | null;
}

export interface StoredWebhookActiveIndex {
  readonly version: 1;
  readonly keyFingerprint: string;
  readonly ownerDigest: string;
  readonly endpointId: string;
  readonly configuredAt: string;
}

export interface StoredWebhookReplayEntry {
  readonly eventAddress: string;
  readonly rawDigest: string;
  readonly normalizedDigest: string;
  readonly parserVersion: 'webhook-v1';
  readonly acceptedAt: string;
  readonly accepted: true;
}

export interface StoredWebhookReplayWindow {
  readonly version: 1;
  readonly keyFingerprint: string;
  readonly endpointId: string;
  readonly entries: readonly StoredWebhookReplayEntry[];
}

/** Dedicated durable namespace for encrypted webhook lifecycle and replay state. */
export interface WebhookRecordStore {
  getEndpoint(endpointId: string, control?: WebhookStoreControl): Promise<StoredWebhookEndpoint | null>;
  putEndpoint(record: StoredWebhookEndpoint, control?: WebhookStoreControl): Promise<void>;
  getActive(ownerDigest: string, control?: WebhookStoreControl): Promise<StoredWebhookActiveIndex | null>;
  putActive(record: StoredWebhookActiveIndex, control?: WebhookStoreControl): Promise<void>;
  getReplay(endpointId: string, control?: WebhookStoreControl): Promise<StoredWebhookReplayWindow | null>;
  putReplay(record: StoredWebhookReplayWindow, control?: WebhookStoreControl): Promise<void>;
}

const COLLECTION = 'lacuna-webhooks';
const ACCEPTED_RECEIPTS = new Set(['queued', 'completed']);
const SHA256 = /^[0-9a-f]{64}$/u;
const ENDPOINT_ID = /^[A-Za-z0-9_-]{22}$/u;
const DEFAULT_READBACK_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 100;

export class WebhookStoreError extends Error {
  override readonly name = 'WebhookStoreError';
}

export interface CloudWebhookRecordStoreOptions {
  readonly readbackTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly now?: () => number;
  readonly wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

type WebhookRecord = StoredWebhookEndpoint | StoredWebhookActiveIndex | StoredWebhookReplayWindow;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalBase64url(value: unknown, bytes: number): value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/u.test(value)) return false;
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === bytes && decoded.toString('base64url') === value;
  } catch {
    return false;
  }
}

function endpoint(value: unknown, expectedId: string): StoredWebhookEndpoint {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'keyFingerprint', 'endpointId', 'ownerDigest', 'workspaceCiphertext',
    'workspaceIv', 'workspaceTag', 'lifecycle', 'createdAt', 'revokedAt',
  ]) || value['version'] !== 1 || value['endpointId'] !== expectedId || !ENDPOINT_ID.test(expectedId)
    || typeof value['keyFingerprint'] !== 'string' || !SHA256.test(value['keyFingerprint'])
    || typeof value['ownerDigest'] !== 'string' || !SHA256.test(value['ownerDigest'])
    || !canonicalBase64url(value['workspaceCiphertext'], 42)
    || !canonicalBase64url(value['workspaceIv'], 12)
    || !canonicalBase64url(value['workspaceTag'], 16)
    || (value['lifecycle'] !== 'active' && value['lifecycle'] !== 'revoked')
    || !canonicalInstant(value['createdAt'])
    || (value['revokedAt'] !== null && !canonicalInstant(value['revokedAt']))
    || (value['lifecycle'] === 'active' && value['revokedAt'] !== null)
    || (value['lifecycle'] === 'revoked' && value['revokedAt'] === null)) {
    throw new WebhookStoreError('invalid webhook endpoint record');
  }
  return value as unknown as StoredWebhookEndpoint;
}

function active(value: unknown, expectedOwner: string): StoredWebhookActiveIndex {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'keyFingerprint', 'ownerDigest', 'endpointId', 'configuredAt',
  ]) || value['version'] !== 1 || value['ownerDigest'] !== expectedOwner || !SHA256.test(expectedOwner)
    || typeof value['keyFingerprint'] !== 'string' || !SHA256.test(value['keyFingerprint'])
    || typeof value['endpointId'] !== 'string' || !ENDPOINT_ID.test(value['endpointId'])
    || !canonicalInstant(value['configuredAt'])) {
    throw new WebhookStoreError('invalid webhook active index');
  }
  return value as unknown as StoredWebhookActiveIndex;
}

function replay(value: unknown, expectedId: string): StoredWebhookReplayWindow {
  if (!isRecord(value) || !exactKeys(value, ['version', 'keyFingerprint', 'endpointId', 'entries'])
    || value['version'] !== 1 || value['endpointId'] !== expectedId || !ENDPOINT_ID.test(expectedId)
    || typeof value['keyFingerprint'] !== 'string' || !SHA256.test(value['keyFingerprint'])
    || !Array.isArray(value['entries']) || value['entries'].length > 256) {
    throw new WebhookStoreError('invalid webhook replay window');
  }
  const addresses = new Set<string>();
  for (const entry of value['entries']) {
    if (!isRecord(entry) || !exactKeys(entry, [
      'eventAddress', 'rawDigest', 'normalizedDigest', 'parserVersion', 'acceptedAt', 'accepted',
    ]) || typeof entry['eventAddress'] !== 'string' || !SHA256.test(entry['eventAddress'])
      || addresses.has(entry['eventAddress'])
      || typeof entry['rawDigest'] !== 'string' || !SHA256.test(entry['rawDigest'])
      || typeof entry['normalizedDigest'] !== 'string' || !SHA256.test(entry['normalizedDigest'])
      || entry['parserVersion'] !== 'webhook-v1' || !canonicalInstant(entry['acceptedAt'])
      || entry['accepted'] !== true) throw new WebhookStoreError('invalid webhook replay window');
    addresses.add(entry['eventAddress']);
  }
  return value as unknown as StoredWebhookReplayWindow;
}

function idFor(kind: 'endpoint' | 'owner' | 'replay', address: string): string {
  if (kind === 'owner' ? !SHA256.test(address) : !ENDPOINT_ID.test(address)) {
    throw new WebhookStoreError('invalid webhook record address');
  }
  return `lacuna:webhook:${kind}:${address}`;
}

function unwrap(source: InspectedSource, expectedId: string): string {
  if (source.id !== expectedId) throw new WebhookStoreError('webhook record id mismatch');
  try {
    const envelope: unknown = JSON.parse(source.envelope);
    if (!isRecord(envelope) || !isRecord(envelope['content'])
      || typeof envelope['content']['text'] !== 'string') {
      throw new WebhookStoreError('invalid webhook record envelope');
    }
    return envelope['content']['text'];
  } catch (error) {
    if (error instanceof WebhookStoreError) throw error;
    throw new WebhookStoreError('invalid webhook record envelope');
  }
}

function integer(value: number | undefined, fallback: number, name: string): number {
  const held = value ?? fallback;
  if (!Number.isSafeInteger(held) || held < 0) throw new WebhookStoreError(`invalid ${name}`);
  return held;
}

function defaultWait(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new WebhookStoreError('webhook store deadline'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new WebhookStoreError('webhook store deadline'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** Strict exact-readback persistence in the webhook-only Hydra collection. */
export class CloudWebhookRecordStore implements WebhookRecordStore {
  readonly #cloud: HydraCloud;
  readonly #readbackTimeoutMs: number;
  readonly #pollIntervalMs: number;
  readonly #now: () => number;
  readonly #wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(cloud: HydraCloud, options: CloudWebhookRecordStoreOptions = {}) {
    this.#cloud = cloud;
    this.#readbackTimeoutMs = integer(options.readbackTimeoutMs, DEFAULT_READBACK_TIMEOUT_MS, 'readback timeout');
    this.#pollIntervalMs = integer(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS, 'poll interval');
    if (this.#readbackTimeoutMs > 0 && this.#pollIntervalMs === 0) {
      throw new WebhookStoreError('invalid poll interval');
    }
    this.#now = options.now ?? Date.now;
    this.#wait = options.wait ?? defaultWait;
  }

  #deadline(control?: WebhookStoreControl): number {
    const deadline = Math.min(control?.deadlineMs ?? this.#now() + DEFAULT_READBACK_TIMEOUT_MS,
      this.#now() + DEFAULT_READBACK_TIMEOUT_MS);
    if (control?.signal?.aborted === true || deadline <= this.#now()) {
      throw new WebhookStoreError('webhook store deadline');
    }
    return deadline;
  }

  async #inspect(id: string, control?: WebhookStoreControl): Promise<string | null> {
    const deadline = this.#deadline(control);
    try {
      const source = await this.#cloud.inspect(
        id,
        Math.max(1, Math.min(10_000, deadline - this.#now())),
        COLLECTION,
        control?.signal,
      );
      return source === null ? null : unwrap(source, id);
    } catch (error) {
      if (error instanceof WebhookStoreError) throw error;
      throw new WebhookStoreError('webhook store read failed');
    }
  }

  async #write(
    kind: 'endpoint' | 'owner' | 'replay',
    address: string,
    record: WebhookRecord,
    control?: WebhookStoreControl,
  ): Promise<void> {
    const id = idFor(kind, address);
    const text = JSON.stringify(record);
    const deadline = this.#deadline(control);
    const operationControl = {
      ...(control?.signal === undefined ? {} : { signal: control.signal }),
      deadlineMs: deadline,
    };
    let results: readonly IngestResult[];
    try {
      results = await this.#cloud.ingestApp([{
        id,
        title: 'Lacuna webhook state',
        type: 'custom',
        timestamp: kind === 'endpoint'
          ? (record as StoredWebhookEndpoint).revokedAt ?? (record as StoredWebhookEndpoint).createdAt
          : kind === 'owner'
            ? (record as StoredWebhookActiveIndex).configuredAt
            : (record as StoredWebhookReplayWindow).entries[0]?.acceptedAt ?? '2000-01-01T00:00:00.000Z',
        text,
        metadata: { lacuna_record: kind === 'owner' ? 'webhook_active_index' : `webhook_${kind}` },
      }], COLLECTION, operationControl);
    } catch {
      throw new WebhookStoreError('webhook store write failed');
    }
    const receipt = results[0];
    if (results.length !== 1 || receipt?.id !== id || !ACCEPTED_RECEIPTS.has(receipt.status)
      || (receipt.error !== null && receipt.error !== '')) {
      throw new WebhookStoreError('webhook store write refused');
    }
    const readbackDeadline = Math.min(deadline, this.#now() + this.#readbackTimeoutMs);
    let sawMismatch = false;
    for (;;) {
      const held = await this.#inspect(id, { ...control, deadlineMs: Math.max(this.#now() + 1, readbackDeadline) });
      if (held !== null) {
        sawMismatch = true;
        if (held === text) return;
      }
      const left = readbackDeadline - this.#now();
      if (left <= 0 || this.#readbackTimeoutMs === 0) {
        throw new WebhookStoreError(sawMismatch
          ? 'webhook record readback did not match'
          : 'webhook record was not readable');
      }
      await this.#wait(Math.min(this.#pollIntervalMs, left), control?.signal);
    }
  }

  async getEndpoint(endpointId: string, control?: WebhookStoreControl): Promise<StoredWebhookEndpoint | null> {
    const text = await this.#inspect(idFor('endpoint', endpointId), control);
    if (text === null) return null;
    try {
      return endpoint(JSON.parse(text) as unknown, endpointId);
    } catch (error) {
      if (error instanceof WebhookStoreError) throw error;
      throw new WebhookStoreError('invalid webhook endpoint record');
    }
  }

  async putEndpoint(record: StoredWebhookEndpoint, control?: WebhookStoreControl): Promise<void> {
    const sanitized = endpoint(record, record.endpointId);
    await this.#write('endpoint', sanitized.endpointId, sanitized, control);
  }

  async getActive(ownerDigest: string, control?: WebhookStoreControl): Promise<StoredWebhookActiveIndex | null> {
    const text = await this.#inspect(idFor('owner', ownerDigest), control);
    if (text === null) return null;
    try {
      return active(JSON.parse(text) as unknown, ownerDigest);
    } catch (error) {
      if (error instanceof WebhookStoreError) throw error;
      throw new WebhookStoreError('invalid webhook active index');
    }
  }

  async putActive(record: StoredWebhookActiveIndex, control?: WebhookStoreControl): Promise<void> {
    const sanitized = active(record, record.ownerDigest);
    await this.#write('owner', sanitized.ownerDigest, sanitized, control);
  }

  async getReplay(endpointId: string, control?: WebhookStoreControl): Promise<StoredWebhookReplayWindow | null> {
    const text = await this.#inspect(idFor('replay', endpointId), control);
    if (text === null) return null;
    try {
      return replay(JSON.parse(text) as unknown, endpointId);
    } catch (error) {
      if (error instanceof WebhookStoreError) throw error;
      throw new WebhookStoreError('invalid webhook replay window');
    }
  }

  async putReplay(record: StoredWebhookReplayWindow, control?: WebhookStoreControl): Promise<void> {
    const sanitized = replay(record, record.endpointId);
    await this.#write('replay', sanitized.endpointId, sanitized, control);
  }
}
