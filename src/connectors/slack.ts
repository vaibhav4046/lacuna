import { createHash } from 'node:crypto';

import { MAX_SOURCE_CHARS } from '../api/ingest.js';
import {
  prepareConnectorBatch,
  type ConnectorDocumentInput,
  type PreparedConnectorBatch,
} from './normalize.js';

export const SLACK_PARSER_VERSION = 'slack-v1';

/**
 * One bounded, reviewed read of a Slack channel the caller can already see.
 *
 * The shape is the GitHub snapshot's, transplanted: the caller names one
 * thing, the importer makes a fixed, small set of requests against a pinned
 * origin, and what comes back is a transcript the extractor reads like any
 * other. No OAuth application of ours, no continuous sync, no events, and no
 * stored credential: the caller pastes their own bot or user token, it is sent
 * as a header on these requests, and nothing here writes it anywhere --- not
 * into provenance, not into an error, not into a log. That is the same
 * doctrine as the GitHub token field, and it is what lets this exist without
 * this deployment becoming a keeper of anyone's Slack access.
 *
 * The origin is a constant, so unlike the HTTPS connector there is no address
 * for a caller to choose and no SSRF surface to guard. The channel id is
 * validated to Slack's own grammar before any request is made.
 */
const SLACK_API_ORIGIN = 'https://slack.com/api';
const DEFAULT_DEADLINE_MS = 20_000;
/** auth.test, conversations.info, conversations.history, users.list. */
const DEFAULT_MAX_REQUESTS = 4;
const RESPONSE_BYTES = 1_536 * 1024;
/** One page. History beyond this is a sync product, which this is not. */
const HISTORY_LIMIT = 200;
const USERS_LIMIT = 200;
/** C public, G private group, D direct message. Slack's own id grammar. */
const CHANNEL_ID = /^[CGD][A-Z0-9]{6,20}$/u;
/** xoxb bot, xoxp user, xoxe rotated. Checked for shape, never stored. */
const TOKEN = /^xox[bpe]-[A-Za-z0-9-]{10,250}$/u;

export type SlackImportErrorCode =
  | 'invalid_slack_request'
  | 'slack_auth_failed'
  | 'slack_channel_unreadable'
  | 'slack_unavailable'
  | 'slack_timeout'
  | 'slack_budget_exceeded'
  | 'slack_no_messages';

export class SlackImportError extends Error {
  override readonly name = 'SlackImportError';
  readonly code: SlackImportErrorCode;
  readonly status: number;

  constructor(code: SlackImportErrorCode) {
    super(code);
    this.code = code;
    this.status = code === 'invalid_slack_request' || code === 'slack_no_messages'
      || code === 'slack_auth_failed' || code === 'slack_channel_unreadable' ? 422
      : code === 'slack_budget_exceeded' ? 413
        : code === 'slack_timeout' ? 504
          : 502;
  }
}

export interface PreparedSlackBatch extends PreparedConnectorBatch {
  readonly teamId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly messageCount: number;
  readonly oldestTs: string;
  readonly latestTs: string;
}

export interface SlackTransportRequest {
  readonly url: string;
  readonly method: 'GET';
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  readonly maxResponseBytes: number;
}

export interface SlackTransportResponse {
  readonly status: number;
  readonly body: Uint8Array;
}

export interface SlackTransport {
  request(request: SlackTransportRequest): Promise<SlackTransportResponse>;
}

export interface SlackImporterBoundary {
  importChannel(channelId: string, token: string, signal: AbortSignal): Promise<PreparedSlackBatch>;
}

export interface SlackImporterOptions {
  readonly transport?: SlackTransport;
  readonly now?: () => number;
  readonly deadlineMs?: number;
}

function fetchTransport(): SlackTransport {
  return {
    async request(request) {
      // `redirect: 'manual'` rather than `'error'`: a redirect on a valid API
      // call should be treated as an unavailable response, not a raw TypeError
      // that escapes into the generic catch. And the body is read with
      // arrayBuffer rather than a manual stream reader, because a serverless
      // fetch does not always expose `response.body` as a web stream, and a
      // null there was another way this fell to a bare 502.
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        redirect: 'manual',
        signal: request.signal,
      });
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > request.maxResponseBytes) throw new SlackImportError('slack_budget_exceeded');
      return { status: response.status, body: new Uint8Array(buffer) };
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Slack error strings are a fixed vocabulary and safe to branch on, but they
 * are the provider's words rather than ours, so they collapse into this
 * module's own codes and never travel further.
 */
function refusalFor(slackError: string): SlackImportError {
  if (slackError === 'invalid_auth' || slackError === 'not_authed'
    || slackError === 'account_inactive' || slackError === 'token_revoked'
    || slackError === 'token_expired') {
    return new SlackImportError('slack_auth_failed');
  }
  if (slackError === 'channel_not_found' || slackError === 'not_in_channel'
    || slackError === 'missing_scope' || slackError === 'is_archived') {
    return new SlackImportError('slack_channel_unreadable');
  }
  if (slackError === 'ratelimited' || slackError === 'rate_limited') {
    return new SlackImportError('slack_unavailable');
  }
  return new SlackImportError('slack_unavailable');
}

/** A Slack ts is seconds.microseconds; the transcript wants an instant. */
function tsToIso(ts: string): string {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return new Date(Math.round(seconds * 1000)).toISOString();
}

/** A display name the segmenter reads as one speaker token. */
function speaker(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_.'-]/gu, '').slice(0, 24);
  return /^[A-Za-z]/u.test(cleaned) ? cleaned : `u${cleaned}`.slice(0, 24);
}

export class SlackImporter implements SlackImporterBoundary {
  readonly #transport: SlackTransport;
  readonly #now: () => number;
  readonly #deadlineMs: number;

  constructor(options: SlackImporterOptions = {}) {
    this.#transport = options.transport ?? fetchTransport();
    this.#now = options.now ?? Date.now;
    this.#deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
  }

  async importChannel(channelId: string, token: string, signal: AbortSignal): Promise<PreparedSlackBatch> {
    if (!CHANNEL_ID.test(channelId) || !TOKEN.test(token)) {
      throw new SlackImportError('invalid_slack_request');
    }

    const startedAt = this.#now();
    // The GitHub importer's deadline shape, not AbortSignal.any: a caller-relayed
    // AbortController with a setTimeout, because the composed-signal helpers are
    // not uniformly present across serverless runtimes and a missing one throws
    // an unmapped error that surfaces as a bare 502.
    const control = new AbortController();
    let deadlineExpired = false;
    const relayAbort = () => control.abort();
    if (signal.aborted) relayAbort();
    else signal.addEventListener('abort', relayAbort, { once: true });
    const deadline = setTimeout(() => { deadlineExpired = true; control.abort(); }, this.#deadlineMs);
    deadline.unref?.();
    let requests = 0;

    const call = async (method: string, params: Readonly<Record<string, string>>): Promise<Record<string, unknown>> => {
      requests += 1;
      if (requests > DEFAULT_MAX_REQUESTS) throw new SlackImportError('slack_budget_exceeded');
      const query = new URLSearchParams(params);
      if (control.signal.aborted) throw new SlackImportError(deadlineExpired ? 'slack_timeout' : 'slack_unavailable');
      let response: SlackTransportResponse;
      try {
        response = await this.#transport.request({
          url: `${SLACK_API_ORIGIN}/${method}?${query.toString()}`,
          method: 'GET',
          headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Lacuna-Connector/1.0' },
          signal: control.signal,
          maxResponseBytes: RESPONSE_BYTES,
        });
      } catch (error) {
        if (error instanceof SlackImportError) throw error;
        throw new SlackImportError(deadlineExpired ? 'slack_timeout' : 'slack_unavailable');
      }
      if (response.status === 429) throw new SlackImportError('slack_unavailable');
      if (response.status !== 200) throw new SlackImportError('slack_unavailable');
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(response.body));
      } catch {
        throw new SlackImportError('slack_unavailable');
      }
      const body = record(parsed);
      if (body === null) throw new SlackImportError('slack_unavailable');
      if (body['ok'] !== true) throw refusalFor(str(body['error']));
      return body;
    };

    const auth = await call('auth.test', {});
    const teamId = str(auth['team_id']);

    const info = record((await call('conversations.info', { channel: channelId }))['channel']);
    const channelName = info === null ? channelId : str(info['name']) || channelId;

    const history = await call('conversations.history', {
      channel: channelId,
      limit: String(HISTORY_LIMIT),
    });
    const rawMessages = Array.isArray(history['messages']) ? history['messages'] : [];

    // Real conversation only: joins, topic changes and bot scaffolding are
    // Slack narrating itself, and recording them as things people said would
    // put claims in nobody's mouth in particular.
    const messages = rawMessages
      .map(record)
      .filter((m): m is Record<string, unknown> => m !== null)
      .filter((m) => str(m['type']) === 'message' && m['subtype'] === undefined && str(m['text']) !== '');
    if (messages.length === 0) throw new SlackImportError('slack_no_messages');

    // Display names, one bounded page. A user outside the page keeps their id
    // as a speaker label, which is ugly and true.
    const users = new Map<string, string>();
    const listed = await call('users.list', { limit: String(USERS_LIMIT) });
    for (const entry of Array.isArray(listed['members']) ? listed['members'] : []) {
      const member = record(entry);
      if (member === null) continue;
      const profile = record(member['profile']);
      const name = (profile === null ? '' : str(profile['display_name']) || str(profile['real_name']))
        || str(member['name']);
      if (str(member['id']) !== '' && name !== '') users.set(str(member['id']), name);
    }

    // Oldest first, the way a transcript reads.
    const ordered = [...messages].sort((a, b) => Number.parseFloat(str(a['ts'])) - Number.parseFloat(str(b['ts'])));
    const lines: string[] = [];
    for (const message of ordered) {
      const iso = tsToIso(str(message['ts']));
      const who = speaker(users.get(str(message['user'])) ?? str(message['user']) ?? 'member');
      const text = str(message['text']).replace(/\r\n?/gu, '\n').trim();
      if (text === '') continue;
      lines.push(`${iso === '' ? '' : `[${iso}] `}${who}: ${text}`);
    }
    const transcript = lines.join('\n').slice(0, MAX_SOURCE_CHARS);
    if (transcript.trim() === '') throw new SlackImportError('slack_no_messages');

    const oldestTs = str(ordered[0]?.['ts']);
    const latestTs = str(ordered[ordered.length - 1]?.['ts']);
    const observedAt = new Date(startedAt).toISOString();
    const rawDigest = createHash('sha256').update(transcript, 'utf8').digest('hex');

    const document: ConnectorDocumentInput = {
      title: `Slack #${channelName}`.slice(0, 120),
      text: transcript,
      provenance: {
        connectorId: 'slack',
        // The channel's web address is provenance a reader can follow; it
        // holds no secret and no message content.
        sourceUrl: `https://app.slack.com/client/${teamId}/${channelId}`,
        mediaType: 'text/plain',
        observedAt,
        slack: {
          schemaVersion: 1,
          teamId,
          channelId,
          messageCount: lines.length,
          oldestTs,
          latestTs,
          retrievedAt: observedAt,
          rawDigest,
          parserVersion: 'slack-v1',
        },
      },
    };

    clearTimeout(deadline);
    const batch = prepareConnectorBatch([document]);
    return {
      ...batch,
      teamId,
      channelId,
      channelName,
      messageCount: lines.length,
      oldestTs,
      latestTs,
    };
  }
}
