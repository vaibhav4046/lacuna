import { mkdtempSync, rmSync } from 'node:fs';
import { File } from 'node:buffer';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import {
  IngestReadinessError,
  type IngestPreparedOptions,
  type IngestPreparedReport,
} from '../../src/api/ingest.js';
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
import {
  HttpsImportError,
  type PinnedHttpsReaderBoundary,
} from '../../src/connectors/https.js';
import { prepareConnectorBatch, prepareConnectorDocument } from '../../src/connectors/normalize.js';
import { FilePreviewTokenService } from '../../src/connectors/preview-token.js';
import { ConnectorRunner } from '../../src/connectors/run.js';
import {
  WebhookRejectedError,
  type IssuedWebhook,
  type WebhookReceipt,
  type WebhookRequestControl,
  type WebhookState,
} from '../../src/connectors/webhook.js';
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
let httpsBoundaryCalls: { readonly url: string; readonly aborted: boolean }[];
let httpsBoundaryFailure: Error | null;
let pauseHttpsReader: boolean;
let httpsReaderStarted: Promise<void>;
let markHttpsReaderStarted: (() => void) | undefined;
let releaseHttpsReader: (() => void) | undefined;
let httpsReaderReleased: Promise<void>;
let httpsReaderAborted: Promise<void>;
let markHttpsReaderAborted: (() => void) | undefined;
let readinessTimeout: boolean;
let pauseGitHubImporter: boolean;
let githubImporterStarted: Promise<void>;
let markGitHubImporterStarted: (() => void) | undefined;
let releaseGitHubImporter: (() => void) | undefined;
let githubImporterReleased: Promise<void>;
let githubImporterFinished: Promise<void>;
let markGitHubImporterFinished: (() => void) | undefined;
let githubImporterAborted: Promise<void>;
let markGitHubImporterAborted: (() => void) | undefined;
let pauseRunnerReadiness: boolean;
let runnerReadinessStarted: Promise<void>;
let markRunnerReadinessStarted: (() => void) | undefined;
let releaseRunnerReadiness: (() => void) | undefined;
let runnerReadinessReleased: Promise<void>;
let runnerReadinessAborted: Promise<void>;
let markRunnerReadinessAborted: (() => void) | undefined;
let now: number;
let webhookCalls: {
  readonly operation: 'issue' | 'state' | 'revoke' | 'accept';
  readonly workspace?: string;
  readonly endpointId?: string;
  readonly body?: Buffer;
  readonly control?: WebhookRequestControl;
}[];
let webhookConfiguredAt: string | null;
let webhookAdmissionFailure: Error | null;

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
  const current = await fetch(`${base}/api/session`, { headers: { cookie: jar.header() } });
  jar.absorb(current);
  const state = await current.json() as { session?: { binding?: unknown } };
  expect(state.session?.binding).toMatch(/^[0-9a-f]{64}$/u);
  jar.binding = state.session?.binding as string;
  return jar;
}

function privateHeaders(
  jar: Jar,
  overrides: Readonly<Record<string, string | null>> = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    cookie: jar.header(),
    'x-lacuna-voice-binding': jar.binding,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  return headers;
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
    ...privateHeaders(jar),
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
    ...privateHeaders(jar),
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

async function postHttps(
  jar: Jar,
  body: unknown,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...privateHeaders(jar),
    'x-csrf-token': token,
    origin: SITE_ORIGIN,
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const response = await fetch(`${base}/api/workspace/connectors/api/import`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  jar.absorb(response);
  return response;
}

async function mutateWebhook(
  jar: Jar,
  method: 'POST' | 'DELETE',
  endpointId?: string,
  body?: unknown,
  overrides: Readonly<Record<string, string | null>> = {},
): Promise<Response> {
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const headers: Record<string, string> = {
    ...privateHeaders(jar),
    'x-csrf-token': token,
    origin: SITE_ORIGIN,
  };
  let encoded: string | undefined;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    encoded = JSON.stringify(body);
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  const suffix = method === 'DELETE' ? `/${endpointId ?? ''}` : '';
  const response = await fetch(`${base}/api/workspace/connectors/webhook${suffix}`, {
    method,
    headers,
    ...(encoded === undefined ? {} : { body: encoded }),
  });
  jar.absorb(response);
  return response;
}

async function slowRejectedWebhookRequest(): Promise<{
  readonly closed: boolean;
  readonly responded: boolean;
}> {
  const target = new URL(base);
  return new Promise((resolve, reject) => {
    let responded = false;
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: '/api/connectors/webhook/AAECAwQFBgcICQoLDA0ODw',
      method: 'POST',
      agent: false,
      headers: {
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        'x-lacuna-timestamp': String(now / 1_000),
        'x-lacuna-event-id': 'event_1234567890',
        'x-lacuna-signature': `v1=${'0'.repeat(64)}`,
      },
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error('slow rejected webhook did not terminate'));
    }, 500);
    request.once('response', (response) => {
      responded = true;
      response.resume();
    });
    request.once('error', () => undefined);
    request.once('close', () => {
      clearTimeout(timer);
      resolve({ closed: true, responded });
    });
    request.flushHeaders();
    request.write('{"title":');
  });
}

function disconnectableGitHubRequest(jar: Jar): {
  readonly close: () => void;
  readonly closed: Promise<void>;
} {
  const target = new URL(base);
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const body = JSON.stringify({ url: 'https://github.com/acme/atlas' });
  let markClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const request = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: '/api/workspace/connectors/github/import',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      cookie: jar.header(),
      'x-lacuna-voice-binding': jar.binding,
      'x-csrf-token': token,
      origin: SITE_ORIGIN,
    },
  }, (response) => response.resume());
  request.once('error', () => markClosed?.());
  request.once('close', () => markClosed?.());
  request.end(body);
  return { close: () => request.destroy(), closed };
}

function disconnectableHttpsRequest(jar: Jar): {
  readonly close: () => void;
  readonly closed: Promise<void>;
} {
  const target = new URL(base);
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  const body = JSON.stringify({ url: 'https://api.example.com/data?token=secret' });
  let markClosed: (() => void) | undefined;
  const closed = new Promise<void>((resolve) => { markClosed = resolve; });
  const request = httpRequest({
    hostname: target.hostname,
    port: target.port,
    path: '/api/workspace/connectors/api/import',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
      cookie: jar.header(),
      'x-lacuna-voice-binding': jar.binding,
      'x-csrf-token': token,
      origin: SITE_ORIGIN,
    },
  }, (response) => response.resume());
  request.once('error', () => markClosed?.());
  request.once('close', () => markClosed?.());
  request.end(body);
  return { close: () => request.destroy(), closed };
}

async function disconnectDuringGitHubBody(jar: Jar): Promise<void> {
  const target = new URL(base);
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  await new Promise<void>((resolve) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: '/api/workspace/connectors/github/import',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '4096',
        cookie: jar.header(),
        'x-lacuna-voice-binding': jar.binding,
        'x-csrf-token': token,
        origin: SITE_ORIGIN,
      },
    });
    request.once('error', () => resolve());
    request.write('{"url":"https://github.com/acme/atlas"');
    setTimeout(() => request.destroy(), 5);
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
}

async function disconnectDuringHttpsBody(jar: Jar): Promise<void> {
  const target = new URL(base);
  const token = decodeURIComponent(jar.values.get('lacuna_csrf') ?? '');
  await new Promise<void>((resolve) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: target.port,
      path: '/api/workspace/connectors/api/import',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': '4096',
        cookie: jar.header(),
        'x-lacuna-voice-binding': jar.binding,
        'x-csrf-token': token,
        origin: SITE_ORIGIN,
      },
    });
    request.once('error', () => resolve());
    request.write('{"url":"https://api.example.com/data"');
    setTimeout(() => request.destroy(), 5);
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 20));
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

function preparedHttpsDocument() {
  return prepareConnectorDocument({
    title: 'Public HTTPS JSON',
    text: '/owner = "Priya"',
    provenance: {
      connectorId: 'https_api',
      sourceUrl: 'https://api.example.com/',
      mediaType: 'application/json',
      observedAt: '2026-08-21T12:00:00.000Z',
      https: {
        schemaVersion: 1,
        pathDigest: 'e'.repeat(64),
        retrievedAt: '2026-08-21T12:00:00.000Z',
        rawDigest: 'f'.repeat(64),
        parserVersion: 'https-v1',
      },
    },
  });
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
  httpsBoundaryCalls = [];
  httpsBoundaryFailure = null;
  pauseHttpsReader = false;
  httpsReaderStarted = new Promise<void>((resolve) => { markHttpsReaderStarted = resolve; });
  httpsReaderReleased = new Promise<void>((resolve) => { releaseHttpsReader = resolve; });
  httpsReaderAborted = new Promise<void>((resolve) => { markHttpsReaderAborted = resolve; });
  readinessTimeout = false;
  pauseGitHubImporter = false;
  githubImporterStarted = new Promise<void>((resolve) => { markGitHubImporterStarted = resolve; });
  githubImporterReleased = new Promise<void>((resolve) => { releaseGitHubImporter = resolve; });
  githubImporterFinished = new Promise<void>((resolve) => { markGitHubImporterFinished = resolve; });
  githubImporterAborted = new Promise<void>((resolve) => { markGitHubImporterAborted = resolve; });
  pauseRunnerReadiness = false;
  runnerReadinessStarted = new Promise<void>((resolve) => { markRunnerReadinessStarted = resolve; });
  runnerReadinessReleased = new Promise<void>((resolve) => { releaseRunnerReadiness = resolve; });
  runnerReadinessAborted = new Promise<void>((resolve) => { markRunnerReadinessAborted = resolve; });
  now = Date.parse('2026-08-21T12:00:00.000Z');
  webhookCalls = [];
  webhookConfiguredAt = null;
  webhookAdmissionFailure = null;
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
      if (pauseRunnerReadiness) {
        markRunnerReadinessStarted?.();
        const signal = (options as IngestPreparedOptions).signal;
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            cleanup();
            markRunnerReadinessAborted?.();
            reject(new IngestReadinessError('failed', 4, 0));
          };
          const onRelease = () => { cleanup(); resolve(); };
          const cleanup = () => signal?.removeEventListener('abort', onAbort);
          if (signal?.aborted === true) onAbort();
          else {
            signal?.addEventListener('abort', onAbort, { once: true });
            void runnerReadinessReleased.then(onRelease);
          }
        });
      }
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
      if (pauseGitHubImporter) {
        markGitHubImporterStarted?.();
        const onAbort = () => markGitHubImporterAborted?.();
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        await githubImporterReleased;
        signal.removeEventListener('abort', onAbort);
      }
      markGitHubImporterFinished?.();
      return preparedGitHubBatch();
    },
  };
  const httpsReader: PinnedHttpsReaderBoundary = {
    read: async (url, signal) => {
      httpsBoundaryCalls.push({ url, aborted: signal.aborted });
      if (httpsBoundaryFailure !== null) throw httpsBoundaryFailure;
      if (pauseHttpsReader) {
        markHttpsReaderStarted?.();
        const onAbort = () => markHttpsReaderAborted?.();
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
        await httpsReaderReleased;
        signal.removeEventListener('abort', onAbort);
      }
      return preparedHttpsDocument();
    },
  };
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    connectorStore,
    connectorCatalog: () => catalogue({
      webhookService: true, fileImport: true, githubImport: true, httpsImport: true,
    }),
    fileConnector,
    githubImporter,
    httpsReader,
    connectorRunner: runner,
    webhookService: {
      admit: () => {
        if (webhookAdmissionFailure !== null) throw webhookAdmissionFailure;
      },
      issue: async (workspace): Promise<IssuedWebhook> => {
        webhookCalls.push({ operation: 'issue', workspace });
        return {
          created: true,
          endpointId: 'AAECAwQFBgcICQoLDA0ODw',
          endpoint: `${SITE_ORIGIN}/api/connectors/webhook/AAECAwQFBgcICQoLDA0ODw`,
          secret: '27e9t3M2kZ2lz84-0mVTJK_jPdVacNum1AjckK__LCg',
          configuredAt: '2026-08-21T12:00:00.000Z',
        };
      },
      state: async (workspace): Promise<WebhookState> => {
        webhookCalls.push({ operation: 'state', workspace });
        return webhookConfiguredAt === null
          ? { configured: false, endpointId: null, endpoint: null, configuredAt: null }
          : {
            configured: true,
            endpointId: 'AAECAwQFBgcICQoLDA0ODw',
            endpoint: `${SITE_ORIGIN}/api/connectors/webhook/AAECAwQFBgcICQoLDA0ODw`,
            configuredAt: webhookConfiguredAt,
          };
      },
      revoke: async (workspace, endpointId): Promise<boolean> => {
        webhookCalls.push({ operation: 'revoke', workspace, endpointId });
        return true;
      },
      accept: async (endpointId, _headers, body, control): Promise<WebhookReceipt> => {
        webhookCalls.push({ operation: 'accept', endpointId, body, control });
        return {
          state: 'accepted', acceptedDocuments: 1, searchableDocuments: 1,
          failedDocuments: 0, acceptedRecords: 4, refusedRecords: 0,
          failure: null, observationWrite: 'stored', indeterminateSubmission: false,
        };
      },
    },
    siteOrigin: SITE_ORIGIN,
    now: () => now,
  });
  await listen(router);
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('private connector exact-session binding', () => {
  it('rejects every private connector operation before catalogue, adapter, runner, or lifecycle work', async () => {
    const jar = await signedIn('binding-owner@example.com');
    const unbound = { 'x-lacuna-voice-binding': null } as const;
    const file = new File(['a: Atlas is owned by Priya.'], 'atlas.txt', { type: 'text/plain' });

    const responses = [
      await fetch(`${base}/api/workspace/connectors`, { headers: privateHeaders(jar, unbound) }),
      await fetch(`${base}/api/workspace/connectors/webhook`, { headers: privateHeaders(jar, unbound) }),
      await mutateWebhook(jar, 'POST', undefined, undefined, unbound),
      await mutateWebhook(jar, 'DELETE', 'AAECAwQFBgcICQoLDA0ODw', undefined, unbound),
      await postFile(jar, '/api/workspace/connectors/file/preview', file, undefined, unbound),
      await postFile(jar, '/api/workspace/connectors/file/import', file, 'preview-token', unbound),
      await postGitHub(jar, { url: 'https://github.com/acme/atlas' }, unbound),
      await postHttps(jar, { url: 'https://api.example.com/data' }, unbound),
    ];

    expect(responses.map(({ status }) => status)).toEqual(Array(8).fill(401));
    expect(connectorStore.reads).toEqual([]);
    expect(fileBoundaryCalls).toBe(0);
    expect(githubBoundaryCalls).toEqual([]);
    expect(httpsBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(webhookCalls).toEqual([]);
  });

  it('rejects a valid account-A binding under account B before import or revoke work', async () => {
    const accountA = await signedIn('binding-a@example.com');
    const accountB = await signedIn('binding-b@example.com');
    const stale = { 'x-lacuna-voice-binding': accountA.binding } as const;

    const imported = await postGitHub(accountB, { url: 'https://github.com/acme/atlas' }, stale);
    const revoked = await mutateWebhook(
      accountB,
      'DELETE',
      'AAECAwQFBgcICQoLDA0ODw',
      undefined,
      stale,
    );

    expect([imported.status, revoked.status]).toEqual([401, 401]);
    expect(githubBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(webhookCalls).toEqual([]);
  });
});

describe('signed webhook lifecycle and public receiver API', () => {
  it('authenticates private lifecycle routes before service work and derives the workspace server-side', async () => {
    const anonymous = await fetch(`${base}/api/workspace/connectors/webhook`);
    expect(anonymous.status).toBe(401);
    expect(webhookCalls).toEqual([]);

    const jar = await signedIn('webhook-owner@example.com');
    const state = await fetch(`${base}/api/workspace/connectors/webhook`, {
      headers: privateHeaders(jar),
    });
    expect(state.status).toBe(200);
    expect(await state.json()).toEqual({
      configured: false, endpointId: null, endpoint: null, configuredAt: null,
    });

    expect((await mutateWebhook(jar, 'POST', undefined, undefined, { origin: null })).status).toBe(403);
    expect((await mutateWebhook(jar, 'POST', undefined, undefined, { 'x-csrf-token': 'wrong' })).status).toBe(403);
    const issuedResponse = await mutateWebhook(jar, 'POST');
    expect(issuedResponse.status).toBe(201);
    const issuedBody = await issuedResponse.json() as Record<string, unknown>;
    expect(issuedBody).toMatchObject({
      created: true,
      endpointId: 'AAECAwQFBgcICQoLDA0ODw',
      secret: '27e9t3M2kZ2lz84-0mVTJK_jPdVacNum1AjckK__LCg',
    });
    expect(JSON.stringify(issuedBody)).not.toMatch(/workspace|collection|ownerDigest|Cipher/u);

    const revoked = await mutateWebhook(jar, 'DELETE', 'AAECAwQFBgcICQoLDA0ODw');
    expect(revoked.status).toBe(200);
    expect(webhookCalls.map((call) => call.operation)).toEqual(['state', 'issue', 'revoke']);
    for (const call of webhookCalls) {
      if (call.workspace !== undefined) expect(call.workspace).toMatch(/^lacuna-ws-[0-9a-f]{32}$/u);
    }
  });

  it('rejects private client scope fields instead of passing them to lifecycle work', async () => {
    const jar = await signedIn('webhook-scope@example.com');
    const response = await mutateWebhook(jar, 'POST', undefined, {
      workspace: 'lacuna-ws-00000000000000000000000000000000',
      collection: 'public',
      secret: 'client-secret',
    });
    expect(response.status).toBe(422);
    expect(webhookCalls).toEqual([]);
  });

  it('accepts the public exact entity body without session state and returns only safe receipt fields', async () => {
    const body = Buffer.from(JSON.stringify({
      title: 'Atlas', text: 'Atlas depends on cache-a.', observed_at: '2026-08-21T12:00:00.000Z',
    }), 'utf8');
    const response = await fetch(`${base}/api/connectors/webhook/AAECAwQFBgcICQoLDA0ODw`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': String(body.byteLength),
        'x-lacuna-timestamp': String(Math.floor(now / 1_000)),
        'x-lacuna-event-id': 'event_1234567890',
        'x-lacuna-signature': `v1=${'0'.repeat(64)}`,
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({
      state: 'accepted', acceptedDocuments: 1, searchableDocuments: 1,
      failedDocuments: 0, acceptedRecords: 4, refusedRecords: 0,
      failure: null, observationWrite: 'stored', indeterminateSubmission: false,
    });
    const call = webhookCalls[0];
    expect(call).toMatchObject({ operation: 'accept', endpointId: 'AAECAwQFBgcICQoLDA0ODw' });
    expect(call?.body).toEqual(body);
    expect(call?.control).toMatchObject({ startedAtMs: now, settlementDeadlineMs: now + 240_000 });
  });

  it('terminally closes a slow unread public request before settling an admission rejection', async () => {
    webhookAdmissionFailure = new WebhookRejectedError();

    await expect(slowRejectedWebhookRequest()).resolves.toEqual({ closed: true, responded: false });
    expect(webhookCalls).toEqual([]);
  });
});

describe('workspace connector catalogue API', () => {
  it('fails file availability closed when the runner or preview signer is absent', () => {
    const unavailable = catalogue({ webhookService: true, fileImport: false });
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
    webhookConfiguredAt = '2026-08-21T08:30:00.000Z';

    const response = await fetch(
      `${base}/api/workspace/connectors?workspace=${encodeURIComponent(workspaceCollection('somebody-else@example.com'))}`,
      { headers: privateHeaders(jar) },
    );
    const body = await response.json() as { connectors: readonly Record<string, unknown>[] };

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(connectorStore.reads).toEqual([workspaceCollection('connector-owner@example.com')]);
    expect(body.connectors).toHaveLength(9);
    expect(body.connectors.find((entry) => entry['id'] === 'github')).toMatchObject({
      availability: 'available', state: 'idle', importedDocuments: 4,
    });
    expect(body.connectors.find((entry) => entry['id'] === 'webhook')).toMatchObject({
      availability: 'available', state: 'connected', importedDocuments: 0,
      configuredAt: '2026-08-21T08:30:00.000Z',
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

    const response = await fetch(`${base}/api/workspace/connectors`, { headers: privateHeaders(jar) });
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

    const response = await fetch(`${base}/api/workspace/connectors`, { headers: privateHeaders(jar) });
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

  it('runs structured JSON and CSV files through the same exact preview/import boundary', async () => {
    const jar = await signedIn('structured-files@example.com');
    const json = new File(['{"owner":"Priya"}\n'], 'claims.json', { type: 'application/json' });
    const jsonPreview = await postFile(jar, '/api/workspace/connectors/file/preview', json);
    expect(jsonPreview.status).toBe(200);
    const jsonBody = await jsonPreview.json() as { readonly type: string; readonly previewToken: string };
    expect(jsonBody.type).toBe('text');
    const jsonImport = await postFile(jar, '/api/workspace/connectors/file/import', json, jsonBody.previewToken);
    expect(jsonImport.status).toBe(200);

    const csv = new File(['owner,note\nPriya,"keeps, context"\n'], 'claims.csv', { type: 'text/csv' });
    const csvPreview = await postFile(jar, '/api/workspace/connectors/file/preview', csv);
    expect(csvPreview.status).toBe(200);
    const csvBody = await csvPreview.json() as { readonly type: string; readonly paragraphs: number; readonly previewToken: string };
    expect(csvBody).toMatchObject({ type: 'text', paragraphs: 2 });
    const csvImport = await postFile(jar, '/api/workspace/connectors/file/import', csv, csvBody.previewToken);
    expect(csvImport.status).toBe(200);
    expect(runnerCalls.map((call) => call.text)).toEqual([
      '{"owner":"Priya"}\n',
      'owner,note\nPriya,"keeps, context"\n',
    ]);
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
      headers: { ...privateHeaders(jar), 'x-csrf-token': token, origin: SITE_ORIGIN },
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
  it('does no upstream, runner, or observation work when the client disconnects before import', async () => {
    const jar = await signedIn('github-disconnect-body@example.com');

    await disconnectDuringGitHubBody(jar);

    expect(githubBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('does not enter the runner when the response socket closes after preparation', async () => {
    const jar = await signedIn('github-disconnect-prepared@example.com');
    pauseGitHubImporter = true;
    const request = disconnectableGitHubRequest(jar);
    await githubImporterStarted;

    request.close();
    await request.closed;
    await githubImporterAborted;
    releaseGitHubImporter?.();
    await githubImporterFinished;

    expect(githubBoundaryCalls).toHaveLength(1);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('stops readiness on disconnect but records exact accepted work without claiming rollback', async () => {
    const jar = await signedIn('github-disconnect-readiness@example.com');
    pauseRunnerReadiness = true;
    const request = disconnectableGitHubRequest(jar);
    await runnerReadinessStarted;

    request.close();
    await request.closed;
    await runnerReadinessAborted;
    releaseRunnerReadiness?.();
    await vi.waitFor(() => expect(connectorStore.puts).toBe(1));

    expect(connectorStore.state.github).toMatchObject({
      importedDocuments: 1,
      lastSuccessAt: expect.any(String),
      lastFailure: 'readiness_failed',
    });
  });

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
      connectorCatalog: () => catalogue({ webhookService: true, fileImport: true, githubImport: false }),
      siteOrigin: SITE_ORIGIN,
    });
    await listen(router);
    const jar = await signedIn('github-unavailable@example.com');

    const response = await postGitHub(jar, { url: 'https://github.com/acme/atlas' });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'github_import_unavailable' });
    const catalogueResponse = await fetch(`${base}/api/workspace/connectors`, {
      headers: privateHeaders(jar),
    });
    const body = await catalogueResponse.json() as { connectors: readonly Record<string, unknown>[] };
    expect(body.connectors.find((entry) => entry['id'] === 'github')).toMatchObject({
      availability: 'unavailable', reason: 'github_import_unavailable', state: 'idle',
    });
    expect(githubBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
  });
});

describe('workspace pinned public HTTPS import API', () => {
  it('does no reader, runner, or observation work when the client disconnects in the body', async () => {
    const jar = await signedIn('https-disconnect-body@example.com');
    await disconnectDuringHttpsBody(jar);
    expect(httpsBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('checks exact origin, CSRF, session, exact body, and quota before the reader', async () => {
    const unsigned = new Jar();
    unsigned.absorb(await fetch(`${base}/api/session`));
    expect((await postHttps(unsigned, { url: 'https://api.example.com/data' })).status).toBe(401);

    const jar = await signedIn('https-early@example.com');
    expect((await postHttps(jar, { url: 'https://api.example.com/data' }, {
      origin: 'https://attacker.example',
    })).status).toBe(403);
    expect((await postHttps(jar, { url: 'https://api.example.com/data' }, {
      origin: null,
    })).status).toBe(403);
    expect((await postHttps(jar, { url: 'https://api.example.com/data' }, {
      'x-csrf-token': null,
    })).status).toBe(403);
    for (const body of [
      { url: 'https://api.example.com/data', workspace: workspaceCollection('attacker@example.com') },
      { url: 'https://api.example.com/data', collection: 'public' },
      { url: 'https://api.example.com/data', method: 'POST' },
      { url: 'https://api.example.com/data', headers: { authorization: 'secret' } },
      { url: 'https://api.example.com/data', redirects: true },
      { url: 'https://api.example.com/data', tls: false },
      { url: 'https://api.example.com/data', dns: '8.8.8.8' },
    ]) {
      const response = await postHttps(jar, body);
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: 'invalid_https_request' });
    }
    expect(httpsBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('uses the account workspace, awaits searchability, and returns only safe counts and digests', async () => {
    const jar = await signedIn('https-owner@example.com');
    const response = await postHttps(jar, { url: 'https://api.example.com/private?q=provider-secret' });
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      connectorId: 'https_api', submittedDocuments: 1, acceptedDocuments: 1,
      searchableDocuments: 1, acceptedRecords: 4,
      sourceDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
    expect(httpsBoundaryCalls).toEqual([{
      url: 'https://api.example.com/private?q=provider-secret', aborted: false,
    }]);
    expect(runnerCalls).toEqual([expect.objectContaining({
      workspace: workspaceCollection('https-owner@example.com'),
      connectorId: 'https_api',
      awaitSearchable: true,
      text: '/owner = "Priya"',
    })]);
    expect(connectorStore.puts).toBe(1);
    expect(JSON.stringify(body)).not.toMatch(/provider-secret|private|api\.example|https-owner|collection|workspace|rawDigest|pathDigest/u);
  });

  it('derives distinct server workspaces across an account swap', async () => {
    const first = await signedIn('https-first@example.com');
    const second = await signedIn('https-second@example.com');
    expect((await postHttps(first, { url: 'https://api.example.com/data?account=second' })).status).toBe(200);
    expect((await postHttps(second, { url: 'https://api.example.com/data?account=first' })).status).toBe(200);
    expect(runnerCalls.map(({ workspace }) => workspace)).toEqual([
      workspaceCollection('https-first@example.com'),
      workspaceCollection('https-second@example.com'),
    ]);
  });

  it('does not enter the runner when the client disconnects during preparation', async () => {
    const jar = await signedIn('https-disconnect-reader@example.com');
    pauseHttpsReader = true;
    const request = disconnectableHttpsRequest(jar);
    await httpsReaderStarted;

    request.close();
    await request.closed;
    await httpsReaderAborted;
    releaseHttpsReader?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));

    expect(httpsBoundaryCalls).toHaveLength(1);
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('stops readiness on disconnect but records accepted HTTPS work truthfully', async () => {
    const jar = await signedIn('https-disconnect-readiness@example.com');
    pauseRunnerReadiness = true;
    const request = disconnectableHttpsRequest(jar);
    await runnerReadinessStarted;

    request.close();
    await request.closed;
    await runnerReadinessAborted;
    releaseRunnerReadiness?.();
    await vi.waitFor(() => expect(connectorStore.puts).toBe(1));

    expect(connectorStore.state.https_api).toMatchObject({
      importedDocuments: 1,
      lastSuccessAt: expect.any(String),
      lastFailure: 'readiness_failed',
    });
  });

  it('maps typed and unknown reader errors to stable redacted responses with zero writes', async () => {
    const jar = await signedIn('https-errors@example.com');
    httpsBoundaryFailure = new HttpsImportError('https_peer_mismatch');
    const mismatch = await postHttps(jar, { url: 'https://api.example.com/private?q=provider-secret' });
    expect(mismatch.status).toBe(502);
    expect(await mismatch.json()).toEqual({ error: 'https_peer_mismatch' });

    httpsBoundaryFailure = new Error('93.184.216.34 CERT private?q=provider-secret');
    const unknown = await postHttps(jar, { url: 'https://api.example.com/private?q=provider-secret' });
    expect(unknown.status).toBe(502);
    expect(await unknown.json()).toEqual({ error: 'https_import_failed' });
    expect(runnerCalls).toEqual([]);
    expect(connectorStore.puts).toBe(0);
  });

  it('spends the private ingest budget before a fifth network read', async () => {
    const jar = await signedIn('https-budget@example.com');
    for (let count = 0; count < 4; count += 1) {
      expect((await postHttps(jar, { url: `https://api.example.com/${count}` })).status).toBe(200);
    }
    const limited = await postHttps(jar, { url: 'https://api.example.com/fifth' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'workspace_ingest_budget' });
    expect(httpsBoundaryCalls).toHaveLength(4);
    expect(runnerCalls).toHaveLength(4);
  });

  it('fails catalogue and route availability closed without both reader and runner', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const router = new ApiRouter({
      store: new FileAccounts(new AccountStore(directory)),
      secure: false,
      health: null,
      connectorStore,
      connectorCatalog: () => catalogue({
        webhookService: true, fileImport: true, githubImport: true, httpsImport: false,
      }),
      siteOrigin: SITE_ORIGIN,
    });
    await listen(router);
    const jar = await signedIn('https-unavailable@example.com');

    const response = await postHttps(jar, { url: 'https://api.example.com/data' });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ error: 'https_import_unavailable' });
    const catalogueResponse = await fetch(`${base}/api/workspace/connectors`, {
      headers: privateHeaders(jar),
    });
    const body = await catalogueResponse.json() as { connectors: readonly Record<string, unknown>[] };
    expect(body.connectors.find((entry) => entry['id'] === 'https_api')).toMatchObject({
      availability: 'unavailable', reason: 'https_import_unavailable', state: 'idle',
    });
    expect(httpsBoundaryCalls).toEqual([]);
    expect(runnerCalls).toEqual([]);
  });
});
