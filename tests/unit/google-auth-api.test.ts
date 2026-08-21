import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { FileAccounts } from '../../src/auth/accounts.js';
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
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
    const email = 'person@example.com';
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
    expect(store.find(email)).toMatchObject({ authProvider: 'password', providerSubject: null });
  });

});
