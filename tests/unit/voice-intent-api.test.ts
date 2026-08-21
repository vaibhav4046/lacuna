import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { AccountStore, newSessionVersion } from '../../src/auth/store.js';
import { workspaceCollection } from '../../src/api/ingest.js';
import { planVoiceIntent } from '../../src/voice/intent.js';

const SITE_ORIGIN = 'https://lacuna.example';
const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const INTENT_PATH = '/api/workspace/voice/intent';
let now = Date.UTC(2026, 7, 21, 12);

interface Identity {
  readonly email: string;
  readonly cookie: string;
  readonly csrf: string;
  readonly binding: string;
}

interface RequestOptions {
  readonly body?: unknown;
  readonly csrf?: boolean;
  readonly origin?: string | null;
  readonly method?: string;
  readonly binding?: string | null;
}

let server: Server;
let base: string;
let directory: string;
let accounts: FileAccounts;
let planCalls = 0;

async function identity(email: string): Promise<Identity> {
  const sessionVersion = newSessionVersion();
  await accounts.create({
    email,
    passwordHash: 'not-used-by-the-voice-intent-test',
    createdAt: new Date(now).toISOString(),
    workspace: `${email} workspace`,
    onboarded: true,
    sessionVersion,
  });
  const session = await accounts.startSession(email, now, sessionVersion);
  const csrf = `csrf-${email.replace(/[^a-z0-9]/giu, '-')}`;
  const cookie = `lacuna_session=${encodeURIComponent(session)}; lacuna_csrf=${encodeURIComponent(csrf)}`;
  const state = await (await fetch(`${base}/api/session`, { headers: { cookie } })).json() as {
    session?: { binding?: unknown };
  };
  const binding = state.session?.binding;
  if (typeof binding !== 'string') throw new Error('signed-in session did not expose a voice binding');
  return {
    email,
    csrf,
    cookie,
    binding,
  };
}

function validBody(requestId = REQUEST_ID): Readonly<Record<string, unknown>> {
  return { version: 1, requestId, transcript: 'what changed?', currentRoute: '/app/dash' };
}

async function request(
  who: Identity | null,
  options: RequestOptions = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json',
  };
  if (who !== null) {
    headers.cookie = who.cookie;
    if (options.csrf !== false) headers['x-csrf-token'] = who.csrf;
    const binding = options.binding === undefined ? who.binding : options.binding;
    if (binding !== null) headers['x-lacuna-voice-binding'] = binding;
  } else if (options.csrf !== false) {
    headers.cookie = 'lacuna_csrf=anonymous-csrf';
    headers['x-csrf-token'] = 'anonymous-csrf';
  }
  if (options.origin !== null) headers.origin = options.origin ?? SITE_ORIGIN;
  return fetch(`${base}${INTENT_PATH}`, {
    method: options.method ?? 'POST',
    headers,
    body: JSON.stringify(options.body ?? validBody()),
  });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-voice-intent-api-'));
  accounts = new FileAccounts(new AccountStore(directory));
  const router = new ApiRouter({
    store: accounts,
    secure: false,
    health: null,
    siteOrigin: SITE_ORIGIN,
    voiceIntent: (...args) => {
      planCalls += 1;
      return planVoiceIntent(...args);
    },
    now: () => now,
  });
  server = createServer((incoming, response) => {
    const path = new URL(incoming.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(incoming, response, path).then((handled) => {
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

describe('authenticated voice intent API', () => {
  it('requires exact origin, a valid session, and matching CSRF while never caching denials', async () => {
    const alice = await identity('intent-access-alice@example.com');

    const missingOrigin = await request(alice, { origin: null });
    expect(missingOrigin.status).toBe(403);
    expect(missingOrigin.headers.get('cache-control')).toBe('no-store, private');
    expect((await request(alice, { origin: `${SITE_ORIGIN}/path` })).status).toBe(403);
    expect((await request(alice, { origin: 'https://lacuna.example.evil.test' })).status).toBe(403);
    expect((await request(null)).status).toBe(401);
    expect((await request(alice, { csrf: false })).status).toBe(403);

    const accepted = await request(alice);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get('cache-control')).toBe('no-store, private');
  });

  it('rejects a missing, malformed, or different current-session binding before planning', async () => {
    const alice = await identity('intent-binding-alice@example.com');
    const bob = await identity('intent-binding-bob@example.com');
    const before = planCalls;

    for (const binding of [null, '', 'A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64), alice.binding]) {
      const denied = await request(bob, { binding });
      expect(denied.status).toBe(401);
      await expect(denied.json()).resolves.toEqual({ error: 'voice_binding' });
    }
    expect(planCalls).toBe(before);

    expect((await request(bob)).status).toBe(200);
    expect(planCalls).toBe(before + 1);
  });

  it('accepts only the exact versioned bounded body and canonical route and request id', async () => {
    const alice = await identity('intent-validation-alice@example.com');
    const invalidBodies: readonly unknown[] = [
      { ...validBody(), version: 2 },
      { requestId: REQUEST_ID, transcript: 'what changed?', currentRoute: '/app/dash' },
      { ...validBody(), requestId: '123E4567-E89B-42D3-A456-426614174000' },
      { ...validBody(), requestId: '123e4567-e89b-12d3-a456-426614174000' },
      { ...validBody(), requestId: 'voice-request-1' },
      { ...validBody(), transcript: 7 },
      { ...validBody(), transcript: 'x'.repeat(1_001) },
      { ...validBody(), currentRoute: '/app/not-a-route' },
      { ...validBody(), currentRoute: '/app/dash/' },
      { ...validBody(), currentRoute: '/app/dash?workspace=forged' },
      { ...validBody(), workspace: 'another-account' },
      { ...validBody(), collection: 'public' },
    ];

    for (const body of invalidBodies) {
      const response = await request(alice, { body });
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({ error: 'voice_intent' });
    }
  });

  it('plans from authenticated route scope without serializing account or collection identity', async () => {
    const alice = await identity('intent-scope-alice@example.com');
    const bob = await identity('intent-scope-bob@example.com');
    const aliceResponse = await request(alice, { body: validBody('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') });
    const bobResponse = await request(bob, { body: validBody('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') });
    const alicePlan = await aliceResponse.json() as Record<string, unknown>;
    const bobPlan = await bobResponse.json() as Record<string, unknown>;

    expect(aliceResponse.status).toBe(200);
    expect(bobResponse.status).toBe(200);
    expect({ ...alicePlan, requestId: null }).toEqual({ ...bobPlan, requestId: null });
    expect(Object.keys(alicePlan).sort()).toEqual([
      'available', 'display', 'effect', 'operation', 'reason', 'requestId',
      'requiresConfirmation', 'version',
    ]);
    const serialized = JSON.stringify([alicePlan, bobPlan]);
    expect(serialized).not.toContain(alice.email);
    expect(serialized).not.toContain(bob.email);
    expect(serialized).not.toContain(workspaceCollection(alice.email));
    expect(serialized).not.toContain(workspaceCollection(bob.email));

    const publicMutation = await request(alice, {
      body: {
        ...validBody('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
        transcript: 'remember Never publish this.',
        currentRoute: '/explore/dash',
      },
    });
    await expect(publicMutation.json()).resolves.toMatchObject({
      requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      effect: 'write',
      available: false,
      reason: 'public_read_only',
    });
  });

  it('rate limits planning per authenticated workspace rather than source address', async () => {
    const alice = await identity('intent-rate-alice@example.com');
    const bob = await identity('intent-rate-bob@example.com');

    for (let count = 0; count < 30; count += 1) {
      const requestId = `00000000-0000-4000-8000-${count.toString(16).padStart(12, '0')}`;
      expect((await request(alice, { body: validBody(requestId) })).status).toBe(200);
    }
    const limited = await request(alice, {
      body: validBody('00000000-0000-4000-8000-000000000030'),
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    await expect(limited.json()).resolves.toEqual({ error: 'workspace_voice_intent_budget' });

    expect((await request(bob, {
      body: validBody('00000000-0000-4000-8000-000000000031'),
    })).status).toBe(200);
  });
});
