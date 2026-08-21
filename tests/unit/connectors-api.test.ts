import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { workspaceCollection } from '../../src/api/ingest.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore } from '../../src/auth/store.js';
import { catalogue } from '../../src/connectors/catalog.js';
import type { ConnectorStore, ConnectorWorkspaceState } from '../../src/connectors/types.js';

class MemoryConnectorStore implements ConnectorStore {
  state: ConnectorWorkspaceState = {};
  readonly reads: string[] = [];

  async get(workspace: string): Promise<ConnectorWorkspaceState> {
    this.reads.push(workspace);
    return this.state;
  }

  async put(_workspace: string, next: ConnectorWorkspaceState): Promise<void> {
    this.state = next;
  }
}

class Jar {
  readonly values = new Map<string, string>();

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
let connectorStore: MemoryConnectorStore;

async function post(jar: Jar, path: string, body: unknown): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: jar.header(),
      'x-csrf-token': token,
    },
    body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

async function signedIn(email = 'connector-owner@example.com'): Promise<Jar> {
  const jar = new Jar();
  const session = await fetch(`${base}/api/session`);
  jar.absorb(session);
  const signup = await post(jar, '/api/auth/signup', { email, password: 'correct horse battery staple' });
  expect(signup.status).toBe(201);
  return jar;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-connectors-api-'));
  connectorStore = new MemoryConnectorStore();
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    connectorStore,
    connectorCatalog: () => catalogue({ webhookKey: 'configured' }),
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

describe('workspace connector catalogue API', () => {
  it('requires an authenticated session before consulting workspace state', async () => {
    const response = await fetch(`${base}/api/workspace/connectors?workspace=public`);

    expect(response.status).toBe(401);
    expect(connectorStore.reads).toEqual([]);
  });

  it('derives the workspace on the server and merges safe persisted observations', async () => {
    const jar = await signedIn();
    connectorStore.state = {
      github: {
        configuredAt: '2026-08-21T09:00:00.000Z',
        lastAttemptAt: '2026-08-21T10:00:00.000Z',
        lastSuccessAt: '2026-08-21T10:00:00.000Z',
        lastFailure: null,
        importedDocuments: 4,
      },
      webhook: {
        configuredAt: '2026-08-21T08:00:00.000Z',
        lastAttemptAt: null,
        lastSuccessAt: null,
        lastFailure: null,
        importedDocuments: 0,
      },
    };

    const response = await fetch(
      `${base}/api/workspace/connectors?workspace=${encodeURIComponent(workspaceCollection('somebody-else@example.com'))}`,
      { headers: { cookie: jar.header() } },
    );
    const body = await response.json() as { connectors: readonly Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(connectorStore.reads).toEqual([workspaceCollection('connector-owner@example.com')]);
    expect(body.connectors).toHaveLength(7);
    expect(body.connectors.find((entry) => entry['id'] === 'github')).toMatchObject({
      availability: 'available', state: 'idle', importedDocuments: 4,
    });
    expect(body.connectors.find((entry) => entry['id'] === 'webhook')).toMatchObject({
      availability: 'available', state: 'connected', importedDocuments: 0,
    });
    expect(JSON.stringify(body)).not.toContain('connector-owner@example.com');
    expect(JSON.stringify(body)).not.toContain(workspaceCollection('connector-owner@example.com'));
    expect(JSON.stringify(body)).not.toContain(workspaceCollection('somebody-else@example.com'));
  });

  it('never turns one-off imports into connections and never returns persisted syncing', async () => {
    const jar = await signedIn('states@example.com');
    connectorStore.state = {
      text: {
        configuredAt: '2026-08-21T09:00:00.000Z',
        lastAttemptAt: '2026-08-21T10:00:00.000Z',
        lastSuccessAt: '2026-08-21T10:00:00.000Z',
        lastFailure: null,
        importedDocuments: 1,
      },
      https_api: {
        configuredAt: null,
        lastAttemptAt: '2026-08-21T11:00:00.000Z',
        lastSuccessAt: null,
        lastFailure: 'transport_failed',
        importedDocuments: 0,
      },
    };

    const response = await fetch(`${base}/api/workspace/connectors`, { headers: { cookie: jar.header() } });
    const body = await response.json() as { connectors: readonly Record<string, unknown>[] };

    expect(body.connectors.find((entry) => entry['id'] === 'text')).toMatchObject({
      availability: 'available', state: 'idle', lastSuccessAt: '2026-08-21T10:00:00.000Z',
    });
    expect(body.connectors.find((entry) => entry['id'] === 'https_api')).toMatchObject({
      availability: 'available', state: 'failed', lastFailure: 'transport_failed',
    });
    expect(JSON.stringify(body)).not.toContain('syncing');
  });
});
