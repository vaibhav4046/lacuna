import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { hashPassword, MAX_PASSWORD_CHARS, MIN_PASSWORD_CHARS, verifyPassword } from '../auth/password.js';
import {
  BodyTooLarge,
  CSRF_COOKIE,
  SESSION_COOKIE,
  clearCookie,
  csrfOk,
  normaliseEmail,
  parseCookies,
  readJsonBody,
  serialiseCookie,
} from '../auth/http.js';
import { AccountStore, SESSION_TTL_MS, StoreUnavailable, mintToken } from '../auth/store.js';
import { FixedWindow } from '../server/ratelimit.js';
import { DEMO_WORKSPACE, askEnvelope, demoWorkspace, emptyWorkspace } from './workspace.js';
import type { WorkspaceView } from './workspace.js';
import type { HydraClient } from '../hydra/client.js';
import type { Inventory } from '../report/inventory.js';

/**
 * The JSON surface the React application talks to.
 *
 * Everything here answers JSON and nothing here renders HTML, which keeps it
 * disjoint from the page routes it sits beside. Sign in is rate limited per
 * source address; every mutation checks the double submit token; every response
 * that could vary by session is marked private so no cache in front of this
 * ever serves one person's session to another.
 *
 * Statuses carry the meaning. The bodies are empty or minimal on purpose,
 * because the client maps status to the sentence it shows and never prints
 * anything this file writes.
 */

/** Six attempts a minute per address is generous for a person and useless for a script. */
const SIGNIN_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };
/** A question should not sit behind a browser spinner for longer than this. */
const ASK_TIMEOUT_MS = 10_000;

/** A workspace name is a label, not an essay. */
const MAX_WORKSPACE_CHARS = 120;

/** Sign up is rarer and more expensive, so it is tighter. */
const SIGNUP_LIMIT = { limit: 3, windowMs: 60_000, maxKeys: 4_096 };

export interface ApiOptions {
  readonly store: AccountStore;
  /** True behind TLS. Marks both cookies Secure. */
  readonly secure: boolean;
  /** Runs the same checks `lacuna doctor` runs. Null when no node is configured. */
  readonly health: (() => Promise<unknown>) | null;
  /** The context store. Absent on a deployment that serves a snapshot. */
  readonly client?: HydraClient;
  /** The ingested corpus, which is what the demo workspace is made of. */
  readonly inventory?: Inventory;
  readonly now?: () => number;
}

interface Handled {
  readonly handled: boolean;
}

const HANDLED: Handled = { handled: true };
const NOT_HANDLED: Handled = { handled: false };

function send(response: ServerResponse, status: number, body: unknown, cookies: readonly string[] = []): void {
  const text = body === null ? '' : JSON.stringify(body);
  const headers: Record<string, string | string[]> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  };
  if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
  response.writeHead(status, headers);
  response.end(text);
}

/**
 * The address a rate limit key is built from. Behind a proxy this is the
 * socket, which is the proxy, so the forwarded header is used when present.
 * Only the first hop is read: the rest of that header is whatever the client
 * chose to put there.
 */
function sourceKey(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.trim() !== '') {
    const hop = first.split(',')[0];
    if (hop !== undefined && hop.trim() !== '') return hop.trim();
  }
  return request.socket.remoteAddress ?? 'unknown';
}

export class ApiRouter {
  readonly #store: AccountStore;
  readonly #secure: boolean;
  readonly #health: (() => Promise<unknown>) | null;
  readonly #client: HydraClient | undefined;
  readonly #inventory: Inventory | undefined;
  readonly #now: () => number;
  readonly #signinLimit = new FixedWindow(SIGNIN_LIMIT);
  readonly #signupLimit = new FixedWindow(SIGNUP_LIMIT);

  constructor(options: ApiOptions) {
    this.#store = options.store;
    this.#secure = options.secure;
    this.#health = options.health;
    this.#client = options.client;
    this.#inventory = options.inventory;
    this.#now = options.now ?? (() => Date.now());
  }

  /** Cookies to set alongside any response, so a page always has a CSRF token. */
  #csrfCookie(cookies: Readonly<Record<string, string>>): string[] {
    if (typeof cookies[CSRF_COOKIE] === 'string' && cookies[CSRF_COOKIE] !== '') return [];
    return [serialiseCookie(CSRF_COOKIE, mintToken(), {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      httpOnly: false,
      secure: this.#secure,
    })];
  }

  /**
   * What this session's workspace contains. Empty unless the workspace is the
   * one explicitly named as the demo, which is the only path that reaches the
   * ingested corpus.
   */
  #viewFor(cookies: Readonly<Record<string, string>>): WorkspaceView {
    const token = cookies[SESSION_COOKIE];
    const record = typeof token === 'string' && token !== ''
      ? this.#store.sessionFor(token, this.#now())
      : null;
    const account = record === null ? null : this.#store.find(record.email);
    if (account === null || account.workspace !== DEMO_WORKSPACE) return emptyWorkspace();
    const inventory = this.#inventory;
    return inventory === undefined ? emptyWorkspace() : demoWorkspace(inventory);
  }

  #sessionCookie(token: string): string {
    return serialiseCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      httpOnly: true,
      secure: this.#secure,
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<Handled> {
    if (!path.startsWith('/api/')) return NOT_HANDLED;

    const cookies = parseCookies(request.headers.cookie);
    const method = request.method ?? 'GET';

    if (path === '/api/session' && method === 'GET') {
      const token = cookies[SESSION_COOKIE];
      const record = typeof token === 'string' && token !== ''
        ? this.#store.sessionFor(token, this.#now())
        : null;
      const account = record === null ? null : this.#store.find(record.email);
      if (account === null) {
        send(response, 200, { signedIn: false }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      send(response, 200, {
        signedIn: true,
        session: { email: account.email, workspace: account.workspace, onboarded: account.onboarded },
      }, this.#csrfCookie(cookies));
      return HANDLED;
    }

    if (path === '/api/health' && method === 'GET') {
      if (this.#health === null) {
        send(response, 200, { command: 'doctor', ok: false, warnings: 0, exitCode: 3, checks: [] });
        return HANDLED;
      }
      send(response, 200, await this.#health());
      return HANDLED;
    }

    if (path.startsWith('/api/auth/')) {
      if (method !== 'POST') {
        send(response, 405, { error: 'method' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!this.#store.available) {
        send(response, 503, { error: 'store' });
        return HANDLED;
      }

      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }

      if (path === '/api/auth/signout') {
        const token = cookies[SESSION_COOKIE];
        if (typeof token === 'string' && token !== '') this.#store.endSession(token);
        send(response, 204, null, [clearCookie(SESSION_COOKIE, this.#secure)]);
        return HANDLED;
      }

      const email = normaliseEmail(body?.['email']);
      if (email === null) {
        send(response, 400, { error: 'email' });
        return HANDLED;
      }

      if (path === '/api/auth/reset') {
        // No mail transport is configured. Saying so is the whole point: a 204
        // here would report that a link was sent when nothing sends one.
        send(response, 501, { error: 'mail' });
        return HANDLED;
      }

      const password = body?.['password'];
      if (typeof password !== 'string' || password === '') {
        send(response, 400, { error: 'password' });
        return HANDLED;
      }

      if (path === '/api/auth/signup') return this.#signup(request, response, email, password);
      if (path === '/api/auth/signin') return this.#signin(request, response, email, password);
    }

    if (path.startsWith('/api/workspace/') && method === 'GET') {
      const view = this.#viewFor(cookies);
      const part = path.slice('/api/workspace/'.length);
      const body: unknown = part === 'changes' ? view.changes
        : part === 'conflicts' ? view.conflicts
          : part === 'connections' ? view.connections
            : part === 'runs' ? view.runs
              : part === 'health' ? view.health
                : part === 'memory' ? { rows: view.memory, total: view.memoryTotal, demo: view.demo }
                  : part === 'categories' ? view.categories
                    : part === 'questions' ? view.questions
                      : part === 'summary' ? view
                      // Nothing is configured for these yet, and an empty list
                      // is the honest answer rather than a 404 the screen would
                      // have to render as a failure.
                      : part === 'agents' || part === 'tools' || part === 'models' || part === 'evaluations' ? []
                        : null;
      if (body === null) {
        send(response, 404, { error: 'route' });
        return HANDLED;
      }
      send(response, 200, body);
      return HANDLED;
    }

    if (path === '/api/ask' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const client = this.#client;
      if (client === undefined) {
        send(response, 200, {
          status: 'SYSTEM_ERROR', answer: null, evidence: [], revisions: [], conflicts: [],
          abstain_reason: 'no context store is configured', context_pack_id: null,
          trace_id: '0x00000000', source_state: 'unavailable', took_ms: 0,
        });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const subject = body?.['subject'];
      const predicate = body?.['predicate'];
      const via = body?.['via'];
      if (typeof subject !== 'string' || typeof predicate !== 'string') {
        send(response, 400, { error: 'question' });
        return HANDLED;
      }
      send(response, 200, await askEnvelope(
        client, subject, predicate, typeof via === 'string' && via !== '' ? via : null, ASK_TIMEOUT_MS,
      ));
      return HANDLED;
    }

    if (path === '/api/workspace' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const token = cookies[SESSION_COOKIE];
      const record = typeof token === 'string' && token !== ''
        ? this.#store.sessionFor(token, this.#now())
        : null;
      const account = record === null ? null : this.#store.find(record.email);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }

      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const name = body?.['workspace'];
      if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_WORKSPACE_CHARS) {
        send(response, 400, { error: 'workspace' });
        return HANDLED;
      }

      try {
        this.#store.update({ ...account, workspace: name.trim(), onboarded: true });
        send(response, 204, null);
      } catch (error) {
        send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
      }
      return HANDLED;
    }

    send(response, 404, { error: 'route' });
    return HANDLED;
  }

  async #signup(request: IncomingMessage, response: ServerResponse, email: string, password: string): Promise<Handled> {
    const verdict = this.#signupLimit.check(sourceKey(request), this.#now());
    if (!verdict.allowed) {
      send(response, 429, { error: 'rate' });
      return HANDLED;
    }
    if (password.length < MIN_PASSWORD_CHARS || password.length > MAX_PASSWORD_CHARS) {
      send(response, 422, { error: 'password' });
      return HANDLED;
    }
    if (this.#store.find(email) !== null) {
      send(response, 409, { error: 'exists' });
      return HANDLED;
    }

    const now = this.#now();
    try {
      const created = this.#store.create({
        email,
        passwordHash: await hashPassword(password),
        createdAt: new Date(now).toISOString(),
        workspace: null,
        onboarded: false,
      });
      if (created === null) {
        send(response, 409, { error: 'exists' });
        return HANDLED;
      }
      const token = this.#store.startSession(email, now);
      send(response, 201, { signedIn: true }, [this.#sessionCookie(token)]);
    } catch (error) {
      send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
    }
    return HANDLED;
  }

  async #signin(request: IncomingMessage, response: ServerResponse, email: string, password: string): Promise<Handled> {
    const verdict = this.#signinLimit.check(sourceKey(request), this.#now());
    if (!verdict.allowed) {
      send(response, 429, { error: 'rate' }, []);
      return HANDLED;
    }

    const account = this.#store.find(email);
    // The hash runs even when there is no account, so the time this takes does
    // not answer the question "does this address have an account here".
    const stored = account?.passwordHash ?? await decoy();
    const ok = await verifyPassword(password, stored);
    if (account === null || !ok) {
      send(response, 401, { error: 'credentials' });
      return HANDLED;
    }

    try {
      const token = this.#store.startSession(email, this.#now());
      send(response, 200, { signedIn: true }, [this.#sessionCookie(token)]);
    } catch (error) {
      send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
    }
    return HANDLED;
  }
}

/**
 * A real argon2id hash of a random value nobody knows, computed once on first
 * use. Sign in verifies against it when no account exists, so the time a wrong
 * address takes matches the time a wrong password takes and the response does
 * not answer "does this address have an account here".
 *
 * Computed rather than written down because a hand-written PHC string that
 * fails to parse would make verify return false immediately, which is the
 * timing signal this exists to remove.
 */
let decoyHash: Promise<string> | null = null;

function decoy(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(32).toString('base64url'));
  return decoyHash;
}
