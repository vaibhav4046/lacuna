import { createHash } from 'node:crypto';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import {
  prepareConnectorBatch,
  type ConnectorDocumentInput,
  type PreparedConnectorBatch,
} from './normalize.js';
import type { ConnectorId } from './types.js';

/**
 * One bounded, reviewed read of a work tool the caller can already see.
 *
 * Slack's doctrine, generalised: the caller names one item and pastes their own
 * credential, this makes a fixed, small number of requests, and what comes back
 * is prose the extractor reads like any other source. No OAuth application of
 * ours, no continuous sync, no stored credential --- the token is a parameter
 * on one call, sent as a header, and written nowhere: not into provenance, not
 * into an error, not into a log.
 *
 * The four sources live together because they are the same shape of read and
 * share every safety rule below. Anything genuinely different about one of them
 * is in its own private method, and nothing else.
 */
export type WorkSourceId = 'notion' | 'jira' | 'confluence' | 'gmail';

const NOTION_ORIGIN = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';
const GMAIL_ORIGIN = 'https://gmail.googleapis.com/gmail/v1';
const DEFAULT_DEADLINE_MS = 20_000;
const DEFAULT_MAX_REQUESTS = 4;
const RESPONSE_BYTES = 1_536 * 1024;
const NOTION_BLOCK_PAGE = 100;

/**
 * Credential grammars. These exist to refuse a malformed paste before any
 * request is made; they are never used to store, log or echo the value.
 */
const NOTION_TOKEN = /^(?:ntn_|secret_)[A-Za-z0-9]{20,120}$/u;
/** Atlassian API tokens are opaque; bound length and alphabet only. */
const ATLASSIAN_TOKEN = /^[A-Za-z0-9_=+/.-]{20,700}$/u;
/** A Google OAuth2 access token. Short-lived by construction, which suits this. */
const GOOGLE_TOKEN = /^ya29\.[A-Za-z0-9_.-]{20,2000}$/u;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[A-Za-z]{2,24}$/u;

/**
 * Resource grammars, one per source. A credential cannot pass any of them,
 * which is what keeps the evidence below free of anything secret by
 * construction rather than by careful handling.
 */
const NOTION_PAGE = /^[0-9a-f]{32}$/u;
const JIRA_ISSUE = /^[A-Z][A-Z0-9]{1,9}-\d{1,7}$/u;
const CONFLUENCE_PAGE = /^\d{1,19}$/u;
const GMAIL_THREAD = /^[0-9a-f]{1,20}$/u;
/** The single Atlassian tenant label. The only caller-supplied part of a host. */
const ATLASSIAN_SITE = /^[a-z0-9][a-z0-9-]{1,60}$/u;

export type WorkImportErrorCode =
  | 'invalid_work_request'
  | 'work_auth_failed'
  | 'work_item_unreadable'
  | 'work_unavailable'
  | 'work_timeout'
  | 'work_budget_exceeded'
  | 'work_no_text';

export class WorkImportError extends Error {
  override readonly name = 'WorkImportError';
  readonly code: WorkImportErrorCode;
  readonly status: number;

  constructor(code: WorkImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'work_budget_exceeded' ? 413
      : code === 'work_timeout' ? 504
        : code === 'work_unavailable' ? 502
          : 422;
  }
}

export type WorkImportInput =
  | { readonly source: 'notion'; readonly page: string; readonly token: string }
  | {
    readonly source: 'jira';
    readonly site: string;
    readonly email: string;
    readonly token: string;
    readonly issue: string;
  }
  | {
    readonly source: 'confluence';
    readonly site: string;
    readonly email: string;
    readonly token: string;
    readonly page: string;
  }
  | { readonly source: 'gmail'; readonly thread: string; readonly token: string };

export interface PreparedWorkBatch extends PreparedConnectorBatch {
  readonly source: WorkSourceId;
  readonly resourceRef: string;
  readonly title: string;
  readonly itemCount: number;
}

export interface WorkTransportRequest {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface WorkTransportResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

export interface WorkTransport {
  request(request: WorkTransportRequest): Promise<WorkTransportResponse>;
}

export interface WorkImporterBoundary {
  importWork(input: WorkImportInput, signal: AbortSignal): Promise<PreparedWorkBatch>;
}

export interface WorkImporterOptions {
  readonly transport?: WorkTransport;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

function fetchTransport(): WorkTransport {
  return {
    async request(request) {
      // `redirect: 'manual'` and `arrayBuffer()` rather than a composed signal
      // or a manual stream reader: both of those threw runtime-shape errors on
      // serverless and surfaced as unmapped 502s during the Slack rollout.
      const response = await fetch(request.url, {
        method: 'GET',
        headers: request.headers,
        redirect: 'manual',
        signal: request.signal,
      });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > request.maxResponseBytes) throw new WorkImportError('work_budget_exceeded');
      return { status: response.status, body: new Uint8Array(buffer) };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The 32-hex id out of a Notion URL, a dashed UUID, or a bare id. */
function notionPageId(raw: string): string | null {
  const match = /[0-9a-fA-F]{32}/u.exec(raw.trim().replace(/-/gu, ''));
  return match === null ? null : match[0].toLowerCase();
}

/** Every `text` leaf of an Atlassian Document Format tree, in document order. */
function adfText(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const child of node) adfText(child, out);
    return;
  }
  if (!isRecord(node)) return;
  const text = str(node['text']);
  if (text !== '') out.push(text);
  if (node['type'] === 'paragraph' || node['type'] === 'listItem') out.push('\n');
  adfText(node['content'], out);
}

/** Confluence storage format is XHTML. Prose survives; markup does not. */
function htmlText(html: string): string {
  return html
    .replace(/<\s*(?:br|\/p|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, '')
    .replace(/&nbsp;/giu, ' ')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&amp;/giu, '&')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n{3,}/gu, '\n\n');
}

function base64UrlText(data: string): string {
  try {
    return Buffer.from(data.replace(/-/gu, '+').replace(/_/gu, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

/** The first text/plain part of a Gmail payload tree. */
function gmailPlain(payload: unknown): string {
  if (!isRecord(payload)) return '';
  const mime = str(payload['mimeType']);
  const body = payload['body'];
  if (mime === 'text/plain' && isRecord(body)) {
    const data = str(body['data']);
    if (data !== '') return base64UrlText(data);
  }
  for (const part of list(payload['parts'])) {
    const found = gmailPlain(part);
    if (found !== '') return found;
  }
  // Only if the message is html-only does markup need stripping.
  if (mime === 'text/html' && isRecord(body)) {
    const data = str(body['data']);
    if (data !== '') return htmlText(base64UrlText(data));
  }
  return '';
}

function header(headers: unknown, name: string): string {
  for (const entry of list(headers)) {
    if (isRecord(entry) && str(entry['name']).toLowerCase() === name) return str(entry['value']);
  }
  return '';
}

export class WorkImporter implements WorkImporterBoundary {
  readonly #transport: WorkTransport;
  readonly #now: () => number;
  readonly #deadlineMs: number;

  constructor(options: WorkImporterOptions = {}) {
    this.#transport = options.transport ?? fetchTransport();
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  async importWork(input: WorkImportInput, signal: AbortSignal): Promise<PreparedWorkBatch> {
    const startedAt = this.#now();
    const control = new AbortController();
    let deadlineExpired = false;
    const relayAbort = () => control.abort();
    if (signal.aborted) relayAbort();
    else signal.addEventListener('abort', relayAbort, { once: true });
    const deadline = setTimeout(() => { deadlineExpired = true; control.abort(); }, this.#deadlineMs);
    deadline.unref?.();
    let requests = 0;

    const call = async (url: string, headers: Record<string, string>): Promise<Record<string, unknown>> => {
      requests += 1;
      if (requests > DEFAULT_MAX_REQUESTS) throw new WorkImportError('work_budget_exceeded');
      if (control.signal.aborted) throw new WorkImportError(deadlineExpired ? 'work_timeout' : 'work_unavailable');
      let response: WorkTransportResponse;
      try {
        response = await this.#transport.request({
          url,
          headers: { ...headers, Accept: 'application/json', 'User-Agent': 'Lacuna-Connector/1.0' },
          signal: control.signal,
          maxResponseBytes: RESPONSE_BYTES,
        });
      } catch (error) {
        if (error instanceof WorkImportError) throw error;
        throw new WorkImportError(deadlineExpired ? 'work_timeout' : 'work_unavailable');
      }
      // Provider status collapses into this fixed vocabulary. A provider's own
      // message never reaches the caller, because it can quote a request.
      if (response.status === 401) throw new WorkImportError('work_auth_failed');
      if (response.status === 403 || response.status === 404) throw new WorkImportError('work_item_unreadable');
      if (response.status !== 200) throw new WorkImportError('work_unavailable');
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
      } catch {
        throw new WorkImportError('work_unavailable');
      }
      if (!isRecord(parsed)) throw new WorkImportError('work_unavailable');
      return parsed;
    };

    try {
      const read = input.source === 'notion' ? await this.#notion(input, call)
        : input.source === 'jira' ? await this.#jira(input, call)
          : input.source === 'confluence' ? await this.#confluence(input, call)
            : await this.#gmail(input, call);

      const text = read.lines.join('\n').trim().slice(0, MAX_SOURCE_CHARS);
      if (text === '') throw new WorkImportError('work_no_text');

      const observedAt = new Date(startedAt).toISOString();
      const document: ConnectorDocumentInput = {
        title: read.title.slice(0, 120),
        text,
        provenance: {
          connectorId: input.source satisfies WorkSourceId as ConnectorId,
          sourceUrl: read.sourceUrl,
          mediaType: 'text/plain',
          observedAt,
          document: {
            schemaVersion: 1,
            resourceRef: read.resourceRef,
            itemCount: read.itemCount,
            retrievedAt: observedAt,
            rawDigest: createHash('sha256').update(text, 'utf8').digest('hex'),
            parserVersion: `${input.source}-v1`,
          },
        },
      };
      const batch = prepareConnectorBatch([document]);
      return {
        ...batch,
        source: input.source,
        resourceRef: read.resourceRef,
        title: read.title,
        itemCount: read.itemCount,
      };
    } finally {
      clearTimeout(deadline);
    }
  }

  async #notion(
    input: Extract<WorkImportInput, { source: 'notion' }>,
    call: (url: string, headers: Record<string, string>) => Promise<Record<string, unknown>>,
  ): Promise<WorkRead> {
    const pageId = notionPageId(input.page);
    if (pageId === null || !NOTION_PAGE.test(pageId) || !NOTION_TOKEN.test(input.token)) {
      throw new WorkImportError('invalid_work_request');
    }
    const headers = { Authorization: `Bearer ${input.token}`, 'Notion-Version': NOTION_VERSION };
    const page = await call(`${NOTION_ORIGIN}/pages/${pageId}`, headers);

    let title = '';
    const properties = page['properties'];
    if (isRecord(properties)) {
      for (const value of Object.values(properties)) {
        if (isRecord(value) && value['type'] === 'title') {
          title = richText(value['title']).trim();
          if (title !== '') break;
        }
      }
    }

    const lines: string[] = [];
    let blocks = 0;
    let cursor = '';
    for (let round = 0; round < 2; round += 1) {
      const query = new URLSearchParams({ page_size: String(NOTION_BLOCK_PAGE) });
      if (cursor !== '') query.set('start_cursor', cursor);
      const children = await call(`${NOTION_ORIGIN}/blocks/${pageId}/children?${query.toString()}`, headers);
      for (const entry of list(children['results'])) {
        if (!isRecord(entry)) continue;
        blocks += 1;
        const line = notionBlockLine(entry);
        if (line !== '') lines.push(line);
      }
      cursor = str(children['next_cursor']);
      if (children['has_more'] !== true || cursor === '') break;
    }

    return {
      title: title === '' ? `Notion page ${pageId.slice(0, 8)}` : title,
      lines,
      itemCount: blocks,
      resourceRef: pageId,
      sourceUrl: `https://www.notion.so/${pageId}`,
    };
  }

  async #jira(
    input: Extract<WorkImportInput, { source: 'jira' }>,
    call: (url: string, headers: Record<string, string>) => Promise<Record<string, unknown>>,
  ): Promise<WorkRead> {
    if (!ATLASSIAN_SITE.test(input.site) || !EMAIL.test(input.email)
      || !ATLASSIAN_TOKEN.test(input.token) || !JIRA_ISSUE.test(input.issue)) {
      throw new WorkImportError('invalid_work_request');
    }
    const origin = `https://${input.site}.atlassian.net`;
    const headers = { Authorization: basic(input.email, input.token) };
    const issue = await call(`${origin}/rest/api/3/issue/${input.issue}?fields=summary,description,status,created`, headers);
    const fields = isRecord(issue['fields']) ? issue['fields'] : {};
    const summary = str(fields['summary']).trim();

    const lines: string[] = [];
    const status = isRecord(fields['status']) ? str(fields['status']['name']) : '';
    if (status !== '') lines.push(`${input.issue} status: ${status}.`);
    const described: string[] = [];
    adfText(fields['description'], described);
    const description = described.join('').replace(/\n{3,}/gu, '\n\n').trim();
    if (description !== '') lines.push(description);

    const comments = await call(`${origin}/rest/api/3/issue/${input.issue}/comment?maxResults=50&orderBy=created`, headers);
    let counted = 0;
    for (const entry of list(comments['comments'])) {
      if (!isRecord(entry)) continue;
      counted += 1;
      const author = isRecord(entry['author']) ? str(entry['author']['displayName']) : '';
      const parts: string[] = [];
      adfText(entry['body'], parts);
      const body = parts.join('').replace(/\s+/gu, ' ').trim();
      if (body === '') continue;
      const at = str(entry['created']).slice(0, 10);
      lines.push(`[${at}] ${author === '' ? 'Comment' : author}: ${body}`);
    }

    return {
      title: summary === '' ? input.issue : `${input.issue} ${summary}`,
      lines,
      itemCount: counted + 1,
      resourceRef: input.issue,
      sourceUrl: `${origin}/browse/${input.issue}`,
    };
  }

  async #confluence(
    input: Extract<WorkImportInput, { source: 'confluence' }>,
    call: (url: string, headers: Record<string, string>) => Promise<Record<string, unknown>>,
  ): Promise<WorkRead> {
    if (!ATLASSIAN_SITE.test(input.site) || !EMAIL.test(input.email)
      || !ATLASSIAN_TOKEN.test(input.token) || !CONFLUENCE_PAGE.test(input.page)) {
      throw new WorkImportError('invalid_work_request');
    }
    const origin = `https://${input.site}.atlassian.net`;
    const headers = { Authorization: basic(input.email, input.token) };
    const page = await call(
      `${origin}/wiki/rest/api/content/${input.page}?expand=body.storage,version,space`,
      headers,
    );
    const title = str(page['title']).trim();
    const body = isRecord(page['body']) && isRecord(page['body']['storage'])
      ? str(page['body']['storage']['value'])
      : '';
    const prose = htmlText(body).trim();
    const lines: string[] = [];
    const version = isRecord(page['version']) ? str(page['version']['when']).slice(0, 10) : '';
    if (title !== '' && version !== '') lines.push(`[${version}] ${title}`);
    if (prose !== '') lines.push(prose);

    return {
      title: title === '' ? `Confluence page ${input.page}` : title,
      lines,
      itemCount: 1,
      resourceRef: input.page,
      sourceUrl: `${origin}/wiki/spaces/pages/${input.page}`,
    };
  }

  async #gmail(
    input: Extract<WorkImportInput, { source: 'gmail' }>,
    call: (url: string, headers: Record<string, string>) => Promise<Record<string, unknown>>,
  ): Promise<WorkRead> {
    if (!GMAIL_THREAD.test(input.thread) || !GOOGLE_TOKEN.test(input.token)) {
      throw new WorkImportError('invalid_work_request');
    }
    const headers = { Authorization: `Bearer ${input.token}` };
    const thread = await call(`${GMAIL_ORIGIN}/users/me/threads/${input.thread}?format=full`, headers);

    const lines: string[] = [];
    let subject = '';
    let counted = 0;
    for (const entry of list(thread['messages'])) {
      if (!isRecord(entry)) continue;
      counted += 1;
      const payload = entry['payload'];
      const headerList = isRecord(payload) ? payload['headers'] : [];
      if (subject === '') subject = header(headerList, 'subject');
      const from = header(headerList, 'from');
      const date = header(headerList, 'date');
      const body = gmailPlain(payload)
        // Quoted history repeats what earlier messages already said, and the
        // extractor should not read one claim many times.
        .split(/^\s*(?:On .+ wrote:|-{2,} ?Original Message)/mu)[0] ?? '';
      const prose = body.replace(/^>.*$/gmu, '').replace(/\n{3,}/gu, '\n\n').trim();
      if (prose === '') continue;
      const at = date === '' ? '' : new Date(date).toISOString().slice(0, 10);
      lines.push(`[${at}] ${from}: ${prose}`);
    }

    return {
      title: subject === '' ? `Gmail thread ${input.thread}` : subject,
      lines,
      itemCount: counted,
      resourceRef: input.thread,
      sourceUrl: `https://mail.google.com/mail/u/0/#inbox/${input.thread}`,
    };
  }
}

interface WorkRead {
  readonly title: string;
  readonly lines: readonly string[];
  readonly itemCount: number;
  readonly resourceRef: string;
  readonly sourceUrl: string;
}

function basic(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`, 'utf8').toString('base64')}`;
}

function richText(value: unknown): string {
  return list(value).map((part) => (isRecord(part) ? str(part['plain_text']) : '')).join('');
}

const NOTION_TEXT_BLOCKS = new Set([
  'paragraph', 'heading_1', 'heading_2', 'heading_3',
  'bulleted_list_item', 'numbered_list_item', 'to_do', 'toggle', 'quote', 'callout',
]);

function notionBlockLine(block: Record<string, unknown>): string {
  const type = str(block['type']);
  if (!NOTION_TEXT_BLOCKS.has(type)) return '';
  const inner = block[type];
  if (!isRecord(inner)) return '';
  const text = richText(inner['rich_text']).replace(/\r\n?/gu, '\n').trim();
  if (text === '') return '';
  // A to_do keeps its checkbox, because done versus planned is exactly the
  // distinction the extractor's modes turn on.
  if (type === 'to_do') return `${inner['checked'] === true ? '[x]' : '[ ]'} ${text}`;
  return text;
}
