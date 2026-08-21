import { HydraDecodeError, HydraQueryError, HydraTransportError } from './errors.js';
import type { FetchLike } from './client.js';

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

  async #send(path: string, init: RequestInit, timeoutMs: number): Promise<{ body: unknown; latencyMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      throw new HydraTransportError(aborted ? `${path} did not answer in ${timeoutMs}ms` : `${path} could not be reached`);
    } finally {
      clearTimeout(timer);
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

    const { body } = await this.#send('/context/ingest', { method: 'POST', body: form }, INGEST_TIMEOUT_MS);
    const results = pick(pick(body, 'data'), 'results');
    if (!Array.isArray(results)) {
      throw new HydraDecodeError('ingest response has no results array');
    }
    const decoded = results.map(decodeIngestResult);
    assertCompleteIngestReceipts(records, decoded);
    return decoded;
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
      ({ body, latencyMs } = await this.#send(`/context/inspect?${query.toString()}`, { method: 'GET' }, timeoutMs));
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

  /**
   * The collection is not optional here. A poll without it answers
   * FILE_NOT_FOUND for a source that ingested successfully, which reads like a
   * service fault and is a scoping mistake.
   */
  async statusOf(ids: readonly string[]): Promise<readonly SourceStatus[]> {
    const query = new URLSearchParams({
      database: this.#config.database,
      collection: this.#config.collection,
    });
    for (const id of ids) query.append('ids', id);

    const { body } = await this.#send(`/context/status?${query.toString()}`, { method: 'GET' }, DEFAULT_TIMEOUT_MS);
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
    options: { readonly timeoutMs?: number; readonly intervalMs?: number } = {},
  ): Promise<readonly SourceStatus[]> {
    const deadline = Date.now() + (options.timeoutMs ?? 300_000);
    const interval = options.intervalMs ?? 5_000;
    for (;;) {
      const statuses = await this.statusOf(ids);
      if (statuses.length > 0 && statuses.every((s) => s.done)) return statuses;
      if (Date.now() >= deadline) return statuses;
      await new Promise((resolve) => setTimeout(resolve, interval));
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
