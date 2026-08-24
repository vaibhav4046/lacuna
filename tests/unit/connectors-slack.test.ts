import { describe, expect, it } from 'vitest';

import {
  SlackImportError,
  SlackImporter,
  type SlackTransport,
  type SlackTransportRequest,
} from '../../src/connectors/slack.js';

// Assembled at runtime so no literal in this repository matches the real
// token pattern: GitHub's push protection reads a well-formed fake exactly as
// it would read a leak, and it is right to.
const TOKEN = ['xoxb', '000000000000', 'TESTTOKENTESTTOKEN'].join('-');
const CHANNEL = 'C0123ABCDEF';

/** A transport that answers each Slack method from a fixed script. */
function scripted(answers: Readonly<Record<string, unknown>>): SlackTransport & { readonly calls: SlackTransportRequest[] } {
  const calls: SlackTransportRequest[] = [];
  return {
    calls,
    async request(request) {
      calls.push(request);
      const method = new URL(request.url).pathname.split('/').pop() ?? '';
      const body = answers[method];
      if (body === undefined) throw new Error(`unscripted method ${method}`);
      return { status: 200, body: new TextEncoder().encode(JSON.stringify(body)) };
    },
  };
}

const HAPPY = {
  'auth.test': { ok: true, team_id: 'T0AAAA1BC' },
  'conversations.info': { ok: true, channel: { id: CHANNEL, name: 'platform' } },
  'conversations.history': {
    ok: true,
    messages: [
      { type: 'message', user: 'U02BBB2CD', ts: '1756000200.000200', text: 'The ledger-fanout pool size is 48.' },
      { type: 'message', user: 'U01AAA1BC', ts: '1756000100.000100', text: 'ledger-fanout is stored in Postgres.' },
      { type: 'message', subtype: 'channel_join', user: 'U01AAA1BC', ts: '1756000000.000000', text: 'joined' },
    ],
  },
  'users.list': {
    ok: true,
    members: [
      { id: 'U01AAA1BC', name: 'dana', profile: { display_name: 'Dana', real_name: 'Dana Q' } },
      { id: 'U02BBB2CD', name: 'toby', profile: { display_name: '', real_name: 'Toby R' } },
    ],
  },
} as const;

describe('SlackImporter', () => {
  it('turns one channel page into an ordered, attributed transcript', async () => {
    const transport = scripted(HAPPY);
    const importer = new SlackImporter({ transport });
    const batch = await importer.importChannel(CHANNEL, TOKEN, new AbortController().signal);

    expect(batch.teamId).toBe('T0AAAA1BC');
    expect(batch.channelName).toBe('platform');
    expect(batch.messageCount).toBe(2);
    expect(batch.documents).toHaveLength(1);
    const text = batch.documents[0]!.text;
    // Oldest first, display names resolved, the join subtype dropped.
    expect(text.indexOf('Dana')).toBeLessThan(text.indexOf('TobyR'));
    expect(text).toContain('Dana: ledger-fanout is stored in Postgres.');
    expect(text).toContain('TobyR: The ledger-fanout pool size is 48.');
    expect(text).not.toContain('joined');
    // The transcript timestamps are instants the segmenter reads.
    expect(text).toMatch(/^\[2025-08-2\dT/u);
  });

  it('never lets the token into the batch, the provenance or an error', async () => {
    const transport = scripted(HAPPY);
    const importer = new SlackImporter({ transport });
    const batch = await importer.importChannel(CHANNEL, TOKEN, new AbortController().signal);
    expect(JSON.stringify(batch)).not.toContain(TOKEN);

    // The token travels only as the Authorization header of each request.
    for (const call of transport.calls) {
      expect(call.url).not.toContain(TOKEN);
      expect(call.headers['Authorization']).toBe(`Bearer ${TOKEN}`);
    }

    const failing = new SlackImporter({
      transport: {
        async request() {
          return { status: 200, body: new TextEncoder().encode(JSON.stringify({ ok: false, error: 'invalid_auth' })) };
        },
      },
    });
    const thrown = await failing.importChannel(CHANNEL, TOKEN, new AbortController().signal)
      .then(() => null, (error: unknown) => error as SlackImportError);
    expect(thrown).toBeInstanceOf(SlackImportError);
    expect(JSON.stringify({ ...thrown, message: thrown?.message })).not.toContain(TOKEN);
  });

  it('refuses a malformed channel or token before any request', async () => {
    const transport = scripted({});
    const importer = new SlackImporter({ transport });
    for (const [channel, token] of [
      ['not-a-channel', TOKEN],
      ['C012', TOKEN],
      [CHANNEL, 'hunter2'],
      [CHANNEL, 'xoxb short'],
      ['../etc', TOKEN],
    ] as const) {
      const thrown = await importer.importChannel(channel, token, new AbortController().signal)
        .then(() => null, (error: unknown) => error as SlackImportError);
      expect(thrown?.code, `${channel} ${token.slice(0, 6)}`).toBe('invalid_slack_request');
    }
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    ['invalid_auth', 'slack_auth_failed'],
    ['token_revoked', 'slack_auth_failed'],
    ['channel_not_found', 'slack_channel_unreadable'],
    ['not_in_channel', 'slack_channel_unreadable'],
    ['missing_scope', 'slack_channel_unreadable'],
    ['ratelimited', 'slack_unavailable'],
    ['internal_error', 'slack_unavailable'],
  ] as const)('collapses the provider word %s into %s', async (slackError, code) => {
    const importer = new SlackImporter({
      transport: {
        async request() {
          return { status: 200, body: new TextEncoder().encode(JSON.stringify({ ok: false, error: slackError })) };
        },
      },
    });
    const thrown = await importer.importChannel(CHANNEL, TOKEN, new AbortController().signal)
      .then(() => null, (error: unknown) => error as SlackImportError);
    expect(thrown?.code).toBe(code);
  });

  it('reports a channel of nothing but scaffolding as having no messages', async () => {
    const importer = new SlackImporter({
      transport: scripted({
        ...HAPPY,
        'conversations.history': {
          ok: true,
          messages: [{ type: 'message', subtype: 'channel_join', user: 'U01AAA1BC', ts: '1756000000.000000', text: 'joined' }],
        },
      }),
    });
    const thrown = await importer.importChannel(CHANNEL, TOKEN, new AbortController().signal)
      .then(() => null, (error: unknown) => error as SlackImportError);
    expect(thrown?.code).toBe('slack_no_messages');
  });

  it('spends at most four requests', async () => {
    const transport = scripted(HAPPY);
    const importer = new SlackImporter({ transport });
    await importer.importChannel(CHANNEL, TOKEN, new AbortController().signal);
    expect(transport.calls.length).toBeLessThanOrEqual(4);
  });
});
