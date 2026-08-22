import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes as nodeRandomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import {
  ConnectorNormalizationError,
  prepareConnectorDocument,
  type ConnectorDocumentInput,
} from './normalize.js';
import type { ConnectorRunResult } from './run.js';
import type {
  StoredWebhookActiveIndex,
  StoredWebhookEndpoint,
  StoredWebhookReplayEntry,
  StoredWebhookReplayWindow,
  WebhookRecordStore,
  WebhookStoreControl,
} from './webhook-store.js';

const WORKSPACE_SHAPE = /^lacuna-ws-[0-9a-f]{32}$/u;
const ENDPOINT_SHAPE = /^[A-Za-z0-9_-]{22}$/u;
const EVENT_SHAPE = /^[A-Za-z0-9_:-]{16,128}$/u;
const TIMESTAMP_SHAPE = /^(?:0|[1-9][0-9]{0,15})$/u;
const SIGNATURE_SHAPE = /^v1=([0-9a-f]{64})$/u;
const HEX_KEY_SHAPE = /^[0-9a-f]{64}$/u;
const BASE64URL_KEY_SHAPE = /^[A-Za-z0-9_-]{43}$/u;
const SHA256_SHAPE = /^[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_REPLAY_ENTRIES = 256;
const BODY_TIMEOUT_MS = 5_000;
const LOCK_TIMEOUT_MS = 5_000;
const STORE_TIMEOUT_MS = 10_000;
const RUNNER_ADMISSION_MS = 200_000;
const FINALIZATION_RESERVE_MS = 10_000;
const MAX_LOCK_WAITERS = 32;
const MAX_ACTIVE_BODY_LEASES = 3;
const PARSER_VERSION = 'webhook-v1' as const;
const KEY_FINGERPRINT_DOMAIN = 'sha256';

export interface WebhookRequestControl {
  readonly requestSignal: AbortSignal;
  readonly startedAtMs: number;
  readonly settlementDeadlineMs: number;
}

export interface IssuedWebhook {
  readonly created: boolean;
  readonly endpointId: string;
  readonly endpoint: string;
  readonly secret: string | null;
  readonly configuredAt: string;
}

export interface WebhookState {
  readonly configured: boolean;
  readonly endpointId: string | null;
  readonly endpoint: string | null;
  readonly configuredAt: string | null;
}

export type WebhookReceiptState = 'accepted' | 'duplicate' | 'conflict' | 'failed' | 'indeterminate';

export interface WebhookReceipt {
  readonly state: WebhookReceiptState;
  readonly acceptedDocuments: number;
  readonly searchableDocuments: number;
  readonly failedDocuments: number;
  readonly acceptedRecords: number;
  readonly refusedRecords: number;
  readonly failure: ConnectorRunResult['failure'];
  readonly observationWrite: ConnectorRunResult['observationWrite'] | null;
  readonly indeterminateSubmission: boolean;
}

interface RunnerLike {
  run(workspace: string, request: unknown, options?: unknown): Promise<ConnectorRunResult>;
}

export interface WebhookServiceOptions {
  readonly masterKey: Uint8Array;
  readonly store: WebhookRecordStore;
  readonly runner: RunnerLike;
  readonly siteOrigin: string;
  readonly now?: () => number;
  readonly randomBytes?: (size: number) => Uint8Array;
}

export class WebhookRejectedError extends Error {
  override readonly name = 'WebhookRejectedError';
  readonly code = 'webhook_rejected';
  readonly status = 401;

  constructor() {
    super('webhook_rejected');
  }
}

export class WebhookBodyError extends Error {
  override readonly name = 'WebhookBodyError';
  readonly code: 'invalid_webhook_body' | 'webhook_body_too_large';
  readonly status: 400 | 413;

  constructor(status: 400 | 413 = 400) {
    super(status === 413 ? 'webhook_body_too_large' : 'invalid_webhook_body');
    this.status = status;
    this.code = status === 413 ? 'webhook_body_too_large' : 'invalid_webhook_body';
  }
}

class WebhookDeadlineError extends Error {
  override readonly name = 'WebhookDeadlineError';
}

interface HeaderValues {
  readonly timestamp: string;
  readonly timestampSeconds: number;
  readonly eventId: string;
  readonly signature: Buffer;
}

interface LockWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  readonly abort?: () => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface LockEntry {
  held: boolean;
  readonly waiters: LockWaiter[];
}

const ownerLocks = new Map<string, LockEntry>();

function base64url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decodeCanonicalBase64url(value: unknown, bytes: number): Buffer | null {
  if (typeof value !== 'string' || !new RegExp(`^[A-Za-z0-9_-]{${Math.ceil(bytes * 4 / 3)}}$`, 'u').test(value)) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === bytes && decoded.toString('base64url') === value ? decoded : null;
  } catch {
    return null;
  }
}

export function parseWebhookMasterKey(value: string | undefined): Buffer | null {
  if (value === undefined) return null;
  if (HEX_KEY_SHAPE.test(value)) return Buffer.from(value, 'hex');
  if (!BASE64URL_KEY_SHAPE.test(value)) return null;
  return decodeCanonicalBase64url(value, 32);
}

/** Removes bearer-like endpoint path segments before application logging. */
export function redactWebhookPath(path: string): string {
  return path.replace(
    /^(\/api\/(?:workspace\/connectors|connectors)\/webhook)\/[^/]+$/u,
    '$1/:redacted',
  );
}

function endpointIdValid(value: unknown): value is string {
  return typeof value === 'string'
    && ENDPOINT_SHAPE.test(value)
    && decodeCanonicalBase64url(value, 16) !== null;
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length && actual.every((key) => expected.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hmac(master: Uint8Array, value: string): Buffer {
  return createHmac('sha256', master).update(value, 'utf8').digest();
}

function secretFor(master: Uint8Array, endpointId: string): Buffer {
  return hmac(master, `lacuna:webhook:v1:secret\0${endpointId}`);
}

function ownerFor(master: Uint8Array, workspace: string): string {
  return hmac(master, `lacuna:webhook:v1:owner\0${workspace}`).toString('hex');
}

function eventFor(master: Uint8Array, endpointId: string, eventId: string): string {
  return hmac(master, `lacuna:webhook:v1:event\0${endpointId}\0${eventId}`).toString('hex');
}

function aeadKey(master: Uint8Array): Buffer {
  return hmac(master, 'lacuna:webhook:v1:aead');
}

function fingerprint(master: Uint8Array): string {
  return createHash(KEY_FINGERPRINT_DOMAIN).update(master).digest('hex');
}

function aad(endpointId: string): Buffer {
  return Buffer.from(`lacuna:webhook:v1:endpoint\0${endpointId}`, 'utf8');
}

function rejected(): never {
  throw new WebhookRejectedError();
}

function remaining(deadlineMs: number, now: () => number): number {
  return deadlineMs - now();
}

function storeControl(deadlineMs: number, now: () => number, signal?: AbortSignal): WebhookStoreControl {
  if (!Number.isFinite(deadlineMs) || remaining(deadlineMs, now) <= 0 || signal?.aborted === true) {
    throw new WebhookDeadlineError();
  }
  return { deadlineMs, ...(signal === undefined ? {} : { signal }) };
}

function storeDeadline(outerDeadlineMs: number, now: () => number): number {
  return Math.min(outerDeadlineMs, now() + STORE_TIMEOUT_MS);
}

function siteOrigin(value: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('invalid webhook site origin');
  }
  return parsed.origin;
}

function endpointRecord(value: unknown, id: string, keyFingerprint: string): StoredWebhookEndpoint | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'keyFingerprint', 'endpointId', 'ownerDigest', 'workspaceCiphertext',
    'workspaceIv', 'workspaceTag', 'lifecycle', 'createdAt', 'revokedAt',
  ])
    || value['version'] !== 1 || value['keyFingerprint'] !== keyFingerprint
    || value['endpointId'] !== id || !endpointIdValid(value['endpointId'])
    || typeof value['ownerDigest'] !== 'string' || !SHA256_SHAPE.test(value['ownerDigest'])
    || decodeCanonicalBase64url(value['workspaceIv'], 12) === null
    || decodeCanonicalBase64url(value['workspaceTag'], 16) === null
    || typeof value['workspaceCiphertext'] !== 'string'
    || decodeCanonicalBase64url(value['workspaceCiphertext'], 42) === null
    || (value['lifecycle'] !== 'active' && value['lifecycle'] !== 'revoked')
    || !canonicalInstant(value['createdAt'])
    || (value['revokedAt'] !== null && !canonicalInstant(value['revokedAt']))
    || (value['lifecycle'] === 'active' && value['revokedAt'] !== null)
    || (value['lifecycle'] === 'revoked' && value['revokedAt'] === null)) return null;
  return value as unknown as StoredWebhookEndpoint;
}

function activeRecord(
  value: unknown,
  ownerDigest: string,
  keyFingerprint: string,
): StoredWebhookActiveIndex | null {
  if (!isRecord(value) || !exactKeys(value, [
    'version', 'keyFingerprint', 'ownerDigest', 'endpointId', 'configuredAt',
  ]) || value['version'] !== 1 || value['keyFingerprint'] !== keyFingerprint
    || value['ownerDigest'] !== ownerDigest || !SHA256_SHAPE.test(ownerDigest)
    || !endpointIdValid(value['endpointId']) || !canonicalInstant(value['configuredAt'])) return null;
  return value as unknown as StoredWebhookActiveIndex;
}

function replayRecord(
  value: unknown,
  endpointId: string,
  keyFingerprint: string,
): StoredWebhookReplayWindow | null {
  if (value === null) return {
    version: 1, keyFingerprint, endpointId, entries: [],
  };
  if (!isRecord(value) || !exactKeys(value, ['version', 'keyFingerprint', 'endpointId', 'entries'])
    || value['version'] !== 1 || value['keyFingerprint'] !== keyFingerprint
    || value['endpointId'] !== endpointId || !Array.isArray(value['entries'])
    || value['entries'].length > MAX_REPLAY_ENTRIES) return null;
  const addresses = new Set<string>();
  const entries: StoredWebhookReplayEntry[] = [];
  for (const item of value['entries']) {
    if (!isRecord(item) || !exactKeys(item, [
      'eventAddress', 'rawDigest', 'normalizedDigest', 'parserVersion', 'acceptedAt', 'accepted',
    ]) || typeof item['eventAddress'] !== 'string' || !SHA256_SHAPE.test(item['eventAddress'])
      || addresses.has(item['eventAddress'])
      || typeof item['rawDigest'] !== 'string' || !SHA256_SHAPE.test(item['rawDigest'])
      || typeof item['normalizedDigest'] !== 'string' || !SHA256_SHAPE.test(item['normalizedDigest'])
      || item['parserVersion'] !== PARSER_VERSION || !canonicalInstant(item['acceptedAt'])
      || item['accepted'] !== true) return null;
    addresses.add(item['eventAddress']);
    entries.push(item as unknown as StoredWebhookReplayEntry);
  }
  return { version: 1, keyFingerprint, endpointId, entries };
}

function encryptWorkspace(
  master: Uint8Array,
  endpointId: string,
  workspace: string,
  iv: Uint8Array,
): Pick<StoredWebhookEndpoint, 'workspaceCiphertext' | 'workspaceIv' | 'workspaceTag'> {
  if (iv.byteLength !== 12) throw new Error('invalid webhook iv');
  const cipher = createCipheriv('aes-256-gcm', aeadKey(master), iv);
  cipher.setAAD(aad(endpointId));
  const ciphertext = Buffer.concat([cipher.update(workspace, 'utf8'), cipher.final()]);
  return {
    workspaceCiphertext: base64url(ciphertext),
    workspaceIv: base64url(iv),
    workspaceTag: base64url(cipher.getAuthTag()),
  };
}

function decryptWorkspace(master: Uint8Array, record: StoredWebhookEndpoint): string | null {
  try {
    const iv = decodeCanonicalBase64url(record.workspaceIv, 12);
    const tag = decodeCanonicalBase64url(record.workspaceTag, 16);
    const ciphertext = Buffer.from(record.workspaceCiphertext, 'base64url');
    if (iv === null || tag === null || ciphertext.toString('base64url') !== record.workspaceCiphertext) return null;
    const decipher = createDecipheriv('aes-256-gcm', aeadKey(master), iv);
    decipher.setAAD(aad(record.endpointId));
    decipher.setAuthTag(tag);
    const workspace = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return WORKSPACE_SHAPE.test(workspace) ? workspace : null;
  } catch {
    return null;
  }
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function acquireOwnerLock(
  key: string,
  deadlineMs: number,
  now: () => number,
  signal?: AbortSignal,
): Promise<() => void> {
  if (signal?.aborted === true || deadlineMs <= now()) throw new WebhookDeadlineError();
  let entry = ownerLocks.get(key);
  if (entry === undefined) {
    entry = { held: true, waiters: [] };
    ownerLocks.set(key, entry);
    return releaseFor(key, entry);
  }
  if (!entry.held) {
    entry.held = true;
    return releaseFor(key, entry);
  }
  if (entry.waiters.length >= MAX_LOCK_WAITERS) throw new WebhookDeadlineError();
  return new Promise<() => void>((resolve, reject) => {
    const waitMs = Math.max(1, deadlineMs - now());
    const waiter: LockWaiter = {
      resolve,
      reject,
      ...(signal === undefined ? {} : { signal }),
      timer: setTimeout(() => fail(new WebhookDeadlineError()), waitMs),
    };
    const fail = (error: Error) => {
      const index = entry!.waiters.indexOf(waiter);
      if (index >= 0) entry!.waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      if (waiter.abort !== undefined && waiter.signal !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.abort);
      }
      if (!entry!.held && entry!.waiters.length === 0) ownerLocks.delete(key);
      reject(error);
    };
    if (signal !== undefined) {
      const abort = () => fail(new WebhookDeadlineError());
      (waiter as { abort?: () => void }).abort = abort;
      signal.addEventListener('abort', abort, { once: true });
    }
    entry!.waiters.push(waiter);
  });
}

function releaseFor(key: string, entry: LockEntry): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = entry.waiters.shift();
    if (next === undefined) {
      entry.held = false;
      ownerLocks.delete(key);
      return;
    }
    clearTimeout(next.timer);
    if (next.abort !== undefined && next.signal !== undefined) {
      next.signal.removeEventListener('abort', next.abort);
    }
    entry.held = true;
    next.resolve(releaseFor(key, entry));
  };
}

function headersFrom(rawHeaders: readonly string[]): HeaderValues {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) rejected();
  const wanted = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== 'string' || typeof value !== 'string') rejected();
    const lower = name.toLowerCase();
    if (lower === 'x-lacuna-timestamp' || lower === 'x-lacuna-event-id' || lower === 'x-lacuna-signature') {
      const values = wanted.get(lower) ?? [];
      values.push(value);
      wanted.set(lower, values);
    }
  }
  const timestampValues = wanted.get('x-lacuna-timestamp');
  const eventValues = wanted.get('x-lacuna-event-id');
  const signatureValues = wanted.get('x-lacuna-signature');
  if (timestampValues?.length !== 1 || eventValues?.length !== 1 || signatureValues?.length !== 1) rejected();
  const timestamp = timestampValues[0]!;
  const eventId = eventValues[0]!;
  const signatureText = signatureValues[0]!;
  if (timestamp.includes(',') || eventId.includes(',') || signatureText.includes(',')
    || !TIMESTAMP_SHAPE.test(timestamp) || !EVENT_SHAPE.test(eventId)) rejected();
  const matched = SIGNATURE_SHAPE.exec(signatureText);
  if (matched === null) rejected();
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds)) rejected();
  return { timestamp, timestampSeconds, eventId, signature: Buffer.from(matched[1]!, 'hex') };
}

function timestampValid(timestampSeconds: number, nowMs: number): boolean {
  return Math.abs(Math.floor(nowMs / 1_000) - timestampSeconds) <= 300;
}

function rawDigest(body: Uint8Array): string {
  return createHash('sha256').update(body).digest('hex');
}

function safeString(value: string): boolean {
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function documentFrom(body: Buffer, signedTimestampSeconds: number): ConnectorDocumentInput | null {
  if (body.byteLength >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) return null;
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    return null;
  }
  if (decoded.startsWith('\ufeff') || !safeString(decoded)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !exactKeys(parsed, ['title', 'text', 'observed_at'])
    || typeof parsed['title'] !== 'string' || typeof parsed['text'] !== 'string'
    || !safeString(parsed['title']) || !safeString(parsed['text'])
    || parsed['text'].length > 20_000 || !canonicalInstant(parsed['observed_at'])) return null;
  const observedMs = Date.parse(parsed['observed_at']);
  if (observedMs < Date.parse('2000-01-01T00:00:00.000Z')
    || observedMs > (signedTimestampSeconds * 1_000) + 300_000) return null;
  return {
    title: parsed['title'],
    text: parsed['text'],
    provenance: {
      connectorId: 'webhook',
      sourceUrl: null,
      mediaType: 'application/json',
      observedAt: parsed['observed_at'],
      webhook: {
        schemaVersion: 1,
        rawDigest: rawDigest(body),
        parserVersion: PARSER_VERSION,
      },
    },
  };
}

function emptyReceipt(state: WebhookReceiptState, failure: ConnectorRunResult['failure'] = null): WebhookReceipt {
  return {
    state,
    acceptedDocuments: 0,
    searchableDocuments: 0,
    failedDocuments: state === 'failed' ? 1 : 0,
    acceptedRecords: 0,
    refusedRecords: 0,
    failure,
    observationWrite: null,
    indeterminateSubmission: false,
  };
}

function receiptFrom(result: ConnectorRunResult, state: WebhookReceiptState): WebhookReceipt {
  return {
    state,
    acceptedDocuments: result.acceptedDocuments,
    searchableDocuments: result.searchableDocuments,
    failedDocuments: result.failedDocuments,
    acceptedRecords: result.acceptedRecords,
    refusedRecords: result.refusedRecords,
    failure: result.failure,
    observationWrite: result.observationWrite,
    indeterminateSubmission: result.indeterminateSubmission,
  };
}

export class WebhookService {
  readonly #master: Buffer;
  readonly #keyFingerprint: string;
  readonly #store: WebhookRecordStore;
  readonly #runner: RunnerLike;
  readonly #siteOrigin: string;
  readonly #now: () => number;
  readonly #randomBytes: (size: number) => Uint8Array;

  constructor(options: WebhookServiceOptions) {
    if (!(options.masterKey instanceof Uint8Array) || options.masterKey.byteLength !== 32) {
      throw new Error('invalid webhook master key');
    }
    this.#master = Buffer.from(options.masterKey);
    this.#keyFingerprint = fingerprint(this.#master);
    this.#store = options.store;
    this.#runner = options.runner;
    this.#siteOrigin = siteOrigin(options.siteOrigin);
    this.#now = options.now ?? Date.now;
    this.#randomBytes = options.randomBytes ?? nodeRandomBytes;
  }

  #endpoint(endpointId: string): string {
    return `${this.#siteOrigin}/api/connectors/webhook/${endpointId}`;
  }

  /** Cheap syntax/freshness admission performed before the entity is read. */
  admit(endpointId: string, rawHeaders: readonly string[]): void {
    if (!endpointIdValid(endpointId)) rejected();
    const headers = headersFrom(rawHeaders);
    if (!timestampValid(headers.timestampSeconds, this.#now())) rejected();
  }

  async #active(workspace: string, deadlineMs: number): Promise<{
    index: StoredWebhookActiveIndex;
    endpoint: StoredWebhookEndpoint;
  } | null> {
    const ownerDigest = ownerFor(this.#master, workspace);
    const rawIndex = await this.#store.getActive(
      ownerDigest,
      storeControl(storeDeadline(deadlineMs, this.#now), this.#now),
    );
    if (rawIndex === null) return null;
    const index = activeRecord(rawIndex, ownerDigest, this.#keyFingerprint);
    if (index === null) throw new Error('invalid webhook state');
    const rawEndpoint = await this.#store.getEndpoint(
      index.endpointId,
      storeControl(storeDeadline(deadlineMs, this.#now), this.#now),
    );
    // Endpoint-first issuance can leave a valid pointer whose endpoint was
    // subsequently lost. Exact absence is inert; a present malformed record
    // still fails closed below.
    if (rawEndpoint === null) return null;
    const endpoint = endpointRecord(rawEndpoint, index.endpointId, this.#keyFingerprint);
    if (endpoint === null || endpoint.ownerDigest !== ownerDigest
      || decryptWorkspace(this.#master, endpoint) !== workspace) throw new Error('invalid webhook state');
    if (endpoint.lifecycle !== 'active') return null;
    return { index, endpoint };
  }

  async issue(workspace: string): Promise<IssuedWebhook> {
    if (!WORKSPACE_SHAPE.test(workspace)) throw new Error('invalid workspace');
    const ownerDigest = ownerFor(this.#master, workspace);
    const deadlineMs = this.#now() + 30_000;
    const release = await acquireOwnerLock(ownerDigest, this.#now() + LOCK_TIMEOUT_MS, this.#now);
    try {
      const current = await this.#active(workspace, deadlineMs);
      if (current !== null) {
        return {
          created: false,
          endpointId: current.endpoint.endpointId,
          endpoint: this.#endpoint(current.endpoint.endpointId),
          secret: null,
          configuredAt: current.index.configuredAt,
        };
      }
      const endpointBytes = this.#randomBytes(16);
      if (endpointBytes.byteLength !== 16) throw new Error('invalid webhook entropy');
      const endpointId = base64url(endpointBytes);
      if (!endpointIdValid(endpointId)) throw new Error('invalid webhook endpoint id');
      const configuredAt = new Date(this.#now()).toISOString();
      const iv = this.#randomBytes(12);
      const encrypted = encryptWorkspace(this.#master, endpointId, workspace, iv);
      const endpoint: StoredWebhookEndpoint = {
        version: 1,
        keyFingerprint: this.#keyFingerprint,
        endpointId,
        ownerDigest,
        ...encrypted,
        lifecycle: 'active',
        createdAt: configuredAt,
        revokedAt: null,
      };
      await this.#store.putEndpoint(endpoint, storeControl(storeDeadline(deadlineMs, this.#now), this.#now));
      const endpointReadback = endpointRecord(await this.#store.getEndpoint(
        endpointId,
        storeControl(storeDeadline(deadlineMs, this.#now), this.#now),
      ), endpointId, this.#keyFingerprint);
      if (endpointReadback === null || !same(endpointReadback, endpoint)) throw new Error('webhook endpoint readback failed');
      const index: StoredWebhookActiveIndex = {
        version: 1,
        keyFingerprint: this.#keyFingerprint,
        ownerDigest,
        endpointId,
        configuredAt,
      };
      await this.#store.putActive(index, storeControl(storeDeadline(deadlineMs, this.#now), this.#now));
      const indexReadback = activeRecord(await this.#store.getActive(
        ownerDigest,
        storeControl(storeDeadline(deadlineMs, this.#now), this.#now),
      ), ownerDigest, this.#keyFingerprint);
      if (indexReadback === null || !same(indexReadback, index)) throw new Error('webhook index readback failed');
      return {
        created: true,
        endpointId,
        endpoint: this.#endpoint(endpointId),
        secret: base64url(secretFor(this.#master, endpointId)),
        configuredAt,
      };
    } finally {
      release();
    }
  }

  async state(workspace: string): Promise<WebhookState> {
    if (!WORKSPACE_SHAPE.test(workspace)) throw new Error('invalid workspace');
    const current = await this.#active(workspace, this.#now() + 30_000);
    if (current === null) return { configured: false, endpointId: null, endpoint: null, configuredAt: null };
    return {
      configured: true,
      endpointId: current.endpoint.endpointId,
      endpoint: this.#endpoint(current.endpoint.endpointId),
      configuredAt: current.index.configuredAt,
    };
  }

  async revoke(workspace: string, suppliedEndpointId: string): Promise<boolean> {
    if (!WORKSPACE_SHAPE.test(workspace)) throw new Error('invalid workspace');
    const ownerDigest = ownerFor(this.#master, workspace);
    const deadlineMs = this.#now() + 30_000;
    const release = await acquireOwnerLock(ownerDigest, this.#now() + LOCK_TIMEOUT_MS, this.#now);
    try {
      const rawIndex = await this.#store.getActive(ownerDigest, storeControl(storeDeadline(deadlineMs, this.#now), this.#now));
      const index = activeRecord(rawIndex, ownerDigest, this.#keyFingerprint);
      if (index === null || index.endpointId !== suppliedEndpointId) return false;
      const rawEndpoint = await this.#store.getEndpoint(index.endpointId, storeControl(storeDeadline(deadlineMs, this.#now), this.#now));
      const endpoint = endpointRecord(rawEndpoint, index.endpointId, this.#keyFingerprint);
      if (endpoint === null || endpoint.ownerDigest !== ownerDigest
        || decryptWorkspace(this.#master, endpoint) !== workspace) return false;
      if (endpoint.lifecycle === 'revoked') return true;
      const revoked: StoredWebhookEndpoint = {
        ...endpoint,
        lifecycle: 'revoked',
        revokedAt: new Date(this.#now()).toISOString(),
      };
      await this.#store.putEndpoint(revoked, storeControl(storeDeadline(deadlineMs, this.#now), this.#now));
      const readback = endpointRecord(await this.#store.getEndpoint(
        index.endpointId,
        storeControl(storeDeadline(deadlineMs, this.#now), this.#now),
      ), index.endpointId, this.#keyFingerprint);
      if (readback === null || !same(readback, revoked)) throw new Error('webhook revocation readback failed');
      return true;
    } finally {
      release();
    }
  }

  async accept(
    endpointId: string,
    rawHeaders: readonly string[],
    body: Buffer,
    control: WebhookRequestControl,
  ): Promise<WebhookReceipt> {
    const firstNow = this.#now();
    if (!endpointIdValid(endpointId) || !Buffer.isBuffer(body) || body.byteLength > MAX_BODY_BYTES
      || control.requestSignal.aborted || control.settlementDeadlineMs <= firstNow) rejected();
    const headers = headersFrom(rawHeaders);
    if (!timestampValid(headers.timestampSeconds, firstNow)) rejected();
    const signingInput = Buffer.concat([
      Buffer.from(`${headers.timestamp}.${headers.eventId}.`, 'ascii'),
      body,
    ]);
    const candidate = createHmac('sha256', secretFor(this.#master, endpointId)).update(signingInput).digest();
    if (!timingSafeEqual(candidate, headers.signature) || !timestampValid(headers.timestampSeconds, this.#now())) rejected();

    const authorizationDeadline = Math.min(
      control.settlementDeadlineMs - RUNNER_ADMISSION_MS,
      this.#now() + STORE_TIMEOUT_MS,
    );
    const initialEndpoint = endpointRecord(await this.#store.getEndpoint(
      endpointId,
      storeControl(authorizationDeadline, this.#now, control.requestSignal),
    ), endpointId, this.#keyFingerprint);
    if (initialEndpoint === null || initialEndpoint.lifecycle !== 'active') rejected();
    const workspace = decryptWorkspace(this.#master, initialEndpoint);
    if (workspace === null || initialEndpoint.ownerDigest !== ownerFor(this.#master, workspace)) rejected();
    const initialIndex = activeRecord(await this.#store.getActive(
      initialEndpoint.ownerDigest,
      storeControl(authorizationDeadline, this.#now, control.requestSignal),
    ), initialEndpoint.ownerDigest, this.#keyFingerprint);
    if (initialIndex === null || initialIndex.endpointId !== endpointId) rejected();
    const document = documentFrom(body, headers.timestampSeconds);
    if (document === null) return emptyReceipt('failed', 'validation_failed');
    let prepared;
    try {
      prepared = prepareConnectorDocument(document);
    } catch (error) {
      if (error instanceof ConnectorNormalizationError) return emptyReceipt('failed', 'validation_failed');
      throw error;
    }
    const bodyDigest = rawDigest(body);
    const eventAddress = eventFor(this.#master, endpointId, headers.eventId);
    const lockDeadline = Math.min(control.settlementDeadlineMs - RUNNER_ADMISSION_MS, this.#now() + LOCK_TIMEOUT_MS);
    const release = await acquireOwnerLock(initialEndpoint.ownerDigest, lockDeadline, this.#now, control.requestSignal)
      .catch(() => rejected());
    try {
      const replay = replayRecord(await this.#store.getReplay(
        endpointId,
        storeControl(authorizationDeadline, this.#now, control.requestSignal),
      ), endpointId, this.#keyFingerprint);
      if (replay === null) rejected();
      const previous = replay.entries.find((entry) => entry.eventAddress === eventAddress);
      if (previous !== undefined) {
        return emptyReceipt(previous.rawDigest === bodyDigest ? 'duplicate' : 'conflict');
      }
      const finalEndpoint = endpointRecord(await this.#store.getEndpoint(
        endpointId,
        storeControl(authorizationDeadline, this.#now, control.requestSignal),
      ), endpointId, this.#keyFingerprint);
      const finalIndex = activeRecord(await this.#store.getActive(
        initialEndpoint.ownerDigest,
        storeControl(authorizationDeadline, this.#now, control.requestSignal),
      ), initialEndpoint.ownerDigest, this.#keyFingerprint);
      if (finalEndpoint === null || finalEndpoint.lifecycle !== 'active'
        || finalEndpoint.ownerDigest !== initialEndpoint.ownerDigest
        || finalIndex === null || finalIndex.endpointId !== endpointId
        || decryptWorkspace(this.#master, finalEndpoint) !== workspace) rejected();
      if (control.requestSignal.aborted || remaining(control.settlementDeadlineMs, this.#now) < RUNNER_ADMISSION_MS) {
        rejected();
      }

      const result = await this.#runner.run(workspace, {
        connectorId: 'webhook',
        documents: [document],
        awaitSearchable: true,
      }, {
        signal: control.requestSignal,
        settlementDeadlineMs: control.settlementDeadlineMs,
      });
      if (result.indeterminateSubmission) return receiptFrom(result, 'indeterminate');
      if (result.acceptedDocuments === 0) return receiptFrom(result, 'failed');

      const marker: StoredWebhookReplayEntry = {
        eventAddress,
        rawDigest: bodyDigest,
        normalizedDigest: prepared.contentDigest,
        parserVersion: PARSER_VERSION,
        acceptedAt: new Date(this.#now()).toISOString(),
        accepted: true,
      };
      const entries = [marker, ...replay.entries.filter((entry) => entry.eventAddress !== eventAddress)]
        .sort((left, right) => right.acceptedAt.localeCompare(left.acceptedAt)
          || left.eventAddress.localeCompare(right.eventAddress))
        .slice(0, MAX_REPLAY_ENTRIES);
      const next: StoredWebhookReplayWindow = {
        version: 1,
        keyFingerprint: this.#keyFingerprint,
        endpointId,
        entries,
      };
      try {
        const finalizationDeadline = Math.min(control.settlementDeadlineMs, this.#now() + FINALIZATION_RESERVE_MS);
        await this.#store.putReplay(next, storeControl(finalizationDeadline, this.#now));
        const readback = replayRecord(await this.#store.getReplay(
          endpointId,
          storeControl(finalizationDeadline, this.#now),
        ), endpointId, this.#keyFingerprint);
        if (readback === null || !same(readback, next)) throw new WebhookDeadlineError();
      } catch {
        return receiptFrom(result, 'indeterminate');
      }
      return receiptFrom(result, 'accepted');
    } finally {
      release();
    }
  }
}

interface BodyLeaseWaiter {
  readonly resolve: () => void;
  readonly reject: (error: WebhookBodyError) => void;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly signal: AbortSignal;
  readonly abort: () => void;
}

let activeBodyLeases = 0;
const bodyLeaseWaiters: BodyLeaseWaiter[] = [];

async function acquireBodyLease(signal: AbortSignal, timeoutMs: number): Promise<() => void> {
  if (signal.aborted || timeoutMs <= 0) throw new WebhookBodyError();
  if (activeBodyLeases < MAX_ACTIVE_BODY_LEASES) {
    activeBodyLeases += 1;
    return releaseBodyLease;
  }
  if (bodyLeaseWaiters.length >= 32) throw new WebhookBodyError();
  await new Promise<void>((resolve, reject) => {
    let waiter: BodyLeaseWaiter;
    const fail = () => {
      const index = bodyLeaseWaiters.indexOf(waiter);
      if (index >= 0) bodyLeaseWaiters.splice(index, 1);
      clearTimeout(waiter.timer);
      signal.removeEventListener('abort', waiter.abort);
      reject(new WebhookBodyError());
    };
    waiter = {
      resolve,
      reject,
      timer: setTimeout(fail, timeoutMs),
      signal,
      abort: fail,
    };
    signal.addEventListener('abort', fail, { once: true });
    bodyLeaseWaiters.push(waiter);
  });
  return releaseBodyLease;
}

function releaseBodyLease(): void {
  const next = bodyLeaseWaiters.shift();
  if (next === undefined) {
    activeBodyLeases = Math.max(0, activeBodyLeases - 1);
    return;
  }
  clearTimeout(next.timer);
  next.signal.removeEventListener('abort', next.abort);
  next.resolve();
}

function framingHeaders(rawHeaders: readonly string[]): { readonly length: number | null; readonly chunked: boolean } {
  if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) throw new WebhookBodyError();
  const values = new Map<string, string[]>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index];
    const value = rawHeaders[index + 1];
    if (typeof name !== 'string' || typeof value !== 'string') throw new WebhookBodyError();
    const lower = name.toLowerCase();
    const held = values.get(lower) ?? [];
    held.push(value);
    values.set(lower, held);
  }
  const exactOne = (name: string): string | null => {
    const held = values.get(name);
    if (held === undefined) return null;
    if (held.length !== 1 || held[0]!.includes(',')) throw new WebhookBodyError();
    return held[0]!;
  };
  if (exactOne('content-type') !== 'application/json'
    || values.has('content-encoding') || values.has('trailer')) throw new WebhookBodyError();
  const contentLength = exactOne('content-length');
  const transferEncoding = exactOne('transfer-encoding');
  if ((contentLength === null) === (transferEncoding === null)) throw new WebhookBodyError();
  if (transferEncoding !== null && transferEncoding !== 'chunked') throw new WebhookBodyError();
  if (contentLength !== null && !/^(?:0|[1-9][0-9]*)$/u.test(contentLength)) throw new WebhookBodyError();
  const length = contentLength === null ? null : Number(contentLength);
  if (length !== null && (!Number.isSafeInteger(length) || length > MAX_BODY_BYTES)) {
    throw new WebhookBodyError(length > MAX_BODY_BYTES ? 413 : 400);
  }
  return { length, chunked: transferEncoding === 'chunked' };
}

export class WebhookBodyReader {
  readonly #now: () => number;

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  async read(
    request: IncomingMessage,
    control: WebhookRequestControl,
    admission?: () => void,
  ): Promise<Buffer> {
    const deadlineMs = Math.min(control.startedAtMs + BODY_TIMEOUT_MS, control.settlementDeadlineMs);
    let release: (() => void) | undefined;
    try {
      release = await acquireBodyLease(control.requestSignal, deadlineMs - this.#now());
    } catch (error) {
      if (!request.closed) {
        await new Promise<void>((resolve) => {
          request.once('close', resolve);
          if (!request.destroyed) request.destroy();
        });
      }
      throw error;
    }
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        let settled = false;
        let ended = false;
        let framing: ReturnType<typeof framingHeaders> | undefined;
        let terminalFailure: Error | undefined;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          control.requestSignal.removeEventListener('abort', onAbort);
          request.removeListener('data', onData);
          request.removeListener('end', onEnd);
          request.removeListener('error', onError);
          request.removeListener('aborted', onAbort);
          request.removeListener('close', onClose);
          if (error !== undefined) reject(error);
          else resolve(Buffer.concat(chunks, bytes));
        };
        const failAndClose = (error: Error) => {
          if (settled) return;
          terminalFailure ??= error;
          if (request.closed) {
            finish(terminalFailure);
            return;
          }
          if (!request.destroyed) request.destroy();
        };
        const onData = (chunk: Buffer | string) => {
          if (terminalFailure !== undefined || framing === undefined) return;
          const held = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
          bytes += held.byteLength;
          if (bytes > MAX_BODY_BYTES || (framing.length !== null && bytes > framing.length)) {
            failAndClose(new WebhookBodyError(bytes > MAX_BODY_BYTES ? 413 : 400));
            return;
          }
          chunks.push(held);
        };
        const onEnd = () => {
          ended = true;
          if (terminalFailure !== undefined || framing === undefined) return;
          const trailers = request.rawTrailers.length > 0 || Object.keys(request.trailers).length > 0;
          if (request.complete !== true || trailers || (framing.length !== null && bytes !== framing.length)) {
            finish(new WebhookBodyError());
            return;
          }
          finish();
        };
        const onError = () => failAndClose(new WebhookBodyError());
        const onAbort = () => failAndClose(new WebhookBodyError());
        const onClose = () => {
          if (settled) return;
          if (terminalFailure !== undefined) {
            finish(terminalFailure);
            return;
          }
          if (!ended) finish(new WebhookBodyError());
        };
        const timer = setTimeout(() => failAndClose(new WebhookBodyError()), Math.max(1, deadlineMs - this.#now()));
        control.requestSignal.addEventListener('abort', onAbort, { once: true });
        request.once('error', onError);
        request.once('aborted', onAbort);
        request.once('close', onClose);
        if (control.requestSignal.aborted) {
          onAbort();
          return;
        }
        if (request.closed) {
          onClose();
          return;
        }
        try {
          admission?.();
          framing = framingHeaders(request.rawHeaders);
        } catch (error) {
          failAndClose(error instanceof Error ? error : new WebhookBodyError());
          return;
        }
        request.on('data', onData);
        request.once('end', onEnd);
      });
    } finally {
      release();
    }
  }
}
