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

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('pragma')).toBe('no-cache');
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('nonce')).toBe(held['lacuna_google_nonce']);
    expect(held['lacuna_google_state']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(held['lacuna_google_pkce']).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.getSetCookie()).toHaveLength(3);
    for (const cookie of response.headers.getSetCookie()) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
  });

  it('clears every transient cookie and fails before exchange when state is wrong', async () => {
    const begun = await start();
    const response = await nativeFetch(`${base}/api/auth/google/callback?state=wrong&code=unused`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(cookies(begun)) },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/signin?google=state');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.getSetCookie()).toHaveLength(3);
    for (const cookie of response.headers.getSetCookie()) expect(cookie).toContain('Max-Age=0');
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
    const state = held['lacuna_google_state'];
    const nonce = held['lacuna_google_nonce'];
    const verifier = held['lacuna_google_pkce'];
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
    expect(response.headers.get('location')).toBe('/signin?google=identity');
    expect(response.headers.getSetCookie().some((cookie) => cookie.startsWith('lacuna_session='))).toBe(false);
    expect(store.find(email)).toMatchObject({ authProvider: 'password', providerSubject: null });
  });

  it('lets a Google-authenticated account add a password and recovery code without changing its provider binding', async () => {
    const email = 'google-owner@example.com';
    const begun = await start();
    const held = cookies(begun);
    const state = held['lacuna_google_state'];
    const nonce = held['lacuna_google_nonce'];
    if (state === undefined || nonce === undefined) throw new Error('OAuth proof missing');

    vi.stubGlobal('fetch', (async (input: string | URL | Request) => {
      if (String(input) === 'https://www.googleapis.com/oauth2/v3/certs') {
        return Response.json({ keys: [publicJwk] }, { headers: { 'cache-control': 'max-age=3600' } });
      }
      return Response.json({ id_token: idToken({
        aud: CONFIG.clientId,
        iss: 'https://accounts.google.com',
        exp: Math.floor(Date.now() / 1_000) + 600,
        sub: 'google-password-owner',
        email,
        email_verified: true,
        nonce,
      }) });
    }) as unknown as typeof fetch);

    const callback = await nativeFetch(`${base}/api/auth/google/callback?state=${encodeURIComponent(state)}&code=one-time-code`, {
      redirect: 'manual',
      headers: { cookie: cookieHeader(held) },
    });
    const sessionHeld = cookies(callback);
    expect(sessionHeld['lacuna_session']).toBeTypeOf('string');

    const session = await nativeFetch(`${base}/api/session`, {
      headers: { cookie: cookieHeader(sessionHeld) },
    });
    Object.assign(sessionHeld, cookies(session));
    const csrf = sessionHeld['lacuna_csrf'];
    if (csrf === undefined) throw new Error('CSRF token missing');

    const configured = await nativeFetch(`${base}/api/auth/password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: cookieHeader(sessionHeld),
        'x-csrf-token': csrf,
      },
      body: JSON.stringify({ password: 'a-secure-password-for-lacuna' }),
    });

    expect(configured.status).toBe(200);
    await expect(configured.json()).resolves.toMatchObject({
      signedIn: true,
      recoveryCode: expect.stringMatching(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/),
    });
    expect(store.find(email)).toMatchObject({
      authProvider: 'google',
      providerSubject: 'google-password-owner',
      recoveryHash: expect.stringContaining('$argon2id$'),
    });
  });
});
