import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion } from '../../src/auth/store.js';
import { DEMO_WORKSPACE } from '../../src/api/workspace.js';
import type { HydraSource } from '../../src/hydra/source.js';
import { emptySubject } from '../../src/hydra/source.js';

let server: Server;
let base: string;
let directory: string;
let cookie: string;
const opened: (string | undefined)[] = [];

function source(collection: string | undefined): HydraSource {
  const demo = collection === undefined;
  return {
    kind: 'cloud',
    entity: async () => ({ value: null, traces: [] }),
    subject: async (name) => ({
      value: demo && name.toLowerCase() === 'production'
        ? {
            name: 'production',
            id: 1,
            kind: 'topic',
            claims: [{
              id: 1,
              predicate: 'owner',
              objectText: 'Lacuna team',
              polarity: 'positive',
              validFrom: '2026-08-21T00:00:00.000Z',
              txTime: '2026-08-21T00:00:00.000Z',
              supersededBy: [],
            }],
            mentions: [],
          }
        : emptySubject(name),
      traces: [],
    }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
    subjects: async () => ({ value: demo ? ['production'] : [], traces: [] }),
  };
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-workspace-query-'));
  const accounts = new FileAccounts(new AccountStore(directory));
  const email = 'demo-query@example.com';
  const version = newSessionVersion();
  await accounts.create({
    email,
    passwordHash: 'unused',
    createdAt: '2026-08-21T00:00:00.000Z',
    workspace: DEMO_WORKSPACE,
    onboarded: true,
    sessionVersion: version,
  });
  cookie = `lacuna_session=${encodeURIComponent(await accounts.startSession(email, Date.now(), version))}; lacuna_csrf=test-csrf`;

  const router = new ApiRouter({
    store: accounts,
    secure: false,
    health: null,
    source: (collection) => {
      opened.push(collection);
      return source(collection);
    },
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) response.writeHead(404).end('{}');
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

describe('authenticated demo workspace query', () => {
  it('reads the same demo corpus used by the signed-in workspace view', async () => {
    const response = await fetch(`${base}/api/workspace/query`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'test-csrf',
      },
      body: JSON.stringify({ question: 'Who owns production?' }),
    });
    const body = await response.json() as { readonly unread: string | null; };

    expect(response.status).toBe(200);
    expect(body.unread).toBeNull();
    expect(opened).toEqual([undefined]);
  });
});
