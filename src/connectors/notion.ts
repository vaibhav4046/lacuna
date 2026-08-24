import { createHash } from 'node:crypto';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import {
  prepareConnectorBatch,
  type ConnectorDocumentInput,
  type PreparedConnectorBatch,
} from './normalize.js';

export const NOTION_PARSER_VERSION = 'notion-v1';

/**
 * One bounded, reviewed read of a Notion page the caller can already see.
 *
 * Slack's doctrine, transplanted: the caller names one page and pastes their
 * own integration token, the importer makes a fixed, small set of requests
 * against a pinned origin, and what comes back is prose the extractor reads
 * like any other source. No OAuth application of ours, no continuous sync, no
 * stored credential --- the token is sent as a header on these requests and
 * written nowhere, not into provenance, not into an error, not into a log.
 *
 * The origin is a constant, so there is no address for a caller to choose and
 * no SSRF surface. The page id is validated to Notion's own 32-hex-digit
 * grammar before any request is made.
 */
const NOTION_API_ORIGIN = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const DEFAULT_DEADLINE_MS = 20_000;
/** page retrieve, then up to two pages of block children. */
const DEFAULT_MAX_REQUESTS = 4;
const RESPONSE_BYTES = 1_536 * 1024;
const BLOCK_PAGE_SIZE = 100;
/** 32 hex digits, dashed or not; Notion's own id shape. Never a token. */
const RAW_ID = /[0-9a-fA-F]{32}/u;
const CANONICAL_ID = /^[0-9a-f]{32}$/u;
/** Integration tokens: ntn_ (current) or secret_ (legacy). Shape only, never stored. */
const TOKEN = /^(?:ntn_|secret_)[A-Za-z0-9]{20,100}$/u;
/** Block types whose rich_text is real prose worth reading. */
const TEXT_BLOCKS = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout',
]);

export type NotionImportErrorCode =
  | 'invalid_notion_request'
  | 'notion_auth_failed'
  | 'notion_page_unreadable'
  | 'notion_unavailable'
  | 'notion_timeout'
  | 'notion_budget_exceeded'
  | 'notion_no_text';

export class NotionImportError extends Error {
  override readonly name = 'NotionImportError';
  readonly code: NotionImportErrorCode;
  readonly status: number;

  constructor(code: NotionImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'invalid_notion_request' || code === 'notion_no_text'
      || code === 'notion_auth_failed' || code === 'notion_page_unreadable' ? 422
      : code === 'notion_budget_exceeded' ? 413
        : code === 'notion_timeout' ? 504
          : 502;
  }
}

export interface PreparedNotionBatch extends PreparedConnectorBatch {
  readonly pageId: string;
  readonly title: string;
  readonly blockCount: number;
}

export interface NotionTransportRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface NotionTransportResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

export interface NotionTransport {
  request(request: NotionTransportRequest): Promise<NotionTransportResponse>;
}

export interface NotionImporterBoundary {
  importPage(page: string, token: string, signal: AbortSignal): Promise<PreparedNotionBatch>;
}

export interface NotionImporterOptions {
  readonly transport?: NotionTransport;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

function fetchTransport(): NotionTransport {
  return {
    async request(request) {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        redirect: 'manual',
        signal: request.signal,
      });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > request.maxResponseBytes) throw new NotionImportError('notion_budget_exceeded');
      return { status: response.status, body: new Uint8Array(buffer) };
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The 32-hex page id out of a URL, a dashed UUID, or a bare id. */
function canonicalPageId(raw: string): string | null {
  const trimmed = raw.trim();
  const match = RAW_ID.exec(trimmed.replace(/-/gu, ''));
  return match === null ? null : match[0].toLowerCase();
}

/** The concatenated plain_text of a rich_text array. */
function richText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((part) => {
    const rec = asRecord(part);
    return rec === null ? '' : str(rec['plain_text']);
  }).join('');
}

/** A page title out of the retrieve response's properties, or the id. */
function pageTitle(page: Record<string, unknown>, fallback: string): string {
  const props = asRecord(page['properties']);
  if (props !== null) {
    for (const value of Object.values(props)) {
      const prop = asRecord(value);
      if (prop !== null && prop['type'] === 'title') {
        const text = richText(prop['title']);
        if (text.trim() !== '') return text.trim().slice(0, 120);
      }
    }
  }
  return `Notion page ${fallback.slice(0, 8)}`;
}

/** One block's readable line, or empty for a block that carries no prose. */
function blockLine(block: Record<string, unknown>): string {
  const type = str(block['type']);
  if (!TEXT_BLOCKS.has(type)) return '';
  const inner = asRecord(block[type]);
  if (inner === null) return '';
  const text = richText(inner['rich_text']).replace(/\r\n?/gu, '\n').trim();
  if (text === '') return '';
  // A to_do keeps its checkbox state, because "done" versus "planned" is
  // exactly the kind of distinction the extractor's modes turn on.
  if (type === 'to_do') return `${inner['checked'] === true ? '[x]' : '[ ]'} ${text}`;
  return text;
}

export class NotionImporter implements NotionImporterBoundary {
  readonly #transport: NotionTransport;
  readonly #now: () => number;
  readonly #deadlineMs: number;

  constructor(options: NotionImporterOptions = {}) {
    this.#transport = options.transport ?? fetchTransport();
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  async importPage(page: string, token: string, signal: AbortSignal): Promise<PreparedNotionBatch> {
    const pageId = canonicalPageId(page);
    if (pageId === null || !CANONICAL_ID.test(pageId) || !TOKEN.test(token)) {
      throw new NotionImportError('invalid_notion_request');
    }

    const startedAt = this.#now();
    const control = new AbortController();
    let deadlineExpired = false;
    const relayAbort = () => control.abort();
    if (signal.aborted) relayAbort();
    else signal.addEventListener('abort', relayAbort, { once: true });
    const deadline = setTimeout(() => { deadlineExpired = true; control.abort(); }, this.#deadlineMs);
    deadline.unref?.();
    let requests = 0;

    const call = async (path: string): Promise<Record<string, unknown>> => {
      requests += 1;
      if (requests > DEFAULT_MAX_REQUESTS) throw new NotionImportError('notion_budget_exceeded');
      if (control.signal.aborted) throw new NotionImportError(deadlineExpired ? 'notion_timeout' : 'notion_unavailable');
      let response: NotionTransportResponse;
      try {
        response = await this.#transport.request({
          url: `${NOTION_API_ORIGIN}${path}`,
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': NOTION_VERSION,
            'User-Agent': 'Lacuna-Connector/1.0',
          },
          signal: control.signal,
          maxResponseBytes: RESPONSE_BYTES,
        });
      } catch (error) {
        if (error instanceof NotionImportError) throw error;
        throw new NotionImportError(deadlineExpired ? 'notion_timeout' : 'notion_unavailable');
      }
      if (response.status === 401) throw new NotionImportError('notion_auth_failed');
      if (response.status === 403) throw new NotionImportError('notion_page_unreadable');
      if (response.status === 404) throw new NotionImportError('notion_page_unreadable');
      if (response.status === 429) throw new NotionImportError('notion_unavailable');
      if (response.status !== 200) throw new NotionImportError('notion_unavailable');
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
      } catch {
        throw new NotionImportError('notion_unavailable');
      }
      const body = asRecord(parsed);
      if (body === null) throw new NotionImportError('notion_unavailable');
      return body;
    };

    const page_ = await call(`/pages/${pageId}`);
    const title = pageTitle(page_, pageId);

    const lines: string[] = [];
    let cursor: string | null = null;
    let blockCount = 0;
    // At most two pages of children, which is the request budget's ceiling and
    // far more than a page a person would review by hand.
    for (let round = 0; round < 2; round += 1) {
      const query = new URLSearchParams({ page_size: String(BLOCK_PAGE_SIZE) });
      if (cursor !== null) query.set('start_cursor', cursor);
      const children = await call(`/blocks/${pageId}/children?${query.toString()}`);
      const results = Array.isArray(children['results']) ? children['results'] : [];
      for (const entry of results) {
        const block = asRecord(entry);
        if (block === null) continue;
        blockCount += 1;
        const line = blockLine(block);
        if (line !== '') lines.push(line);
      }
      const next = str(children['next_cursor']);
      if (children['has_more'] !== true || next === '') break;
      cursor = next;
    }

    const text = lines.join('\n').slice(0, MAX_SOURCE_CHARS);
    if (text.trim() === '') throw new NotionImportError('notion_no_text');

    clearTimeout(deadline);
    const observedAt = new Date(startedAt).toISOString();
    const rawDigest = createHash('sha256').update(text, 'utf8').digest('hex');
    const document: ConnectorDocumentInput = {
      title: title.slice(0, 120),
      text,
      provenance: {
        connectorId: 'notion',
        sourceUrl: `https://www.notion.so/${pageId}`,
        mediaType: 'text/plain',
        observedAt,
        notion: {
          schemaVersion: 1,
          pageId,
          blockCount: lines.length,
          retrievedAt: observedAt,
          rawDigest,
          parserVersion: 'notion-v1',
        },
      },
    };

    const batch = prepareConnectorBatch([document]);
    return { ...batch, pageId, title, blockCount: lines.length };
  }
}
