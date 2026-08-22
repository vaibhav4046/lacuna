import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts, type Accounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion, type Account, type SessionRecord } from '../../src/auth/store.js';
import { FileAgentRuntimeStore } from '../../src/agent/store.js';
import type { AgentRun } from '../../src/agent/types.js';
import { FileScheduleStore } from '../../src/scheduler/store.js';

const VOICE_REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
let server: Server;
let base: string;
let directory: string;
const idempotencyKeys: string[] = [];
const preparedWorkspaces: string[] = [];

class ObservedAccounts implements Accounts {
  readonly #delegate: Accounts;
  lookups = 0;

  constructor(delegate: Accounts) { this.#delegate = delegate; }
  available(): Promise<boolean> { return this.#delegate.available(); }
  create(account: Account): Promise<Account | null> { return this.#delegate.create(account); }
  update(account: Account): Promise<void> { return this.#delegate.update(account); }
  updateWorkspace(email: string, workspace: string): Promise<void> {
    return this.#delegate.updateWorkspace(email, workspace);
  }
  startSession(email: string, now: number, expectedSessionVersion?: string): Promise<string> {
    return this.#delegate.startSession(email, now, expectedSessionVersion);
  }
  endSession(token: string): Promise<void> { return this.#delegate.endSession(token); }
  find(email: string): Promise<Account | null> {
    this.lookups += 1;
    return this.#delegate.find(email);
  }
  sessionFor(token: string, now: number): Promise<SessionRecord | null> {
    this.lookups += 1;
    return this.#delegate.sessionFor(token, now);
  }
}

interface Identity {
  readonly cookie: string;
  readonly csrf: string;
  readonly binding: string;
}

interface BareIdentity {
  readonly cookie: string;
  readonly csrf: string;
}

async function identity(accounts: Accounts, email: string): Promise<BareIdentity> {
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
    csrf: `csrf-${email}`,
    cookie: `lacuna_session=${encodeURIComponent(session)}; lacuna_csrf=${encodeURIComponent(`csrf-${email}`)}`,
  };
}

let who: Identity;
let other: Identity;
let observedAccounts: ObservedAccounts;

async function withBinding(identity: BareIdentity): Promise<Identity> {
  const state = await (await fetch(`${base}/api/session`, {
    headers: { cookie: identity.cookie },
  })).json() as { session?: { binding?: unknown } };
  if (typeof state.session?.binding !== 'string') throw new Error('signed-in session did not expose a voice binding');
  return { ...identity, binding: state.session.binding };
}

async function postPath(
  path: string,
  body: unknown,
  identity = who,
  binding?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
    cookie: identity.cookie,
    'x-csrf-token': identity.csrf,
  };
  if (binding !== undefined) headers['x-lacuna-voice-binding'] = binding;
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

async function run(body: unknown, binding: string | undefined = who.binding, identity = who): Promise<Response> {
  return postPath('/api/workspace/agent/run', body, identity, binding);
}

async function getPath(path: string, identity = who, binding?: string): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    cookie: identity.cookie,
  };
  if (binding !== undefined) headers['x-lacuna-voice-binding'] = binding;
  return fetch(`${base}${path}`, { headers });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-agent-runtime-api-'));
  observedAccounts = new ObservedAccounts(new FileAccounts(new AccountStore(directory)));
  const bareWho = await identity(observedAccounts, 'voice-runtime@example.com');
  const bareOther = await identity(observedAccounts, 'voice-runtime-other@example.com');
  const router = new ApiRouter({
    store: observedAccounts,
    secure: false,
    health: null,
    now: () => Date.UTC(2026, 7, 21, 12),
    agentStore: new FileAgentRuntimeStore(directory),
    scheduleStore: new FileScheduleStore(directory),
    prepareAgents: async (workspace) => { preparedWorkspaces.push(workspace); },
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
  who = await withBinding(bareWho);
  other = await withBinding(bareOther);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('authenticated agent-run request identity', () => {
  it('keeps the agent catalogue readable when no model provider is configured', async () => {
    const runtime = new FileAgentRuntimeStore(directory);
    const router = new ApiRouter({
      store: observedAccounts,
      secure: false,
      health: null,
      now: () => Date.UTC(2026, 7, 21, 12),
      agentStore: runtime,
      scheduleStore: new FileScheduleStore(directory),
      prepareAgents: async (workspace) => { await runtime.putAgents(workspace, []); },
      prepareSchedule: async () => undefined,
    });
    const local = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
      void router.handle(request, response, path).then((handled) => {
        if (!handled.handled) response.writeHead(404).end('{}');
      });
    });
    await new Promise<void>((resolve) => local.listen(0, '127.0.0.1', resolve));
    try {
      const address = local.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/workspace/agents`, {
        headers: { cookie: who.cookie },
      });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([]);
    } finally {
      await new Promise<void>((resolve) => local.close(() => resolve()));
    }
  });

  it('keeps ordinary target GETs compatible and accepts a matching voice binding', async () => {
    for (const path of ['/api/workspace/runs', '/api/workspace/schedules']) {
      expect((await getPath(path, other)).status, path).toBe(200);
      expect((await getPath(path, other, other.binding)).status, path).toBe(200);
    }
  });

  it('rejects stale and malformed target GET bindings before account or workspace lookup', async () => {
    const lookupBefore = observedAccounts.lookups;
    const prepareBefore = preparedWorkspaces.length;
    for (const path of ['/api/workspace/runs', '/api/workspace/schedules']) {
      for (const binding of [who.binding, '', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
        const denied = await getPath(path, other, binding);
        expect(denied.status, `${path} ${binding.length}`).toBe(401);
        await expect(denied.json()).resolves.toEqual({ error: 'voice_binding' });
      }
    }
    expect(observedAccounts.lookups).toBe(lookupBefore);
    expect(preparedWorkspaces).toHaveLength(prepareBefore);
  });

  it('accepts a matching voice binding but rejects stale and malformed bindings before any dispatch', async () => {
    const body = { task: 'Prepare an evidence brief for Atlas.', requestId: VOICE_REQUEST_ID };
    const before = idempotencyKeys.length;

    expect((await run(body, who.binding)).status).toBe(200);
    expect(idempotencyKeys).toHaveLength(before + 1);

    for (const binding of [who.binding, '', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      const denied = await run(body, binding, other);
      expect(denied.status).toBe(401);
      await expect(denied.json()).resolves.toEqual({ error: 'voice_binding' });
    }
    expect(idempotencyKeys).toHaveLength(before + 1);
  });

  it('enforces a stale planning-session binding on every closed voice mutation path', async () => {
    const mutations = [
      ['/api/workspace/ingest', { title: 'Voice memory', text: 'Atlas belongs to Priya.' }],
      ['/api/workspace/agent/run', { task: 'Prepare an Atlas brief.', requestId: VOICE_REQUEST_ID }],
      ['/api/workspace/agent/runs/run-one/cancel', {}],
      ['/api/workspace/agent/runs/run-one/retry', {}],
      ['/api/workspace/schedules/schedule-one/run', { requestId: VOICE_REQUEST_ID }],
    ] as const;
    const before = idempotencyKeys.length;

    for (const [path, body] of mutations) {
      const denied = await postPath(path, body, other, who.binding);
      expect(denied.status, path).toBe(401);
      await expect(denied.json()).resolves.toEqual({ error: 'voice_binding' });
    }
    expect(idempotencyKeys).toHaveLength(before);
  });

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
