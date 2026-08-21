import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { DEMO_WORKSPACE } from '../../src/api/workspace.js';
import { AccountStore, newSessionVersion, type Account, type SessionRecord } from '../../src/auth/store.js';
import { FileAccounts, type Accounts } from '../../src/auth/accounts.js';
import { buildDemo } from '../../src/server/examples.js';

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
let accounts: RotatingAccounts;
/**
 * The router's clock. Sign up is limited to three a minute per address and
 * every test here comes from 127.0.0.1, so a suite that did not move the clock
 * would start getting 429s partway through and the failures would look like
 * bugs in whatever test happened to be sixth.
 */
let clock = Date.UTC(2026, 0, 1);

/** Deterministically rotates credentials inside the verify-to-issue gap. */
class RotatingAccounts implements Accounts {
  readonly #delegate: Accounts;
  #rotateBeforeStart = false;
  #rotateAfterSessionValidation = false;

  constructor(delegate: Accounts) {
    this.#delegate = delegate;
  }

  rotateBeforeNextSession(): void {
    this.#rotateBeforeStart = true;
  }

  rotateAfterNextSessionValidation(): void {
    this.#rotateAfterSessionValidation = true;
  }

  available(): Promise<boolean> { return this.#delegate.available(); }
  find(email: string): Promise<Account | null> { return this.#delegate.find(email); }
  create(account: Account): Promise<Account | null> { return this.#delegate.create(account); }
  update(account: Account): Promise<void> { return this.#delegate.update(account); }
  updateWorkspace(email: string, workspace: string): Promise<void> {
    return this.#delegate.updateWorkspace(email, workspace);
  }
  async sessionFor(token: string, now: number): Promise<SessionRecord | null> {
    const record = await this.#delegate.sessionFor(token, now);
    if (this.#rotateAfterSessionValidation && record !== null) {
      this.#rotateAfterSessionValidation = false;
      const account = await this.#delegate.find(record.email);
      if (account !== null) {
        await this.#delegate.update({ ...account, sessionVersion: newSessionVersion() });
      }
    }
    return record;
  }
  endSession(token: string): Promise<void> { return this.#delegate.endSession(token); }

  async startSession(
    email: string,
    now: number,
    expectedSessionVersion: string | undefined,
  ): Promise<string> {
    if (this.#rotateBeforeStart) {
      this.#rotateBeforeStart = false;
      const account = await this.#delegate.find(email);
      if (account !== null) {
        await this.#delegate.update({ ...account, sessionVersion: newSessionVersion() });
      }
    }
    return this.#delegate.startSession(email, now, expectedSessionVersion);
  }
}

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
  accounts = new RotatingAccounts(new FileAccounts(new AccountStore(dir)));
  const router = new ApiRouter({
    store: accounts,
    secure: false,
    health: async () => ({ command: 'doctor', ok: true, warnings: 0, exitCode: 0, checks: [] }),
    inventory: buildDemo().inventory,
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

  it('rejects a session whose credential epoch changes before the account is returned', async () => {
    nextMinute();
    const jar = await primed();
    expect((await post(jar, '/api/auth/signup', {
      email: 'session-epoch@example.com', password: PASSWORD,
    })).status).toBe(201);
    accounts.rotateAfterNextSessionValidation();

    const response = await session(jar);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ signedIn: false });
  });
});

describe('credential epoch authorization', () => {
  it('does not authorize a private route from an account read after session rotation', async () => {
    nextMinute();
    const jar = await primed();
    expect((await post(jar, '/api/auth/signup', {
      email: 'private-epoch@example.com', password: PASSWORD,
    })).status).toBe(201);
    accounts.rotateAfterNextSessionValidation();

    const response = await fetch(url('/api/workspace/graph'), {
      headers: { cookie: jar.header() },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'session' });
  });

  it('does not build a workspace view from an account read after session rotation', async () => {
    nextMinute();
    const jar = await primed();
    const email = 'view-epoch@example.com';
    expect((await post(jar, '/api/auth/signup', { email, password: PASSWORD })).status).toBe(201);
    await accounts.updateWorkspace(email, DEMO_WORKSPACE);
    accounts.rotateAfterNextSessionValidation();

    const response = await fetch(url('/api/workspace/memory'), {
      headers: { cookie: jar.header() },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ rows: [], total: 0, loaded: 0, demo: false });
  });

  it('does not let a stale credential epoch mutate workspace metadata', async () => {
    nextMinute();
    const jar = await primed();
    const email = 'workspace-mutation-epoch@example.com';
    expect((await post(jar, '/api/auth/signup', { email, password: PASSWORD })).status).toBe(201);
    accounts.rotateAfterNextSessionValidation();

    const response = await post(jar, '/api/workspace', { workspace: 'Must not be written' });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'session' });
    await expect(accounts.find(email)).resolves.toMatchObject({ workspace: null, onboarded: false });
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

  it('fails closed when recovery rotates credentials after verification but before session issue', async () => {
    nextMinute();
    const jar = await primed();
    accounts.rotateBeforeNextSession();

    const response = await post(jar, '/api/auth/signin', { email: 'new@example.com', password: PASSWORD });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'credentials' });
    expect(response.headers.getSetCookie().some((line) => line.startsWith('lacuna_session='))).toBe(false);
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
    const token = store.startSession(
      'persist@example.com',
      Date.now(),
      store.find('persist@example.com')?.sessionVersion,
    );

    const reopened = new AccountStore(dir);

    expect(reopened.sessionFor(token, Date.now())).not.toBeNull();
    expect(JSON.stringify([...Object.values(reopened)])).not.toContain(token);
  });
});

/**
 * The way back into an account, for a deployment with nowhere to send email.
 *
 * The reset route still answers 501 and still should: nothing sends mail, and a
 * 204 there would report a link that was never sent. What is new is that 501 is
 * no longer the end of the road.
 *
 * What matters most here is what recovery refuses. It is a credential that
 * resets a password without a second channel, so an unknown address, an account
 * with no code, and a wrong code all have to look identical from outside, or it
 * becomes a way to ask which addresses have accounts.
 */
describe('recovery codes', () => {
  const EMAIL = 'recover@example.com';
  const NEXT = 'a-completely-different-password';
  let code = '';
  let sessionBeforeRecovery = '';

  it('are issued once when the account is created', async () => {
    const jar = await primed();
    const response = await post(jar, '/api/auth/signup', { email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(201);

    const body = await response.json() as { signedIn: boolean; recoveryCode?: string };
    expect(body.signedIn).toBe(true);
    expect(typeof body.recoveryCode).toBe('string');
    // Twenty characters in four groups of five, which is what the screen shows.
    expect(body.recoveryCode).toMatch(/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/);
    code = body.recoveryCode ?? '';
    sessionBeforeRecovery = jar.get('lacuna_session') ?? '';
  });

  it('are never returned again', async () => {
    const jar = await primed();
    await post(jar, '/api/auth/signin', { email: EMAIL, password: PASSWORD });
    const response = await session(jar);
    expect(JSON.stringify(await response.json())).not.toContain(code.slice(0, 5));
  });

  it('still refuse to pretend an email was sent', async () => {
    const jar = await primed();
    const response = await post(jar, '/api/auth/reset', { email: EMAIL });
    expect(response.status).toBe(501);
  });

  it('refuse a wrong code', async () => {
    const jar = await primed();
    const response = await post(jar, '/api/auth/recover', {
      email: EMAIL, code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', password: NEXT,
    });
    expect(response.status).toBe(401);
  });

  it('answer an unknown address exactly as they answer a wrong code', async () => {
    const jar = await primed();
    const wrongCode = await post(jar, '/api/auth/recover', {
      email: EMAIL, code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', password: NEXT,
    });
    const noAccount = await post(jar, '/api/auth/recover', {
      email: 'nobody-at-all@example.com', code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', password: NEXT,
    });
    // Same status and same body. A difference here is a way to ask which
    // addresses have accounts.
    expect(noAccount.status).toBe(wrongCode.status);
    expect(await noAccount.json()).toEqual(await wrongCode.json());
  });

  it('refuse a new password that is too short, before checking the code', async () => {
    const jar = await primed();
    const response = await post(jar, '/api/auth/recover', {
      email: EMAIL, code, password: 'eleven chr',
    });
    expect(response.status).toBe(422);
  });

  it('accept the code however it was written down', async () => {
    const jar = await primed();
    // Lower case, spaces instead of dashes. Somebody copied it off a note.
    const written = code.toLowerCase().replace(/-/g, ' ');
    const response = await post(jar, '/api/auth/recover', { email: EMAIL, code: written, password: NEXT });
    expect(response.status).toBe(200);

    const body = await response.json() as { signedIn: boolean; recoveryCode?: string };
    expect(body.signedIn).toBe(true);
    // Spent, and replaced in the same breath, so nobody is left without one.
    expect(typeof body.recoveryCode).toBe('string');
    expect(body.recoveryCode).not.toBe(code);
    code = body.recoveryCode ?? '';
  });

  it('changed the password, rather than only saying so', async () => {
    const stale = await primed();
    expect((await post(stale, '/api/auth/signin', { email: EMAIL, password: PASSWORD })).status).toBe(401);

    const fresh = await primed();
    expect((await post(fresh, '/api/auth/signin', { email: EMAIL, password: NEXT })).status).toBe(200);
  });

  it('revoked every session minted before the credential recovery', async () => {
    expect(sessionBeforeRecovery).not.toBe('');
    const response = await fetch(url('/api/session'), {
      headers: { cookie: `lacuna_session=${sessionBeforeRecovery}` },
    });
    await expect(response.json()).resolves.toEqual({ signedIn: false });
  });

  it('refuse a code that has already been spent', async () => {
    const jar = await primed();
    // The one used above. Reusing it must not work, which is the whole reason
    // it is rotated rather than kept.
    const response = await post(jar, '/api/auth/recover', {
      email: EMAIL, code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', password: 'another-new-password-here',
    });
    expect(response.status).toBe(401);
  });
});
