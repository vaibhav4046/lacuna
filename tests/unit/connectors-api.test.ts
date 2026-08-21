import { mkdtempSync, rmSync } from 'node:fs';
import { File } from 'node:buffer';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { IngestReadinessError, type IngestPreparedReport } from '../../src/api/ingest.js';
import { workspaceCollection } from '../../src/api/ingest.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore } from '../../src/auth/store.js';
import { catalogue } from '../../src/connectors/catalog.js';
import { FileConnectorService } from '../../src/connectors/files.js';
import {
  GitHubImportError,
  type GitHubImporterBoundary,
  type PreparedGitHubBatch,
} from '../../src/connectors/github.js';
import { prepareConnectorBatch } from '../../src/connectors/normalize.js';
import { FilePreviewTokenService } from '../../src/connectors/preview-token.js';
import { ConnectorRunner } from '../../src/connectors/run.js';
import type {
  ConnectorId,
  ConnectorObservation,
  ConnectorPutResult,
  ConnectorStore,
  ConnectorWorkspaceState,
} from '../../src/connectors/types.js';

class MemoryConnectorStore implements ConnectorStore {
  state: ConnectorWorkspaceState = {};
  readonly reads: string[] = [];
  failure: Error | null = null;
  puts = 0;

  async get(workspace: string): Promise<ConnectorWorkspaceState> {
    this.reads.push(workspace);
    if (this.failure !== null) throw this.failure;
    return this.state;
  }

  async put(
    _workspace: string,
    id: ConnectorId,
    next: ConnectorObservation,
  ): Promise<ConnectorPutResult> {
    this.puts += 1;
    this.state = { ...this.state, [id]: next };
    return 'stored';
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
let runnerCalls: {
  readonly workspace: string;
  readonly connectorId: ConnectorId;
  readonly awaitSearchable: boolean;
  readonly text: string;
  readonly sourceKey: string;
}[];
let fileBoundaryCalls: number;
let githubBoundaryCalls: { readonly url: string; readonly aborted: boolean }[];
let githubBoundaryFailure: Error | null;
let readinessTimeout: boolean;
let now: number;

const SITE_ORIGIN = 'https://app.example.test';

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

async function postFile(
  jar: Jar,
  path: '/api/workspace/connectors/file/preview' | '/api/workspace/connectors/file/import',
  file: File,
  previewToken?: string,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Response> {
  const form = new FormData();
  form.set('file', file as unknown as Blob);
  if (previewToken !== undefined) form.set('preview_token', previewToken);
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const headers: Record<string, string> = {
    cookie: jar.header(),
    'x-csrf-token': token,
    origin: SITE_ORIGIN,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const response = await fetch(`${base}${path}`, { method: 'POST', headers, body: form });
  jar.absorb(response);
  return response;
}

async function postGitHub(
  jar: Jar,
  body: unknown,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    cookie: jar.header(),
    'x-csrf-token': token,
    origin: SITE_ORIGIN,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const response = await fetch(`${base}/api/workspace/connectors/github/import`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

function preparedGitHubBatch(): PreparedGitHubBatch {
  const commitSha = 'a'.repeat(40);
  const blobSha = 'b'.repeat(40);
  const batch = prepareConnectorBatch([{
    title: 'README.md',
    text: 'a: Atlas is owned by Priya.',
    provenance: {
      connectorId: 'github',
      sourceUrl: `https://github.com/acme/atlas/blob/${commitSha}/README.md`,
      mediaType: 'text/markdown',
      observedAt: '2026-08-21T12:00:00.000Z',
      github: {
        repositoryUrl: 'https://github.com/acme/atlas',
        commitSha,
        path: 'README.md',
        blobSha,
        retrievedAt: '2026-08-21T12:00:00.000Z',
        rawDigest: 'c'.repeat(64),
        parserVersion: 'github-v1',
      },
    },
  }]);
  return {
    ...batch,
    repositoryUrl: 'https://github.com/acme/atlas',
    commitSha,
    snapshotDigest: 'd'.repeat(64),
    consideredEntries: 2,
    fetchedBlobs: 1,
    skipped: [{ reason: 'unsupported_extension', count: 1 }],
  };
}

async function listen(router: ApiRouter): Promise<void> {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  base = `http://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-connectors-api-'));
  connectorStore = new MemoryConnectorStore();
  runnerCalls = [];
  fileBoundaryCalls = 0;
  githubBoundaryCalls = [];
  githubBoundaryFailure = null;
  readinessTimeout = false;
  now = Date.parse('2026-08-21T12:00:00.000Z');
  const runner = new ConnectorRunner({
    store: connectorStore,
    now: () => now,
    ingest: async (workspace, prepared, options): Promise<IngestPreparedReport> => {
      runnerCalls.push({
        workspace,
        connectorId: prepared.provenance.connectorId,
        awaitSearchable: options.awaitSearchable,
        text: prepared.text,
        sourceKey: prepared.sourceKey,
      });
      if (readinessTimeout) throw new IngestReadinessError('timeout', 4, 0);
      return {
        sourceKey: prepared.sourceKey,
        collection: workspace,
        turns: 1,
        claims: 1,
        entities: 2,
        accepted: 4,
        refused: [],
        ms: 2,
        truncated: false,
        searchable: true,
        indexing: 'completed',
      };
    },
  });
  const tokens = new FilePreviewTokenService({ key: Buffer.alloc(32, 0x4a), now: () => now });
  const files = new FileConnectorService({ runner, tokens, now: () => now });
  const fileConnector = {
    preview: async (...args: Parameters<typeof files.preview>) => {
      fileBoundaryCalls += 1;
      return files.preview(...args);
    },
    importFile: async (...args: Parameters<typeof files.importFile>) => {
      fileBoundaryCalls += 1;
      return files.importFile(...args);
    },
  };
  const githubImporter: GitHubImporterBoundary = {
    importPublicRepo: async (url, signal) => {
      githubBoundaryCalls.push({ url, aborted: signal.aborted });
      if (githubBoundaryFailure !== null) throw githubBoundaryFailure;
      return preparedGitHubBatch();
    },
  };
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    connectorStore,
    connectorCatalog: () => catalogue({ webhookKey: 'configured', fileImport: true, githubImport: true }),
    fileConnector,
    githubImporter,
    connectorRunner: runner,
    siteOrigin: SITE_ORIGIN,
  });
  await listen(router);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('workspace connector catalogue API', () => {
  it('fails file availability closed when the runner or preview signer is absent', () => {
    const unavailable = catalogue({ webhookKey: 'configured', fileImport: false });
    for (const id of ['markdown', 'text', 'pdf', 'docx']) {
      expect(unavailable.find((entry) => entry.id === id)).toMatchObject({
        availability: 'unavailable', reason: 'file_import_unavailable',
      });
    }
  });

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

  it('returns generic unavailable rather than idle state when durable state is corrupt', async () => {
    const jar = await signedIn('corrupt-state@example.com');
    connectorStore.failure = new Error('foreign payload containing owner@example.com and lacuna-ws-secret');

    const response = await fetch(`${base}/api/workspace/connectors`, { headers: { cookie: jar.header() } });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toEqual({ error: 'connector_state_unavailable' });
    expect(JSON.stringify(body)).not.toContain('owner@example.com');
    expect(JSON.stringify(body)).not.toContain('lacuna-ws-secret');
  });
});

describe('workspace file preview and import API', () => {
  it('checks origin, CSRF, and session before consuming the multipart boundary', async () => {
    const unsigned = new Jar();
    unsigned.absorb(await fetch(`${base}/api/session`));
    const file = new File(['a: Atlas is owned by Priya.'], 'notes.txt', { type: 'text/plain' });

    const noSession = await postFile(unsigned, '/api/workspace/connectors/file/preview', file);
    expect(noSession.status).toBe(401);
    expect(fileBoundaryCalls).toBe(0);

    const jar = await signedIn('early-checks@example.com');
    const noCsrf = await postFile(jar, '/api/workspace/connectors/file/preview', file, undefined, {
      'x-csrf-token': null,
    });
    expect(noCsrf.status).toBe(403);
    expect(fileBoundaryCalls).toBe(0);

    const foreignOrigin = await postFile(jar, '/api/workspace/connectors/file/preview', file, undefined, {
      origin: 'https://attacker.example',
    });
    expect(foreignOrigin.status).toBe(403);
    expect(fileBoundaryCalls).toBe(0);

    const missingOrigin = await postFile(jar, '/api/workspace/connectors/file/preview', file, undefined, {
      origin: null,
    });
    expect(missingOrigin.status).toBe(403);
    expect(fileBoundaryCalls).toBe(0);
  });

  it('previews without runner/store writes and returns only bounded safe fields', async () => {
    const jar = await signedIn('preview@example.com');
    const source = `a: Atlas is owned by Priya.\n${'bounded context '.repeat(40)}`;

    const response = await postFile(
      jar,
      '/api/workspace/connectors/file/preview',
      new File([source], 'atlas.md', { type: 'text/markdown' }),
    );
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(body).toMatchObject({
      filename: 'atlas.md',
      title: 'atlas',
      type: 'markdown',
      characters: source.length,
      pages: 0,
      rawDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      normalizedDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      previewToken: expect.any(String),
      expiresAt: '2026-08-21T12:05:00.000Z',
    });
    expect(String(body['excerpt']).length).toBeLessThan(source.length);
    expect(JSON.stringify(body)).not.toContain(source);
    expect(JSON.stringify(body)).not.toContain('lacuna-ws-');
    expect(JSON.stringify(body)).not.toContain('collection');
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('reparses and verifies both digests before one searchable runner import', async () => {
    const jar = await signedIn('import@example.com');
    const source = 'a: Atlas is owned by Priya.\r\n';
    const file = new File([source], 'atlas.txt', { type: 'text/plain' });
    const preview = await postFile(jar, '/api/workspace/connectors/file/preview', file);
    const previewBody = await preview.json() as { previewToken: string };

    const normalizedTwin = new File([source.replace('\r\n', '\n')], 'atlas.txt', { type: 'text/plain' });
    const mismatch = await postFile(
      jar, '/api/workspace/connectors/file/import', normalizedTwin, previewBody.previewToken,
    );
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toEqual({ error: 'preview_invalid' });
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);

    const imported = await postFile(jar, '/api/workspace/connectors/file/import', file, previewBody.previewToken);
    const result = await imported.json() as Record<string, unknown>;
    expect(imported.status).toBe(200);
    expect(result).toMatchObject({
      connectorId: 'text', acceptedDocuments: 1, searchableDocuments: 1, acceptedRecords: 4,
    });
    expect(runnerCalls).toEqual([expect.objectContaining({
      workspace: workspaceCollection('import@example.com'),
      connectorId: 'text',
      awaitSearchable: true,
      text: 'a: Atlas is owned by Priya.\n',
    })]);
    expect(connectorStore.puts).toBe(1);
    expect(JSON.stringify(result)).not.toContain('collection');
    expect(JSON.stringify(result)).not.toContain(source);

    const replay = await postFile(jar, '/api/workspace/connectors/file/import', file, previewBody.previewToken);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ error: 'preview_replayed' });
    expect(runnerCalls).toHaveLength(1);
    expect(connectorStore.puts).toBe(1);
  });

  it('rejects tamper, expiry, session/workspace swap, and title policy changes before writes', async () => {
    const first = await signedIn('first-preview@example.com');
    const second = await signedIn('second-preview@example.com');
    const file = new File(['a: Atlas is owned by Priya.'], 'atlas.txt', { type: 'text/plain' });

    const preview = await postFile(first, '/api/workspace/connectors/file/preview', file);
    const body = await preview.json() as { previewToken: string };
    const swapped = await postFile(second, '/api/workspace/connectors/file/import', file, body.previewToken);
    expect(swapped.status).toBe(409);

    const renamed = await postFile(
      first,
      '/api/workspace/connectors/file/import',
      new File([await file.arrayBuffer()], 'renamed.txt', { type: 'text/plain' }),
      body.previewToken,
    );
    expect(renamed.status).toBe(409);

    const tampered = await postFile(
      first, '/api/workspace/connectors/file/import', file, `${body.previewToken.slice(0, -1)}x`,
    );
    expect(tampered.status).toBe(409);

    const expiryPreview = await postFile(first, '/api/workspace/connectors/file/preview', file);
    const expiryBody = await expiryPreview.json() as { previewToken: string };
    now += 300_001;
    const expired = await postFile(first, '/api/workspace/connectors/file/import', file, expiryBody.previewToken);
    expect(expired.status).toBe(409);
    expect(await expired.json()).toEqual({ error: 'preview_expired' });

    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('fails malformed, duplicate, unsupported, and over-extractor-limit uploads with stable redacted codes', async () => {
    const jar = await signedIn('bad-files@example.com');
    const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
    const duplicate = new FormData();
    duplicate.append('file', new File(['one'], 'one.txt', { type: 'text/plain' }) as unknown as Blob);
    duplicate.append('file', new File(['two'], 'two.txt', { type: 'text/plain' }) as unknown as Blob);
    const duplicateResponse = await fetch(`${base}/api/workspace/connectors/file/preview`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'x-csrf-token': token, origin: SITE_ORIGIN },
      body: duplicate,
    });
    expect(duplicateResponse.status).toBe(400);
    expect(await duplicateResponse.json()).toEqual({ error: 'invalid_multipart' });

    const unsupported = await postFile(
      jar,
      '/api/workspace/connectors/file/preview',
      new File(['MZ executable'], 'report.pdf.txt', { type: 'text/plain' }),
    );
    expect(unsupported.status).toBe(422);
    expect(await unsupported.json()).toEqual({ error: 'invalid_filename' });

    const tooLong = await postFile(
      jar,
      '/api/workspace/connectors/file/preview',
      new File([`a: ${'x'.repeat(20_000)}`], 'large.md', { type: 'text/markdown' }),
    );
    expect(tooLong.status).toBe(422);
    expect(await tooLong.json()).toEqual({ error: 'document_too_long' });

    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });
});

describe('workspace public GitHub import API', () => {
  it('checks exact origin, CSRF, session, and request shape before upstream work', async () => {
    const unsigned = new Jar();
    unsigned.absorb(await fetch(`${base}/api/session`));
    const noSession = await postGitHub(unsigned, { url: 'https://github.com/acme/atlas' });
    expect(noSession.status).toBe(401);

    const jar = await signedIn('github-early@example.com');
    const noCsrf = await postGitHub(jar, { url: 'https://github.com/acme/atlas' }, {
      'x-csrf-token': null,
    });
    expect(noCsrf.status).toBe(403);
    const foreignOrigin = await postGitHub(jar, { url: 'https://github.com/acme/atlas' }, {
      origin: 'https://attacker.example',
    });
    expect(foreignOrigin.status).toBe(403);
    const missingOrigin = await postGitHub(jar, { url: 'https://github.com/acme/atlas' }, {
      origin: null,
    });
    expect(missingOrigin.status).toBe(403);
    for (const forbidden of [
      { url: 'https://github.com/acme/atlas', token: 'github-secret' },
      { url: 'https://github.com/acme/atlas', ref: 'main' },
      { url: 'https://github.com/acme/atlas', headers: { authorization: 'secret' } },
      { url: 'https://github.com/acme/atlas', apiBase: 'https://evil.example' },
      { url: 'https://github.com/acme/atlas', redirects: true },
    ]) {
      const response = await postGitHub(jar, forbidden);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'invalid_github_request' });
    }
    expect(githubBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('ignores client workspace fields, uses the account workspace, and returns only a safe immutable summary', async () => {
    const jar = await signedIn('github-owner@example.com');
    const response = await postGitHub(jar, {
      url: 'https://github.com/acme/atlas',
      workspace: workspaceCollection('attacker@example.com'),
      collection: 'public',
    });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connectorId: 'github',
      submittedDocuments: 1,
      acceptedDocuments: 1,
      searchableDocuments: 1,
      acceptedRecords: 4,
      snapshotCommit: 'a'.repeat(40),
      snapshotDigest: 'd'.repeat(64),
      consideredEntries: 2,
      fetchedBlobs: 1,
      skipped: [{ reason: 'unsupported_extension', count: 1 }],
    });
    expect(githubBoundaryCalls).toEqual([{ url: 'https://github.com/acme/atlas', aborted: false }]);
    expect(runnerCalls).toEqual([expect.objectContaining({
      workspace: workspaceCollection('github-owner@example.com'),
      connectorId: 'github',
      awaitSearchable: true,
      text: 'a: Atlas is owned by Priya.',
    })]);
    expect(connectorStore.puts).toBe(1);
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('github-owner@example.com');
    expect(serialized).not.toContain('attacker@example.com');
    expect(serialized).not.toContain('lacuna-ws-');
    expect(serialized).not.toContain('api.github.com');
    expect(serialized).not.toContain('Atlas is owned');
    expect(serialized).not.toContain('repositoryUrl');
    expect(serialized).not.toContain('sourceUrl');
    expect(serialized).not.toContain('blobSha');
    expect(serialized).not.toContain('rawDigest');
  });

  it('derives each account workspace independently even when client workspace fields are swapped', async () => {
    const first = await signedIn('github-first@example.com');
    const second = await signedIn('github-second@example.com');

    expect((await postGitHub(first, {
      url: 'https://github.com/acme/atlas',
      workspace: workspaceCollection('github-second@example.com'),
    })).status).toBe(200);
    expect((await postGitHub(second, {
      url: 'https://github.com/acme/atlas',
      workspace: workspaceCollection('github-first@example.com'),
    })).status).toBe(200);

    expect(runnerCalls.map(({ workspace }) => workspace)).toEqual([
      workspaceCollection('github-first@example.com'),
      workspaceCollection('github-second@example.com'),
    ]);
  });

  it('preserves accepted work when indexing readiness times out', async () => {
    const jar = await signedIn('github-readiness@example.com');
    readinessTimeout = true;

    const response = await postGitHub(jar, { url: 'https://github.com/acme/atlas' });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connectorId: 'github',
      acceptedDocuments: 1,
      acceptedRecords: 4,
      searchableDocuments: 0,
      failure: 'readiness_timeout',
    });
    expect(connectorStore.state.github).toMatchObject({
      importedDocuments: 1,
      lastSuccessAt: expect.any(String),
      lastFailure: 'readiness_timeout',
    });
    expect(JSON.stringify(body)).not.toContain('collection');
  });

  it('redacts typed and unknown upstream failures and performs zero runner writes', async () => {
    const jar = await signedIn('github-errors@example.com');
    githubBoundaryFailure = new GitHubImportError('github_integrity_failed');
    const integrity = await postGitHub(jar, { url: 'https://github.com/acme/private-or-missing' });
    expect(integrity.status).toBe(502);
    expect(await integrity.json()).toEqual({ error: 'github_integrity_failed' });

    githubBoundaryFailure = new Error('token=secret API /repos/private X-GitHub-Request-Id: raw');
    const unknown = await postGitHub(jar, { url: 'https://github.com/acme/private-or-missing' });
    expect(unknown.status).toBe(502);
    expect(await unknown.json()).toEqual({ error: 'github_import_failed' });
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('returns the stable zero-document validation result without runner or store writes', async () => {
    const jar = await signedIn('github-empty@example.com');
    githubBoundaryFailure = new GitHubImportError('github_no_documents');

    const response = await postGitHub(jar, { url: 'https://github.com/acme/empty' });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: 'github_no_documents' });
    expect(githubBoundaryCalls).toHaveLength(1);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('spends the private ingest budget before a fifth upstream request', async () => {
    const jar = await signedIn('github-budget@example.com');
    for (let count = 0; count < 4; count += 1) {
      expect((await postGitHub(jar, { url: 'https://github.com/acme/atlas' })).status).toBe(200);
    }
    const limited = await postGitHub(jar, { url: 'https://github.com/acme/atlas' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'workspace_ingest_budget' });
    expect(githubBoundaryCalls).toHaveLength(4);
    expect(runnerCalls).toHaveLength(4);
  });

  it('fails catalogue and route availability closed without both importer and runner', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(directory)),
      secure: false,
      health: null,
      connectorStore,
      connectorCatalog: () => catalogue({ webhookKey: 'configured', fileImport: true, githubImport: false }),
      siteOrigin: SITE_ORIGIN,
    });
    await listen(router);
    const jar = await signedIn('github-unavailable@example.com');

    const response = await postGitHub(jar, { url: 'https://github.com/acme/atlas' });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'github_import_unavailable' });
    const catalogueResponse = await fetch(`${base}/api/workspace/connectors`, {
      headers: { cookie: jar.header() },
    });
    const body = await catalogueResponse.json() as { connectors: readonly Record<string, unknown>[] };
    expect(body.connectors.find((entry) => entry['id'] === 'github')).toMatchObject({
      availability: 'unavailable', reason: 'github_import_unavailable', state: 'idle',
    });
    expect(githubBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
  });
});
