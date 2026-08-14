import {
  DEFAULT_LIMITS,
  queryEndpoint,
  type HydraConfig,
  type HydraLimits,
} from './config.js';
import {
  HydraDecodeError,
  HydraGuardError,
  HydraQueryError,
  HydraTransportError,
} from './errors.js';
import { assertSingleStatement } from './statement.js';
import { decodeRows, rowsToObjects, type HydraValue } from './values.js';

export interface QueryRequest {
  readonly cypher: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly timeoutMs?: number;
  readonly pageSize?: number;
  /**
   * Causal read selector (DECISIONS.md D-013).
   *
   *   undefined  use the bookmark from the last write this client performed
   *   null       send no bookmark
   *   string     send this one
   */
  readonly bookmark?: string | null;
  readonly consistency?: 'strong' | 'eventual';
  readonly signal?: AbortSignal;
}

export interface QueryPage {
  readonly queryId: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly HydraValue[])[];
  readonly readEpoch: number | null;
  /**
   * Opaque. Observed as a small per-node counter rather than a row offset, so
   * it is never interpreted, only echoed back with the same query_id.
   */
  readonly nextCursor: number | null;
  readonly bookmark: string | null;
}

interface WireRequest {
  cell_id: string;
  query: string;
  query_id: string;
  parameters?: Record<string, unknown>;
  consistency?: string;
  timeout_ms?: number;
  page_size?: number;
  cursor?: number;
  bookmark?: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads a response body without letting it grow unbounded. The cap is enforced
 * while the stream is being consumed, not after, so an oversized response is
 * cut off rather than buffered and then rejected.
 */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (res.body === null) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HydraTransportError(
          `response body exceeded the ${maxBytes} byte cap and was cut off`,
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(joined);
}

/**
 * HydraDB reports failures as {"error": {"message": "..."}}. When the body is
 * something else entirely, the raw text is more useful than a guess, so it is
 * passed through truncated.
 */
export function unwrapEngineMessage(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isRecord(parsed) && isRecord(parsed['error'])) {
      const message = parsed['error']['message'];
      if (typeof message === 'string') return message;
    }
  } catch {
    // Not JSON. Fall through.
  }
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 400 ? `${flat.slice(0, 400)}...` : flat;
}

export class HydraClient {
  readonly #config: HydraConfig;
  readonly #limits: HydraLimits;
  readonly #fetch: FetchLike;
  #lastWriteBookmark: string | null = null;

  constructor(
    config: HydraConfig,
    options: { limits?: Partial<HydraLimits>; fetch?: FetchLike } = {},
  ) {
    this.#config = config;
    this.#limits = { ...DEFAULT_LIMITS, ...options.limits };
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The bookmark returned by the most recent write, or null before any. */
  get lastWriteBookmark(): string | null {
    return this.#lastWriteBookmark;
  }

  /**
   * A client-minted query id, per DECISIONS.md D-012. The server will supply
   * one if this is omitted, but a cursor is scoped to the query id it was
   * issued under, and minting our own is what makes a paged read a thing this
   * client controls rather than something it has to remember.
   */
  static mintQueryId(): string {
    return `lacuna-${crypto.randomUUID()}`;
  }

  /** One HTTP request. Does not follow cursors. */
  async queryPage(
    request: QueryRequest,
    options: { queryId?: string; cursor?: number } = {},
  ): Promise<QueryPage> {
    const cypher = request.cypher.trim();
    if (cypher === '') {
      throw new HydraGuardError('query is empty');
    }
    if (cypher.length > this.#limits.maxQueryChars) {
      throw new HydraGuardError(
        `query is ${cypher.length} characters, over the `
        + `${this.#limits.maxQueryChars} character cap`,
      );
    }
    assertSingleStatement(cypher);

    const timeoutMs = request.timeoutMs ?? this.#limits.defaultTimeoutMs;
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new HydraGuardError(`timeoutMs must be a positive integer, got ${timeoutMs}`);
    }

    const body: WireRequest = {
      cell_id: this.#config.cell,
      query: cypher,
      query_id: options.queryId ?? HydraClient.mintQueryId(),
      consistency: request.consistency ?? 'strong',
      timeout_ms: timeoutMs,
    };

    if (request.parameters !== undefined) {
      body.parameters = { ...request.parameters };
    }
    if (request.pageSize !== undefined) {
      if (!Number.isInteger(request.pageSize) || request.pageSize <= 0) {
        throw new HydraGuardError(
          `pageSize must be a positive integer, got ${request.pageSize}`,
        );
      }
      body.page_size = request.pageSize;
    }
    if (options.cursor !== undefined) {
      body.cursor = options.cursor;
    }

    const bookmark = request.bookmark === undefined
      ? this.#lastWriteBookmark
      : request.bookmark;
    if (bookmark !== null) {
      body.bookmark = bookmark;
    }

    const encoded = JSON.stringify(body);
    const payloadBytes = Buffer.byteLength(encoded, 'utf8');
    if (payloadBytes > this.#limits.maxParameterBytes) {
      throw new HydraGuardError(
        `request payload is ${payloadBytes} bytes, over the `
        + `${this.#limits.maxParameterBytes} byte cap`,
      );
    }

    const timeout = AbortSignal.timeout(timeoutMs + this.#limits.abortSlackMs);
    const signal = request.signal === undefined
      ? timeout
      : AbortSignal.any([timeout, request.signal]);

    let res: Response;
    try {
      res = await this.#fetch(queryEndpoint(this.#config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.#config.token}`,
          'X-Graph-Namespace': this.#config.namespace,
        },
        body: encoded,
        signal,
      });
    } catch (cause) {
      // Deliberately does not include the request headers. One of them is the
      // token, and a thrown error is a thing that gets logged.
      const reason = cause instanceof Error && cause.name === 'TimeoutError'
        ? `client abort after ${timeoutMs + this.#limits.abortSlackMs}ms`
        : 'request failed before a response arrived';
      throw new HydraTransportError(`${reason} (${queryEndpoint(this.#config)})`, { cause });
    }

    if (!res.ok) {
      const text = await readCapped(res, 64 * 1024).catch(() => '');
      throw new HydraQueryError(res.status, unwrapEngineMessage(text));
    }

    const text = await readCapped(res, this.#limits.maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (cause) {
      throw new HydraDecodeError('response body is not valid JSON', { cause });
    }
    return decodePage(parsed);
  }

  /**
   * A complete read. Follows cursors under one query id until the server stops
   * handing them out, bounded by maxPages and maxRowsPerQuery.
   */
  async query(request: QueryRequest): Promise<QueryPage> {
    const queryId = HydraClient.mintQueryId();
    let page = await this.queryPage(request, { queryId });

    if (page.nextCursor === null) return page;

    const columns = page.columns;
    const rows: (readonly HydraValue[])[] = [...page.rows];
    let pages = 1;

    while (page.nextCursor !== null) {
      if (pages >= this.#limits.maxPages) {
        throw new HydraTransportError(
          `result did not end after ${pages} pages, over the `
          + `${this.#limits.maxPages} page cap`,
        );
      }
      page = await this.queryPage(request, { queryId, cursor: page.nextCursor });
      pages += 1;

      if (page.columns.length !== columns.length
        || page.columns.some((name, i) => name !== columns[i])) {
        throw new HydraDecodeError(
          `page ${pages} changed the column list from [${columns.join(', ')}] `
          + `to [${page.columns.join(', ')}]`,
        );
      }
      rows.push(...page.rows);
      if (rows.length > this.#limits.maxRowsPerQuery) {
        throw new HydraTransportError(
          `result exceeded the ${this.#limits.maxRowsPerQuery} row cap after `
          + `${pages} pages`,
        );
      }
    }

    return {
      queryId,
      columns,
      rows,
      readEpoch: page.readEpoch,
      nextCursor: null,
      bookmark: page.bookmark,
    };
  }

  /** Same as query, with the rows keyed by the response's column names. */
  async queryObjects(request: QueryRequest): Promise<Record<string, HydraValue>[]> {
    const page = await this.query(request);
    return rowsToObjects(page.columns, page.rows);
  }

  /**
   * A mutation. Transport is identical to a read; what differs is that the
   * bookmark it returns is remembered, so the next read can be told to observe
   * this write (D-013).
   */
  async write(request: QueryRequest): Promise<QueryPage> {
    const page = await this.queryPage(request, { queryId: HydraClient.mintQueryId() });
    if (page.bookmark !== null) {
      this.#lastWriteBookmark = page.bookmark;
    }
    return page;
  }

  /** Drops the remembered write bookmark. Reads stop being causally pinned. */
  forgetWriteBookmark(): void {
    this.#lastWriteBookmark = null;
  }
}

function decodePage(parsed: unknown): QueryPage {
  if (!isRecord(parsed)) {
    throw new HydraDecodeError('response body is not a JSON object');
  }
  const queryId = parsed['query_id'];
  const columns = parsed['columns'];
  const readEpoch = parsed['read_epoch'];
  const nextCursor = parsed['next_cursor'];
  const bookmark = parsed['bookmark'];

  if (typeof queryId !== 'string') {
    throw new HydraDecodeError('response has no string query_id');
  }
  if (!Array.isArray(columns) || columns.some((c) => typeof c !== 'string')) {
    throw new HydraDecodeError('response columns is not an array of strings');
  }
  if (readEpoch !== null && readEpoch !== undefined && typeof readEpoch !== 'number') {
    throw new HydraDecodeError('response read_epoch is neither a number nor null');
  }
  if (nextCursor !== null && nextCursor !== undefined && typeof nextCursor !== 'number') {
    throw new HydraDecodeError('response next_cursor is neither a number nor null');
  }
  if (bookmark !== null && bookmark !== undefined && typeof bookmark !== 'string') {
    throw new HydraDecodeError('response bookmark is neither a string nor null');
  }

  return {
    queryId,
    columns: columns as string[],
    rows: decodeRows(parsed['rows']),
    readEpoch: typeof readEpoch === 'number' ? readEpoch : null,
    nextCursor: typeof nextCursor === 'number' ? nextCursor : null,
    bookmark: typeof bookmark === 'string' ? bookmark : null,
  };
}
