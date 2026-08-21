import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion } from '../../src/auth/store.js';
import type { AgentRun } from '../../src/agent/types.js';

const VOICE_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
let server: Server;
let base: string;
let directory: string;
const idempotencyKeys: string[] = [];

interface Identity {
  readonly cookie: string;
  readonly csrf: string;
}

async function identity(accounts: FileAccounts): Promise<Identity> {
  const email = 'voice-runtime@example.com';
  const now = Date.UTC(2026, 7, 21, 12);
  const sessionVersion = newSessionVersion();
  await accounts.create({
    email,
    passwordHash: 'not-used-by-agent-runtime-api-test',
    createdAt: new Date(now).toISOString(),
    workspace: 'Voice runtime',
    onboarded: true,
    sessionVersion,
  });
  const session = await accounts.startSession(email, now, sessionVersion);
  return {
    csrf: 'voice-runtime-csrf',
    cookie: `lacuna_session=${encodeURIComponent(session)}; lacuna_csrf=voice-runtime-csrf`,
  };
}

let who: Identity;

async function run(body: unknown): Promise<Response> {
  return fetch(`${base}/api/workspace/agent/run`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      cookie: who.cookie,
      'x-csrf-token': who.csrf,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-agent-runtime-api-'));
  const accounts = new FileAccounts(new AccountStore(directory));
  who = await identity(accounts);
  const router = new ApiRouter({
    store: accounts,
    secure: false,
    health: null,
    now: () => Date.UTC(2026, 7, 21, 12),
    agent: async (workspace, task, options) => {
      idempotencyKeys.push(options?.idempotencyKey ?? 'missing');
      return {
        id: `run-${idempotencyKeys.length}`,
        workspace: workspace ?? 'public',
        task,
        status: 'COMPLETED',
      } as AgentRun;
    },
  });
  server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(request, response, path).then((handled) => {
      if (!handled.handled) response.writeHead(404).end('{}');
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

describe('authenticated agent-run request identity', () => {
  it('maps a canonical voice UUID replay to the same durable idempotency key', async () => {
    const before = idempotencyKeys.length;
    const body = { task: 'Prepare an evidence brief for Atlas.', requestId: VOICE_REQUEST_ID };

    expect((await run(body)).status).toBe(200);
    expect((await run(body)).status).toBe(200);
    expect(idempotencyKeys.slice(before)).toEqual([
      `voice:${VOICE_REQUEST_ID}`,
      `voice:${VOICE_REQUEST_ID}`,
    ]);
  });

  it('preserves fresh web idempotency keys when requestId is absent', async () => {
    const before = idempotencyKeys.length;
    expect((await run({ task: 'Review Atlas evidence.' })).status).toBe(200);
    expect((await run({ task: 'Review Atlas evidence.' })).status).toBe(200);
    const keys = idempotencyKeys.slice(before);

    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^web:[0-9a-f]{32}$/u);
    expect(keys[1]).toMatch(/^web:[0-9a-f]{32}$/u);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('rejects arbitrary request ids and authority-bearing extra keys before running', async () => {
    const before = idempotencyKeys.length;
    const invalidBodies = [
      { task: 'Review Atlas.', requestId: 'voice-request-1' },
      { task: 'Review Atlas.', requestId: VOICE_REQUEST_ID.toUpperCase() },
      { task: 'Review Atlas.', requestId: '123e4567-e89b-12d3-a456-426614174000' },
      { task: 'Review Atlas.', requestId: `voice:${VOICE_REQUEST_ID}` },
      { task: 'Review Atlas.', requestId: VOICE_REQUEST_ID, endpoint: 'https://evil.example' },
      { task: 'Review Atlas.', requestId: VOICE_REQUEST_ID, method: 'DELETE' },
      { task: 'Review Atlas.', requestId: VOICE_REQUEST_ID, id: 'another-run' },
    ] as const;

    for (const body of invalidBodies) expect((await run(body)).status).toBe(422);
    expect(idempotencyKeys).toHaveLength(before);
  });
});
