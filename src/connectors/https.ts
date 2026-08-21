import { createHash } from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import type { LookupFunction, Socket } from 'node:net';
import { request as nodeHttpsRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import {
  addressFamily,
  canonicalizePublicHttpsUrl,
  compareCanonicalAddresses,
  isGlobalUnicastAddress,
} from './https-url.js';
import { prepareConnectorDocument, type ConnectorMediaType, type PreparedConnectorDocument } from './normalize.js';

export { canonicalizePublicHttpsUrl, isGlobalUnicastAddress } from './https-url.js';

export const HTTPS_IMPORT_DEADLINE_MS = 10_000;
const MAX_ENTITY_BYTES = 1024 * 1024;
const MAX_DNS_ANSWERS = 16;
const MAX_ACTIVE_READS = 3;
const MAX_QUEUED_READS = 16;
const MAX_HEADER_COUNT = 64;
const MAX_HEADER_BYTES = 16 * 1024;
const MAX_JSON_DEPTH = 8;
const MAX_JSON_LEAVES = 100;
const MAX_JSON_NODES = 512;
const MAX_JSON_MEMBERS = 100;
const MAX_JSON_KEY_BYTES = 256;
const MAX_JSON_PATH_BYTES = 1024;
const TEXT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const FIXED_HEADERS = Object.freeze({
  Accept: 'application/json, text/plain, text/markdown',
  'User-Agent': 'Lacuna-Connector/1.0',
  Connection: 'close',
  'Accept-Encoding': 'identity',
});

export type HttpsImportErrorCode =
  | 'invalid_https_url'
  | 'https_dns_failed'
  | 'https_address_blocked'
  | 'https_timeout'
  | 'https_tls_failed'
  | 'https_peer_mismatch'
  | 'https_redirect_refused'
  | 'https_upstream_failed'
  | 'https_response_invalid'
  | 'https_type_unsupported'
  | 'https_too_large'
  | 'https_content_invalid'
  | 'https_json_invalid'
  | 'https_busy';

export class HttpsImportError extends Error {
  override readonly name = 'HttpsImportError';
  readonly code: HttpsImportErrorCode;
  readonly status: number;

  constructor(code: HttpsImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'invalid_https_url' || code === 'https_content_invalid'
      || code === 'https_json_invalid' || code === 'https_address_blocked' ? 422
      : code === 'https_type_unsupported' ? 415
        : code === 'https_too_large' ? 413
          : code === 'https_timeout' ? 504
            : code === 'https_busy' ? 503
              : 502;
  }
}

export class HttpsReadCancelledError extends Error {
  override readonly name = 'HttpsReadCancelledError';

  constructor() {
    super('https_read_cancelled');
  }
}

export interface HttpsResolver {
  resolve4(hostname: string): Promise<readonly string[]>;
  resolve6(hostname: string): Promise<readonly string[]>;
  cancel(): void;
}

export type HttpsRequestFactory = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

export interface PinnedHttpsReaderBoundary {
  read(url: string, signal: AbortSignal): Promise<PreparedConnectorDocument>;
}

export interface PinnedHttpsReaderOptions {
  readonly resolverFactory?: (() => HttpsResolver) | undefined;
  readonly requestFactory?: HttpsRequestFactory | undefined;
  readonly now?: (() => number) | undefined;
  readonly deadlineMs?: number | undefined;
  readonly maxActive?: number | undefined;
  readonly maxQueued?: number | undefined;
}

class NodeResolver implements HttpsResolver {
  readonly #resolver = new Resolver();

  resolve4(hostname: string): Promise<readonly string[]> {
    return this.#resolver.resolve4(hostname);
  }

  resolve6(hostname: string): Promise<readonly string[]> {
    return this.#resolver.resolve6(hostname);
  }

  cancel(): void {
    this.#resolver.cancel();
  }
}

interface LeaseWaiter {
  readonly resolve: (release: () => void) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

class ReadLeasePool {
  readonly #maxActive: number;
  readonly #maxQueued: number;
  #active = 0;
  readonly #queue: LeaseWaiter[] = [];

  constructor(maxActive: number, maxQueued: number) {
    this.#maxActive = maxActive;
    this.#maxQueued = maxQueued;
  }

  acquire(signal: AbortSignal, aborted: () => Error): Promise<() => void> {
    if (signal.aborted) return Promise.reject(aborted());
    if (this.#active < this.#maxActive) {
      this.#active += 1;
      return Promise.resolve(this.#releaseOnce());
    }
    if (this.#queue.length >= this.#maxQueued) {
      return Promise.reject(new HttpsImportError('https_busy'));
    }
    return new Promise<() => void>((resolve, reject) => {
      const waiter: LeaseWaiter = {
        resolve,
        reject,
        signal,
        onAbort: () => {
          const index = this.#queue.indexOf(waiter);
          if (index >= 0) this.#queue.splice(index, 1);
          reject(aborted());
        },
      };
      signal.addEventListener('abort', waiter.onAbort, { once: true });
      this.#queue.push(waiter);
    });
  }

  #releaseOnce(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (;;) {
        const waiter = this.#queue.shift();
        if (waiter === undefined) {
          this.#active -= 1;
          return;
        }
        waiter.signal.removeEventListener('abort', waiter.onAbort);
        if (waiter.signal.aborted) {
          waiter.reject(new HttpsReadCancelledError());
          continue;
        }
        waiter.resolve(this.#releaseOnce());
        return;
      }
    };
  }
}

/** One process-wide production budget; injected test/read boundaries remain isolated. */
const PRODUCTION_READ_POOL = new ReadLeasePool(MAX_ACTIVE_READS, MAX_QUEUED_READS);

function boundedOption(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error('invalid HTTPS reader budget');
  return value;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function abortFailure(timedOut: boolean): Error {
  return timedOut ? new HttpsImportError('https_timeout') : new HttpsReadCancelledError();
}

function errorCode(value: unknown): string | null {
  return typeof value === 'object' && value !== null && 'code' in value && typeof value.code === 'string'
    ? value.code
    : null;
}

async function resolveAddresses(
  resolver: HttpsResolver,
  hostname: string,
  signal: AbortSignal,
  timedOut: () => boolean,
): Promise<readonly string[]> {
  if (signal.aborted) throw abortFailure(timedOut());
  const four = resolver.resolve4(hostname);
  const six = resolver.resolve6(hostname);
  const all = Promise.allSettled([four, six]);
  let stop: (() => void) | undefined;
  const interrupted = new Promise<never>((_resolve, reject) => {
    stop = (): void => reject(abortFailure(timedOut()));
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
  try {
    const results = await Promise.race([all, interrupted]);
    const answers: string[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (!Array.isArray(result.value) || result.value.some((answer) => typeof answer !== 'string')) {
          throw new HttpsImportError('https_dns_failed');
        }
        answers.push(...result.value);
      }
      else if (errorCode(result.reason) !== 'ENODATA') throw new HttpsImportError('https_dns_failed');
    }
    if (answers.length === 0 || answers.length > MAX_DNS_ANSWERS
      || answers.some((answer) => !isGlobalUnicastAddress(answer))) {
      throw new HttpsImportError(answers.some((answer) => !isGlobalUnicastAddress(answer))
        ? 'https_address_blocked'
        : 'https_dns_failed');
    }
    return Object.freeze([...new Set(answers)].sort(compareCanonicalAddresses));
  } finally {
    if (stop !== undefined) signal.removeEventListener('abort', stop);
  }
}

interface ResponseContract {
  readonly mediaType: ConnectorMediaType;
  readonly contentLength: number | null;
}

function headerValues(rawHeaders: readonly string[], name: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index]?.toLowerCase() === name) values.push(rawHeaders[index + 1] ?? '');
  }
  return values;
}

function responseContract(response: IncomingMessage): ResponseContract {
  const status = response.statusCode ?? 0;
  if (status >= 300 && status <= 399) throw new HttpsImportError('https_redirect_refused');
  if (status !== 200) throw new HttpsImportError('https_upstream_failed');
  const raw = response.rawHeaders;
  if (raw.length % 2 !== 0 || raw.length / 2 > MAX_HEADER_COUNT
    || raw.reduce((bytes, item) => bytes + Buffer.byteLength(item, 'latin1') + 2, 0) > MAX_HEADER_BYTES) {
    throw new HttpsImportError('https_response_invalid');
  }
  const critical = ['content-type', 'content-length', 'transfer-encoding', 'content-encoding', 'trailer'];
  if (critical.some((name) => headerValues(raw, name).length > 1)) {
    throw new HttpsImportError('https_response_invalid');
  }
  const encodings = headerValues(raw, 'content-encoding');
  if (encodings.length === 1 && encodings[0]!.toLowerCase() !== 'identity') {
    throw new HttpsImportError('https_response_invalid');
  }
  if (headerValues(raw, 'trailer').length !== 0) throw new HttpsImportError('https_response_invalid');
  const contentTypes = headerValues(raw, 'content-type');
  if (contentTypes.length !== 1) throw new HttpsImportError('https_type_unsupported');
  const typeMatch = /^(application\/json|text\/plain|text\/markdown)(?:[ \t]*;[ \t]*charset[ \t]*=[ \t]*utf-8[ \t]*)?$/iu
    .exec(contentTypes[0]!);
  if (typeMatch === null) throw new HttpsImportError('https_type_unsupported');
  const mediaType = typeMatch[1]!.toLowerCase() as ConnectorMediaType;
  const lengths = headerValues(raw, 'content-length');
  const transfers = headerValues(raw, 'transfer-encoding');
  if ((lengths.length === 1) === (transfers.length === 1)) throw new HttpsImportError('https_response_invalid');
  if (transfers.length === 1 && transfers[0]!.toLowerCase() !== 'chunked') {
    throw new HttpsImportError('https_response_invalid');
  }
  let contentLength: number | null = null;
  if (lengths.length === 1) {
    const value = lengths[0]!;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new HttpsImportError('https_response_invalid');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new HttpsImportError('https_response_invalid');
    if (parsed > MAX_ENTITY_BYTES) throw new HttpsImportError('https_too_large');
    contentLength = parsed;
  }
  return { mediaType, contentLength };
}

function tlsFailure(error: unknown): HttpsImportError {
  const code = errorCode(error) ?? '';
  return new HttpsImportError(/TLS|CERT|SSL|EPROTO/u.test(code) ? 'https_tls_failed' : 'https_upstream_failed');
}

interface EntityResponse {
  readonly bytes: Uint8Array;
  readonly mediaType: ConnectorMediaType;
}

function pinnedLookup(hostname: string, expectedHostname: string, address: string): LookupFunction {
  return ((requested: string, options: unknown, callback?: unknown): void => {
    const actualCallback = (typeof options === 'function' ? options : callback) as ((...args: unknown[]) => void) | undefined;
    if (actualCallback === undefined) return;
    if (requested !== hostname || requested !== expectedHostname) {
      actualCallback(Object.assign(new Error('pinned lookup host mismatch'), { code: 'EPERM' }));
      return;
    }
    const family = addressFamily(address);
    if (typeof options === 'object' && options !== null && 'all' in options && options.all === true) {
      actualCallback(null, [{ address, family }]);
      return;
    }
    actualCallback(null, address, family);
  }) as LookupFunction;
}

function readEntity(
  requestFactory: HttpsRequestFactory,
  hostname: string,
  requestPath: string,
  pinnedAddress: string,
  signal: AbortSignal,
  abortError: () => Error,
  onRequestCreated: () => void,
  onTeardown: () => void,
): Promise<EntityResponse> {
  return new Promise<EntityResponse>((resolve, reject) => {
    let request: ClientRequest | undefined;
    let response: IncomingMessage | undefined;
    let socket: Socket | undefined;
    let peerValidated = false;
    let responseEnded = false;
    let requestClosed = false;
    let settled = false;
    let entity: EntityResponse | undefined;
    const chunks: Buffer[] = [];
    let bytes = 0;
    let contract: ResponseContract | undefined;

    const cleanup = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
    const settleFailure = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
      response?.destroy();
      request?.destroy();
      socket?.destroy?.();
    };
    const settleSuccess = (): void => {
      if (settled || !responseEnded || !requestClosed || entity === undefined) return;
      settled = true;
      cleanup();
      resolve(entity);
    };
    const validatePeer = (): boolean => {
      if (peerValidated) return true;
      if (socket?.remoteAddress !== pinnedAddress || !isGlobalUnicastAddress(socket.remoteAddress)) {
        settleFailure(new HttpsImportError('https_peer_mismatch'));
        return false;
      }
      peerValidated = true;
      return true;
    };
    const onAbort = (): void => settleFailure(abortError());

    try {
      request = requestFactory({
        hostname,
        servername: hostname,
        port: 443,
        path: requestPath,
        method: 'GET',
        headers: FIXED_HEADERS,
        agent: false,
        rejectUnauthorized: true,
        maxHeaderSize: MAX_HEADER_BYTES,
        lookup: pinnedLookup(hostname, hostname, pinnedAddress),
      }, (incoming) => {
        if (settled) {
          incoming.destroy();
          return;
        }
        response = incoming;
        if (!validatePeer()) return;
        try {
          contract = responseContract(incoming);
        } catch (error) {
          settleFailure(error instanceof HttpsImportError ? error : new HttpsImportError('https_response_invalid'));
          return;
        }
        incoming.on('data', (chunk: unknown) => {
          if (settled) return;
          if (!(typeof chunk === 'string' || chunk instanceof Uint8Array)) {
            settleFailure(new HttpsImportError('https_response_invalid'));
            return;
          }
          const buffer = Buffer.from(chunk);
          bytes += buffer.byteLength;
          if (bytes > MAX_ENTITY_BYTES) {
            settleFailure(new HttpsImportError('https_too_large'));
            return;
          }
          if (contract !== undefined && contract.contentLength !== null && bytes > contract.contentLength) {
            settleFailure(new HttpsImportError('https_response_invalid'));
            return;
          }
          chunks.push(buffer);
        });
        incoming.once('error', () => settleFailure(new HttpsImportError('https_upstream_failed')));
        incoming.once('aborted', () => settleFailure(new HttpsImportError('https_upstream_failed')));
        incoming.once('end', () => {
          if (settled) return;
          if (contract === undefined || (contract.contentLength !== null && bytes !== contract.contentLength)
            || incoming.rawTrailers.length !== 0 || Object.keys(incoming.trailers).length !== 0) {
            settleFailure(new HttpsImportError('https_response_invalid'));
            return;
          }
          responseEnded = true;
          entity = { bytes: Buffer.concat(chunks, bytes), mediaType: contract.mediaType };
          settleSuccess();
        });
        incoming.once('close', () => {
          if (!responseEnded && !settled) settleFailure(new HttpsImportError('https_upstream_failed'));
        });
      });
      onRequestCreated();
      // Node truncates at this property instead of rejecting. Keeping one
      // sentinel beyond the accepted count lets the raw-header check reject
      // every overflow while still bounding parser allocation.
      request.maxHeadersCount = MAX_HEADER_COUNT + 1;
      request.once('socket', (connectedSocket) => {
        socket = connectedSocket;
        connectedSocket.once('secureConnect', validatePeer);
      });
      request.once('error', (error) => settleFailure(tlsFailure(error)));
      request.once('close', () => {
        requestClosed = true;
        onTeardown();
        if (!responseEnded && !settled) settleFailure(new HttpsImportError('https_upstream_failed'));
        else settleSuccess();
      });
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      else request.end();
    } catch (error) {
      settleFailure(tlsFailure(error));
    }
  });
}

interface JsonBudget {
  nodes: number;
  leaves: number;
}

function jsonPointerPart(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

function flattenJson(value: unknown): string {
  const lines: string[] = [];
  const budget: JsonBudget = { nodes: 0, leaves: 0 };
  const visit = (node: unknown, path: string, depth: number): void => {
    budget.nodes += 1;
    if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw new HttpsImportError('https_json_invalid');
    if (node === null || typeof node === 'string' || typeof node === 'boolean' || typeof node === 'number') {
      if (typeof node === 'number' && !Number.isFinite(node)) throw new HttpsImportError('https_json_invalid');
      budget.leaves += 1;
      if (budget.leaves > MAX_JSON_LEAVES || Buffer.byteLength(path, 'utf8') > MAX_JSON_PATH_BYTES) {
        throw new HttpsImportError('https_json_invalid');
      }
      lines.push(`${path === '' ? '/' : path} = ${JSON.stringify(node)}`);
      return;
    }
    if (Array.isArray(node)) {
      if (node.length > MAX_JSON_MEMBERS) throw new HttpsImportError('https_json_invalid');
      node.forEach((child, index) => visit(child, `${path}/${index}`, depth + 1));
      return;
    }
    if (typeof node !== 'object' || node === null) throw new HttpsImportError('https_json_invalid');
    const record = node as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length > MAX_JSON_MEMBERS) throw new HttpsImportError('https_json_invalid');
    const normalized = new Set<string>();
    for (const key of keys) {
      const canonical = key.normalize('NFC');
      if (canonical !== key || normalized.has(canonical) || Buffer.byteLength(key, 'utf8') > MAX_JSON_KEY_BYTES) {
        throw new HttpsImportError('https_json_invalid');
      }
      normalized.add(canonical);
    }
    keys.sort().forEach((key) => visit(record[key], `${path}/${jsonPointerPart(key)}`, depth + 1));
  };
  visit(value, '', 0);
  if (lines.length === 0) throw new HttpsImportError('https_json_invalid');
  return lines.join('\n');
}

function decodeAndPrepare(
  entity: EntityResponse,
  canonical: NonNullable<ReturnType<typeof canonicalizePublicHttpsUrl>>,
  observedAt: string,
): PreparedConnectorDocument {
  const bytes = entity.bytes;
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new HttpsImportError('https_content_invalid');
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpsImportError('https_content_invalid');
  }
  if (decoded.includes('\ufeff') || TEXT_CONTROL.test(decoded) || decoded.trim() === '') {
    throw new HttpsImportError('https_content_invalid');
  }
  let text = decoded;
  if (entity.mediaType === 'application/json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(decoded) as unknown;
    } catch {
      throw new HttpsImportError('https_json_invalid');
    }
    text = flattenJson(parsed);
  }
  const normalized = text.replace(/\r\n?/gu, '\n').normalize('NFC');
  if (normalized.trim() === '' || normalized.length > MAX_SOURCE_CHARS) {
    throw new HttpsImportError('https_content_invalid');
  }
  const rawDigest = sha256(bytes);
  const pathDigest = sha256(canonical.pathname);
  if (!SHA256.test(rawDigest) || !SHA256.test(pathDigest)) throw new HttpsImportError('https_content_invalid');
  const title = entity.mediaType === 'application/json' ? 'Public HTTPS JSON'
    : entity.mediaType === 'text/markdown' ? 'Public HTTPS Markdown'
      : 'Public HTTPS Text';
  return prepareConnectorDocument({
    title,
    text: normalized,
    provenance: {
      connectorId: 'https_api',
      sourceUrl: canonical.origin,
      mediaType: entity.mediaType,
      observedAt,
      https: Object.freeze({
        schemaVersion: 1,
        pathDigest,
        retrievedAt: observedAt,
        rawDigest,
        parserVersion: 'https-v1',
      }),
    },
  });
}

export class PinnedHttpsReader implements PinnedHttpsReaderBoundary {
  readonly #resolverFactory: () => HttpsResolver;
  readonly #requestFactory: HttpsRequestFactory;
  readonly #now: () => number;
  readonly #deadlineMs: number;
  readonly #pool: ReadLeasePool;

  constructor(options: PinnedHttpsReaderOptions = {}) {
    this.#resolverFactory = options.resolverFactory ?? (() => new NodeResolver());
    this.#requestFactory = options.requestFactory ?? nodeHttpsRequest;
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = boundedOption(options.deadlineMs, HTTPS_IMPORT_DEADLINE_MS, HTTPS_IMPORT_DEADLINE_MS);
    this.#pool = options.resolverFactory === undefined && options.requestFactory === undefined
      && options.maxActive === undefined && options.maxQueued === undefined
      ? PRODUCTION_READ_POOL
      : new ReadLeasePool(
        boundedOption(options.maxActive, MAX_ACTIVE_READS, MAX_ACTIVE_READS),
        boundedOption(options.maxQueued, MAX_QUEUED_READS, MAX_QUEUED_READS),
      );
  }

  async read(value: string, callerSignal: AbortSignal): Promise<PreparedConnectorDocument> {
    const canonical = canonicalizePublicHttpsUrl(value);
    if (canonical === null) throw new HttpsImportError('invalid_https_url');
    const control = new AbortController();
    let timedOut = false;
    const relayAbort = (): void => control.abort();
    if (callerSignal.aborted) relayAbort();
    else callerSignal.addEventListener('abort', relayAbort, { once: true });
    const deadline = setTimeout(() => {
      timedOut = true;
      control.abort();
    }, this.#deadlineMs);
    deadline.unref?.();
    let release: (() => void) | undefined;
    let requestCreated = false;
    const abortError = (): Error => abortFailure(timedOut);
    try {
      release = await this.#pool.acquire(control.signal, abortError);
      const resolver = this.#resolverFactory();
      const cancelResolver = (): void => {
        try {
          resolver.cancel();
        } catch {
          // The request still tears down and fails closed; a resolver cleanup
          // exception must never escape an abort event listener.
        }
      };
      control.signal.addEventListener('abort', cancelResolver, { once: true });
      let addresses: readonly string[];
      try {
        addresses = await resolveAddresses(resolver, canonical.hostname, control.signal, () => timedOut);
      } catch (error) {
        control.signal.removeEventListener('abort', cancelResolver);
        throw error;
      }
      const pinnedAddress = addresses[0];
      if (pinnedAddress === undefined) throw new HttpsImportError('https_dns_failed');
      let entity: EntityResponse;
      try {
        entity = await readEntity(
          this.#requestFactory,
          canonical.hostname,
          canonical.requestPath,
          pinnedAddress,
          control.signal,
          abortError,
          () => { requestCreated = true; },
          () => release?.(),
        );
      } finally {
        control.signal.removeEventListener('abort', cancelResolver);
      }
      const timestamp = this.#now();
      if (!Number.isFinite(timestamp)) throw new HttpsImportError('https_content_invalid');
      let observedAt: string;
      try {
        observedAt = new Date(timestamp).toISOString();
      } catch {
        throw new HttpsImportError('https_content_invalid');
      }
      if (new Date(observedAt).toISOString() !== observedAt) {
        throw new HttpsImportError('https_content_invalid');
      }
      return decodeAndPrepare(entity, canonical, observedAt);
    } finally {
      clearTimeout(deadline);
      callerSignal.removeEventListener('abort', relayAbort);
      if (!requestCreated) release?.();
    }
  }
}
