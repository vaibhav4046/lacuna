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
import { SESSION_TTL_MS, StoreUnavailable, hashToken, mintToken, sameDigest, type Account } from '../auth/store.js';
import type { Accounts } from '../auth/accounts.js';
import { FixedWindow } from '../server/ratelimit.js';
import { DEMO_WORKSPACE, askEnvelope, demoWorkspace, emptyWorkspace } from './workspace.js';
import type { WorkspaceView } from './workspace.js';
import { authorizeUrl, identityFromCode, type GoogleConfig } from '../auth/google.js';
import type { ServiceRelation } from '../hydra/relations.js';
import type { HydraSource } from '../hydra/source.js';
import type { Inventory } from '../report/inventory.js';
import type { EvalRow } from '../report/evaluations.js';
import { headerModel, modelRows } from '../provider/registry.js';

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
/**
 * The state cookie for the Google round trip, and how long it may sit unused.
 *
 * Ten minutes is longer than a person needs to pick an account and shorter than
 * a browser left open overnight, and it is cleared on every outcome including
 * the failures.
 */
const GOOGLE_STATE_COOKIE = 'lacuna_google_state';
const GOOGLE_STATE_TTL_SECONDS = 600;

const SIGNIN_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };
/** A question should not sit behind a browser spinner for longer than this. */
const ASK_TIMEOUT_MS = 10_000;

/** A workspace name is a label, not an essay. */
const MAX_WORKSPACE_CHARS = 120;

/** Sign up is rarer and more expensive, so it is tighter. */
const SIGNUP_LIMIT = { limit: 3, windowMs: 60_000, maxKeys: 4_096 };

export interface ApiOptions {
  readonly store: Accounts;
  /** True behind TLS. Marks both cookies Secure. */
  readonly secure: boolean;
  /** Runs the same checks `lacuna doctor` runs. Null when no node is configured. */
  readonly health: (() => Promise<unknown>) | null;
  /** The context store. Absent on a deployment that serves a snapshot. */
  /**
   * A source per request rather than a shared one.
   *
   * The cloud source memoises the records it reads, which is what makes a hop
   * cost one fetch instead of two. Sharing that memo across requests would let
   * a warm instance answer from a record the store has since replaced, which
   * is the one bug this product has no business having.
   */
  readonly source?: () => HydraSource;
  /** The ingested corpus, which is what the demo workspace is made of. */
  readonly inventory?: Inventory;
  /**
   * The recorded benchmark, already read from its artifact by the caller.
   *
   * Passed in rather than loaded here: this router has no filesystem in the
   * deployment it runs in, and a screen that shows a measured run should read
   * the same file a person checking the claim would open.
   */
  readonly evaluations?: readonly EvalRow[];
  /**
   * HydraDB's own relation graph, read from the service rather than built here.
   *
   * Injected for the same reason the source is: this router does not choose a
   * store and does not know one exists. It is optional because the self-hosted
   * node has no equivalent endpoint, and a deployment without it says so on the
   * screen instead of showing an empty table.
   */
  readonly relations?: () => Promise<readonly ServiceRelation[]>;
  /**
   * Google sign in, when the deployment has been given a client.
   *
   * Optional in the same way the source is. A deployment without it does not
   * offer the button rather than offering one that fails, and every local run
   * and every test works without ever touching Google.
   */
  readonly google?: GoogleConfig;
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

/**
 * One named part of a workspace view.
 *
 * Shared by the signed-in route and the demo route so the two cannot answer
 * differently for the same name. Null means no such part, which the caller
 * turns into a 404.
 */
function workspacePart(view: WorkspaceView, part: string): unknown {
  return part === 'changes' ? view.changes
    : part === 'conflicts' ? view.conflicts
      : part === 'connections' ? view.connections
        : part === 'runs' ? view.runs
          : part === 'health' ? view.health
            : part === 'memory' ? { rows: view.memory, total: view.memoryTotal, demo: view.demo }
              : part === 'categories' ? view.categories
                : part === 'questions' ? view.questions
                  : part === 'summary' ? view
                  // Nothing is configured for these yet, and an empty list is
                  // the honest answer rather than a 404 the screen would have
                  // to render as a failure.
                  : part === 'agents' || part === 'tools' || part === 'evaluations' ? []
                    : null;
}

/**
 * A question the answer to which is not on the subject.
 *
 * "Who is our contact for the vendor behind X" cannot be answered from X's own
 * claims: the walk has to land on the vendor first. Derived from a claim the
 * graph holds rather than written down here, so a regenerated corpus moves the
 * suggestion instead of stranding it.
 */
function hopSuggestions(inventory: Inventory | undefined): readonly { label: string; subject: string; predicate: string }[] {
  if (inventory === undefined) return [];
  // Both ends have to hold: a current vendor on the subject, and a current
  // contact on the vendor it names. A suggestion that satisfies only the first
  // abstains, correctly, and demonstrates nothing about hopping.
  const reachable = new Set(
    inventory.claims
      .filter((row) => row.predicate === 'contact' && row.state === 'current')
      .map((row) => row.subject),
  );
  const claim = inventory.claims.find((row) => (
    row.predicate === 'vendor' && row.state === 'current' && reachable.has(row.objectText)
  ));
  if (claim === undefined) return [];
  return [{
    label: `${claim.subject} · contact — through the vendor behind it`,
    subject: claim.subject,
    predicate: 'contact',
  }];
}

export class ApiRouter {
  readonly #store: Accounts;
  readonly #secure: boolean;
  readonly #health: (() => Promise<unknown>) | null;
  readonly #source: (() => HydraSource) | undefined;
  readonly #inventory: Inventory | undefined;
  readonly #evaluations: readonly EvalRow[] | undefined;
  readonly #relations: (() => Promise<readonly ServiceRelation[]>) | undefined;
  readonly #google: GoogleConfig | undefined;
  readonly #now: () => number;
  readonly #signinLimit = new FixedWindow(SIGNIN_LIMIT);
  readonly #signupLimit = new FixedWindow(SIGNUP_LIMIT);

  constructor(options: ApiOptions) {
    this.#store = options.store;
    this.#secure = options.secure;
    this.#health = options.health;
    this.#source = options.source;
    this.#inventory = options.inventory;
    this.#evaluations = options.evaluations;
    this.#relations = options.relations;
    this.#google = options.google;
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
  async #viewFor(cookies: Readonly<Record<string, string>>): Promise<WorkspaceView> {
    const token = cookies[SESSION_COOKIE];
    const record = typeof token === 'string' && token !== ''
      ? await this.#store.sessionFor(token, this.#now())
      : null;
    const account = record === null ? null : await this.#store.find(record.email);
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
        ? await this.#store.sessionFor(token, this.#now())
        : null;
      const account = record === null ? null : await this.#store.find(record.email);
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
      // Google's half of the flow is two GETs and cannot carry a CSRF header:
      // the second one is Google redirecting a browser back here. It is guarded
      // instead by the state value below, which is the same idea in the shape
      // this protocol allows. Both are handled before the POST and CSRF checks
      // for that reason.
      if (path === '/api/auth/google/start' && method === 'GET') {
        return this.#googleStart(response);
      }
      if (path === '/api/auth/google/callback' && method === 'GET') {
        return this.#googleCallback(request, response, cookies);
      }

      if (method !== 'POST') {
        send(response, 405, { error: 'method' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!await this.#store.available()) {
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
        if (typeof token === 'string' && token !== '') await this.#store.endSession(token);
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

    // The demo workspace, without an account.
    //
    // A judge, and anyone else who wants to see the product work before
    // signing up, reads the ingested corpus here. It is the same view the
    // signed-in demo workspace shows, named explicitly rather than reached by
    // holding the right session, and it is read only: nothing under /api/demo
    // writes. Every other workspace stays behind the session, and this one
    // holds nothing personal to protect.
    if (path.startsWith('/api/demo/') && method === 'GET') {
      const inventory = this.#inventory;
      const view = inventory === undefined ? emptyWorkspace() : demoWorkspace(inventory);
      const part = path.slice('/api/demo/'.length);

      // Probed rather than listed, same as the signed-in route: these two ask
      // the endpoints and report what answered.
      if (part === 'models') {
        send(response, 200, await modelRows(process.env));
        return HANDLED;
      }
      if (part === 'model') {
        send(response, 200, { label: headerModel(await modelRows(process.env)) });
        return HANDLED;
      }

      // HydraDB's own graph, not the product's. The service extracted these
      // relations from the same transcripts at ingest, so the screen can show
      // what the store found beside what the product traversed. A failure is
      // reported as unavailable rather than as an empty graph, because an empty
      // table and a store that did not answer are different facts.
      if (part === 'relations') {
        if (this.#relations === undefined) {
          send(response, 200, { available: false, reason: 'this deployment has no relations endpoint', relations: [] });
          return HANDLED;
        }
        try {
          const started = Date.now();
          const relations = await this.#relations();
          send(response, 200, { available: true, ms: Date.now() - started, relations });
        } catch {
          send(response, 200, { available: false, reason: 'the store did not answer', relations: [] });
        }
        return HANDLED;
      }

      const body = part === 'hops'
        ? hopSuggestions(inventory)
        : part === 'evaluations'
          ? this.#evaluations ?? []
          : workspacePart(view, part);
      if (body === null) {
        send(response, 404, { error: 'route' });
        return HANDLED;
      }
      send(response, 200, body, this.#csrfCookie(cookies));
      return HANDLED;
    }

    if (path.startsWith('/api/workspace/') && method === 'GET') {
      const view = await this.#viewFor(cookies);
      const part = path.slice('/api/workspace/'.length);

      // Probed rather than listed: these two ask the endpoints and report what
      // answered, so they run before the static branches below.
      if (part === 'models') {
        send(response, 200, await modelRows(process.env));
        return HANDLED;
      }
      if (part === 'model') {
        send(response, 200, { label: headerModel(await modelRows(process.env)) });
        return HANDLED;
      }

      const body = part === 'evaluations'
        ? this.#evaluations ?? []
        : workspacePart(view, part);

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
      const openSource = this.#source;
      if (openSource === undefined) {
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
        openSource(), subject, predicate, typeof via === 'string' && via !== '' ? via : null, ASK_TIMEOUT_MS,
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
        ? await this.#store.sessionFor(token, this.#now())
        : null;
      const account = record === null ? null : await this.#store.find(record.email);
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
        await this.#store.update({ ...account, workspace: name.trim(), onboarded: true });
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
    if (await this.#store.find(email) !== null) {
      send(response, 409, { error: 'exists' });
      return HANDLED;
    }

    const now = this.#now();
    try {
      const created = await this.#store.create({
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
      const token = await this.#store.startSession(email, now);
      send(response, 201, { signedIn: true }, [this.#sessionCookie(token)]);
    } catch (error) {
      send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
    }
    return HANDLED;
  }

  /** Where a person lands after signing in, depending on whether they have set up. */
  #afterSignIn(account: Account): string {
    return account.onboarded ? '/app/dash' : '/onboarding';
  }

  #redirect(response: ServerResponse, to: string, cookies: readonly string[] = []): Handled {
    response.writeHead(302, { Location: to, 'Set-Cookie': cookies as string[] });
    response.end();
    return HANDLED;
  }

  /**
   * Send the browser to Google, carrying a value that has to come back.
   *
   * The state is minted here, stored in an httpOnly cookie, and compared on
   * return. Without it somebody can hand a person a finished callback URL and
   * sign them into an account that is not theirs.
   */
  #googleStart(response: ServerResponse): Handled {
    const google = this.#google;
    if (google === undefined) return this.#redirect(response, '/signin?google=unconfigured');

    const state = mintToken();
    return this.#redirect(response, authorizeUrl(google, state), [
      serialiseCookie(GOOGLE_STATE_COOKIE, state, {
        maxAgeSeconds: GOOGLE_STATE_TTL_SECONDS,
        httpOnly: true,
        secure: this.#secure,
      }),
    ]);
  }

  /**
   * Google sends the browser back here. Everything that can go wrong ends the
   * same way, at sign in with a reason in the query, because a person who
   * cancelled and a person whose token failed a check both just need the page
   * back. The reasons are distinct so a log can tell them apart.
   */
  async #googleCallback(
    request: IncomingMessage,
    response: ServerResponse,
    cookies: Readonly<Record<string, string>>,
  ): Promise<Handled> {
    const google = this.#google;
    if (google === undefined) return this.#redirect(response, '/signin?google=unconfigured');

    const url = new URL(request.url ?? '/', 'http://placeholder');
    const clear = clearCookie(GOOGLE_STATE_COOKIE, this.#secure);

    // The person pressed cancel on Google's screen. Not an error.
    if (url.searchParams.get('error') !== null) {
      return this.#redirect(response, '/signin?google=cancelled', [clear]);
    }

    const state = url.searchParams.get('state');
    const expected = cookies[GOOGLE_STATE_COOKIE];
    if (
      typeof expected !== 'string' || expected === '' || state === null
      || state.length !== expected.length
      || !sameDigest(hashToken(state), hashToken(expected))
    ) {
      return this.#redirect(response, '/signin?google=state', [clear]);
    }

    const code = url.searchParams.get('code');
    if (code === null || code === '') {
      return this.#redirect(response, '/signin?google=code', [clear]);
    }

    if (!await this.#store.available()) {
      return this.#redirect(response, '/signin?google=store', [clear]);
    }

    let identity;
    try {
      identity = await identityFromCode(google, code);
    } catch {
      return this.#redirect(response, '/signin?google=identity', [clear]);
    }

    try {
      let account = await this.#store.find(identity.email);
      if (account === null) {
        // No password is set, and the field cannot be left empty, so it holds a
        // real argon2id hash of a value nobody knows. Signing in with a password
        // to this address is then not a special case that has to be remembered:
        // it simply never verifies.
        const created = await this.#store.create({
          email: identity.email,
          passwordHash: await decoy(),
          createdAt: new Date(this.#now()).toISOString(),
          workspace: null,
          onboarded: false,
        });
        // Null means the address was taken between the read and the write, which
        // means an account exists and signing in is still the right outcome.
        account = created ?? await this.#store.find(identity.email);
        if (account === null) return this.#redirect(response, '/signin?google=store', [clear]);
      }

      const token = await this.#store.startSession(account.email, this.#now());
      return this.#redirect(response, this.#afterSignIn(account), [clear, this.#sessionCookie(token)]);
    } catch {
      return this.#redirect(response, '/signin?google=store', [clear]);
    }
  }

  async #signin(request: IncomingMessage, response: ServerResponse, email: string, password: string): Promise<Handled> {
    const verdict = this.#signinLimit.check(sourceKey(request), this.#now());
    if (!verdict.allowed) {
      send(response, 429, { error: 'rate' }, []);
      return HANDLED;
    }

    const account = await this.#store.find(email);
    // The hash runs even when there is no account, so the time this takes does
    // not answer the question "does this address have an account here".
    const stored = account?.passwordHash ?? await decoy();
    const ok = await verifyPassword(password, stored);
    if (account === null || !ok) {
      send(response, 401, { error: 'credentials' });
      return HANDLED;
    }

    try {
      const token = await this.#store.startSession(email, this.#now());
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
