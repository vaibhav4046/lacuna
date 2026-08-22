import {
  HydraDecodeError,
  HydraGuardError,
  HydraIngestIndeterminateError,
  HydraQueryError,
  HydraTransportError,
} from './errors.js';
import type { FetchLike } from './client.js';
import {
  IMPACT_QUERY_BODY_CAP,
  IMPACT_RELATIONS_BODY_CAP,
  IMPACT_SUBJECT_BODY_CAP,
  assertImpactActive,
  assertImpactControl,
  sendImpactJson,
  type HydraImpactChunk,
  type HydraImpactQuery,
  type HydraImpactReadControl,
  type HydraImpactRelationOccurrence,
  type ImpactJsonResponse,
} from './impact-read.js';

/**
 * The HydraDB Cloud application API.
 *
 * This is a different protocol from the self-hosted node, not a different
 * host. The node speaks Cypher over `/v1/graphs/{graph}/query` and answers in
 * tagged value rows; the cloud is a REST application API at version 2.0.1
 * whose useful surface here is five endpoints. Pointing the node client at the
 * cloud fails on the first request, which is why this file exists rather than
 * a base URL change.
 *
 * Everything above this layer consumes claims rather than transport, so the
 * temporal resolver, the contradiction policy, the evidence gate and the
 * Context Pack compiler are untouched by which of the two is in use.
 *
 * The same discipline as the node client: a timeout on every call, an
 * AbortSignal that callers can cancel, typed errors, measured latency, and
 * never the token or a response body in an error message. A cloud error body
 * can echo a request, and an echoed request can carry a key.
 */

export interface CloudConfig {
  /** Base URL with no trailing slash. `https://api.hydradb.com`. */
  readonly baseUrl: string;
  readonly token: string;
  readonly database: string;
  /**
   * Collection scope. Load bearing in a way the docs understate: a status
   * poll that omits the collection a source was ingested into answers
   * FILE_NOT_FOUND for a source that ingested successfully.
   */
  readonly collection: string;
}

export type ContextType = 'knowledge' | 'memory' | 'all';

export interface IngestResult {
  readonly id: string;
  readonly filename: string;
  readonly status: string;
  readonly error: string | null;
}

export interface HydraOperationControl {
  /** Consulted immediately before dispatch; submitted ingest then detaches it. */
  readonly signal?: AbortSignal;
  /** Absolute internal deadline. Every provider timer is clipped to it. */
  readonly deadlineMs?: number;
}

export interface SourceStatus {
  readonly id: string;
  readonly indexingStatus: string;
  readonly errorCode: string;
  readonly done: boolean;
}

export interface Chunk {
  readonly text: string;
  readonly score: number | null;
  readonly sourceId: string | null;
  /** The title the service recorded for the source. Shown as evidence. */
  readonly sourceTitle: string | null;
  readonly sourceType: string | null;
  readonly observedAt: string | null;
}

export interface CloudAnswer {
  readonly chunks: readonly Chunk[];
  readonly sources: readonly unknown[];
  readonly graphContext: unknown;
  readonly temporalFacts: unknown;
  /** Measured round trip in milliseconds. */
  readonly latencyMs: number;
}

/** One pre-extracted record, as this product writes it. */
export interface AppRecord {
  readonly id: string;
  readonly title: string;
  /** The service's own category vocabulary. `custom` for records it did not parse. */
  readonly type: string;
  readonly timestamp: string;
  readonly text: string;
  readonly metadata?: Readonly<Record<string, string | number>>;
  /** Explicit graph edges, declared rather than inferred. */
  readonly relations?: readonly string[];
}

export interface InspectedSource {
  readonly id: string;
  /** The service's stored envelope, JSON, with the ingested text inside it. */
  readonly envelope: string;
  readonly latencyMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const INGEST_TIMEOUT_MS = 120_000;

/** Terminal states from the status endpoint. Anything else means keep polling. */
const TERMINAL = new Set(['completed', 'errored', 'failed']);
/** Receipt states observed in the ingest contract and exercised by every durable writer. */
const INGEST_ACCEPTED = new Set(['queued', 'completed']);
const INGEST_REFUSED = new Set(['errored', 'failed']);

export class HydraCloud {
  readonly #config: CloudConfig;
  readonly #fetch: FetchLike;

  constructor(config: CloudConfig, options: { readonly fetch?: FetchLike } = {}) {
    this.#config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, '') };
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /**
   * The same service and credentials, scoped to a different collection.
   *
   * A collection is the isolation boundary the service already gives us, and
   * ingesting one person's transcript into the collection the public demo reads
   * would put their sentences on a page anybody can open. This returns a client
   * that writes and reads somewhere else, sharing nothing but the connection.
   */
  withCollection(collection: string): HydraCloud {
    return new HydraCloud({ ...this.#config, collection }, { fetch: this.#fetch });
  }

  get database(): string {
    return this.#config.database;
  }

  get collection(): string {
    return this.#config.collection;
  }

  async #sendForImpact(
    path: string,
    init: RequestInit,
    control: HydraImpactReadControl,
    cap: number,
  ): Promise<ImpactJsonResponse> {
    assertImpactControl(control);
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.#config.token}`);
    headers.set('Accept', 'application/json');
    return await sendImpactJson(
      this.#fetch,
      `${this.#config.baseUrl}${path}`,
      { ...init, headers },
      control,
      cap,
    );
  }

  async #send(
    path: string,
    init: RequestInit,
    timeoutMs: number,
    deadlineMs?: number,
  ): Promise<{ body: unknown; latencyMs: number }> {
    const effectiveTimeout = deadlineMs === undefined
      ? timeoutMs
      : Math.min(timeoutMs, deadlineMs - Date.now());
    if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) {
      throw new HydraTransportError(`${path} exceeded its deadline`);
    }
    const controller = new AbortController();
    const callerSignal = init.signal ?? undefined;
    const relayAbort = () => controller.abort();
    if (callerSignal?.aborted === true) relayAbort();
    else callerSignal?.addEventListener('abort', relayAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    const started = performance.now();
    try {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${this.#config.token}`);
      headers.set('Accept', 'application/json');
      const response = await this.#fetch(`${this.#config.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (!response.ok) {
        // The status and the service's own error code, never the body: a cloud
        // error body can echo the request that produced it.
        const code = await errorCode(response);
        throw new HydraQueryError(response.status, code);
      }
      return { body: await response.json(), latencyMs };
    } catch (error) {
      if (error instanceof HydraQueryError) throw error;
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new HydraTransportError(aborted ? `${path} did not answer before its deadline` : `${path} could not be reached`);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', relayAbort);
    }
  }

  /** Provisions the database. Safe to call again: the service accepts a repeat. */
  async createDatabase(): Promise<void> {
    await this.#send('/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ database: this.#config.database }),
    }, DEFAULT_TIMEOUT_MS);
  }

  /** True when every component is up and ingestion will be accepted. */
  async readyForIngestion(): Promise<boolean> {
    const { body } = await this.#send(
      `/databases/status?database=${encodeURIComponent(this.#config.database)}`,
      { method: 'GET' },
      DEFAULT_TIMEOUT_MS,
    );
    const infra = pick(pick(body, 'data'), 'infra');
    return pick(infra, 'ready_for_ingestion') === true;
  }

  /**
   * Uploads one document. The endpoint is multipart, and the response is a 202
   * meaning queued rather than indexed, so the caller polls `statusOf`.
   */
  async ingestDocument(filename: string, text: string, type: ContextType = 'knowledge'): Promise<IngestResult> {
    const form = new FormData();
    form.set('database', this.#config.database);
    form.set('collection', this.#config.collection);
    form.set('type', type);
    form.set('documents', new Blob([text], { type: 'text/plain' }), filename);

    const { body } = await this.#send('/context/ingest', { method: 'POST', body: form }, INGEST_TIMEOUT_MS);
    const results = pick(pick(body, 'data'), 'results');
    const first = Array.isArray(results) ? results[0] : undefined;
    return {
      id: String(pick(first, 'id') ?? ''),
      filename: String(pick(first, 'filename') ?? filename),
      status: String(pick(first, 'status') ?? 'unknown'),
      error: (pick(first, 'error') as string | null) ?? null,
    };
  }

  /**
   * Uploads pre-extracted records, each under an id this side chose.
   *
   * `app_knowledge` is the endpoint's path for content a connector already
   * parsed, and it is the one that accepts a stable id: an uploaded file gets
   * whatever id the service assigns, which cannot be recomputed from a name at
   * read time. Ids chosen here are derived from the graph, so a later read
   * addresses a record without a lookup table travelling alongside it.
   *
   * `relations.ids` are declared rather than left to extraction where the
   * graph already states them, which is what makes `/context/relations` show
   * the product's own edges rather than only the ones inference found.
   */
  async ingestApp(
    records: readonly AppRecord[],
    collection = this.#config.collection,
    control: HydraOperationControl = {},
  ): Promise<readonly IngestResult[]> {
    const form = new FormData();
    form.set('database', this.#config.database);
    form.set('collection', collection);
    form.set('type', 'knowledge');
    form.set('upsert', 'true');
    form.set('app_knowledge', JSON.stringify(records.map((record) => ({
      id: record.id,
      database: this.#config.database,
      collection,
      title: record.title,
      type: record.type,
      timestamp: record.timestamp,
      content: { text: record.text },
      additional_metadata: record.metadata ?? {},
      ...(record.relations && record.relations.length > 0
        ? { relations: { ids: [...record.relations] } }
        : {}),
    }))));

    if (control.signal?.aborted === true) throw new HydraGuardError('ingest cancelled before dispatch');
    if (control.deadlineMs !== undefined && control.deadlineMs <= Date.now()) {
      throw new HydraGuardError('ingest deadline passed before dispatch');
    }
    // This is the commit boundary. The caller signal is deliberately not
    // relayed after this point: losing it cannot prove Hydra rejected a POST.
    try {
      const { body } = await this.#send(
        '/context/ingest',
        { method: 'POST', body: form },
        INGEST_TIMEOUT_MS,
        control.deadlineMs,
      );
      const results = pick(pick(body, 'data'), 'results');
      if (!Array.isArray(results)) {
        throw new HydraDecodeError('ingest response has no results array');
      }
      const decoded = results.map(decodeIngestResult);
      assertCompleteIngestReceipts(records, decoded);
      return decoded;
    } catch (error) {
      if (error instanceof HydraGuardError) throw error;
      throw new HydraIngestIndeterminateError();
    }
  }

  /**
   * The stored record for one id, verbatim.
   *
   * This is the read the deterministic path uses. It is addressed by id rather
   * than ranked by similarity, so the same question reads the same record
   * every time, which is what lets a temporal resolver sit above a service
   * whose other endpoint is a vector search.
   */
  async inspect(
    id: string,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    collection = this.#config.collection,
    signal?: AbortSignal,
  ): Promise<InspectedSource | null> {
    const query = new URLSearchParams({
      database: this.#config.database,
      collection,
      id,
      mode: 'content',
    });
    let body: unknown;
    let latencyMs: number;
    try {
      ({ body, latencyMs } = await this.#send(
        `/context/inspect?${query.toString()}`,
        { method: 'GET', ...(signal === undefined ? {} : { signal }) },
        timeoutMs,
      ));
    } catch (error) {
      // A record that is not there is an answer, not a fault: it is what an
      // out of scope name looks like when the store is addressed by id. The
      // service also uses 400 and 404 for other refusals, so only its explicit
      // missing-record code may be converted to null.
      if (error instanceof HydraQueryError
        && (error.status === 404 || error.status === 400)
        && (error.engineMessage === 'FILE_NOT_FOUND'
          || (error.status === 404 && error.engineMessage === 'NOT_FOUND'))) return null;
      throw error;
    }
    const data = pick(body, 'data');
    const raw = pick(data, 'content');
    if (typeof raw !== 'string' || raw === '') {
      throw new HydraDecodeError('inspect response has no stored content');
    }
    return { id, envelope: raw, latencyMs };
  }

  /** Strict, deadline-bound inspect used only by the private impact path. */
  async inspectForImpact(
    id: string,
    control: HydraImpactReadControl,
  ): Promise<InspectedSource | null> {
    assertImpactControl(control);
    if (typeof id !== 'string' || id === '' || Buffer.byteLength(id, 'utf8') > 256) {
      throw new HydraGuardError('impact inspect id is invalid');
    }
    const query = new URLSearchParams({
      database: this.#config.database,
      collection: this.#config.collection,
      id,
      mode: 'content',
    });
    const response = await this.#sendForImpact(
      `/context/inspect?${query.toString()}`,
      { method: 'GET' },
      control,
      IMPACT_SUBJECT_BODY_CAP,
    );
    if (!response.ok) {
      const code = safeImpactErrorCode(response.body);
      if ((response.status === 400 || response.status === 404)
        && (code === 'FILE_NOT_FOUND' || (response.status === 404 && code === 'NOT_FOUND'))) {
        assertImpactActive(control);
        return null;
      }
      throw new HydraQueryError(response.status, code);
    }
    const envelope = decodeImpactInspect(response.body);
    assertImpactActive(control);
    return { id, envelope, latencyMs: response.latencyMs };
  }

  /**
   * The collection is not optional here. A poll without it answers
   * FILE_NOT_FOUND for a source that ingested successfully, which reads like a
   * service fault and is a scoping mistake.
   */
  async statusOf(
    ids: readonly string[],
    signal?: AbortSignal,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<readonly SourceStatus[]> {
    const query = new URLSearchParams({
      database: this.#config.database,
      collection: this.#config.collection,
    });
    for (const id of ids) query.append('ids', id);

    const { body } = await this.#send(
      `/context/status?${query.toString()}`,
      { method: 'GET', ...(signal === undefined ? {} : { signal }) },
      timeoutMs,
    );
    const statuses = pick(pick(body, 'data'), 'statuses');
    if (!Array.isArray(statuses)) return [];
    return statuses.map((entry): SourceStatus => {
      const indexingStatus = String(pick(entry, 'indexing_status') ?? 'unknown');
      return {
        id: String(pick(entry, 'id') ?? ''),
        indexingStatus,
        errorCode: String(pick(entry, 'error_code') ?? ''),
        done: TERMINAL.has(indexingStatus),
      };
    });
  }

  /** Polls until every id is terminal, or the deadline passes. */
  async waitForIndexing(
    ids: readonly string[],
    options: {
      readonly timeoutMs?: number;
      readonly intervalMs?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<readonly SourceStatus[]> {
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    const interval = options.intervalMs ?? 5_000;
    for (;;) {
      const statuses = await this.statusOf(
        ids,
        options.signal,
        Math.max(1, Math.min(DEFAULT_TIMEOUT_MS, deadline - Date.now())),
      );
      if (statuses.length > 0 && statuses.every((s) => s.done)) return statuses;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) return statuses;
      await abortableDelay(Math.min(interval, remainingMs), options.signal);
    }
  }

  /**
   * One retrieval. `graph_context` is asked for on purpose: the cloud returns
   * graph and temporal structure alongside the chunks, which is the same shape
   * the resolver above already consumes.
   */
  async query(text: string, options: { readonly type?: ContextType; readonly maxResults?: number } = {}): Promise<CloudAnswer> {
    const { body, latencyMs } = await this.#send('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.#config.database,
        collection: this.#config.collection,
        query: text,
        type: options.type ?? 'all',
        graph_context: true,
        max_results: options.maxResults ?? 8,
      }),
    }, DEFAULT_TIMEOUT_MS);

    const data = pick(body, 'data');
    const rawChunks = pick(data, 'chunks');
    const chunks: Chunk[] = Array.isArray(rawChunks)
      // The field is chunk_content. Guessing `content` or `text` returns an
      // empty string for a chunk the service delivered in full, which looks
      // like an empty result and is a mapping error.
      ? rawChunks.map((c): Chunk => ({
        text: String(pick(c, 'chunk_content') ?? ''),
        score: numberOr(pick(c, 'relevancy_score')),
        sourceId: (pick(c, 'id') as string | null) ?? null,
        sourceTitle: (pick(c, 'source_title') as string | null) ?? null,
        sourceType: (pick(c, 'source_type') as string | null) ?? null,
        observedAt: (pick(c, 'source_last_updated_time') ?? pick(c, 'source_upload_time') ?? null) as string | null,
      }))
      : [];

    return {
      chunks,
      sources: asArray(pick(data, 'sources')),
      graphContext: pick(data, 'graph_context'),
      temporalFacts: pick(data, 'temporal_facts'),
      latencyMs,
    };
  }

  /** Fixed-option query used only by workspace impact. */
  async queryForImpact(
    text: string,
    control: HydraImpactReadControl,
  ): Promise<HydraImpactQuery> {
    assertImpactControl(control);
    if (typeof text !== 'string' || text === '') {
      throw new HydraGuardError('impact query text is empty');
    }
    const response = await this.#sendForImpact('/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        database: this.#config.database,
        collection: this.#config.collection,
        query: text,
        type: 'all',
        graph_context: true,
        max_results: 6,
      }),
    }, control, IMPACT_QUERY_BODY_CAP);
    if (!response.ok) {
      throw new HydraQueryError(response.status, safeImpactErrorCode(response.body));
    }
    const decoded = decodeImpactQuery(response.body);
    assertImpactActive(control);
    return decoded;
  }

  /** Graph relations for the scope, bounded by the service's own limit. */
  async relations(limit = 50): Promise<readonly unknown[]> {
    const query = new URLSearchParams({
      database: this.#config.database,
      collection: this.#config.collection,
      limit: String(limit),
    });
    const { body } = await this.#send(`/context/relations?${query.toString()}`, { method: 'GET' }, DEFAULT_TIMEOUT_MS);
    const data = pick(body, 'data');
    return asArray(pick(data, 'relations') ?? data);
  }

  /** Fixed-limit inventory read used only by workspace impact. */
  async relationsForImpact(
    control: HydraImpactReadControl,
  ): Promise<readonly HydraImpactRelationOccurrence[]> {
    assertImpactControl(control);
    const query = new URLSearchParams({
      database: this.#config.database,
      collection: this.#config.collection,
      limit: '128',
    });
    const response = await this.#sendForImpact(
      `/context/relations?${query.toString()}`,
      { method: 'GET' },
      control,
      IMPACT_RELATIONS_BODY_CAP,
    );
    if (!response.ok) {
      throw new HydraQueryError(response.status, safeImpactErrorCode(response.body));
    }
    const decoded = decodeImpactRelations(response.body);
    assertImpactActive(control);
    return decoded;
  }
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) return Promise.reject(new DOMException('aborted', 'AbortError'));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(new DOMException('aborted', 'AbortError'));
    };
    const cleanup = () => signal?.removeEventListener('abort', abort);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function errorCode(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    // HydraDB's current documented envelope is
    // `{ detail: { error_code } }`; the older context API also emitted
    // `{ error: { code } }`. Read both machine-code fields and never surface
    // the human message, which may contain request data.
    const codes = [
      pick(pick(body, 'detail'), 'error_code'),
      pick(pick(body, 'error'), 'code'),
      pick(body, 'error_code'),
    ];
    const code = codes.find((value) => typeof value === 'string' && value !== '');
    return typeof code === 'string' ? code : 'no error code';
  } catch {
    return 'no error body';
  }
}

function pick(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function decodeIngestResult(entry: unknown): IngestResult {
  const id = pick(entry, 'id');
  const status = pick(entry, 'status');
  const rawError = pick(entry, 'error');
  if (typeof id !== 'string' || id === '' || typeof status !== 'string' || status === '') {
    throw new HydraDecodeError('ingest response contains an incomplete receipt');
  }
  if (rawError !== undefined && rawError !== null && typeof rawError !== 'string') {
    throw new HydraDecodeError('ingest response contains an invalid receipt error');
  }

  const error = typeof rawError === 'string' ? rawError : null;
  const refused = error !== null && error !== '';
  if (refused ? !INGEST_ACCEPTED.has(status) && !INGEST_REFUSED.has(status) : !INGEST_ACCEPTED.has(status)) {
    throw new HydraDecodeError('ingest response contains an unrecognized receipt status');
  }

  return {
    id,
    filename: String(pick(entry, 'filename') ?? ''),
    status,
    error,
  };
}

function assertCompleteIngestReceipts(
  submitted: readonly AppRecord[],
  results: readonly IngestResult[],
): void {
  const expected = new Set(submitted.map((record) => record.id));
  const seen = new Set<string>();
  for (const result of results) {
    if (!expected.has(result.id) || seen.has(result.id)) {
      throw new HydraDecodeError('ingest response contains an invalid receipt id');
    }
    seen.add(result.id);
  }
  if (seen.size !== expected.size || expected.size !== submitted.length) {
    throw new HydraDecodeError('ingest response omits a submitted record id');
  }
}

function numberOr(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function impactRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HydraDecodeError(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function impactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  const closed = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !closed.has(key));
  if (unknown !== undefined) {
    throw new HydraDecodeError(`${where} contains an unknown field`);
  }
}

function scalarString(value: string): boolean {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(at + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      at += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function impactString(
  value: unknown,
  where: string,
  maxBytes: number,
  options: { readonly nullable?: boolean; readonly empty?: boolean } = {},
): string | null {
  if (value === null && options.nullable === true) return null;
  if (typeof value !== 'string' || !scalarString(value)) {
    throw new HydraDecodeError(`${where} is not a scalar string`);
  }
  if (options.empty !== true && value === '') {
    throw new HydraDecodeError(`${where} is empty`);
  }
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new HydraDecodeError(`${where} exceeds its byte cap`);
  }
  return value;
}

function optionalImpactString(
  record: Record<string, unknown>,
  key: string,
  where: string,
  maxBytes: number,
  options: { readonly empty?: boolean } = {},
): string | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  return impactString(value, `${where}.${key}`, maxBytes, options);
}

function finiteScore(value: unknown, where: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HydraDecodeError(`${where} is not a finite score`);
  }
  return value;
}

const IMPACT_AUXILIARY_JSON_PROFILE = Object.freeze({
  maxDepth: 6,
  maxNodes: 4_096,
  maxObjectKeys: 64,
  maxArrayLength: 256,
  maxKeyBytes: 256,
  maxStringBytes: 8_192,
});

interface ImpactAuxiliaryBudget {
  nodes: number;
}

function validateImpactAuxiliaryJson(
  value: unknown,
  where: string,
  budget: ImpactAuxiliaryBudget,
  depth = 0,
): void {
  if (depth > IMPACT_AUXILIARY_JSON_PROFILE.maxDepth) {
    throw new HydraDecodeError(`${where} exceeds its auxiliary depth cap`);
  }
  budget.nodes += 1;
  if (budget.nodes > IMPACT_AUXILIARY_JSON_PROFILE.maxNodes) {
    throw new HydraDecodeError(`${where} exceeds its auxiliary node cap`);
  }
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new HydraDecodeError(`${where} contains a non-finite auxiliary number`);
    }
    return;
  }
  if (typeof value === 'string') {
    impactString(value, where, IMPACT_AUXILIARY_JSON_PROFILE.maxStringBytes, { empty: true });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > IMPACT_AUXILIARY_JSON_PROFILE.maxArrayLength) {
      throw new HydraDecodeError(`${where} exceeds its auxiliary array cap`);
    }
    value.forEach((entry, index) => {
      validateImpactAuxiliaryJson(entry, `${where}[${index}]`, budget, depth + 1);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) {
    throw new HydraDecodeError(`${where} contains an invalid auxiliary value`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > IMPACT_AUXILIARY_JSON_PROFILE.maxObjectKeys) {
    throw new HydraDecodeError(`${where} exceeds its auxiliary object-key cap`);
  }
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index] as string;
    impactString(
      key,
      `${where}.key[${index}]`,
      IMPACT_AUXILIARY_JSON_PROFILE.maxKeyBytes,
      { empty: true },
    );
    validateImpactAuxiliaryJson(
      record[key],
      `${where}.value[${index}]`,
      budget,
      depth + 1,
    );
  }
}

function validateImpactAuxiliaryObject(
  value: unknown,
  where: string,
  budget: ImpactAuxiliaryBudget,
  nullable = false,
): void {
  if (value === null && nullable) {
    validateImpactAuxiliaryJson(value, where, budget);
    return;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HydraDecodeError(`${where} is not an auxiliary object`);
  }
  validateImpactAuxiliaryJson(value, where, budget);
}

function validateImpactAuxiliaryArray(
  value: unknown,
  where: string,
  budget: ImpactAuxiliaryBudget,
): void {
  if (!Array.isArray(value)) {
    throw new HydraDecodeError(`${where} is not an auxiliary array`);
  }
  validateImpactAuxiliaryJson(value, where, budget);
}

function decodeImpactSuccessData(
  body: unknown,
  where: string,
): { readonly data: Record<string, unknown>; readonly auxiliary: ImpactAuxiliaryBudget } {
  const root = impactRecord(body, where);
  impactKeys(root, ['success', 'data', 'error', 'meta'], where);
  if (root['success'] !== true) {
    throw new HydraDecodeError(`${where} is not a successful envelope`);
  }
  if (root['error'] !== undefined && root['error'] !== null) {
    throw new HydraDecodeError(`${where} carries an error in a successful envelope`);
  }
  const auxiliary: ImpactAuxiliaryBudget = { nodes: 0 };
  if (root['meta'] !== undefined) {
    validateImpactAuxiliaryObject(root['meta'], `${where}.meta`, auxiliary);
  }
  return { data: impactRecord(root['data'], `${where}.data`), auxiliary };
}

function impactStringArray(
  value: unknown,
  where: string,
  maxRows: number,
  maxBytes: number,
): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maxRows) {
    throw new HydraDecodeError(`${where} is not a bounded array`);
  }
  return value.map((entry, index) => (
    impactString(entry, `${where}[${index}]`, maxBytes) as string
  ));
}

function safeImpactErrorCode(body: unknown): string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'provider_refused';
  const record = body as Record<string, unknown>;
  const nested = [record['detail'], record['error']];
  for (const candidate of nested) {
    if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) continue;
    const held = candidate as Record<string, unknown>;
    for (const key of ['error_code', 'code']) {
      const code = held[key];
      if (code === 'FILE_NOT_FOUND' || code === 'NOT_FOUND') {
        return code;
      }
    }
  }
  const direct = record['error_code'];
  return direct === 'FILE_NOT_FOUND' || direct === 'NOT_FOUND' ? direct : 'provider_refused';
}

function decodeImpactInspect(body: unknown): string {
  const { data } = decodeImpactSuccessData(body, 'impact inspect response');
  impactKeys(data, ['content'], 'impact inspect response.data');
  return impactString(data['content'], 'impact inspect response.data.content', IMPACT_SUBJECT_BODY_CAP) as string;
}

function decodeImpactQuery(body: unknown): HydraImpactQuery {
  const { data, auxiliary } = decodeImpactSuccessData(body, 'impact query response');
  impactKeys(data, [
    'chunks',
    'sources',
    'graph_context',
    'temporal_facts',
    'temporal_filter',
    'additional_context',
  ], 'impact query response.data');

  const rawChunks = data['chunks'] ?? [];
  if (!Array.isArray(rawChunks)) {
    throw new HydraDecodeError('impact query chunks is not an array');
  }
  if (rawChunks.length > 6) {
    throw new HydraDecodeError('impact query chunks exceeds its row cap');
  }
  const chunks = rawChunks.map((entry, index) => decodeImpactChunk(entry, index, auxiliary));
  assertConsistentChunks(chunks);

  decodeImpactSources(data['sources'], auxiliary);
  if (data['temporal_facts'] !== undefined) {
    const value = data['temporal_facts'];
    if (value !== null && !Array.isArray(value)
      && (typeof value !== 'object' || value === null)) {
      throw new HydraDecodeError('impact query response.data.temporal_facts has an invalid outer type');
    }
    validateImpactAuxiliaryJson(value, 'impact query response.data.temporal_facts', auxiliary);
  }
  if (data['temporal_filter'] !== undefined) {
    validateImpactAuxiliaryObject(
      data['temporal_filter'],
      'impact query response.data.temporal_filter',
      auxiliary,
      true,
    );
  }
  if (data['additional_context'] !== undefined) {
    validateImpactAuxiliaryObject(
      data['additional_context'],
      'impact query response.data.additional_context',
      auxiliary,
    );
  }

  const relations = decodeImpactGraph(data['graph_context'], auxiliary);
  return { chunks, relations };
}

function decodeImpactSources(value: unknown, auxiliary: ImpactAuxiliaryBudget): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value)) {
    throw new HydraDecodeError('impact query sources is not an array');
  }
  if (value.length > 64) {
    throw new HydraDecodeError('impact query sources exceeds its row cap');
  }
  value.forEach((entry, index) => {
    const where = `impact query source ${index}`;
    const source = impactRecord(entry, where);
    impactKeys(source, [
      'id',
      'title',
      'type',
      'url',
      'timestamp',
      'description',
      'metadata',
      'additional_metadata',
      'app_kind',
      'app_provider',
      'app_external_id',
      'sub_tenant_id',
    ], where);
    optionalImpactString(source, 'id', where, 256);
    optionalImpactString(source, 'title', where, 256);
    optionalImpactString(source, 'type', where, 256);
    optionalImpactString(source, 'url', where, 2_048);
    optionalImpactString(source, 'timestamp', where, 256);
    optionalImpactString(source, 'description', where, 2_048, { empty: true });
    optionalImpactString(source, 'app_kind', where, 256);
    optionalImpactString(source, 'app_provider', where, 256);
    optionalImpactString(source, 'app_external_id', where, 256);
    optionalImpactString(source, 'sub_tenant_id', where, 256);
    for (const key of ['metadata', 'additional_metadata']) {
      if (source[key] !== undefined) {
        validateImpactAuxiliaryObject(source[key], `${where}.${key}`, auxiliary, true);
      }
    }
  });
}

function decodeImpactChunk(
  value: unknown,
  index: number,
  auxiliary: ImpactAuxiliaryBudget,
): HydraImpactChunk {
  const where = `impact query chunk ${index}`;
  const chunk = impactRecord(value, where);
  impactKeys(chunk, [
    'chunk_uuid',
    'id',
    'chunk_content',
    'relevancy_score',
    'source_id',
    'source_ids',
    'source_title',
    'source_type',
    'source_last_updated_time',
    'source_upload_time',
    'metadata',
    'additional_metadata',
    'extra_context_ids',
    'layout',
  ], where);
  const chunkId = optionalImpactString(chunk, 'chunk_uuid', where, 256);
  const text = impactString(chunk['chunk_content'], `${where}.chunk_content`, 2_048, { empty: true }) as string;
  const score = finiteScore(chunk['relevancy_score'], `${where}.relevancy_score`);
  const idAlias = optionalImpactString(chunk, 'id', where, 256);
  const sourceIdAlias = optionalImpactString(chunk, 'source_id', where, 256);
  if (idAlias !== null && sourceIdAlias !== null && idAlias !== sourceIdAlias) {
    throw new HydraDecodeError(`${where} has inconsistent source-id aliases`);
  }
  const singular = sourceIdAlias ?? idAlias;
  const rawIds = impactStringArray(chunk['source_ids'], `${where}.source_ids`, 8, 256);
  const sourceIds: string[] = [];
  const add = (id: string | null) => {
    if (id !== null && !sourceIds.includes(id)) sourceIds.push(id);
  };
  add(singular);
  rawIds.forEach(add);
  if (sourceIds.length > 8) {
    throw new HydraDecodeError(`${where} source-id union exceeds its cap`);
  }
  impactStringArray(chunk['extra_context_ids'], `${where}.extra_context_ids`, 32, 256);
  optionalImpactString(chunk, 'layout', where, 256, { empty: true });
  for (const key of ['metadata', 'additional_metadata']) {
    if (chunk[key] !== undefined) {
      validateImpactAuxiliaryObject(chunk[key], `${where}.${key}`, auxiliary, true);
    }
  }
  const updated = optionalImpactString(chunk, 'source_last_updated_time', where, 256);
  const uploaded = optionalImpactString(chunk, 'source_upload_time', where, 256);
  return {
    chunkId,
    text,
    score,
    sourceIds,
    sourceTitle: optionalImpactString(chunk, 'source_title', where, 256),
    sourceType: optionalImpactString(chunk, 'source_type', where, 256),
    observedAt: updated ?? uploaded,
  };
}

function decodeImpactGraph(
  value: unknown,
  auxiliary: ImpactAuxiliaryBudget,
): readonly HydraImpactRelationOccurrence[] {
  if (value === undefined || value === null) return [];
  const graph = impactRecord(value, 'impact query graph_context');
  impactKeys(graph, [
    'query_paths',
    'chunk_relations',
    'chunk_id_to_group_ids',
    'synthesis_context',
  ], 'impact query graph_context');

  const relations = decodeImpactPathList(
    graph['query_paths'],
    'impact query path',
  );
  if (graph['chunk_relations'] !== undefined) {
    validateImpactAuxiliaryArray(
      graph['chunk_relations'],
      'impact query graph_context.chunk_relations',
      auxiliary,
    );
  }
  decodeImpactChunkGroups(graph['chunk_id_to_group_ids']);
  if (graph['synthesis_context'] !== undefined && graph['synthesis_context'] !== null) {
    impactString(
      graph['synthesis_context'],
      'impact query graph_context.synthesis_context',
      8_192,
      { empty: true },
    );
  }
  assertConsistentRelations(relations);
  return relations;
}

function decodeImpactPathList(
  value: unknown,
  where: string,
): readonly HydraImpactRelationOccurrence[] {
  const paths = value ?? [];
  if (!Array.isArray(paths)) {
    throw new HydraDecodeError(`${where}s is not an array`);
  }
  if (paths.length > 32) {
    throw new HydraDecodeError(`${where}s exceeds its row cap`);
  }
  const relations: HydraImpactRelationOccurrence[] = [];
  for (let pathIndex = 0; pathIndex < paths.length; pathIndex += 1) {
    const pathWhere = `${where} ${pathIndex}`;
    const path = impactRecord(paths[pathIndex], pathWhere);
    impactKeys(path, [
      'triplets',
      'relevancy_score',
      'combined_context',
      'group_id',
      'source_chunk_ids',
    ], pathWhere);
    finiteScore(path['relevancy_score'], `${pathWhere}.relevancy_score`);
    optionalImpactString(path, 'combined_context', pathWhere, 2_048, { empty: true });
    optionalImpactString(path, 'group_id', pathWhere, 256);
    impactStringArray(path['source_chunk_ids'], `${pathWhere}.source_chunk_ids`, 8, 256);
    const triplets = path['triplets'] ?? [];
    if (!Array.isArray(triplets)) {
      throw new HydraDecodeError(`${pathWhere}.triplets is not an array`);
    }
    if (triplets.length > 8) {
      throw new HydraDecodeError(`${pathWhere} exceeds its triplet cap`);
    }
    for (let row = 0; row < triplets.length; row += 1) {
      if (relations.length >= 128) {
        throw new HydraDecodeError(`${where} triplets exceeds its total cap`);
      }
      relations.push(decodeImpactTriplet(triplets[row], `${pathWhere} triplet ${row}`));
    }
  }
  return relations;
}

function decodeImpactChunkGroups(value: unknown): void {
  if (value === undefined || value === null) return;
  const groups = impactRecord(value, 'impact query graph_context.chunk_id_to_group_ids');
  const entries = Object.entries(groups);
  if (entries.length > 128) {
    throw new HydraDecodeError('impact query chunk-group map exceeds its key cap');
  }
  for (let index = 0; index < entries.length; index += 1) {
    const [chunkId, groupIds] = entries[index] as [string, unknown];
    impactString(chunkId, `impact query chunk-group key ${index}`, 256);
    impactStringArray(
      groupIds,
      `impact query chunk-group value ${index}`,
      32,
      256,
    );
  }
}

function decodeImpactEndpoint(value: unknown, where: string): string | null {
  if (value === null) return null;
  const endpoint = impactRecord(value, where);
  impactKeys(endpoint, ['name', 'type', 'namespace', 'entity_id'], where);
  if (endpoint['type'] !== undefined && endpoint['type'] !== null) {
    impactString(endpoint['type'], `${where}.type`, 256);
  }
  if (endpoint['entity_id'] !== undefined && endpoint['entity_id'] !== null) {
    impactString(endpoint['entity_id'], `${where}.entity_id`, 256);
  }
  if (endpoint['namespace'] !== undefined && endpoint['namespace'] !== null) {
    impactString(endpoint['namespace'], `${where}.namespace`, 256);
  }
  if (endpoint['name'] === undefined) {
    throw new HydraDecodeError(`${where}.name is missing`);
  }
  return impactString(endpoint['name'], `${where}.name`, 512, { nullable: true, empty: true });
}

function decodeImpactRelation(
  value: unknown,
  where: string,
  source: string | null,
  target: string | null,
): HydraImpactRelationOccurrence {
  const relation = impactRecord(value, where);
  impactKeys(relation, [
    'relationship_id',
    'canonical_predicate',
    'raw_predicate',
    'predicate',
    'chunk_id',
    'context',
    'confidence',
    'source_entity_id',
    'target_entity_id',
    'temporal_details',
    'timestamp',
  ], where);
  finiteScore(relation['confidence'], `${where}.confidence`);
  const predicateValues = new Map<string, string | null>();
  for (const key of ['canonical_predicate', 'raw_predicate', 'predicate']) {
    if (relation[key] !== undefined) {
      predicateValues.set(key, impactString(
        relation[key],
        `${where}.${key}`,
        64,
        { nullable: true, empty: true },
      ));
    }
  }
  optionalImpactString(relation, 'source_entity_id', where, 256);
  optionalImpactString(relation, 'target_entity_id', where, 256);
  const temporalDetails = relation['temporal_details'];
  if (temporalDetails !== undefined && temporalDetails !== null) {
    const timestamp = impactString(temporalDetails, `${where}.temporal_details`, 128) as string;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
      || !Number.isFinite(Date.parse(timestamp))) {
      throw new HydraDecodeError(`${where}.temporal_details is not an ISO timestamp`);
    }
  }
  finiteScore(relation['timestamp'], `${where}.timestamp`);
  const predicate = predicateValues.has('raw_predicate')
    ? predicateValues.get('raw_predicate') ?? null
    : predicateValues.has('canonical_predicate')
      ? predicateValues.get('canonical_predicate') ?? null
      : predicateValues.get('predicate') ?? null;
  return {
    relationshipId: optionalImpactString(relation, 'relationship_id', where, 256),
    source,
    target,
    predicate,
    chunkId: optionalImpactString(relation, 'chunk_id', where, 256),
    context: relation['context'] === undefined
      ? null
      : impactString(relation['context'], `${where}.context`, 2_048, { nullable: true, empty: true }),
  };
}

function decodeImpactTriplet(value: unknown, where: string): HydraImpactRelationOccurrence {
  const triplet = impactRecord(value, where);
  impactKeys(triplet, ['source', 'relation', 'target'], where);
  return decodeImpactRelation(
    triplet['relation'],
    `${where}.relation`,
    decodeImpactEndpoint(triplet['source'], `${where}.source`),
    decodeImpactEndpoint(triplet['target'], `${where}.target`),
  );
}

function decodeImpactRelations(body: unknown): readonly HydraImpactRelationOccurrence[] {
  const { data } = decodeImpactSuccessData(body, 'impact relations response');
  impactKeys(data, ['relations'], 'impact relations response.data');
  const raw = data['relations'] ?? [];
  if (!Array.isArray(raw)) {
    throw new HydraDecodeError('impact relation containers is not an array');
  }
  if (raw.length > 64) {
    throw new HydraDecodeError('impact relation containers exceeds its cap');
  }
  const relations: HydraImpactRelationOccurrence[] = [];
  for (let containerIndex = 0; containerIndex < raw.length; containerIndex += 1) {
    const where = `impact relation container ${containerIndex}`;
    const container = impactRecord(raw[containerIndex], where);
    impactKeys(container, ['source', 'target', 'relations'], where);
    const source = decodeImpactEndpoint(container['source'], `${where}.source`);
    const target = decodeImpactEndpoint(container['target'], `${where}.target`);
    const rows = container['relations'] ?? [];
    if (!Array.isArray(rows)) {
      throw new HydraDecodeError(`${where}.relations is not an array`);
    }
    if (rows.length > 8) {
      throw new HydraDecodeError(`${where} exceeds its nested row cap`);
    }
    for (let row = 0; row < rows.length; row += 1) {
      if (relations.length >= 128) {
        throw new HydraDecodeError('impact relation rows exceeds its total cap');
      }
      relations.push(decodeImpactRelation(rows[row], `${where}.relations[${row}]`, source, target));
    }
  }
  assertConsistentRelations(relations);
  return relations;
}

function chunkFingerprint(chunk: HydraImpactChunk): string {
  const score = chunk.score === null
    ? null
    : (() => {
        const bytes = Buffer.allocUnsafe(8);
        bytes.writeDoubleBE(chunk.score, 0);
        return bytes.toString('hex');
      })();
  return JSON.stringify({
    text: chunk.text,
    score,
    sourceIds: chunk.sourceIds,
    sourceTitle: chunk.sourceTitle,
    sourceType: chunk.sourceType,
    observedAt: chunk.observedAt,
  });
}

function assertConsistentChunks(chunks: readonly HydraImpactChunk[]): void {
  const seen = new Map<string, string>();
  for (const chunk of chunks) {
    if (chunk.chunkId === null) continue;
    const fingerprint = chunkFingerprint(chunk);
    const prior = seen.get(chunk.chunkId);
    if (prior !== undefined && prior !== fingerprint) {
      throw new HydraDecodeError('impact query reuses a chunk id inconsistently');
    }
    seen.set(chunk.chunkId, fingerprint);
  }
}

function relationFingerprint(relation: HydraImpactRelationOccurrence): string {
  return JSON.stringify({
    source: relation.source,
    target: relation.target,
    predicate: relation.predicate,
    chunkId: relation.chunkId,
    context: relation.context,
  });
}

function assertConsistentRelations(relations: readonly HydraImpactRelationOccurrence[]): void {
  const seen = new Map<string, string>();
  for (const relation of relations) {
    if (relation.relationshipId === null) continue;
    const fingerprint = relationFingerprint(relation);
    const prior = seen.get(relation.relationshipId);
    if (prior !== undefined && prior !== fingerprint) {
      throw new HydraDecodeError('impact response reuses a relationship id inconsistently');
    }
    seen.set(relation.relationshipId, fingerprint);
  }
}

/**
 * The sole cloud origin allowed to receive the deployment bearer.
 *
 * Hostname substring checks are not an allowlist: `api.hydradb.com.evil.test`
 * contains the right text while naming somebody else's server. Parse and
 * canonicalise the URL before the token is ever put into a client instead.
 */
function hydraCloudOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.hostname !== 'api.hydradb.com'
    || url.username !== '' || url.password !== '' || url.port !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') return null;
  return url.origin;
}

/** Builds a cloud client from the environment, or null when nothing is configured. */
export function cloudFromEnv(env: Record<string, string | undefined>): HydraCloud | null {
  const configuredUrl = env['HYDRA_CLOUD_URL'] ?? env['HYDRA_HTTP_URL'];
  const token = env['HYDRA_CLOUD_TOKEN'] ?? env['HYDRA_TOKEN'];
  const database = env['HYDRA_DATABASE'];
  if (configuredUrl === undefined || token === undefined || token === ''
    || database === undefined || database === '') return null;
  const baseUrl = hydraCloudOrigin(configuredUrl);
  if (baseUrl === null) return null;
  return new HydraCloud({
    baseUrl,
    token,
    database,
    collection: env['HYDRA_COLLECTION'] ?? 'default',
  });
}
