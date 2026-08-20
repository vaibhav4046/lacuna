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
import { DEMO_WORKSPACE, askEnvelope, demoWorkspace, emptyWorkspace, invalidRequest, storeWorkspace, validateQuestion } from './workspace.js';
import { MAX_SOURCE_CHARS, ingestSource, validateSource, workspaceCollection } from './ingest.js';
import { graphImpact } from './impact.js';
import type { WorkspaceView } from './workspace.js';
import { authorizeUrl, identityFromCode, type GoogleConfig } from '../auth/google.js';
import type { ServiceRelation } from '../hydra/relations.js';
import { extractionReport } from './extract-demo.js';
import type { HydraSource } from '../hydra/source.js';
import type { ClaimState, Inventory } from '../report/inventory.js';
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

/** A pasted transcript is bigger than a form. Four times what the extractor reads. */
const EXTRACT_BODY_BYTES = 16_384;

/** Sign up is rarer and more expensive, so it is tighter. */
const SIGNUP_LIMIT = { limit: 3, windowMs: 60_000, maxKeys: 4_096 };

/**
 * The public endpoints that cost real work, and what one address may spend.
 *
 * These answer to nobody by design, which is what makes them demonstrable and
 * also what makes them the cheapest thing to point a script at. The graph walk
 * is a live traversal against the managed service and takes seconds; the
 * extractor runs a parser over text somebody supplied; the ask path is a
 * question against the store. None of them writes, so the risk is spend and
 * availability rather than damage, and a per-address window is the proportionate
 * answer to both.
 */
const PUBLIC_READ_LIMIT = { limit: 60, windowMs: 60_000, maxKeys: 8_192 };
const PUBLIC_WALK_LIMIT = { limit: 10, windowMs: 60_000, maxKeys: 8_192 };
/**
 * A public run spends two model calls, so its budget is not the read budget.
 * Four a minute is enough for somebody trying the thing and far too little to
 * be worth pointing at a bill.
 */
const PUBLIC_RUN_LIMIT = { limit: 4, windowMs: 60_000, maxKeys: 8_192 };

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
  /**
   * Optionally scoped to one workspace's collection.
   *
   * Signed in, a person reads what they ingested; signed out, `/demo` reads the
   * corpus that ships with the repository. Passing the collection here rather
   * than holding a source per account keeps the memo inside one source alive
   * exactly as long as the request that filled it.
   */
  readonly source?: (collection?: string) => HydraSource;
  /**
   * Writes one source into a collection. Absent where nothing can be written,
   * and the route then answers 501 rather than pretending to have stored it.
   */
  readonly ingest?: (
    collection: string,
    title: string,
    text: string,
  ) => Promise<Awaited<ReturnType<typeof ingestSource>>>;
  /**
   * Runs the two agents over one workspace. Absent where no model provider is
   * configured, and the route then answers 501 rather than pretending.
   */
  /** `null` runs over the public corpus rather than one account's collection. */
  readonly agent?: (collection: string | null, task: string) => Promise<unknown>;
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
   * The recorded one-context run, read from its artifact by the caller for the
   * same reason the evaluation is: this router has no filesystem where it runs.
   */
  readonly continuity?: Readonly<Record<string, unknown>>;
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
   * The store's own graph, walked for one subject rather than listed.
   *
   * `relations` above asks what edges exist. This asks the store to traverse
   * them for a question and hand back the paths it reached, which is the thing
   * a list cannot demonstrate. Injected and optional for the same reasons.
   */
  readonly expansion?: (subject: string) => Promise<readonly ServiceRelation[]>;
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
            : part === 'memory' ? { rows: view.memory, total: view.memoryTotal, loaded: view.memoryPage, demo: view.demo }
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

/**
 * The subject worth asking the store to walk.
 *
 * A correction is the whole argument, so the subject picked is one the corpus
 * corrected: a `depends_on` claim that a later claim replaced. HydraDB's own
 * graph holds both the old edge and the new one and marks neither, so walking
 * that subject shows exactly what the store contributes and exactly what the
 * resolver above it decides. Derived from the inventory rather than written
 * down here, so a regenerated corpus moves it instead of stranding it.
 */
function expansionSubject(inventory: Inventory | undefined): string | null {
  if (inventory === undefined) return null;
  const replaced = inventory.claims.find(
    (row) => row.state === 'historical' && row.predicate === 'depends_on',
  ) ?? inventory.claims.find((row) => row.state === 'historical');
  return replaced?.subject ?? null;
}

/** One row of the store's walk, beside what Lacuna's claim graph says about it. */
export interface ExpansionRow extends ServiceRelation {
  /**
   * The state of the claim this edge lines up with, or `unstated` where the
   * claim graph holds nothing joining these two. `unstated` is not a fault: the
   * store extracted from prose the annotations never described.
   */
  readonly standing: ClaimState | 'unstated';
}

/**
 * What Lacuna's claim graph says about an edge the store reached.
 *
 * The store names two entities; a claim about the subject names one object. So
 * the other end of the edge is looked up as that object, case-insensitively,
 * because the store lowercases the names it extracts and the corpus does not.
 * Nothing here changes an answer: this is the comparison the HydraDB screen
 * renders, and the resolver never sees it.
 */
function standingOf(
  inventory: Inventory,
  subject: string,
  relation: ServiceRelation,
): ClaimState | 'unstated' {
  const lower = subject.toLowerCase();
  const other = relation.source?.toLowerCase() === lower ? relation.target : relation.source;
  if (other === null || other === undefined) return 'unstated';
  const claim = inventory.claims.find(
    (row) => row.subject.toLowerCase() === lower && row.objectText.toLowerCase() === other.toLowerCase(),
  );
  return claim?.state ?? 'unstated';
}

export class ApiRouter {
  readonly #store: Accounts;
  readonly #secure: boolean;
  readonly #health: (() => Promise<unknown>) | null;
  readonly #source: ((collection?: string) => HydraSource) | undefined;
  readonly #ingest: ApiOptions['ingest'];
  readonly #agent: ApiOptions['agent'];
  readonly #inventory: Inventory | undefined;
  readonly #evaluations: readonly EvalRow[] | undefined;
  readonly #continuity: Readonly<Record<string, unknown>> | undefined;
  readonly #relations: (() => Promise<readonly ServiceRelation[]>) | undefined;
  readonly #expansion: ((subject: string) => Promise<readonly ServiceRelation[]>) | undefined;
  readonly #google: GoogleConfig | undefined;
  readonly #now: () => number;
  readonly #signinLimit = new FixedWindow(SIGNIN_LIMIT);
  readonly #signupLimit = new FixedWindow(SIGNUP_LIMIT);
  readonly #readLimit = new FixedWindow(PUBLIC_READ_LIMIT);
  readonly #walkLimit = new FixedWindow(PUBLIC_WALK_LIMIT);
  readonly #runLimit = new FixedWindow(PUBLIC_RUN_LIMIT);

  constructor(options: ApiOptions) {
    this.#store = options.store;
    this.#secure = options.secure;
    this.#health = options.health;
    this.#source = options.source;
    this.#ingest = options.ingest;
    this.#agent = options.agent;
    this.#inventory = options.inventory;
    this.#evaluations = options.evaluations;
    this.#continuity = options.continuity;
    this.#relations = options.relations;
    this.#expansion = options.expansion;
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
    if (account === null) return emptyWorkspace();

    // The sample workspace reads the corpus that ships here. Every other
    // account reads what it ingested, because a screen saying "no claims yet"
    // beside answers drawn from the store is the screen being wrong.
    if (account.workspace === DEMO_WORKSPACE) {
      const inventory = this.#inventory;
      return inventory === undefined ? emptyWorkspace() : demoWorkspace(inventory);
    }

    const openSource = this.#source;
    if (openSource === undefined) return emptyWorkspace();
    try {
      return await storeWorkspace(openSource(workspaceCollection(account.email)), ASK_TIMEOUT_MS);
    } catch {
      // A store that did not answer is not an empty workspace, but the view has
      // no way to say so, and inventing rows would be worse.
      return emptyWorkspace();
    }
  }

  #sessionCookie(token: string): string {
    return serialiseCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: Math.floor(SESSION_TTL_MS / 1000),
      httpOnly: true,
      secure: this.#secure,
    });
  }

  /**
   * The account a request's cookies name, or null.
   *
   * Used to decide which collection a read is scoped to, so it must never
   * throw: a store that is down means nobody is signed in for the purposes of
   * this question, and the public corpus is still answerable.
   */
  async #accountFor(cookies: Readonly<Record<string, string>>): Promise<Account | null> {
    const token = cookies[SESSION_COOKIE];
    if (typeof token !== 'string' || token === '') return null;
    try {
      const record = await this.#store.sessionFor(token, this.#now());
      return record === null ? null : await this.#store.find(record.email);
    } catch {
      return null;
    }
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
    // `/api/explore` is the name; `/api/demo` still answers, because it is
    // written into documents, a social card and a video frame, and those are
    // not ours to break.
    if ((path.startsWith('/api/explore/') || path.startsWith('/api/demo/')) && method === 'GET') {
      const inventory = this.#inventory;
      const view = inventory === undefined ? emptyWorkspace() : demoWorkspace(inventory);
      const part = path.startsWith('/api/explore/')
        ? path.slice('/api/explore/'.length)
        : path.slice('/api/demo/'.length);

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

      // The same graph, walked rather than listed.
      //
      // One subject goes to the store's own retrieval with graph context asked
      // for, and what comes back is the paths it reached, each set beside the
      // state Lacuna's claim graph holds for the same pair. The corrected
      // subject is the one chosen, so the row the store cannot rank and the
      // resolver refuses is visible rather than described. Read only: no answer
      // on any other screen consults this.
      if (part === 'expansion' || part === 'impact') {
        if (!this.#walkLimit.check(sourceKey(request), this.#now()).allowed) {
          send(response, 429, { error: 'too many graph walks from this address, try again shortly' });
          return HANDLED;
        }
      }

      if (part === 'expansion') {
        const walk = this.#expansion;
        const subject = expansionSubject(inventory);
        if (walk === undefined || subject === null || inventory === undefined) {
          send(response, 200, {
            available: false,
            reason: walk === undefined
              ? 'this deployment has no graph walk endpoint'
              : 'the corpus holds no corrected claim to walk',
            subject: null,
            relations: [],
          });
          return HANDLED;
        }
        try {
          const started = Date.now();
          const walked = await walk(subject);
          const rows: ExpansionRow[] = walked.map((relation) => ({
            ...relation,
            standing: standingOf(inventory, subject, relation),
          }));
          send(response, 200, { available: true, subject, ms: Date.now() - started, relations: rows });
        } catch {
          send(response, 200, { available: false, reason: 'the store did not answer', subject, relations: [] });
        }
        return HANDLED;
      }

      // The step before every other screen: prose in, claims out.
      //
      // Everything else here reads a graph that was built from annotations,
      // which proves the resolver and proves nothing about where the graph came
      // from. This runs the extractor itself, over the built in transcript or
      // over text a reader supplies, and reports what it read, what it refused,
      // and how many sentences it made nothing of. Pure: no store, no model, no
      // write, nothing kept.
      // GET returns the built in transcript only. A reader's own text goes in a
      // POST body: a transcript in a query string ends up in access logs, in
      // proxy caches and in browser history, and somebody pasting a real
      // conversation in has no reason to expect that.
      /**
       * One question, asked of three clients, compared field by field.
       *
       * A recorded run rather than a live one, and labelled that way, because
       * a browser cannot spawn a subprocess and pretending otherwise would be
       * the page claiming something it cannot do. The run itself was real: a
       * web request, a local CLI process and an MCP subprocess each asked the
       * same six questions of the same store.
       */
      if (part === 'continuity') {
        const recorded = this.#continuity;
        if (recorded === undefined) {
          send(response, 200, { available: false, reason: 'no recorded run ships with this build' });
          return HANDLED;
        }
        send(response, 200, { available: true, kind: 'recorded', ...recorded });
        return HANDLED;
      }

      if (part === 'extract') {
        send(response, 200, extractionReport(null));
        return HANDLED;
      }

      /**
       * The one result the store's graph decides.
       *
       * HydraDB traverses its own relations for the subject and returns the
       * candidate edges; this project's policy then removes the ones the
       * conversation replaced, disputed, or never asserted, and the reachable
       * set is computed over what survives. Every rejection is returned with
       * its reason, so the contribution of each side is readable rather than
       * claimed.
       */
      if (part === 'impact') {
        const walk = this.#expansion;
        const all = this.#relations;
        const subject = expansionSubject(inventory);
        if (walk === undefined || all === undefined || subject === null || inventory === undefined) {
          send(response, 200, {
            available: false,
            reason: 'this deployment has no graph walk endpoint',
            subject: null,
          });
          return HANDLED;
        }
        try {
          const started = Date.now();
          const [seed, edges] = await Promise.all([walk(subject), all()]);
          send(response, 200, {
            available: true,
            ...graphImpact(inventory, subject, seed, edges, started),
          });
        } catch {
          send(response, 200, { available: false, reason: 'the store did not answer', subject });
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

    // Extraction over text a reader supplies. No session, no store, no write:
    // it is a pure function of the body, so it needs no CSRF token, and it is
    // marked no-store so nothing between here and the browser keeps a copy of
    // somebody's transcript.
    if ((path === '/api/explore/extract' || path === '/api/demo/extract') && method === 'POST') {
      let body: Record<string, unknown> | null;
      try {
        // Four times the text the extractor will read, so anything a reader can
        // legitimately paste arrives and is reported as truncated rather than
        // rejected with a status code that says nothing.
        body = await readJsonBody(request, EXTRACT_BODY_BYTES);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const text = body?.['text'];
      if (text !== undefined && typeof text !== 'string') {
        send(response, 422, { error: 'text must be a string' });
        return HANDLED;
      }
      if (!this.#readLimit.check(sourceKey(request), this.#now()).allowed) {
        send(response, 429, { error: 'too many extractions from this address, try again shortly' });
        return HANDLED;
      }
      send(response, 200, extractionReport(typeof text === 'string' ? text : null));
      return HANDLED;
    }

    /**
     * One source, from prose into this account's memory.
     *
     * Signed in only, and written to a collection derived from the account, so
     * one person's transcript never lands where the public demo reads. The
     * pipeline is the shipped one: the extractor decides what may become a
     * claim before anything is written, which is also the containment for a
     * pasted transcript that contains instructions, since an instruction is not
     * a statement and files where no answer reads it.
     */
    /**
     * One agent run: Researcher drafts from the governed pack, Reviewer checks
     * it against the same evidence and refuses what nothing supports.
     *
     * Signed in only, because a run costs a real model call. Nothing it does
     * writes to memory: it produces a record of itself and stops.
     */
    if (path === '/api/workspace/agent/run' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const runAgent = this.#agent;
      if (runAgent === undefined) {
        send(response, 501, { error: 'no model provider is configured on this deployment' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const task = body?.['task'];
      if (typeof task !== 'string' || task.trim() === '' || task.length > 600) {
        send(response, 422, { error: 'task_required' });
        return HANDLED;
      }
      try {
        send(response, 200, await runAgent(workspaceCollection(account.email), task));
      } catch {
        send(response, 502, { error: 'the run did not complete' });
      }
      return HANDLED;
    }

    /**
     * The same run, over the corpus anybody can read.
     *
     * A run writes nothing. Both agents are `NO_WRITE`, the manifest says so
     * before either model is called, and the only thing it touches is the
     * public collection every visitor already reads. So requiring an account
     * for it protected nothing and hid the strongest thing the product does
     * behind a sign-in wall, which is how a judge concludes it does not exist.
     *
     * It costs model calls where a read does not, which is why it has its own
     * budget rather than sharing the read one.
     */
    if ((path === '/api/explore/agent/run' || path === '/api/demo/agent/run') && method === 'POST') {
      const runAgent = this.#agent;
      if (runAgent === undefined) {
        send(response, 501, { error: 'no model provider is configured on this deployment' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const task = body?.['task'];
      if (typeof task !== 'string' || task.trim() === '' || task.length > 600) {
        send(response, 422, { error: 'task_required' });
        return HANDLED;
      }
      if (!this.#runLimit.check(sourceKey(request), this.#now()).allowed) {
        send(response, 429, { error: 'too many runs from this address, try again shortly' });
        return HANDLED;
      }
      try {
        send(response, 200, await runAgent(null, task));
      } catch {
        send(response, 502, { error: 'the run did not complete' });
      }
      return HANDLED;
    }

    if (path === '/api/workspace/ingest' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const ingestInto = this.#ingest;
      if (ingestInto === undefined) {
        send(response, 501, { error: 'this deployment cannot write to a context store' });
        return HANDLED;
      }

      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request, MAX_SOURCE_CHARS * 5);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const title = body?.['title'];
      const text = body?.['text'];
      const bad = validateSource(title, text);
      if (bad !== null) {
        send(response, 422, { error: bad });
        return HANDLED;
      }

      try {
        const report = await ingestInto(
          workspaceCollection(account.email),
          title as string,
          text as string,
        );
        if (typeof report === 'string') {
          // Nothing was extracted. That is a result, not a failure: the frame
          // table could not justify a claim from this prose, and inventing one
          // is the trade this product refuses.
          send(response, 200, { ok: false, reason: report });
          return HANDLED;
        }
        send(response, 200, { ok: true, ...report });
      } catch {
        send(response, 502, { error: 'the context store did not accept the source' });
      }
      return HANDLED;
    }

    /**
     * The public board's question, always against the corpus that ships here.
     *
     * `/api/ask` scopes to the signed-in workspace, which is right for the
     * product and wrong for `/judge`: a visitor who happens to have a session
     * was shown NO EVIDENCE on every row of a page whose whole purpose is
     * answering. The proof board reads the demo corpus whoever is looking.
     *
     * Read only and session free, so it needs no CSRF token, and it shares the
     * public read budget.
     */
    if ((path === '/api/explore/ask' || path === '/api/demo/ask') && method === 'POST') {
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      // The shape of the request is judged before the health of the store. An
      // empty subject is a bad question whether or not a store is configured,
      // and reporting it as anything else blames the wrong thing.
      const invalid = validateQuestion(body?.['subject'], body?.['predicate']);
      if (invalid !== null) {
        send(response, 422, invalidRequest(invalid));
        return HANDLED;
      }
      const openSource = this.#source;
      if (openSource === undefined) {
        send(response, 503, { error: 'no context store is configured' });
        return HANDLED;
      }
      if (!this.#readLimit.check(sourceKey(request), this.#now()).allowed) {
        send(response, 429, { error: 'too many questions from this address, try again shortly' });
        return HANDLED;
      }
      const via = body?.['via'];
      send(response, 200, await askEnvelope(
        openSource(),
        body?.['subject'] as string,
        body?.['predicate'] as string,
        typeof via === 'string' && via !== '' ? via : null,
        ASK_TIMEOUT_MS,
      ));
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
      // A malformed question is a 422 with a named reason, not a 200 carrying
      // SYSTEM_ERROR. The screen can then say what the person did rather than
      // telling them the context store is down.
      const invalid = validateQuestion(subject, predicate);
      if (invalid !== null) {
        send(response, 422, invalidRequest(invalid));
        return HANDLED;
      }
      if (!this.#readLimit.check(sourceKey(request), this.#now()).allowed) {
        send(response, 429, { error: 'too many questions from this address, try again shortly' });
        return HANDLED;
      }
      // Signed in, the question is asked of the workspace this person ingested
      // into. Signed out, it is asked of the corpus that ships here.
      const asker = await this.#accountFor(cookies);
      const scope = asker === null ? undefined : workspaceCollection(asker.email);
      // Narrowed by validateQuestion above, which returns non-null for anything
      // that is not a non-empty string of bounded length.
      send(response, 200, await askEnvelope(
        openSource(scope),
        subject as string,
        predicate as string,
        typeof via === 'string' && via !== '' ? via : null,
        ASK_TIMEOUT_MS,
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
