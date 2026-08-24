import { describe, expect, it } from 'vitest';

import { ConnectorRunner } from '../../src/connectors/run.js';
import {
  WorkImportError,
  WorkImporter,
  type WorkImportInput,
  type WorkTransport,
  type WorkTransportRequest,
} from '../../src/connectors/work-source.js';

// Assembled at runtime so no literal here matches a real credential pattern:
// push protection reads a well-formed fake exactly as it would read a leak,
// and it is right to.
const NOTION_TOKEN = ['ntn', 'TESTTESTTESTTESTTESTTESTTEST'].join('_');
const ATLASSIAN_TOKEN = ['ATATT', 'TESTTESTTESTTESTTESTTEST'].join('');
const GOOGLE_TOKEN = ['ya29', 'TESTTESTTESTTESTTESTTESTTESTTEST'].join('.');
const EMAIL = 'owner@example.com';
const PAGE = '0123456789abcdef0123456789abcdef';
const ISSUE = 'AUTH-412';
const CONF_PAGE = '65601';
const THREAD = '18f2a9c4bb01';

/** A transport that answers by URL substring from a fixed script. */
function scripted(
  answers: Readonly<Record<string, unknown>>,
  status = 200,
): WorkTransport & { readonly calls: WorkTransportRequest[] } {
  const calls: WorkTransportRequest[] = [];
  return {
    calls,
    async request(request) {
      calls.push(request);
      const key = Object.keys(answers).find((part) => request.url.includes(part));
      if (key === undefined) throw new Error(`unscripted url ${request.url}`);
      return { status, body: new TextEncoder().encode(JSON.stringify(answers[key])) };
    },
  };
}

const NOTION = {
  '/pages/': {
    properties: { Name: { type: 'title', title: [{ plain_text: 'Ledger rollout' }] } },
  },
  '/children': {
    has_more: false,
    next_cursor: null,
    results: [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'The ledger pool size is 48.' }] } },
      { type: 'to_do', to_do: { checked: true, rich_text: [{ plain_text: 'Migrate to Postgres' }] } },
      { type: 'image', image: { file: { url: 'https://example.com/x.png' } } },
    ],
  },
};

const JIRA = {
  '/issue/AUTH-412?': {
    fields: {
      summary: 'Session tokens outlive revocation',
      status: { name: 'In Progress' },
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Revocation lags by 15 minutes.' }] }] },
    },
  },
  '/comment?': {
    comments: [
      {
        created: '2026-08-07T09:00:00.000Z',
        author: { displayName: 'Dana' },
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deadline is 7 August.' }] }] },
      },
      {
        created: '2026-08-14T09:00:00.000Z',
        author: { displayName: 'Toby' },
        body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Deadline moved to 14 August.' }] }] },
      },
    ],
  },
};

const CONFLUENCE = {
  '/content/': {
    title: 'Incident runbook',
    version: { when: '2026-08-11T10:00:00.000Z' },
    body: { storage: { value: '<h1>Runbook</h1><p>Failover is <strong>manual</strong>.</p><p>Owner &amp; escalation: Dana.</p>' } },
  },
};

const GMAIL = {
  '/threads/': {
    messages: [
      {
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'dana@example.com' },
            { name: 'Subject', value: 'Ledger cutover' },
            { name: 'Date', value: 'Fri, 7 Aug 2026 09:00:00 +0000' },
          ],
          body: { data: Buffer.from('Cutover is on the 7th.', 'utf8').toString('base64url') },
        },
      },
      {
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'From', value: 'toby@example.com' },
            { name: 'Date', value: 'Fri, 14 Aug 2026 09:00:00 +0000' },
          ],
          body: {
            data: Buffer.from('Cutover moved to the 14th.\n\nOn Fri, Dana wrote:\n> Cutover is on the 7th.', 'utf8')
              .toString('base64url'),
          },
        },
      },
    ],
  },
};

const INPUTS: Readonly<Record<string, WorkImportInput>> = {
  notion: { source: 'notion', page: PAGE, token: NOTION_TOKEN },
  jira: { source: 'jira', site: 'qyntra', email: EMAIL, token: ATLASSIAN_TOKEN, issue: ISSUE },
  confluence: { source: 'confluence', site: 'qyntra', email: EMAIL, token: ATLASSIAN_TOKEN, page: CONF_PAGE },
  gmail: { source: 'gmail', thread: THREAD, token: GOOGLE_TOKEN },
};
const SCRIPTS: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  notion: NOTION, jira: JIRA, confluence: CONFLUENCE, gmail: GMAIL,
};

function signal(): AbortSignal {
  return new AbortController().signal;
}

describe('WorkImporter', () => {
  it('turns a Notion page into prose and keeps the checkbox state', async () => {
    const importer = new WorkImporter({ transport: scripted(NOTION) });
    const batch = await importer.importWork(INPUTS['notion']!, signal());
    expect(batch.source).toBe('notion');
    expect(batch.title).toBe('Ledger rollout');
    const text = batch.documents[0]!.text;
    expect(text).toContain('The ledger pool size is 48.');
    // done versus planned is a distinction the extractor's modes turn on.
    expect(text).toContain('[x] Migrate to Postgres');
    // A block with no prose contributes nothing.
    expect(text).not.toContain('example.com');
  });

  it('folds a Jira issue and its comments into one dated transcript', async () => {
    const importer = new WorkImporter({ transport: scripted(JIRA) });
    const batch = await importer.importWork(INPUTS['jira']!, signal());
    const text = batch.documents[0]!.text;
    expect(batch.title).toBe('AUTH-412 Session tokens outlive revocation');
    expect(text).toContain('AUTH-412 status: In Progress.');
    expect(text).toContain('Revocation lags by 15 minutes.');
    // The supersession this connector exists to surface: same predicate, two
    // dates, later one wins.
    expect(text.indexOf('Deadline is 7 August.')).toBeLessThan(text.indexOf('Deadline moved to 14 August.'));
    expect(text).toContain('[2026-08-07] Dana:');
    expect(batch.itemCount).toBe(3);
  });

  it('strips Confluence storage markup down to prose', async () => {
    const importer = new WorkImporter({ transport: scripted(CONFLUENCE) });
    const batch = await importer.importWork(INPUTS['confluence']!, signal());
    const text = batch.documents[0]!.text;
    expect(text).toContain('Failover is manual.');
    expect(text).toContain('Owner & escalation: Dana.');
    expect(text).not.toContain('<');
    expect(text).not.toContain('&amp;');
  });

  it('reads a Gmail thread oldest-first and drops quoted history', async () => {
    const importer = new WorkImporter({ transport: scripted(GMAIL) });
    const batch = await importer.importWork(INPUTS['gmail']!, signal());
    const text = batch.documents[0]!.text;
    expect(batch.title).toBe('Ledger cutover');
    expect(text).toContain('[2026-08-07] dana@example.com: Cutover is on the 7th.');
    expect(text).toContain('Cutover moved to the 14th.');
    // The quote repeats a claim the thread already made; reading it twice
    // would invent agreement that is not there.
    expect(text).not.toContain('> Cutover is on the 7th.');
    expect(text).not.toContain('On Fri, Dana wrote:');
  });

  it.each(['notion', 'jira', 'confluence', 'gmail'] as const)(
    'never lets the %s credential into the batch, the provenance or an error',
    async (source) => {
      const transport = scripted(SCRIPTS[source]!);
      const importer = new WorkImporter({ transport });
      const input = INPUTS[source]!;
      const batch = await importer.importWork(input, signal());
      const token = input.token;
      expect(JSON.stringify(batch)).not.toContain(token);
      for (const call of transport.calls) {
        expect(call.url).not.toContain(token);
        // Atlassian sends the token inside a Basic pair, so the raw value is
        // never a header substring either; both forms are checked.
        expect(call.headers['Authorization']).not.toBe(token);
        expect(call.headers['Authorization']).toBeTypeOf('string');
      }
      const failing = new WorkImporter({ transport: scripted(SCRIPTS[source]!, 401) });
      const thrown = await failing.importWork(input, signal())
        .then(() => null, (error: unknown) => error as WorkImportError);
      expect(thrown).toBeInstanceOf(WorkImportError);
      expect(JSON.stringify({ ...thrown, message: thrown?.message })).not.toContain(token);
    },
  );

  it('refuses a malformed request before any request is made', async () => {
    const transport = scripted({});
    const importer = new WorkImporter({ transport });
    const invalid: readonly WorkImportInput[] = [
      { source: 'notion', page: 'not-a-page', token: NOTION_TOKEN },
      { source: 'notion', page: PAGE, token: 'hunter2' },
      { source: 'jira', site: 'qyntra', email: EMAIL, token: ATLASSIAN_TOKEN, issue: 'lowercase-1' },
      { source: 'jira', site: 'qyntra', email: 'not-an-email', token: ATLASSIAN_TOKEN, issue: ISSUE },
      // The one caller-supplied part of any host is a single tenant label.
      // Anything that could redirect the read elsewhere is refused here.
      { source: 'jira', site: 'evil.com/x', email: EMAIL, token: ATLASSIAN_TOKEN, issue: ISSUE },
      { source: 'confluence', site: '../../etc', email: EMAIL, token: ATLASSIAN_TOKEN, page: CONF_PAGE },
      { source: 'confluence', site: 'qyntra', email: EMAIL, token: ATLASSIAN_TOKEN, page: 'abc' },
      { source: 'gmail', thread: 'ZZZZ', token: GOOGLE_TOKEN },
      { source: 'gmail', thread: THREAD, token: NOTION_TOKEN },
    ];
    for (const input of invalid) {
      const thrown = await importer.importWork(input, signal())
        .then(() => null, (error: unknown) => error as WorkImportError);
      expect(thrown?.code, JSON.stringify(input.source)).toBe('invalid_work_request');
    }
    expect(transport.calls).toHaveLength(0);
  });

  it.each([
    [401, 'work_auth_failed'],
    [403, 'work_item_unreadable'],
    [404, 'work_item_unreadable'],
    [429, 'work_unavailable'],
    [500, 'work_unavailable'],
  ] as const)('collapses provider status %s into %s', async (status, code) => {
    const importer = new WorkImporter({ transport: scripted(NOTION, status) });
    const thrown = await importer.importWork(INPUTS['notion']!, signal())
      .then(() => null, (error: unknown) => error as WorkImportError);
    expect(thrown?.code).toBe(code);
  });

  it('reports an item with no prose as having no text', async () => {
    const importer = new WorkImporter({
      transport: scripted({ ...NOTION, '/children': { has_more: false, next_cursor: null, results: [] } }),
    });
    const thrown = await importer.importWork(INPUTS['notion']!, signal())
      .then(() => null, (error: unknown) => error as WorkImportError);
    expect(thrown?.code).toBe('work_no_text');
  });

  it('spends at most four requests per import', async () => {
    for (const source of ['notion', 'jira', 'confluence', 'gmail'] as const) {
      const transport = scripted(SCRIPTS[source]!);
      await new WorkImporter({ transport }).importWork(INPUTS[source]!, signal());
      expect(transport.calls.length, source).toBeLessThanOrEqual(4);
    }
  });

  it('is accepted by the runner that validates connector requests', async () => {
    // The Slack rollout shipped broken because the runner kept its own id set
    // and never learned the new connector, so every live run was refused at
    // the gate with tests still green. This asserts the gate directly.
    const runner = new ConnectorRunner({
      store: {
        async get() { return {}; },
        async put() { return 'stored'; },
      },
      ingest: async () => 'nothing_extracted',
    });
    for (const source of ['notion', 'jira', 'confluence', 'gmail'] as const) {
      const result = await runner.run(`lacuna-ws-${PAGE}`, {
        connectorId: source,
        documents: [{
          title: 'Probe',
          text: 'The ledger pool size is 48.',
          provenance: {
            connectorId: source,
            sourceUrl: null,
            mediaType: 'text/plain',
            observedAt: '2026-08-24T00:00:00.000Z',
            document: {
              schemaVersion: 1,
              resourceRef: PAGE,
              itemCount: 1,
              retrievedAt: '2026-08-24T00:00:00.000Z',
              rawDigest: 'a'.repeat(64),
              parserVersion: `${source}-v1`,
            },
          },
        }],
        awaitSearchable: true,
      });
      expect(result.connectorId, source).toBe(source);
    }
  });
});
