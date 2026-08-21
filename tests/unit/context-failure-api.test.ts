import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion } from '../../src/auth/store.js';
import type { HydraSource } from '../../src/hydra/source.js';
import { emptySubject } from '../../src/hydra/source.js';

type SourceMode = 'empty' | 'subjects_fail' | 'subject_fail' | 'unlistable';

let mode: SourceMode = 'empty';
let server: Server;
let base: string;
let directory: string;
let sessionCookie: string;

function source(): HydraSource {
  const value: HydraSource = {
    kind: 'cloud',
    entity: async () => ({ value: null, traces: [] }),
    subject: async (name) => {
      if (mode === 'subject_fail') throw new Error('private provider detail must stay hidden');
      return { value: emptySubject(name), traces: [] };
    },
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
    subjects: async () => {
      if (mode === 'subjects_fail') throw new Error('private provider detail must stay hidden');
      return { value: mode === 'subject_fail' ? ['token-forge'] : [], traces: [] };
    },
  };
  if (mode === 'unlistable') delete value.subjects;
  return value;
}

function privateHeaders(json = false): Record<string, string> {
  return {
    Cookie: `${sessionCookie}; lacuna_csrf=context-failure-csrf`,
    ...(json ? {
      'Content-Type': 'application/json',
      'X-CSRF-Token': 'context-failure-csrf',
    } : {}),
  };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-context-failure-'));
  const accounts = new FileAccounts(new AccountStore(directory));
  const sessionVersion = newSessionVersion();
  const email = 'context-failure@example.com';
  await accounts.create({
    email,
    passwordHash: 'not-used-by-this-route-test',
    createdAt: '2026-08-21T00:00:00.000Z',
    workspace: 'Private context',
    onboarded: true,
    sessionVersion,
  });
  const token = await accounts.startSession(email, Date.now(), sessionVersion);
  sessionCookie = `lacuna_session=${encodeURIComponent(token)}`;

  const router = new ApiRouter({
    store: accounts,
    secure: false,
    health: null,
    source: () => source(),
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) response.writeHead(404).end('{}');
    }).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'application/json' });
      if (!response.writableEnded) response.end('{"error":"unhandled"}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('context-store failure semantics', () => {
  it('never renders a private store outage as empty memory or no recommendations', async () => {
    mode = 'subjects_fail';

    for (const path of ['/api/workspace/memory', '/api/workspace/health', '/api/workspace/recommendations']) {
      const response = await fetch(`${base}${path}`, { headers: privateHeaders() });
      expect([path, response.status]).toEqual([path, 503]);
      await expect(response.json()).resolves.toEqual({ error: 'context_unavailable' });
    }
  });

  it('treats a source that cannot enumerate as unavailable rather than empty', async () => {
    mode = 'unlistable';

    const memory = await fetch(`${base}/api/workspace/memory`, { headers: privateHeaders() });
    expect(memory.status).toBe(503);
    await expect(memory.json()).resolves.toEqual({ error: 'context_unavailable' });

    const query = await fetch(`${base}/api/explore/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Who owns token-forge?' }),
    });
    expect(query.status).toBe(503);
    await expect(query.json()).resolves.toEqual({ error: 'context_unavailable' });
  });

  it('keeps independent model status readable during a context-store outage', async () => {
    mode = 'subjects_fail';

    const response = await fetch(`${base}/api/workspace/model`, { headers: privateHeaders() });

    expect(response.status).toBe(200);
  });

  it('never calls a failed subject index a missing topic', async () => {
    mode = 'subjects_fail';

    const response = await fetch(`${base}/api/workspace/query`, {
      method: 'POST',
      headers: privateHeaders(true),
      body: JSON.stringify({ question: 'Who owns token-forge?' }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'context_unavailable' });
  });

  it('never calls a failed subject read a missing detail', async () => {
    mode = 'subject_fail';

    const response = await fetch(`${base}/api/explore/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Who owns token-forge?' }),
    });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'context_unavailable' });
  });

  it('preserves semantic not-found when the store successfully reports no subjects', async () => {
    mode = 'empty';

    const response = await fetch(`${base}/api/explore/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'Who owns token-forge?' }),
    });
    const body = await response.json() as { readonly unread: string | null };

    expect(response.status).toBe(200);
    expect(body.unread).toBe('no_subject');
  });
});
