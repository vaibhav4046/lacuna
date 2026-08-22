import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { GOOGLE_PROVIDER_TIMEOUT_MS, identityFromCode } from '../../src/auth/google.js';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';
import { AccountStore, newSessionVersion } from '../../src/auth/store.js';

const CONFIG = {
  clientId: 'client-under-test.apps.googleusercontent.com',
  clientSecret: 'not-a-real-secret',
  redirectUri: 'https://lacuna-five.vercel.app/api/auth/google/callback',
};
const nativeFetch = globalThis.fetch.bind(globalThis);
const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = {
  ...pair.publicKey.export({ format: 'jwk' }), kid: 'google-api-test-key', alg: 'RS256', use: 'sig',
};

let server: Server;
let base: string;
let directory: string;
let store: AccountStore;

function cookies(response: Response): Record<string, string> {
  const held: Record<string, string> = {};
  for (const line of response.headers.getSetCookie()) {
    const pair = line.split(';')[0];
    const separator = pair?.indexOf('=') ?? -1;
    if (pair !== undefined && separator > 0) held[pair.slice(0, separator)] = decodeURIComponent(pair.slice(separator + 1));
  }
  return held;
}

function cookieHeader(held: Readonly<Record<string, string>>): string {
  return Object.entries(held).map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
}

function oauthCookie(held: Readonly<Record<string, string>>, prefix: string): string | undefined {
  return Object.entries(held).find(([name]) => name.startsWith(`${prefix}_`))?.[1];
}

function oauthAttempt(held: Readonly<Record<string, string>>): {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
} | null {
  const raw = oauthCookie(held, 'lacuna_google_attempt');
  if (raw === undefined) return null;
  return JSON.parse(raw) as { readonly state: string; readonly codeVerifier: string; readonly nonce: string };
}

function idToken(payload: Readonly<Record<string, unknown>>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  const input = `${part({ alg: 'RS256', kid: 'google-api-test-key' })}.${part(payload)}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input, 'ascii'), pair.privateKey).toString('base64url')}`;
}

async function start(): Promise<Response> {
  return nativeFetch(`${base}/api/auth/google/start`, { redirect: 'manual' });
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-google-api-'));
  store = new AccountStore(directory);
  const router = new ApiRouter({
    store: new FileAccounts(store),
    secure: true,
    health: null,
    google: CONFIG,
    legacyGoogleMigrationEmail: '  MIGRATE@example.com ',
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
  vi.unstubAllGlobals();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('Google OAuth HTTP boundary', () => {
  it('starts with state, PKCE S256, nonce, hardened cookies and a non-cacheable redirect', async () => {
    const response = await start();
    const location = new URL(response.headers.get('location') ?? '');
    const held = cookies(response);
    const attempt = oauthAttempt(held);

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('state')).toBe(attempt?.state);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toBe(
      createHash('sha256').update(attempt?.codeVerifier ?? '', 'utf8').digest('base64url'),
    );
    expect(location.searchParams.get('nonce')).toBe(attempt?.nonce);
    expect(attempt?.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(attempt?.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.getSetCookie()).toHaveLength(1);
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it('bounds repeated Google starts before proof cookies can accumulate', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await start();
      expect(new URL(response.headers.get('location') ?? '').origin).toBe('https://accounts.google.com');
    }

    const blocked = await start();
    expect(blocked.status).toBe(302);
    expect(blocked.headers.get('location')).toBe('/signin?google=rate');
    expect(blocked.headers.getSetCookie()).toHaveLength(0);
  });

  it('fails before exchange when state is wrong', async () => {
    const begun = await start();
    const response = await nativeFetch(`${base}/api/auth/google/callback?state=wrong&code=unused`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(cookies(begun)) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=state');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });

  it('rejects oversized callback proofs before hashing or contacting Google', async () => {
    const begun = await start();
    const held = cookies(begun);
    const attempt = oauthAttempt(held);
    if (attempt === null) throw new Error('OAuth proof missing');
    const provider = vi.fn(async () => { throw new Error('provider must not be called'); });
    vi.stubGlobal('fetch', provider);

    const stateResponse = await nativeFetch(`${base}/api/auth/google/callback?state=${'a'.repeat(44)}&code=unused`, {
      redirect: 'manual', headers: { cookie: cookieHeader(held) },
    });
    expect(stateResponse.headers.get('location')).toBe('/signin?google=state');

    const codeResponse = await nativeFetch(
      `${base}/api/auth/google/callback?state=${encodeURIComponent(attempt.state)}&code=${'c'.repeat(2_049)}`,
      { redirect: 'manual', headers: { cookie: cookieHeader(held) } },
    );
    expect(codeResponse.headers.get('location')).toBe('/signin?google=code');
    expect(provider).not.toHaveBeenCalled();
  });

  it('bounds a stalled token or key provider call and fails with a stable auth error', async () => {
    vi.useFakeTimers();
    const provider = (async (_input: string | URL, init?: RequestInit) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('timed out', 'TimeoutError')), { once: true });
    })) as unknown as typeof fetch;
    const request = identityFromCode(CONFIG, 'one-time-code', provider);
    await vi.advanceTimersByTimeAsync(GOOGLE_PROVIDER_TIMEOUT_MS);
    await expect(request).rejects.toThrow('the Google provider timed out');
  });

  it('checks state before accepting a forged provider cancellation', async () => {
    const begun = await start();
    const response = await nativeFetch(`${base}/api/auth/google/callback?state=forged&error=access_denied`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(cookies(begun)) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=state');
  });

  it('keeps overlapping Google sign-in attempts independently valid', async () => {
    const first = await start();
    const second = await start();
    const firstHeld = cookies(first);
    const secondHeld = cookies(second);
    const firstAttempt = oauthAttempt(firstHeld);
    const secondAttempt = oauthAttempt(secondHeld);
    if (firstAttempt === null || secondAttempt === null) throw new Error('OAuth proof missing');

    // A person can double-click, use two tabs, or return from the older Google
    // chooser after opening a newer one. The newer response must not erase the
    // proof needed by the older, otherwise a legitimate callback is rejected
    // before its authorization code is even checked.
    const held = { ...firstHeld, ...secondHeld };
    const tokenBodies: string[] = [];
    const providerFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      const body = String(init?.body ?? '');
      tokenBodies.push(body);
      const verifier = new URLSearchParams(body).get('code_verifier');
      const nonce = verifier === firstAttempt.codeVerifier ? firstAttempt.nonce : secondAttempt.nonce;
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'overlap-subject',
        email: 'overlap@example.com',
        email_verified: true,
        nonce,
      }) });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', providerFetch);

    const firstResponse = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(firstAttempt.state)}&code=first-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });
    const secondResponse = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(secondAttempt.state)}&code=second-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });

    expect(firstResponse.headers.get('location')).toBe('/onboarding');
    expect(secondResponse.headers.get('location')).toBe('/onboarding');
    expect(tokenBodies[0]).toContain(`code_verifier=${firstAttempt.codeVerifier}`);
    expect(tokenBodies[1]).toContain(`code_verifier=${secondAttempt.codeVerifier}`);
    const firstCookieName = Object.keys(firstHeld)[0];
    const secondCookieName = Object.keys(secondHeld)[0];
    expect(firstResponse.headers.getSetCookie().some((cookie) => cookie.startsWith(`${firstCookieName}=`))).toBe(true);
    expect(firstResponse.headers.getSetCookie().some((cookie) => cookie.startsWith(`${secondCookieName}=`))).toBe(false);
  });

  it('does not merge a verified Google email into a password-owned account', async () => {
    // This is the operator-allowlisted address. The allowlist must never
    // override an explicit password-provider binding.
    const email = 'migrate@example.com';
    const account = {
      email,
      passwordHash: 'not-a-real-hash',
      authProvider: 'password' as const,
      providerSubject: null,
      sessionVersion: newSessionVersion(),
      createdAt: '2026-08-20T00:00:00.000Z',
      workspace: null,
      onboarded: false,
      recoveryHash: 'not-a-real-recovery-hash',
    };
    expect(store.create(account)).not.toBeNull();

    const begun = await start();
    const held = cookies(begun);
    const attempt = oauthAttempt(held);
    const state = attempt?.state;
    const nonce = attempt?.nonce;
    const verifier = attempt?.codeVerifier;
    if (state === undefined || nonce === undefined || verifier === undefined) throw new Error('OAuth proof missing');
    let tokenBody = '';
    const providerFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      tokenBody = String(init?.body ?? '');
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'google-subject-123',
        email,
        email_verified: true,
        nonce,
      }) });
    }) as unknown as typeof fetch;
    vi.stubGlobal('fetch', providerFetch);

    const response = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=one-time-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });

    expect(tokenBody).toContain(`code_verifier=${verifier}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=provider_mismatch');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(false);
    const attemptCookieName = Object.keys(held)[0];
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith(`${attemptCookieName}=`) && cookie.includes('Max-Age=0'))).toBe(true);
    expect(store.find(email)).toEqual(account);
  });

  it('migrates only the explicitly allowlisted legacy account after verified Google OAuth', async () => {
    const email = 'migrate@example.com';
    const legacyPassword = 'legacy password under test';
    const sessionVersion = newSessionVersion();
    expect(store.create({
      email,
      passwordHash: await hashPassword(legacyPassword),
      sessionVersion,
      createdAt: '2026-08-01T00:00:00.000Z',
      workspace: 'Legacy workspace',
      onboarded: true,
      recoveryHash: 'legacy-recovery-hash',
    })).not.toBeNull();
    const oldSession = store.startSession(email, Date.now(), sessionVersion);

    const begun = await start();
    const held = cookies(begun);
    const attempt = oauthAttempt(held);
    if (attempt === null) throw new Error('OAuth proof missing');
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'migrated-google-subject',
        email,
        email_verified: true,
        nonce: attempt.nonce,
      }) });
    }) as unknown as typeof fetch);

    const response = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(attempt.state)}&code=one-time-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app/dash');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(true);
    const migrated = store.find(email);
    expect(migrated).toMatchObject({
      email,
      authProvider: 'google',
      providerSubject: 'migrated-google-subject',
      recoveryHash: null,
      workspace: 'Legacy workspace',
      onboarded: true,
    });
    expect(migrated?.sessionVersion).not.toBe(sessionVersion);
    expect(await verifyPassword(legacyPassword, migrated?.passwordHash ?? '')).toBe(false);
    expect(store.sessionFor(oldSession, Date.now())).toBeNull();
  });

  it('refuses an allowlisted legacy row that already carries a provider subject', async () => {
    const email = 'migrate@example.com';
    const partial = {
      email,
      passwordHash: await hashPassword('legacy password under test'),
      providerSubject: 'partially-bound-subject',
      sessionVersion: newSessionVersion(),
      createdAt: '2026-08-01T00:00:00.000Z',
      workspace: 'Legacy workspace',
      onboarded: true,
      recoveryHash: null,
    };
    expect(store.create(partial)).not.toBeNull();

    const begun = await start();
    const held = cookies(begun);
    const attempt = oauthAttempt(held);
    if (attempt === null) throw new Error('OAuth proof missing');
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'different-google-subject',
        email,
        email_verified: true,
        nonce: attempt.nonce,
      }) });
    }) as unknown as typeof fetch);

    const response = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(attempt.state)}&code=one-time-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=legacy_unbound');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(false);
    expect(store.find(email)).toEqual(partial);
  });

  it('keeps an unapproved legacy account fail-closed after verified Google OAuth', async () => {
    const email = 'not-approved@example.com';
    expect(store.create({
      email,
      passwordHash: await hashPassword('legacy password under test'),
      createdAt: '2026-08-01T00:00:00.000Z',
      workspace: null,
      onboarded: false,
    })).not.toBeNull();

    const begun = await start();
    const held = cookies(begun);
    const attempt = oauthAttempt(held);
    if (attempt === null) throw new Error('OAuth proof missing');
    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'unapproved-google-subject',
        email,
        email_verified: true,
        nonce: attempt.nonce,
      }) });
    }) as unknown as typeof fetch);

    const response = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(attempt.state)}&code=one-time-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=legacy_unbound');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(false);
    const unchanged = store.find(email);
    expect(unchanged?.authProvider).toBeUndefined();
    expect(unchanged?.providerSubject).toBeUndefined();
  });

  it('links Google only from the existing password session and rotates the old credential epoch', async () => {
    const email = 'link-me@example.com';
    const oldPassword = 'old password under test';
    const oldVersion = newSessionVersion();
    expect(store.create({
      email,
      passwordHash: await hashPassword(oldPassword),
      authProvider: 'password',
      providerSubject: null,
      sessionVersion: oldVersion,
      createdAt: '2026-08-01T00:00:00.000Z',
      workspace: 'Linked workspace',
      onboarded: true,
      recoveryHash: 'old-recovery-hash',
    })).not.toBeNull();
    const oldSession = store.startSession(email, Date.now(), oldVersion);
    const heldSession = { lacuna_session: oldSession };

    const begun = await nativeFetch(`${base}/api/auth/google/link/start`, {
      redirect: 'manual', headers: { cookie: cookieHeader(heldSession) },
    });
    expect(new URL(begun.headers.get('location') ?? '').origin).toBe('https://accounts.google.com');
    const held = { ...heldSession, ...cookies(begun) };
    const attempt = oauthAttempt(held);
    if (attempt === null) throw new Error('link proof missing');

    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'linked-google-subject',
        email,
        email_verified: true,
        nonce: attempt.nonce,
      }) });
    }) as unknown as typeof fetch);

    const response = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(attempt.state)}&code=link-code`, {
      redirect: 'manual', headers: { cookie: cookieHeader(held) },
    });

    expect(response.headers.get('location')).toBe('/app/settings?google=linked');
    const linked = store.find(email);
    expect(linked).toMatchObject({
      authProvider: 'google', providerSubject: 'linked-google-subject', recoveryHash: null,
      workspace: 'Linked workspace', onboarded: true,
    });
    expect(linked?.sessionVersion).not.toBe(oldVersion);
    expect(await verifyPassword(oldPassword, linked?.passwordHash ?? '')).toBe(false);
    expect(store.sessionFor(oldSession, Date.now())).toBeNull();
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(true);
  });

  it('does not start a Google link from a signed-out browser', async () => {
    const response = await nativeFetch(`${base}/api/auth/google/link/start`, { redirect: 'manual' });
    expect(response.headers.get('location')).toBe('/signin?google=link_session');
  });

});
