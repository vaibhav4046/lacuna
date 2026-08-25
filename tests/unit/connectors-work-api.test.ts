import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore } from '../../src/auth/store.js';
import { catalogue } from '../../src/connectors/catalog.js';
import { prepareConnectorBatch } from '../../src/connectors/normalize.js';
import { ConnectorRunner } from '../../src/connectors/run.js';
import type {
  ConnectorId,
  ConnectorPutResult,
  ConnectorStore,
  ConnectorWorkspaceState,
} from '../../src/connectors/types.js';
import {
  WorkImportError,
  type PreparedWorkBatch,
  type WorkImportInput,
  type WorkImporterBoundary,
} from '../../src/connectors/work-source.js';

/**
 * The work import route at its boundary, which is the part an attacker reaches.
 *
 * The importer has its own tests and its own adversarial pass. This file is
 * about everything in front of it: the origin check, the double-submit token,
 * the session, and the exact field set each source accepts. One route serves
 * four sources, so the thing most worth proving is that a field belonging to
 * one of them cannot ride along on another's request.
 */

const SITE_ORIGIN = 'https://app.example.test';
const NOTION_TOKEN = ['ntn', 'TESTTESTTESTTESTTESTTESTTEST'].join('_');
const ATLASSIAN_TOKEN = ['ATATT', 'TESTTESTTESTTESTTESTTEST'].join('');
const PAGE = '0123456789abcdef0123456789abcdef';

class Jar {
  readonly values = new Map<string, string>();
  binding = '';

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0] ?? '';
      const separator = pair.indexOf('=');
      if (separator < 1) continue;
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value === '') this.values.delete(name);
      else this.values.set(name, value);
    }
  }

  header(): string {
    return [...this.values].map(([name, value]) => `${name}=${value}`).join('; ');
  }
}

let server: Server;
let base: string;
let directory: string;
let seen: WorkImportInput[];

const store: ConnectorStore = {
  async get(): Promise<ConnectorWorkspaceState> { return {}; },
  async put(_workspace: string, _id: ConnectorId): Promise<ConnectorPutResult> { return 'stored'; },
};

/** A stand-in importer: it records what the route handed it and answers well. */
const importer: WorkImporterBoundary = {
  async importWork(input): Promise<PreparedWorkBatch> {
    seen.push(input);
    const observedAt = '2026-08-24T00:00:00.000Z';
    const batch = prepareConnectorBatch([{
      title: 'Probe',
      text: 'The ledger pool size is 48.',
      provenance: {
        connectorId: input.source,
        sourceUrl: null,
        mediaType: 'text/plain',
        observedAt,
        document: {
          schemaVersion: 1,
          resourceRef: PAGE,
          itemCount: 1,
          retrievedAt: observedAt,
          rawDigest: 'a'.repeat(64),
          parserVersion: `${input.source}-v1`,
        },
      },
    }]);
    return { ...batch, source: input.source, resourceRef: PAGE, title: 'Probe', itemCount: 1 };
  },
};

async function post(jar: Jar, path: string, body: unknown): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: jar.header(), 'x-csrf-token': token },
    body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

async function signedIn(email = 'work-owner@example.com'): Promise<Jar> {
  const jar = new Jar();
  jar.absorb(await fetch(`${base}/api/session`));
  const signup = await post(jar, '/api/auth/signup', { email, password: 'correct horse battery staple' });
  expect(signup.status).toBe(201);
  const current = await fetch(`${base}/api/session`, { headers: { cookie: jar.header() } });
  jar.absorb(current);
  const state = await current.json() as { session?: { binding?: unknown } };
  jar.binding = state.session?.binding as string;
  return jar;
}

async function postWork(
  jar: Jar,
  body: unknown,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    cookie: jar.header(),
    'x-lacuna-voice-binding': jar.binding,
    'x-csrf-token': token,
    origin: SITE_ORIGIN,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const response = await fetch(`${base}/api/workspace/connectors/work/import`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

const NOTION_BODY = { source: 'notion', page: PAGE, token: NOTION_TOKEN };

beforeEach(async () => {
  seen = [];
  directory = mkdtempSync(join(tmpdir(), 'lacuna-work-api-'));
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    siteOrigin: SITE_ORIGIN,
    connectorStore: store,
    connectorCatalog: () => catalogue({ workImport: true }),
    workImporter: importer,
    connectorRunner: new ConnectorRunner({ store, ingest: async () => 'nothing_extracted' }),
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  base = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('the work import route', () => {
  it('accepts a well formed request from a signed-in caller', async () => {
    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body['source']).toBe('notion');
    expect(body['resourceRef']).toBe(PAGE);
    expect(body['connectorId']).toBe('notion');
    expect(seen).toHaveLength(1);
  });

  it('refuses a caller with no session before reaching the importer', async () => {
    const jar = new Jar();
    jar.absorb(await fetch(`${base}/api/session`));
    const response = await postWork(jar, NOTION_BODY);
    expect(response.status).toBe(401);
    expect(seen).toHaveLength(0);
  });

  it('refuses a request from another origin', async () => {
    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY, { origin: 'https://evil.example' });
    expect(response.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('refuses a request with no double submit token', async () => {
    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY, { 'x-csrf-token': null });
    expect(response.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('refuses a request carrying somebody else s token', async () => {
    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY, { 'x-csrf-token': 'a'.repeat(43) });
    expect(response.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it('will not let one source s field ride along on another s request', async () => {
    const jar = await signedIn();
    // Every one of these is a well formed request for some source, with one
    // field too many, one too few, or one belonging to a different source.
    const smuggled: unknown[] = [
      { ...NOTION_BODY, site: 'qyntra' },
      { ...NOTION_BODY, issue: 'AUTH-412' },
      { ...NOTION_BODY, extra: 'x' },
      { source: 'notion', page: PAGE },
      { source: 'jira', site: 'qyntra', email: 'a@b.com', token: ATLASSIAN_TOKEN },
      { source: 'jira', site: 'qyntra', email: 'a@b.com', token: ATLASSIAN_TOKEN, issue: 'AUTH-412', page: '1' },
      { source: 'gmail', thread: '18f2a9c4bb01', token: NOTION_TOKEN, site: 'qyntra' },
    ];
    for (const body of smuggled) {
      const response = await postWork(jar, body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect(seen).toHaveLength(0);
  });

  it('refuses a source that is not one of the four', async () => {
    const jar = await signedIn();
    for (const source of ['slack', 'github', 'linear', 'database', '', '__proto__', 'constructor']) {
      const response = await postWork(jar, { source, page: PAGE, token: NOTION_TOKEN });
      expect(response.status, source).toBe(422);
    }
    expect(seen).toHaveLength(0);
  });

  it('refuses non-string field values however plausible they look', async () => {
    const jar = await signedIn();
    const bodies: unknown[] = [
      { source: 'notion', page: PAGE, token: 12345 },
      { source: 'notion', page: null, token: NOTION_TOKEN },
      { source: 'notion', page: [PAGE], token: NOTION_TOKEN },
      { source: 'notion', page: { toString: 'x' }, token: NOTION_TOKEN },
      { source: ['notion'], page: PAGE, token: NOTION_TOKEN },
      null,
      [],
      'a string body',
    ];
    for (const body of bodies) {
      const response = await postWork(jar, body);
      expect([400, 422], JSON.stringify(body)).toContain(response.status);
    }
    expect(seen).toHaveLength(0);
  });

  it('maps an importer refusal to its own status and never leaks the credential', async () => {
    const failing: WorkImporterBoundary = {
      async importWork(): Promise<PreparedWorkBatch> { throw new WorkImportError('work_auth_failed'); },
    };
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(directory)),
      secure: false,
      health: null,
      siteOrigin: SITE_ORIGIN,
      connectorStore: store,
      connectorCatalog: () => catalogue({ workImport: true }),
      workImporter: failing,
      connectorRunner: new ConnectorRunner({ store, ingest: async () => 'nothing_extracted' }),
    });
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
      void router.handle(request, response, path);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server did not bind');
    base = `http://127.0.0.1:${address.port}`;

    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY);
    expect(response.status).toBe(422);
    const text = await response.text();
    expect(text).toContain('work_auth_failed');
    expect(text).not.toContain(NOTION_TOKEN);
  });

  it('answers 501 rather than 500 when the importer is not wired', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(directory)),
      secure: false,
      health: null,
      siteOrigin: SITE_ORIGIN,
      connectorStore: store,
      connectorCatalog: () => catalogue({}),
    });
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
      void router.handle(request, response, path);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('server did not bind');
    base = `http://127.0.0.1:${address.port}`;

    const jar = await signedIn();
    const response = await postWork(jar, NOTION_BODY);
    expect(response.status).toBe(501);
    const body = await response.json() as Record<string, unknown>;
    expect(body['error']).toBe('work_import_unavailable');
  });

  it('publishes the four sources as unavailable when the importer is absent', async () => {
    const entries = catalogue({});
    for (const id of ['notion', 'jira', 'confluence', 'gmail'] as const) {
      const entry = entries.find((candidate) => candidate.id === id);
      expect(entry?.availability, id).toBe('unavailable');
      expect(entry?.reason, id).toBe('work_import_unavailable');
    }
  });
});
