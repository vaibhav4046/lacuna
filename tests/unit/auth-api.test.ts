import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { AccountStore } from '../../src/auth/store.js';
import { FileAccounts } from '../../src/auth/accounts.js';

/**
 * The auth surface, driven over a real socket.
 *
 * Cookies, the CSRF double submit and the httpOnly flag are all things a
 * function call cannot check, because they only exist as headers. So this
 * starts the router behind a real server and talks to it with fetch, which is
 * what a browser will do. The store gets a temporary directory per run and it
 * is removed afterwards, so no test leaves an account behind.
 */

const PASSWORD = 'correct horse battery';

let server: Server;
let base: string;
let dir: string;
/**
 * The router's clock. Sign up is limited to three a minute per address and
 * every test here comes from 127.0.0.1, so a suite that did not move the clock
 * would start getting 429s partway through and the failures would look like
 * bugs in whatever test happened to be sixth.
 */
let clock = Date.UTC(2026, 0, 1);

/** Past the rate limit window, so the next request starts a fresh bucket. */
function nextMinute(): void {
  clock += 61_000;
}

function url(path: string): string {
  return `${base}${path}`;
}

/** Every cookie the server has set so far, in the header form a browser sends. */
class Jar {
  readonly #values = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      if (pair === undefined) continue;
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '') this.#values.delete(name);
      else this.#values.set(name, value);
    }
  }

  header(): string {
    return [...this.#values].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.#values.get(name);
  }
}

async function session(jar: Jar): Promise<Response> {
  const response = await fetch(url('/api/session'), { headers: { cookie: jar.header() } });
  jar.absorb(response);
  return response;
}

async function post(jar: Jar, path: string, body: unknown, options: { csrf?: string } = {}): Promise<Response> {
  const token = options.csrf ?? jar.get('lacuna_csrf') ?? '';
  const headers: Record<string, string> = { 'content-type': 'application/json', cookie: jar.header() };
  if (token !== '') headers['x-csrf-token'] = decodeURIComponent(token);
  const response = await fetch(url(path), { method: 'POST', headers, body: JSON.stringify(body) });
  jar.absorb(response);
  return response;
}

/** A jar that has been given a CSRF token, which is what a loaded page has. */
async function primed(): Promise<Jar> {
  const jar = new Jar();
  await session(jar);
  return jar;
}

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'lacuna-auth-'));
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(dir)),
    secure: false,
    health: async () => ({ command: 'doctor', ok: true, warnings: 0, exitCode: 0, checks: [] }),
    now: () => clock,
  });
  server = createServer((request, response) => {
    void (async () => {
      const path = new URL(request.url ?? '/', 'http://test.invalid').pathname;
      const outcome = await router.handle(request, response, path);
      if (!outcome.handled) { response.writeHead(404); response.end(); }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('the session endpoint', () => {
  it('answers signed out with a 200 and a CSRF cookie, not with a 401', async () => {
    const jar = new Jar();
    const response = await session(jar);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
    expect(jar.get('lacuna_csrf')).toBeTypeOf('string');
  });

  it('does not mint a second CSRF token when the page already has one', async () => {
    const jar = await primed();
    const first = jar.get('lacuna_csrf');

    const response = await session(jar);

    expect(response.headers.getSetCookie()).toEqual([]);
    expect(jar.get('lacuna_csrf')).toBe(first);
  });
});

describe('sign up', () => {
  it('refuses without the double submit token', async () => {
    const jar = await primed();

    const response = await post(jar, '/api/auth/signup', { email: 'a@example.com', password: PASSWORD }, { csrf: 'not-the-token' });

    expect(response.status).toBe(403);
  });

  it('refuses a password under the minimum', async () => {
    nextMinute();
    const jar = await primed();

    const response = await post(jar, '/api/auth/signup', { email: 'short@example.com', password: 'eleven chr' });

    expect(response.status).toBe(422);
  });

  it('refuses something that is not an email address', async () => {
    const jar = await primed();

    const response = await post(jar, '/api/auth/signup', { email: 'not-an-email', password: PASSWORD });

    expect(response.status).toBe(400);
  });

  it('creates the account, signs the person in, and sets an httpOnly cookie', async () => {
    nextMinute();
    const jar = await primed();

    const response = await post(jar, '/api/auth/signup', { email: 'new@example.com', password: PASSWORD });

    expect(response.status).toBe(201);
    const cookie = response.headers.getSetCookie().find((line) => line.startsWith('lacuna_session='));
    expect(cookie).toBeTypeOf('string');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Not Secure: this server is plain HTTP, and marking it Secure would mean
    // the browser never sends it back, which is a broken sign in rather than a
    // stronger one.
    expect(cookie).not.toContain('Secure');

    await expect((await session(jar)).json()).resolves.toEqual({
      signedIn: true,
      session: { email: 'new@example.com', workspace: null, onboarded: false },
    });
  });

  it('reports a taken address as a conflict', async () => {
    nextMinute();
    const jar = await primed();

    const response = await post(jar, '/api/auth/signup', { email: 'new@example.com', password: PASSWORD });

    expect(response.status).toBe(409);
  });
});

describe('sign in', () => {
  it('rejects the wrong password', async () => {
    const jar = await primed();

    const response = await post(jar, '/api/auth/signin', { email: 'new@example.com', password: 'a different one' });

    expect(response.status).toBe(401);
  });

  it('rejects an address with no account with the same status as a wrong password', async () => {
    const jar = await primed();

    const response = await post(jar, '/api/auth/signin', { email: 'nobody@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
  });

  it('accepts the right password and returns a session', async () => {
    nextMinute();
    const jar = await primed();

    const response = await post(jar, '/api/auth/signin', { email: 'new@example.com', password: PASSWORD });

    expect(response.status).toBe(200);
    await expect((await session(jar)).json()).resolves.toMatchObject({ signedIn: true });
  });

  it('stops answering after six attempts in a window', async () => {
    nextMinute();
    const jar = await primed();
    const codes: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      codes.push((await post(jar, '/api/auth/signin', { email: 'flood@example.com', password: PASSWORD })).status);
    }

    expect(codes).toContain(429);
    expect(codes.filter((code) => code === 401).length).toBeLessThanOrEqual(6);
  });
});

describe('sign out', () => {
  it('ends the session and clears the cookie', async () => {
    nextMinute();
    const jar = await primed();
    expect((await post(jar, '/api/auth/signup', { email: 'bye@example.com', password: PASSWORD })).status).toBe(201);
    await expect((await session(jar)).json()).resolves.toMatchObject({ signedIn: true });

    const response = await post(jar, '/api/auth/signout', {});

    expect(response.status).toBe(204);
    await expect((await session(jar)).json()).resolves.toEqual({ signedIn: false });
  });
});

describe('password reset', () => {
  it('says it is not configured rather than reporting a link nobody sent', async () => {
    const jar = await primed();

    const response = await post(jar, '/api/auth/reset', { email: 'new@example.com' });

    expect(response.status).toBe(501);
  });
});

describe('the account store', () => {
  it('replays its log, so a restart keeps the accounts and the sessions', async () => {
    nextMinute();
    const jar = await primed();
    expect((await post(jar, '/api/auth/signup', { email: 'persist@example.com', password: PASSWORD })).status).toBe(201);

    const reopened = new AccountStore(dir);

    expect(reopened.find('persist@example.com')).not.toBeNull();
    expect(reopened.find('persist@example.com')?.passwordHash).toContain('$argon2id$');
    expect(reopened.find('persist@example.com')?.passwordHash).not.toContain(PASSWORD);
  });

  it('never stores the password or the session token', async () => {
    const store = new AccountStore(dir);
    const token = store.startSession('persist@example.com', Date.now());

    const reopened = new AccountStore(dir);

    expect(reopened.sessionFor(token, Date.now())).not.toBeNull();
    expect(JSON.stringify([...Object.values(reopened)])).not.toContain(token);
  });
});
