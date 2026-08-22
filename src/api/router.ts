import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { hashPassword, MAX_PASSWORD_CHARS, MIN_PASSWORD_CHARS, verifyPassword } from '../auth/password.js';
import { canonicalRecoveryCode, newRecoveryCode, normaliseRecoveryCode } from '../auth/recovery.js';
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
import { CredentialChanged, SESSION_TTL_MS, StoreUnavailable, hashToken, mintToken, newSessionVersion, sameDigest, sessionVersionMatches, type Account } from '../auth/store.js';
import { VOICE_BINDING_HEADER, voiceBindingVerdict, voiceSessionBinding } from '../auth/voice-binding.js';
import type { Accounts } from '../auth/accounts.js';
import { googleBinding } from '../auth/identity.js';
import type { McpCapabilities } from '../auth/mcp-capability-store.js';
import { MCP_CAPABILITY_SHAPE } from '../auth/mcp-capability.js';
import { FixedWindow, type RateLimitOptions, type RateLimitVerdict } from '../server/ratelimit.js';
import { DEMO_WORKSPACE, askEnvelope, demoWorkspace, emptyWorkspace, invalidRequest, plannedAskEnvelope, storeWorkspace, validateQuestion } from './workspace.js';
import { MAX_SOURCE_CHARS, ingestSource, serializeIngestReport, validateSource, workspaceCollection } from './ingest.js';
import { graphImpact } from './impact.js';
import {
  runWorkspaceImpact,
  WORKSPACE_IMPACT_LIMITS,
  type WorkspaceImpactResult,
} from './workspace-impact.js';
import type { HydraImpactReadPort } from '../hydra/impact-read.js';
import { canonicalEntityName } from '../retrieval/resolve.js';
import type { WorkspaceView } from './workspace.js';
import { authorizeUrl, GoogleAuthError, identityFromCode, newGoogleAuthorizationProof, type GoogleConfig } from '../auth/google.js';
import type { ServiceRelation } from '../hydra/relations.js';
import { extractionReport } from './extract-demo.js';
import type { HydraSource } from '../hydra/source.js';
import type { ClaimState, Inventory } from '../report/inventory.js';
import type { EvalRow } from '../report/evaluations.js';
import { headerModel, modelRows } from '../provider/registry.js';
import { GraphApiError, graphFromInventory, graphFromSource, graphPage } from './graph.js';
import type { AgentRun } from '../agent/types.js';
import { builtInAgentId, agentPageRecords, recommendedAgents } from '../agent/registry.js';
import { registeredAgentTools } from '../agent/tools.js';
import {
  AgentInputRejected,
  cancelAgentRun,
} from '../agent/run.js';
import {
  InvalidRunTransition,
  RunConflict,
  RunBudgetExceeded,
  WorkspaceAccessDenied,
  type AgentRuntimeStore,
} from '../agent/store.js';
import type { DailySchedule } from '../scheduler/types.js';
import type { ScheduleStore } from '../scheduler/store.js';
import {
  ScheduleAuthorizationFailed,
  cronAuthorized,
  dispatchDueDaily,
  recommendedDailySchedule,
  runScheduleNow,
} from '../scheduler/dispatcher.js';
import { addStreamingAudioBytes, type VoiceBoundary, type VoiceBoundaryResult } from './voice.js';
import { VOICE_ROUTES } from '../voice/operations.js';
import { MAX_VOICE_TRANSCRIPT_CHARS, type VoiceIntentPlan, type VoiceScope } from '../voice/intent.js';
import { catalogue, mergeConnectorState } from '../connectors/catalog.js';
import { FileConnectorError, type FileConnectorBoundary } from '../connectors/files.js';
import {
  GitHubImportError,
  type GitHubImporterBoundary,
} from '../connectors/github.js';
import {
  HTTPS_IMPORT_DEADLINE_MS,
  HttpsImportError,
  HttpsReadCancelledError,
  type PinnedHttpsReaderBoundary,
} from '../connectors/https.js';
import { PreviewTokenError } from '../connectors/preview-token.js';
import {
  ConnectorRunCancelledError,
  serializeConnectorRunResult,
  type ConnectorRunner,
} from '../connectors/run.js';
import type { ConnectorDescriptor, ConnectorStore } from '../connectors/types.js';
import {
  WebhookBodyError,
  WebhookBodyReader,
  WebhookRejectedError,
  type WebhookService,
} from '../connectors/webhook.js';

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
 * One cookie namespace per Google round trip, and how long it may sit unused.
 *
 * The state digest in each name lets two tabs keep independent PKCE and nonce
 * proofs. A second click must not overwrite the first valid attempt. Ten
 * minutes is longer than a person needs to pick an account and shorter than a
 * browser left open overnight.
 */
const GOOGLE_ATTEMPT_COOKIE = 'lacuna_google_attempt';
const GOOGLE_STATE_TTL_SECONDS = 600;
const GOOGLE_CODE_MAX_CHARS = 2_048;
const GOOGLE_START_LIMIT = { limit: 8, windowMs: GOOGLE_STATE_TTL_SECONDS * 1_000, maxKeys: 4_096 };

interface GoogleAttempt {
  readonly state: string;
  readonly codeVerifier: string;
  readonly nonce: string;
}

const GOOGLE_PROOF_SHAPE = /^[A-Za-z0-9_-]{43}$/u;

function googleAttemptCookie(state: string): string {
  return `${GOOGLE_ATTEMPT_COOKIE}_${hashToken(state).slice(0, 24)}`;
}

function parseGoogleAttempt(raw: string | undefined): GoogleAttempt | null {
  if (raw === undefined || raw.length > 512) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const attempt = value as Partial<GoogleAttempt>;
    if (!GOOGLE_PROOF_SHAPE.test(attempt.state ?? '')
      || !GOOGLE_PROOF_SHAPE.test(attempt.codeVerifier ?? '')
      || !GOOGLE_PROOF_SHAPE.test(attempt.nonce ?? '')) return null;
    return attempt as GoogleAttempt;
  } catch {
    return null;
  }
}

const SIGNIN_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };
/** A question should not sit behind a browser spinner for longer than this. */
const ASK_TIMEOUT_MS = 10_000;

/** A configured workspace store did not answer; never reinterpret that as empty memory. */
class ContextUnavailable extends Error {
  constructor() {
    super('context unavailable');
    this.name = 'ContextUnavailable';
  }
}

/** A workspace name is a label, not an essay. */
const MAX_WORKSPACE_CHARS = 120;

/** A pasted transcript is bigger than a form. Four times what the extractor reads. */
const EXTRACT_BODY_BYTES = 16_384;

/** Sign up is rarer and more expensive, so it is tighter. */
const SIGNUP_LIMIT = { limit: 3, windowMs: 60_000, maxKeys: 4_096 };
/**
 * Recovery gets its own budget rather than sharing sign in's.
 *
 * Sharing meant a few failed sign ins used up the attempts of somebody trying
 * to get back into their account, which is exactly the person least able to
 * afford it. Tighter than sign in because a code is a credential that resets a
 * password: six a minute is generous for a person typing one off a note and
 * nowhere near enough to search a hundred bit space.
 */
const RECOVER_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };

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
/** Private spend ceilings are keyed by the server-derived workspace id. */
const PRIVATE_RUN_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };
const PRIVATE_INGEST_LIMIT = { limit: 4, windowMs: 5 * 60_000, maxKeys: 4_096 };
const PRIVATE_FILE_LIMIT = { limit: 12, windowMs: 5 * 60_000, maxKeys: 4_096 };
const PRIVATE_MCP_ISSUE_LIMIT = { limit: 6, windowMs: 60_000, maxKeys: 4_096 };
const PRIVATE_VOICE_INTENT_LIMIT = { limit: 30, windowMs: 60_000, maxKeys: 4_096 };

const VOICE_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const VOICE_ROUTE_KEYS = new Set<string>(VOICE_ROUTES);

export interface VoiceIntentRequest {
  readonly version: 1;
  readonly requestId: string;
  readonly transcript: string;
  readonly currentRoute: string;
  readonly scope: VoiceScope;
}

interface AgentRunRequest {
  readonly task: string;
  readonly agentId?: string;
  readonly requestId?: string;
}

/** Closed body for a browser run. Only voice may supply a durable request id. */
function readAgentRunRequest(value: unknown): AgentRunRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(body);
  if (keys.some((key) => key !== 'task' && key !== 'agentId' && key !== 'requestId')) return null;
  if (typeof body['task'] !== 'string' || body['task'].trim() === '' || body['task'].length > 600) return null;
  if (body['agentId'] !== undefined && typeof body['agentId'] !== 'string') return null;
  if (body['requestId'] !== undefined
    && (typeof body['requestId'] !== 'string' || !VOICE_REQUEST_ID.test(body['requestId']))) return null;
  return {
    task: body['task'],
    ...(typeof body['agentId'] === 'string' ? { agentId: body['agentId'] } : {}),
    ...(typeof body['requestId'] === 'string' ? { requestId: body['requestId'] } : {}),
  };
}

/** Origin headers serialize to the origin only. Paths and trailing slashes are not equivalent input. */
export function exactVoiceOrigin(origin: string | undefined, expectedOrigin: string): boolean {
  if (origin === undefined) return false;
  try {
    const expected = new URL(expectedOrigin);
    const given = new URL(origin);
    return expectedOrigin === expected.origin
      && origin === expected.origin
      && given.username === ''
      && given.password === '';
  } catch {
    return false;
  }
}

function voiceRouteScope(route: unknown): VoiceScope | null {
  if (typeof route !== 'string') return null;
  const match = /^\/(app|explore)\/([^/]+)$/u.exec(route);
  if (match === null || !VOICE_ROUTE_KEYS.has(match[2] ?? '')) return null;
  return match[1] === 'explore' ? 'public' : 'private';
}

/** Strict boundary for the only client-controlled values the pure planner receives. */
export function readVoiceIntentRequest(value: unknown): VoiceIntentRequest | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const body = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(body).sort();
  if (keys.length !== 4
    || keys[0] !== 'currentRoute'
    || keys[1] !== 'requestId'
    || keys[2] !== 'transcript'
    || keys[3] !== 'version') return null;
  const scope = voiceRouteScope(body['currentRoute']);
  if (body['version'] !== 1
    || typeof body['requestId'] !== 'string'
    || !VOICE_REQUEST_ID.test(body['requestId'])
    || typeof body['transcript'] !== 'string'
    || body['transcript'].length > MAX_VOICE_TRANSCRIPT_CHARS
    || typeof body['currentRoute'] !== 'string'
    || scope === null) return null;
  return {
    version: 1,
    requestId: body['requestId'],
    transcript: body['transcript'],
    currentRoute: body['currentRoute'],
    scope,
  };
}

interface RememberedOperations {
  readonly windowStart: number;
  readonly ids: Set<string>;
}

/**
 * A workspace spend limit that does not charge an idempotent HTTP replay as a
 * second attempt. The durable stores still make the actual run idempotent;
 * this small bounded index only keeps the process-local defence from blocking
 * the replay before it reaches that durable result.
 */
class WorkspaceRunWindow {
  readonly #window: FixedWindow;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #operations = new Map<string, RememberedOperations>();

  constructor(options: RateLimitOptions) {
    this.#window = new FixedWindow(options);
    this.#windowMs = options.windowMs;
    this.#maxKeys = options.maxKeys;
  }

  check(workspace: string, now: number, operationId?: string): RateLimitVerdict {
    const remembered = this.#operations.get(workspace);
    if (operationId !== undefined && remembered !== undefined
      && now - remembered.windowStart < this.#windowMs && remembered.ids.has(operationId)) {
      return { allowed: true, remaining: 0, retryAfterSeconds: 0 };
    }
    const verdict = this.#window.check(workspace, now);
    if (!verdict.allowed || operationId === undefined) return verdict;

    if (remembered === undefined || now - remembered.windowStart >= this.#windowMs) {
      this.#evict(now);
      this.#operations.delete(workspace);
      this.#operations.set(workspace, { windowStart: now, ids: new Set([operationId]) });
    } else {
      remembered.ids.add(operationId);
    }
    return verdict;
  }

  #evict(now: number): void {
    if (this.#operations.size < this.#maxKeys) return;
    for (const [workspace, held] of this.#operations) {
      if (now - held.windowStart >= this.#windowMs) this.#operations.delete(workspace);
    }
    for (const workspace of this.#operations.keys()) {
      if (this.#operations.size < this.#maxKeys) break;
      this.#operations.delete(workspace);
    }
  }
}

export interface ApiOptions {
  readonly store: Accounts;
  /** False on hosted stores that cannot atomically create a unique identity. */
  readonly allowPasswordSignup?: boolean;
  /** Random, revocable capabilities used to authorize private MCP access. */
  readonly mcpCapabilities?: McpCapabilities;
  /** Durable non-secret connector observations, separate from workspace memory. */
  readonly connectorStore?: ConnectorStore;
  /** Deployment-specific availability over the closed server catalogue. */
  readonly connectorCatalog?: () => readonly ConnectorDescriptor[];
  /** Authenticated preview/import boundary; absent unless parser, signer, runner, and store exist. */
  readonly fileConnector?: FileConnectorBoundary;
  /** Anonymous public-repository reader with a hardwired GitHub API boundary. */
  readonly githubImporter?: GitHubImporterBoundary;
  /** DNS-pinned public HTTPS reader; absent when the hardened runtime boundary is unavailable. */
  readonly httpsReader?: PinnedHttpsReaderBoundary;
  /** Shared governed ingestion runner used after an adapter has prepared content. */
  readonly connectorRunner?: Pick<ConnectorRunner, 'run'>;
  /** Complete signed-webhook lifecycle and delivery service; absent fails closed. */
  readonly webhookService?: Pick<WebhookService, 'issue' | 'state' | 'revoke' | 'admit' | 'accept'>;
  /** Strict raw entity reader, injectable only for deterministic boundary tests. */
  readonly webhookBodyReader?: Pick<WebhookBodyReader, 'read'>;
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
  /** Strict Hydra-native impact reader, scoped by the server-derived collection. */
  readonly impact?: (collection?: string) => HydraImpactReadPort;
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
  readonly agent?: (
    collection: string | null,
    task: string,
    run?: {
      readonly idempotencyKey?: string;
      readonly kind?: 'TASK' | 'CONTEXT_HEALTH';
      readonly attempt?: number;
      readonly retryOf?: string | null;
    },
  ) => Promise<AgentRun>;
  /** Operational run records, scoped by the server-derived collection id. */
  readonly agentStore?: AgentRuntimeStore;
  /** Seeds real built-in definitions before a workspace runtime read. */
  readonly prepareAgents?: (workspace: string) => Promise<void>;
  /** Daily schedule records and dispatch leases. */
  readonly scheduleStore?: ScheduleStore;
  /** Creates the one supported daily schedule idempotently. */
  readonly prepareSchedule?: (workspace: string) => Promise<void>;
  /** Server-only Vercel cron bearer. */
  readonly cronSecret?: string;
  /** Explicit dispatcher scopes. Never taken from a cron request. */
  readonly cronWorkspaces?: readonly string[];
  /** ElevenLabs boundary. Permanent credentials remain inside it. */
  readonly voice?: VoiceBoundary;
  /** Canonical trusted origin used for the voice Origin check. */
  readonly siteOrigin?: string;
  /** Pure deterministic planner, composed independently of the speech provider. */
  readonly voiceIntent?: (transcript: string, currentRoute: string, scope: VoiceScope) => VoiceIntentPlan;
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
  /** The recorded LongMemEval ingest check. Absent when the build has none. */
  readonly longmemeval?: Readonly<Record<string, unknown>>;
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
  /**
   * One legacy address an operator has explicitly approved for Google
   * migration. The verified OAuth identity must still return this exact email.
   * Remove the setting immediately after the one-time migration succeeds.
   */
  readonly legacyGoogleMigrationEmail?: string;
  /** Stable server-only key used to sign opaque graph pagination cursors. */
  readonly graphCursorKey?: string;
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

function sendRateLimited(response: ServerResponse, retryAfterSeconds: number, error: string): void {
  response.writeHead(429, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))),
  });
  response.end(JSON.stringify({ error }));
}

/** Stream provider audio without copying provider headers or buffering bytes. */
async function sendVoiceResult(
  response: ServerResponse,
  result: VoiceBoundaryResult,
  control: AbortController,
): Promise<void> {
  if (result.kind === 'json') {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, private',
      'X-Content-Type-Options': 'nosniff',
      ...(result.retryAfterSeconds === undefined ? {} : { 'Retry-After': String(result.retryAfterSeconds) }),
    };
    response.writeHead(result.status, headers);
    response.end(JSON.stringify(result.body));
    return;
  }

  const body = result.response.body;
  if (body === null) {
    send(response, 503, { error: 'speech_unavailable' });
    return;
  }
  response.writeHead(200, {
    'Content-Type': result.contentType,
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
  });
  const reader = body.getReader();
  let streamedBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done || control.signal.aborted) break;
      const nextBytes = addStreamingAudioBytes(streamedBytes, chunk.value.byteLength);
      if (nextBytes === null) {
        control.abort();
        await reader.cancel().catch(() => undefined);
        if (!response.destroyed) response.destroy();
        return;
      }
      streamedBytes = nextBytes;
      if (!response.write(Buffer.from(chunk.value))) {
        await Promise.race([once(response, 'drain'), once(response, 'close')]);
      }
    }
    if (!response.writableEnded) response.end();
  } catch {
    control.abort();
    if (!response.destroyed) response.destroy();
  } finally {
    if (control.signal.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function firstHeader(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0];
}

function voiceBindingOk(
  request: IncomingMessage,
  cookies: Readonly<Record<string, string>>,
  required: boolean,
): boolean {
  const token = cookies[SESSION_COOKIE];
  const verdict = voiceBindingVerdict(
    request.headers[VOICE_BINDING_HEADER],
    typeof token === 'string' && token !== '' ? hashToken(token) : null,
  );
  return verdict === 'matching' || (!required && verdict === 'absent');
}

function isPrivateConnectorOperation(path: string, method: string): boolean {
  if (method === 'GET') {
    return path === '/api/workspace/connectors'
      || path === '/api/workspace/connectors/webhook';
  }
  if (method === 'POST') {
    return path === '/api/workspace/connectors/webhook'
      || path === '/api/workspace/connectors/file/preview'
      || path === '/api/workspace/connectors/file/import'
      || path === '/api/workspace/connectors/github/import'
      || path === '/api/workspace/connectors/api/import';
  }
  return method === 'DELETE'
    && /^\/api\/workspace\/connectors\/webhook\/[A-Za-z0-9_-]{22}$/u.test(path);
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

/**
 * The names a source holds, for the parser to match a sentence against.
 *
 * A successful empty list means the workspace holds no subjects. A failed
 * read must propagate so the caller can report temporary unavailability rather
 * than making the semantic claim that the requested topic does not exist.
 */
async function knownSubjects(source: HydraSource): Promise<readonly string[]> {
  if (source.subjects === undefined) throw new ContextUnavailable();
  return (await source.subjects(8_000)).value;
}

export class ApiRouter {
  readonly #store: Accounts;
  readonly #allowPasswordSignup: boolean;
  readonly #mcpCapabilities: McpCapabilities | undefined;
  readonly #connectorStore: ConnectorStore | undefined;
  readonly #fileConnector: FileConnectorBoundary | undefined;
  readonly #githubImporter: GitHubImporterBoundary | undefined;
  readonly #httpsReader: PinnedHttpsReaderBoundary | undefined;
  readonly #connectorRunner: Pick<ConnectorRunner, 'run'> | undefined;
  readonly #webhookService: Pick<WebhookService, 'issue' | 'state' | 'revoke' | 'admit' | 'accept'> | undefined;
  readonly #webhookBodyReader: Pick<WebhookBodyReader, 'read'>;
  readonly #connectorCatalog: () => readonly ConnectorDescriptor[];
  readonly #secure: boolean;
  readonly #health: (() => Promise<unknown>) | null;
  readonly #source: ((collection?: string) => HydraSource) | undefined;
  readonly #impact: ((collection?: string) => HydraImpactReadPort) | undefined;
  readonly #ingest: ApiOptions['ingest'];
  readonly #agent: ApiOptions['agent'];
  readonly #agentStore: AgentRuntimeStore | undefined;
  readonly #prepareAgents: ApiOptions['prepareAgents'];
  readonly #scheduleStore: ScheduleStore | undefined;
  readonly #prepareSchedule: ApiOptions['prepareSchedule'];
  readonly #cronSecret: string | undefined;
  readonly #cronWorkspaces: readonly string[];
  readonly #voice: VoiceBoundary | undefined;
  readonly #siteOrigin: string | undefined;
  readonly #voiceIntent: ApiOptions['voiceIntent'];
  readonly #inventory: Inventory | undefined;
  readonly #evaluations: readonly EvalRow[] | undefined;
  readonly #continuity: Readonly<Record<string, unknown>> | undefined;
  readonly #longmemeval: Readonly<Record<string, unknown>> | undefined;
  readonly #relations: (() => Promise<readonly ServiceRelation[]>) | undefined;
  readonly #expansion: ((subject: string) => Promise<readonly ServiceRelation[]>) | undefined;
  readonly #google: GoogleConfig | undefined;
  readonly #legacyGoogleMigrationEmail: string | undefined;
  readonly #graphCursorKey: string;
  readonly #now: () => number;
  readonly #signinLimit = new FixedWindow(SIGNIN_LIMIT);
  readonly #googleStartLimit = new FixedWindow(GOOGLE_START_LIMIT);
  readonly #signupLimit = new FixedWindow(SIGNUP_LIMIT);
  readonly #recoverLimit = new FixedWindow(RECOVER_LIMIT);
  readonly #readLimit = new FixedWindow(PUBLIC_READ_LIMIT);
  readonly #walkLimit = new FixedWindow(PUBLIC_WALK_LIMIT);
  readonly #privateRunLimit = new WorkspaceRunWindow(PRIVATE_RUN_LIMIT);
  readonly #privateIngestLimit = new FixedWindow(PRIVATE_INGEST_LIMIT);
  readonly #privateFileLimit = new FixedWindow(PRIVATE_FILE_LIMIT);
  readonly #privateMcpIssueLimit = new FixedWindow(PRIVATE_MCP_ISSUE_LIMIT);
  readonly #privateVoiceIntentLimit = new FixedWindow(PRIVATE_VOICE_INTENT_LIMIT);

  constructor(options: ApiOptions) {
    this.#store = options.store;
    this.#allowPasswordSignup = options.allowPasswordSignup ?? true;
    this.#mcpCapabilities = options.mcpCapabilities;
    this.#connectorStore = options.connectorStore;
    this.#fileConnector = options.fileConnector;
    this.#githubImporter = options.githubImporter;
    this.#httpsReader = options.httpsReader;
    this.#connectorRunner = options.connectorRunner;
    this.#webhookService = options.webhookService;
    this.#webhookBodyReader = options.webhookBodyReader ?? new WebhookBodyReader(
      options.now === undefined ? {} : { now: options.now },
    );
    this.#connectorCatalog = options.connectorCatalog
      ?? (() => catalogue({
        webhookService: this.#webhookService !== undefined,
        fileImport: this.#fileConnector !== undefined,
        githubImport: this.#githubImporter !== undefined && this.#connectorRunner !== undefined,
        httpsImport: this.#httpsReader !== undefined && this.#connectorRunner !== undefined,
      }));
    this.#secure = options.secure;
    this.#health = options.health;
    this.#source = options.source;
    this.#impact = options.impact;
    this.#ingest = options.ingest;
    this.#agent = options.agent;
    this.#agentStore = options.agentStore;
    this.#prepareAgents = options.prepareAgents;
    this.#scheduleStore = options.scheduleStore;
    this.#prepareSchedule = options.prepareSchedule;
    this.#cronSecret = options.cronSecret;
    this.#cronWorkspaces = options.cronWorkspaces ?? ['public'];
    this.#voice = options.voice;
    this.#siteOrigin = options.siteOrigin;
    this.#voiceIntent = options.voiceIntent;
    this.#inventory = options.inventory;
    this.#evaluations = options.evaluations;
    this.#continuity = options.continuity;
    this.#longmemeval = options.longmemeval;
    this.#relations = options.relations;
    this.#expansion = options.expansion;
    this.#google = options.google;
    this.#legacyGoogleMigrationEmail = normaliseEmail(options.legacyGoogleMigrationEmail) ?? undefined;
    // A process-local key keeps development and tests safe by default. Hosted
    // deployments inject a stable secret so a cursor survives another
    // serverless instance without ever exposing the secret in the envelope.
    this.#graphCursorKey = options.graphCursorKey ?? randomBytes(32).toString('hex');
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
    if (record === null) return emptyWorkspace();
    const account = await this.#store.find(record.email);
    if (account === null || !sessionVersionMatches(account, record)) return emptyWorkspace();

    // The sample workspace reads the corpus that ships here. Every other
    // account reads what it ingested, because a screen saying "no claims yet"
    // beside answers drawn from the store is the screen being wrong.
    if (account.workspace === DEMO_WORKSPACE) {
      const inventory = this.#inventory;
      return inventory === undefined ? emptyWorkspace() : demoWorkspace(inventory);
    }

    const openSource = this.#source;
    if (openSource === undefined) throw new ContextUnavailable();
    try {
      return await storeWorkspace(openSource(workspaceCollection(account.email)), ASK_TIMEOUT_MS);
    } catch {
      throw new ContextUnavailable();
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
      if (record === null) return null;
      const account = await this.#store.find(record.email);
      return account !== null && sessionVersionMatches(account, record) ? account : null;
    } catch {
      return null;
    }
  }

  async #prepareRuntime(workspace: string): Promise<void> {
    await this.#prepareAgents?.(workspace);
    await this.#prepareSchedule?.(workspace);
  }

  async #runScheduled(schedule: DailySchedule, idempotencyKey: string): Promise<AgentRun> {
    const run = this.#agent;
    if (run === undefined) throw new Error('agent provider unavailable');
    return run(schedule.workspace, schedule.task, {
      idempotencyKey,
      kind: schedule.runKind,
    });
  }

  async handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<Handled> {
    if (!path.startsWith('/api/')) return NOT_HANDLED;

    const cookies = parseCookies(request.headers.cookie);
    const method = request.method ?? 'GET';

    if (isPrivateConnectorOperation(path, method) && !voiceBindingOk(request, cookies, true)) {
      send(response, 401, { error: 'voice_binding' });
      return HANDLED;
    }

    if (path === '/api/workspace/connectors/webhook' && method === 'GET') {
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const service = this.#webhookService;
      if (service === undefined || this.#siteOrigin === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      try {
        send(response, 200, await service.state(workspaceCollection(account.email)));
      } catch {
        send(response, 503, { error: 'webhook_state_unavailable' });
      }
      return HANDLED;
    }

    if (path === '/api/workspace/connectors/webhook' && method === 'POST') {
      if (this.#siteOrigin === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const service = this.#webhookService;
      if (service === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      const length = firstHeader(request.headers['content-length']);
      if (request.headers['transfer-encoding'] !== undefined
        || (length !== undefined && length !== '0')) {
        send(response, 422, { error: 'invalid_webhook_request' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateIngestLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_ingest_budget');
        return HANDLED;
      }
      try {
        const issued = await service.issue(workspace);
        send(response, issued.created ? 201 : 200, {
          created: issued.created,
          endpointId: issued.endpointId,
          endpoint: issued.endpoint,
          secret: issued.secret,
          configuredAt: issued.configuredAt,
        });
      } catch {
        send(response, 503, { error: 'webhook_lifecycle_failed' });
      }
      return HANDLED;
    }

    const privateWebhookDelete = /^\/api\/workspace\/connectors\/webhook\/([A-Za-z0-9_-]{22})$/u.exec(path);
    if (privateWebhookDelete !== null && method === 'DELETE') {
      if (this.#siteOrigin === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const service = this.#webhookService;
      if (service === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateIngestLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_ingest_budget');
        return HANDLED;
      }
      try {
        const revoked = await service.revoke(workspace, privateWebhookDelete[1]!);
        send(response, revoked ? 200 : 404, revoked ? { revoked: true } : { error: 'webhook_not_found' });
      } catch {
        send(response, 503, { error: 'webhook_lifecycle_failed' });
      }
      return HANDLED;
    }

    const publicWebhook = /^\/api\/connectors\/webhook\/([^/]{1,128})$/u.exec(path);
    if (publicWebhook !== null && method === 'POST') {
      const service = this.#webhookService;
      if (service === undefined) {
        send(response, 503, { error: 'signing_not_configured' });
        return HANDLED;
      }
      const startedAtMs = this.#now();
      const settlementDeadlineMs = startedAtMs + 240_000;
      const controller = new AbortController();
      const abortIfPremature = () => {
        if (!response.writableEnded && !response.writableFinished) controller.abort();
      };
      request.once('aborted', abortIfPremature);
      response.once('close', abortIfPremature);
      request.socket.once('close', abortIfPremature);
      const deadline = setTimeout(() => controller.abort(), Math.max(1, settlementDeadlineMs - this.#now()));
      deadline.unref?.();
      try {
        const control = { requestSignal: controller.signal, startedAtMs, settlementDeadlineMs };
        const rawBody = await this.#webhookBodyReader.read(
          request,
          control,
          () => service.admit(publicWebhook[1]!, request.rawHeaders),
        );
        const receipt = await service.accept(publicWebhook[1]!, request.rawHeaders, rawBody, control);
        if (!response.destroyed && !response.writableEnded) send(response, 200, {
          state: receipt.state,
          acceptedDocuments: receipt.acceptedDocuments,
          searchableDocuments: receipt.searchableDocuments,
          failedDocuments: receipt.failedDocuments,
          acceptedRecords: receipt.acceptedRecords,
          refusedRecords: receipt.refusedRecords,
          failure: receipt.failure,
          observationWrite: receipt.observationWrite,
          indeterminateSubmission: receipt.indeterminateSubmission,
        });
      } catch (error) {
        if (response.destroyed || response.writableEnded) return HANDLED;
        if (error instanceof WebhookBodyError) send(response, error.status, { error: error.code });
        else if (error instanceof WebhookRejectedError) send(response, error.status, { error: error.code });
        else send(response, 502, { error: 'webhook_failed' });
      } finally {
        clearTimeout(deadline);
        request.off('aborted', abortIfPremature);
        response.off('close', abortIfPremature);
        request.socket.off('close', abortIfPremature);
      }
      return HANDLED;
    }

    const fileMode = path === '/api/workspace/connectors/file/preview' ? 'preview'
      : path === '/api/workspace/connectors/file/import' ? 'import'
        : null;
    if (fileMode !== null && method === 'POST') {
      if (this.#siteOrigin === undefined) {
        send(response, 503, { error: 'file_import_unavailable' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const files = this.#fileConnector;
      if (files === undefined) {
        send(response, 503, { error: 'file_import_unavailable' });
        return HANDLED;
      }
      const sessionToken = cookies[SESSION_COOKIE];
      if (typeof sessionToken !== 'string' || sessionToken === '') {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateFileLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_file_budget');
        return HANDLED;
      }
      try {
        const context = { workspace, sessionBinding: hashToken(sessionToken) };
        const result = fileMode === 'preview'
          ? await files.preview(request, context)
          : await files.importFile(request, context);
        send(response, 200, result);
      } catch (error) {
        if (error instanceof FileConnectorError) {
          send(response, error.status, { error: error.code });
        } else if (error instanceof PreviewTokenError) {
          send(response, 409, { error: error.code });
        } else {
          send(response, 502, { error: 'file_import_failed' });
        }
      }
      return HANDLED;
    }

    if (path === '/api/workspace/connectors/github/import' && method === 'POST') {
      if (this.#siteOrigin === undefined) {
        send(response, 501, { error: 'github_import_unavailable' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const importer = this.#githubImporter;
      const runner = this.#connectorRunner;
      if (importer === undefined || runner === undefined) {
        send(response, 501, { error: 'github_import_unavailable' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request, 4_096);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const keys = body === null ? [] : Object.keys(body);
      const allowedKeys = new Set(['url', 'workspace', 'collection']);
      if (body === null || typeof body['url'] !== 'string'
        || keys.some((key) => !allowedKeys.has(key))) {
        send(response, 422, { error: 'invalid_github_request' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateIngestLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_ingest_budget');
        return HANDLED;
      }
      const control = new AbortController();
      const abortIfPremature = () => {
        if (!response.writableEnded && !response.writableFinished) control.abort();
      };
      request.once('aborted', abortIfPremature);
      response.once('close', abortIfPremature);
      request.socket.once('close', abortIfPremature);
      if ((response.destroyed || request.socket.destroyed)
        && !response.writableEnded && !response.writableFinished) control.abort();
      try {
        if (control.signal.aborted) return HANDLED;
        const batch = await importer.importPublicRepo(body['url'], control.signal);
        if (control.signal.aborted) return HANDLED;
        const result = await runner.run(workspace, {
          connectorId: 'github',
          documents: batch.documents.map((document) => ({
            title: document.title,
            text: document.text,
            provenance: document.provenance,
          })),
          awaitSearchable: true,
        }, { signal: control.signal });
        if (control.signal.aborted) return HANDLED;
        send(response, 200, {
          ...serializeConnectorRunResult(result),
          snapshotCommit: batch.commitSha,
          snapshotDigest: batch.snapshotDigest,
          consideredEntries: batch.consideredEntries,
          fetchedBlobs: batch.fetchedBlobs,
          skipped: batch.skipped.map(({ reason, count }) => ({ reason, count })),
        });
      } catch (error) {
        if (control.signal.aborted || error instanceof ConnectorRunCancelledError) return HANDLED;
        if (error instanceof GitHubImportError) send(response, error.status, { error: error.code });
        else send(response, 502, { error: 'github_import_failed' });
      } finally {
        request.off('aborted', abortIfPremature);
        response.off('close', abortIfPremature);
        request.socket.off('close', abortIfPremature);
      }
      return HANDLED;
    }

    if (path === '/api/workspace/connectors/api/import' && method === 'POST') {
      if (this.#siteOrigin === undefined) {
        send(response, 501, { error: 'https_import_unavailable' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const reader = this.#httpsReader;
      const runner = this.#connectorRunner;
      if (reader === undefined || runner === undefined) {
        send(response, 501, { error: 'https_import_unavailable' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request, 4_096);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      if (body === null || Object.keys(body).length !== 1 || typeof body['url'] !== 'string') {
        send(response, 422, { error: 'invalid_https_request' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateIngestLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_ingest_budget');
        return HANDLED;
      }
      const control = new AbortController();
      let disconnected = false;
      let deadlineExpired = false;
      const abortIfPremature = () => {
        if (!response.writableEnded && !response.writableFinished) {
          disconnected = true;
          control.abort();
        }
      };
      request.once('aborted', abortIfPremature);
      response.once('close', abortIfPremature);
      request.socket.once('close', abortIfPremature);
      if ((response.destroyed || request.socket.destroyed)
        && !response.writableEnded && !response.writableFinished) abortIfPremature();
      const deadline = setTimeout(() => {
        deadlineExpired = true;
        control.abort();
      }, HTTPS_IMPORT_DEADLINE_MS);
      deadline.unref?.();
      try {
        if (control.signal.aborted) return HANDLED;
        const prepared = await reader.read(body['url'], control.signal);
        if (disconnected) return HANDLED;
        if (deadlineExpired) {
          send(response, 504, { error: 'https_timeout' });
          return HANDLED;
        }
        const result = await runner.run(workspace, {
          connectorId: 'https_api',
          documents: [{
            title: prepared.title,
            text: prepared.text,
            provenance: prepared.provenance,
          }],
          awaitSearchable: true,
        }, { signal: control.signal });
        if (disconnected) return HANDLED;
        send(response, 200, {
          ...serializeConnectorRunResult(result),
          sourceDigest: prepared.provenanceKey,
          contentDigest: prepared.contentDigest,
        });
      } catch (error) {
        if (disconnected) return HANDLED;
        if (deadlineExpired || error instanceof HttpsReadCancelledError
          || error instanceof ConnectorRunCancelledError) {
          send(response, 504, { error: 'https_timeout' });
        } else if (error instanceof HttpsImportError) {
          send(response, error.status, { error: error.code });
        } else {
          send(response, 502, { error: 'https_import_failed' });
        }
      } finally {
        clearTimeout(deadline);
        request.off('aborted', abortIfPremature);
        response.off('close', abortIfPremature);
        request.socket.off('close', abortIfPremature);
      }
      return HANDLED;
    }

    if (path === '/api/workspace/connectors' && method === 'GET') {
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      try {
        const workspace = workspaceCollection(account.email);
        const [observed, webhook] = await Promise.all([
          this.#connectorStore === undefined ? {} : this.#connectorStore.get(workspace),
          this.#webhookService === undefined ? null : this.#webhookService.state(workspace),
        ]);
        send(response, 200, { connectors: mergeConnectorState(this.#connectorCatalog(), observed, {
          webhookConfiguredAt: webhook?.configured === true ? webhook.configuredAt : null,
        }) });
      } catch {
        send(response, 503, { error: 'connector_state_unavailable' });
      }
      return HANDLED;
    }

    if (path === '/api/cron/agents/daily' && method === 'GET') {
      const authorization = firstHeader(request.headers.authorization);
      // Authenticate before even reading the workspace registry. Otherwise an
      // unauthenticated request can spend a database scan despite being unable
      // to dispatch anything.
      if (!cronAuthorized(authorization, this.#cronSecret)) {
        send(response, 401, { error: 'authorization' });
        return HANDLED;
      }
      const schedules = this.#scheduleStore;
      if (schedules === undefined || this.#agent === undefined) {
        send(response, 503, { error: 'runtime_unavailable' });
        return HANDLED;
      }
      try {
        const dispatched = [];
        const registered = await schedules.listWorkspaces();
        const workspaces = [...new Set([...this.#cronWorkspaces, ...registered])].sort();
        for (const workspace of workspaces) {
          await this.#prepareRuntime(workspace);
          dispatched.push(...await dispatchDueDaily({
            store: schedules,
            workspace,
            authorization,
            cronSecret: this.#cronSecret,
            run: (schedule, key) => this.#runScheduled(schedule, key),
            now: this.#now,
          }));
        }
        send(response, 200, dispatched);
      } catch (error) {
        send(response, error instanceof ScheduleAuthorizationFailed ? 401 : 503, {
          error: error instanceof ScheduleAuthorizationFailed ? 'authorization' : 'dispatch_unavailable',
        });
      }
      return HANDLED;
    }

    if (path === '/api/session' && method === 'GET') {
      const token = cookies[SESSION_COOKIE];
      const record = typeof token === 'string' && token !== ''
        ? await this.#store.sessionFor(token, this.#now())
        : null;
      const account = record === null ? null : await this.#store.find(record.email);
      if (account === null || record === null || !sessionVersionMatches(account, record)) {
        send(response, 200, { signedIn: false }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      send(response, 200, {
        signedIn: true,
        session: {
          email: account.email,
          workspace: account.workspace,
          onboarded: account.onboarded,
          binding: voiceSessionBinding(record.tokenHash),
        },
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
        return this.#googleStart(request, response);
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
        // Still no mail transport, and still refusing to report a link nobody
        // sent. `/api/auth/recover` is the way back now: it needs the recovery
        // code issued when the account was created, which is a channel this
        // deployment actually has.
        send(response, 501, { error: 'mail' });
        return HANDLED;
      }

      /**
       * A new password, proved by the code issued when the account was made.
       *
       * The checks are deliberately in this order and all of them are timed the
       * same way from outside: an unknown email, an account with no code, and a
       * wrong code all take one password verification and all answer 401 with
       * the same body. Any of those distinctions leaking would turn this into
       * an oracle for which addresses have accounts.
       */
      if (path === '/api/auth/recover') {
        const verdict = this.#recoverLimit.check(sourceKey(request), this.#now());
        if (!verdict.allowed) {
          send(response, 429, { error: 'rate' });
          return HANDLED;
        }
        const code = normaliseRecoveryCode(body?.['code']);
        const next = body?.['password'];
        if (typeof next !== 'string' || next.length < MIN_PASSWORD_CHARS || next.length > MAX_PASSWORD_CHARS) {
          send(response, 422, { error: 'password' });
          return HANDLED;
        }

        try {
          const account = await this.#store.find(email);
          const stored = account?.recoveryHash ?? null;
          // Verified even when there is nothing to verify against, so that a
          // missing account costs the same time as a wrong code.
          const ok = await verifyPassword(code ?? 'not-a-code', stored ?? await decoy());
          if (account === null || stored === null || code === null || !ok) {
            send(response, 401, { error: 'recovery' });
            return HANDLED;
          }

          /**
           * The code is spent. A new one is issued in the same breath.
           *
           * Rotating rather than keeping it means a code that was written on a
           * shared note cannot be used twice, and issuing the replacement here
           * means nobody is left without a way back after using theirs.
           */
          const replacement = newRecoveryCode();
          const sessionVersion = newSessionVersion();
          await this.#store.update({
            ...account,
            passwordHash: await hashPassword(next),
            recoveryHash: await hashPassword(canonicalRecoveryCode(replacement)),
            // Credential recovery revokes every prior 30-day session. The
            // replacement session minted below carries this fresh epoch.
            sessionVersion,
          });
          const token = await this.#store.startSession(email, this.#now(), sessionVersion);
          send(response, 200, { signedIn: true, recoveryCode: replacement }, [this.#sessionCookie(token)]);
        } catch (error) {
          if (error instanceof CredentialChanged) {
            send(response, 409, { error: 'recovery_conflict' });
          } else {
            send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
          }
        }
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
      if (part === 'connectors') {
        // Public metadata only: never merge workspace observations, webhook
        // state, imported counts, or account-derived identifiers here.
        const connectors = this.#connectorCatalog().map(({ id, label, group, availability, reason }) => ({
          id, label, group, availability, reason,
        }));
        send(response, 200, { connectors });
        return HANDLED;
      }

      if (part === 'graph') {
        if (!this.#readLimit.check(sourceKey(request), this.#now()).allowed) {
          send(response, 429, { error: 'too many graph reads from this address, try again shortly' });
          return HANDLED;
        }
        if (inventory === undefined) {
          send(response, 503, { error: 'SOURCE_UNAVAILABLE' });
          return HANDLED;
        }
        const query = new URL(request.url ?? path, 'http://lacuna.invalid').searchParams;
        const modeValue = query.get('mode');
        if (modeValue !== null && modeValue !== 'overview' && modeValue !== 'proof') {
          send(response, 422, { error: 'INVALID_MODE' });
          return HANDLED;
        }
        const limitValue = query.get('limit');
        if (limitValue !== null && !/^[1-9]\d*$/u.test(limitValue)) {
          send(response, 422, { error: 'INVALID_LIMIT' });
          return HANDLED;
        }
        try {
          const graph = graphFromInventory(DEMO_WORKSPACE, inventory, 'public');
          send(response, 200, graphPage(graph, {
            authenticatedWorkspaceId: DEMO_WORKSPACE,
            requestedWorkspaceId: DEMO_WORKSPACE,
            mode: modeValue ?? 'overview',
            ...(limitValue === null ? {} : { limit: Number(limitValue) }),
            cursor: query.get('cursor'),
            cursorKey: this.#graphCursorKey,
          }));
        } catch (error) {
          send(response, error instanceof GraphApiError ? error.status : 500, {
            error: error instanceof GraphApiError ? error.code : 'GRAPH_FAILED',
          });
        }
        return HANDLED;
      }

      if (part === 'recommendations') {
        send(response, 200, recommendedAgents('public', view.memory));
        return HANDLED;
      }

      if (part === 'agents' || part === 'runs' || part === 'tools' || part === 'schedules') {
        const runtime = this.#agentStore;
        const schedules = this.#scheduleStore;
        if (runtime === undefined || schedules === undefined || this.#agent === undefined) {
          send(response, 503, { error: 'runtime_unavailable' });
          return HANDLED;
        }
        try {
          const workspace = 'public';
          await this.#prepareRuntime(workspace);
          const runs = await runtime.listRuns(workspace);
          const body = part === 'agents'
            ? agentPageRecords(await runtime.listAgents(workspace), runs)
            : part === 'runs'
              ? runs
              : part === 'tools'
                ? registeredAgentTools(runs)
                : await schedules.listSchedules(workspace);
          send(response, 200, body);
        } catch {
          send(response, 503, { error: 'runtime_unavailable' });
        }
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

      /**
       * What happened when the published LongMemEval file went through.
       *
       * There is no accuracy score here and there should not be: the extractor
       * reads sentence frames about infrastructure and LongMemEval is a
       * personal assistant benchmark about degrees, hobbies and appointments,
       * so it produced a claim for 80 of the 500 instances. A score computed
       * over a sixth of a dataset is not a score, it is a number chosen by what
       * happened to parse.
       *
       * What is here is what was measured and is worth stating: every instance
       * read without a parse failure, and no ground truth survived the strip,
       * checked by searching each serialised instance for the answer, the
       * evidence session ids and the turn level marker. Publishing the coverage
       * that low is the point rather than the embarrassment.
       */
      if (part === 'longmemeval') {
        const recorded = this.#longmemeval;
        if (recorded === undefined) {
          send(response, 200, { available: false, reason: 'no recorded run ships with this build' });
          return HANDLED;
        }
        send(response, 200, { available: true, ...recorded });
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
      const part = path.slice('/api/workspace/'.length);

      if (part === 'recommendations') {
        const account = await this.#accountFor(cookies);
        if (account === null) {
          send(response, 401, { error: 'session' });
          return HANDLED;
        }
        const workspace = workspaceCollection(account.email);
        try {
          const view = await this.#viewFor(cookies);
          send(response, 200, recommendedAgents(workspace, view.memory));
        } catch (error) {
          if (!(error instanceof ContextUnavailable)) throw error;
          send(response, 503, { error: 'context_unavailable' });
        }
        return HANDLED;
      }

      if (part === 'graph') {
        const account = await this.#accountFor(cookies);
        if (account === null) {
          send(response, 401, { error: 'session' });
          return HANDLED;
        }
        const openSource = this.#source;
        if (openSource === undefined) {
          send(response, 503, { error: 'SOURCE_UNAVAILABLE' });
          return HANDLED;
        }
        const query = new URL(request.url ?? path, 'http://lacuna.invalid').searchParams;
        const modeValue = query.get('mode');
        if (modeValue !== null && modeValue !== 'overview' && modeValue !== 'proof') {
          send(response, 422, { error: 'INVALID_MODE' });
          return HANDLED;
        }
        const limitValue = query.get('limit');
        if (limitValue !== null && !/^[1-9]\d*$/u.test(limitValue)) {
          send(response, 422, { error: 'INVALID_LIMIT' });
          return HANDLED;
        }
        const collection = workspaceCollection(account.email);
        try {
          const graph = await graphFromSource(collection, openSource(collection), ASK_TIMEOUT_MS, 'workspace');
          send(response, 200, graphPage(graph, {
            authenticatedWorkspaceId: collection,
            requestedWorkspaceId: collection,
            mode: modeValue ?? 'overview',
            ...(limitValue === null ? {} : { limit: Number(limitValue) }),
            cursor: query.get('cursor'),
            cursorKey: this.#graphCursorKey,
          }));
        } catch (error) {
          send(response, error instanceof GraphApiError ? error.status : 503, {
            error: error instanceof GraphApiError ? error.code : 'SOURCE_UNAVAILABLE',
          });
        }
        return HANDLED;
      }

      /**
       * Private, source-backed Hydra impact. The account is resolved first and
       * the collection is derived only from that account; no tenant or
       * provider selector is accepted from the URL. Public Explore continues
       * using its legacy fixture endpoint.
       */
      if (part === 'impact') {
        const account = await this.#accountFor(cookies);
        if (account === null) {
          send(response, 401, { error: 'session' });
          return HANDLED;
        }
        const query = new URL(request.url ?? path, 'http://lacuna.invalid').searchParams;
        const keys = [...query.keys()];
        const subjects = query.getAll('subject');
        if (keys.some((key) => key !== 'subject') || subjects.length !== 1) {
          send(response, 422, { error: 'subject' });
          return HANDLED;
        }
        const rawSubject = subjects[0];
        const subject = rawSubject === undefined ? null : canonicalEntityName(rawSubject);
        if (subject === null) {
          send(response, 422, { error: 'subject' });
          return HANDLED;
        }
        const impactFactory = this.#impact;
        if (impactFactory === undefined) {
          send(response, 503, { error: 'impact_unavailable' });
          return HANDLED;
        }
        const controller = new AbortController();
        const abort = () => controller.abort();
        request.once('aborted', abort);
        response.once('close', abort);
        const started = Date.now();
        try {
          const result: WorkspaceImpactResult = await runWorkspaceImpact(
            subject.display,
            impactFactory(workspaceCollection(account.email)),
            {
              signal: controller.signal,
              deadlineMs: started + WORKSPACE_IMPACT_LIMITS.routeDeadlineMs,
            },
          );
          const { subject: resultSubject, ...payload } = result;
          send(response, 200, {
            available: true,
            subject: resultSubject.display,
            ...payload,
            ms: Math.max(0, Date.now() - started),
          });
        } catch {
          if (!response.destroyed && !response.writableEnded) {
            send(response, 503, { error: 'impact_unavailable' });
          }
        } finally {
          request.removeListener('aborted', abort);
          response.removeListener('close', abort);
        }
        return HANDLED;
      }

      if (part === 'agents' || part === 'runs' || part === 'tools' || part === 'schedules') {
        if ((part === 'runs' || part === 'schedules') && !voiceBindingOk(request, cookies, false)) {
          send(response, 401, { error: 'voice_binding' });
          return HANDLED;
        }
        const account = await this.#accountFor(cookies);
        if (account === null) {
          send(response, 401, { error: 'session' });
          return HANDLED;
        }
        const runtime = this.#agentStore;
        const schedules = this.#scheduleStore;
        if (runtime === undefined || schedules === undefined || this.#agent === undefined) {
          send(response, 503, { error: 'runtime_unavailable' });
          return HANDLED;
        }
        const workspace = workspaceCollection(account.email);
        try {
          await this.#prepareRuntime(workspace);
          const runs = await runtime.listRuns(workspace);
          const body = part === 'agents'
            ? agentPageRecords(await runtime.listAgents(workspace), runs)
            : part === 'runs'
              ? runs
              : part === 'tools'
                ? registeredAgentTools(runs)
                : await schedules.listSchedules(workspace);
          send(response, 200, body);
        } catch {
          send(response, 503, { error: 'runtime_unavailable' });
        }
        return HANDLED;
      }

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

      if (part === 'evaluations') {
        send(response, 200, this.#evaluations ?? []);
        return HANDLED;
      }

      const viewPart = part === 'changes' || part === 'conflicts' || part === 'connections'
        || part === 'health' || part === 'memory' || part === 'categories'
        || part === 'questions' || part === 'summary';
      if (!viewPart) {
        send(response, 404, { error: 'route' });
        return HANDLED;
      }

      let view: WorkspaceView;
      try {
        view = await this.#viewFor(cookies);
      } catch (error) {
        if (!(error instanceof ContextUnavailable)) throw error;
        send(response, 503, { error: 'context_unavailable' });
        return HANDLED;
      }

      const body = workspacePart(view, part);

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
    /**
     * The same, over the workspace the session owns.
     *
     * The subject list comes from the workspace rather than from the public
     * corpus, so a transcript somebody pasted five minutes ago is askable in
     * their own words without anybody having told the parser its vocabulary.
     */
    if ((path === '/api/workspace/voice/token' || path === '/api/workspace/voice/speech') && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const voice = this.#voice;
      const expectedOrigin = this.#siteOrigin;
      if (voice === undefined || expectedOrigin === undefined) {
        send(response, 503, { error: 'speech_unavailable' });
        return HANDLED;
      }
      let body: unknown = null;
      if (path.endsWith('/speech')) {
        try {
          body = await readJsonBody(request, 16_384);
        } catch (error) {
          send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
          return HANDLED;
        }
      }
      const workspace = workspaceCollection(account.email);
      const control = new AbortController();
      const abort = () => control.abort();
      request.once('aborted', abort);
      response.once('close', abort);
      const access = {
        origin: firstHeader(request.headers.origin),
        expectedOrigin,
        scope: 'private' as const,
        workspace,
        sessionWorkspace: workspace,
        sourceKey: sourceKey(request),
      };
      const result = path.endsWith('/token')
        ? await voice.token(access, control.signal)
        : await voice.speech(access, body, control.signal);
      await sendVoiceResult(response, result, control);
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      return HANDLED;
    }

    if (path === '/api/workspace/voice/intent' && method === 'POST') {
      const expectedOrigin = this.#siteOrigin;
      const plan = this.#voiceIntent;
      if (expectedOrigin === undefined || plan === undefined) {
        send(response, 503, { error: 'voice_intent_unavailable' });
        return HANDLED;
      }
      if (!exactVoiceOrigin(firstHeader(request.headers.origin), expectedOrigin)) {
        send(response, 403, { error: 'permission' });
        return HANDLED;
      }
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, true)) {
        send(response, 401, { error: 'voice_binding' });
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      let raw: unknown;
      try {
        raw = await readJsonBody(request, 4_096);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const body = readVoiceIntentRequest(raw);
      if (body === null) {
        send(response, 422, { error: 'voice_intent' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const budget = this.#privateVoiceIntentLimit.check(workspace, this.#now());
      if (!budget.allowed) {
        sendRateLimited(response, budget.retryAfterSeconds, 'workspace_voice_intent_budget');
        return HANDLED;
      }
      send(response, 200, {
        ...plan(body.transcript, body.currentRoute, body.scope),
        requestId: body.requestId,
      });
      return HANDLED;
    }

    /**
     * Mint and revoke private MCP bearers from the authenticated workspace.
     *
     * The workspace is never accepted from the request. A capability is shown
     * once, stored only as a digest, and can later be revoked with the same
     * bearer. This replaces the old deterministic collection id, which was an
     * address and never an authorization credential.
     */
    if ((path === '/api/workspace/mcp/capabilities'
      || path === '/api/workspace/mcp/capabilities/revoke') && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const capabilities = this.#mcpCapabilities;
      if (capabilities === undefined) {
        send(response, 503, { error: 'mcp_capabilities_unavailable' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      try {
        if (path.endsWith('/revoke')) {
          const body = await readJsonBody(request);
          const keys = body === null ? [] : Object.keys(body);
          const capability = body?.['capability'];
          if (keys.length !== 1 || keys[0] !== 'capability'
            || typeof capability !== 'string' || !MCP_CAPABILITY_SHAPE.test(capability)) {
            send(response, 422, { error: 'capability' });
            return HANDLED;
          }
          // Resolve first so one signed-in workspace cannot revoke another's
          // bearer merely by obtaining its value elsewhere.
          if (await capabilities.resolve(capability, this.#now()) !== workspace) {
            send(response, 404, { error: 'capability' });
            return HANDLED;
          }
          const revoked = await capabilities.revoke(capability, this.#now());
          send(response, revoked ? 204 : 404, revoked ? null : { error: 'capability' });
          return HANDLED;
        }

        const body = await readJsonBody(request);
        if (body !== null && Object.keys(body).length > 0) {
          send(response, 422, { error: 'body' });
          return HANDLED;
        }
        const issueBudget = this.#privateMcpIssueLimit.check(workspace, this.#now());
        if (!issueBudget.allowed) {
          sendRateLimited(response, issueBudget.retryAfterSeconds, 'workspace_mcp_capability_budget');
          return HANDLED;
        }
        const issued = await capabilities.issue(workspace, this.#now());
        send(response, 201, {
          capability: issued.capability,
          createdAt: issued.createdAt,
          expiresAt: issued.expiresAt,
          endpoint: '/mcp',
        });
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 503, {
          error: error instanceof BodyTooLarge ? 'body' : 'mcp_capabilities_unavailable',
        });
      }
      return HANDLED;
    }

    if ((path === '/api/explore/voice/token' || path === '/api/explore/voice/speech') && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const voice = this.#voice;
      const expectedOrigin = this.#siteOrigin;
      if (voice === undefined || expectedOrigin === undefined) {
        send(response, 503, { error: 'speech_unavailable' });
        return HANDLED;
      }
      let body: unknown = null;
      if (path.endsWith('/speech')) {
        try {
          body = await readJsonBody(request, 16_384);
        } catch (error) {
          send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
          return HANDLED;
        }
      }
      const control = new AbortController();
      const abort = () => control.abort();
      request.once('aborted', abort);
      response.once('close', abort);
      const access = {
        origin: firstHeader(request.headers.origin),
        expectedOrigin,
        scope: 'public' as const,
        workspace: 'public',
        sessionWorkspace: null,
        sourceKey: sourceKey(request),
      };
      const result = path.endsWith('/token')
        ? await voice.token(access, control.signal)
        : await voice.speech(access, body, control.signal);
      await sendVoiceResult(response, result, control);
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
      return HANDLED;
    }

    if (path === '/api/workspace/query' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const openSource = this.#source;
      if (openSource === undefined) {
        send(response, 503, { error: 'no context store is configured' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const text = body?.['question'];
      if (typeof text !== 'string' || text.trim() === '' || text.length > 300) {
        send(response, 422, invalidRequest('question_unreadable'));
        return HANDLED;
      }
      const source = openSource(workspaceCollection(account.email));
      try {
        send(response, 200, await plannedAskEnvelope(
          source,
          text,
          await knownSubjects(source),
          ASK_TIMEOUT_MS,
        ));
      } catch {
        send(response, 503, { error: 'context_unavailable' });
      }
      return HANDLED;
    }

    const recommendedSchedule = /^\/api\/workspace\/agent\/recommendations\/([^/]+)\/schedule$/u.exec(path);
    if (recommendedSchedule !== null && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, true)) {
        send(response, 401, { error: 'voice_binding' });
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const schedules = this.#scheduleStore;
      if (schedules === undefined || this.#agent === undefined) {
        send(response, 503, { error: 'runtime_unavailable' });
        return HANDLED;
      }
      let recommendationId: string;
      try {
        recommendationId = decodeURIComponent(recommendedSchedule[1] ?? '');
      } catch {
        send(response, 400, { error: 'recommendation_id' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const cadence = body?.['cadence'];
      const localTime = body?.['localTime'];
      const timezone = body?.['timezone'];
      const controls = body === null ? [] : Object.keys(body);
      if (cadence !== 'DAILY' || typeof localTime !== 'string' || typeof timezone !== 'string'
        || controls.some((key) => key !== 'cadence' && key !== 'localTime' && key !== 'timezone')) {
        send(response, 422, { error: 'schedule_controls' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      let view: WorkspaceView;
      try {
        view = await this.#viewFor(cookies);
      } catch (error) {
        if (!(error instanceof ContextUnavailable)) throw error;
        send(response, 503, { error: 'context_unavailable' });
        return HANDLED;
      }
      const choice = recommendedAgents(workspace, view.memory)
        .find((recommendation) => recommendation.id === recommendationId);
      if (choice === undefined) {
        send(response, 404, { error: 'recommendation' });
        return HANDLED;
      }
      let schedule: DailySchedule;
      try {
        schedule = recommendedDailySchedule(
          workspace,
          choice,
          localTime,
          timezone,
          this.#now(),
        );
      } catch {
        send(response, 422, { error: 'schedule_controls' });
        return HANDLED;
      }
      try {
        await this.#prepareRuntime(workspace);
        send(response, 200, await schedules.putSchedule(schedule));
      } catch {
        send(response, 503, { error: 'runtime_unavailable' });
      }
      return HANDLED;
    }

    if (path === '/api/workspace/agent/run' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, true)) {
        send(response, 401, { error: 'voice_binding' });
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
      const runRequest = readAgentRunRequest(body);
      if (runRequest === null) {
        send(response, 422, { error: 'agent_run' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const requestedAgent = runRequest.agentId;
      if (requestedAgent !== undefined && requestedAgent !== builtInAgentId(workspace, 'RESEARCHER')) {
        send(response, 403, { error: 'agent_scope' });
        return HANDLED;
      }
      const idempotencyKey = runRequest.requestId === undefined
        ? `web:${randomBytes(16).toString('hex')}`
        : `voice:${runRequest.requestId}`;
      const runBudget = this.#privateRunLimit.check(
        workspace,
        this.#now(),
        runRequest.requestId === undefined ? undefined : idempotencyKey,
      );
      if (!runBudget.allowed) {
        sendRateLimited(response, runBudget.retryAfterSeconds, 'workspace_run_budget');
        return HANDLED;
      }
      try {
        await this.#prepareRuntime(workspace);
        send(response, 200, await runAgent(workspace, runRequest.task, {
          idempotencyKey,
        }));
      } catch (error) {
        if (error instanceof RunBudgetExceeded) {
          sendRateLimited(response, error.retryAfterSeconds, 'workspace_run_budget');
          return HANDLED;
        }
        send(response, error instanceof AgentInputRejected ? 422 : 502, {
          error: error instanceof AgentInputRejected ? 'task_rejected' : 'the run did not complete',
        });
      }
      return HANDLED;
    }

    const runMutation = /^\/api\/workspace\/agent\/runs\/([^/]+)\/(cancel|retry)$/u.exec(path);
    if (runMutation !== null && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, true)) {
        send(response, 401, { error: 'voice_binding' });
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const runtime = this.#agentStore;
      const runAgent = this.#agent;
      if (runtime === undefined || runAgent === undefined) {
        send(response, 503, { error: 'runtime_unavailable' });
        return HANDLED;
      }
      let runId: string;
      try {
        runId = decodeURIComponent(runMutation[1] ?? '');
      } catch {
        send(response, 400, { error: 'run_id' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      try {
        await this.#prepareRuntime(workspace);
        const current = await runtime.getRun(workspace, runId);
        if (current === null) {
          send(response, 404, { error: 'run' });
          return HANDLED;
        }
        if (runMutation[2] === 'cancel') {
          send(response, 200, await cancelAgentRun(runtime, workspace, runId, this.#now));
        } else {
          if (current.status !== 'FAILED' && current.status !== 'CANCELLED') {
            send(response, 409, { error: 'run_transition' });
            return HANDLED;
          }
          const runBudget = this.#privateRunLimit.check(workspace, this.#now(), `retry:${current.id}`);
          if (!runBudget.allowed) {
            sendRateLimited(response, runBudget.retryAfterSeconds, 'workspace_run_budget');
            return HANDLED;
          }
          send(response, 200, await runAgent(workspace, current.task, {
            idempotencyKey: `retry:${current.id}`,
            kind: current.kind,
            attempt: current.attempt + 1,
            retryOf: current.id,
          }));
        }
      } catch (error) {
        if (error instanceof RunBudgetExceeded) {
          sendRateLimited(response, error.retryAfterSeconds, 'workspace_run_budget');
          return HANDLED;
        }
        const status = error instanceof WorkspaceAccessDenied
          ? 403
          : error instanceof InvalidRunTransition || error instanceof RunConflict
            ? 409
            : error instanceof AgentInputRejected
              ? 422
              : 503;
        send(response, status, { error: status === 403 ? 'scope' : status === 409 ? 'run_transition' : 'runtime_unavailable' });
      }
      return HANDLED;
    }

    const scheduleMutation = /^\/api\/workspace\/schedules\/([^/]+)\/run$/u.exec(path);
    if (scheduleMutation !== null && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, true)) {
        send(response, 401, { error: 'voice_binding' });
        return HANDLED;
      }
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }
      const schedules = this.#scheduleStore;
      if (schedules === undefined || this.#agent === undefined) {
        send(response, 503, { error: 'runtime_unavailable' });
        return HANDLED;
      }
      let scheduleId: string;
      try {
        scheduleId = decodeURIComponent(scheduleMutation[1] ?? '');
      } catch {
        send(response, 400, { error: 'schedule_id' });
        return HANDLED;
      }
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const requestId = body?.['requestId'];
      if (typeof requestId !== 'string' || requestId.trim() === '' || requestId.length > 160 || requestId.includes('\0')) {
        send(response, 422, { error: 'request_id' });
        return HANDLED;
      }
      const workspace = workspaceCollection(account.email);
      const runBudget = this.#privateRunLimit.check(
        workspace,
        this.#now(),
        `schedule:${scheduleId}:${requestId}`,
      );
      if (!runBudget.allowed) {
        sendRateLimited(response, runBudget.retryAfterSeconds, 'workspace_run_budget');
        return HANDLED;
      }
      try {
        await this.#prepareRuntime(workspace);
        send(response, 200, await runScheduleNow({
          store: schedules,
          workspace,
          scheduleId,
          requestId,
          run: (schedule, key) => this.#runScheduled(schedule, key),
        }));
      } catch {
        send(response, 409, { error: 'schedule_run' });
      }
      return HANDLED;
    }

    /**
     * The public workspace is evidence, not a shared scratchpad.
     *
     * Agent manifests correctly prohibit authoritative memory writeback, but a
     * run still persists its task, lifecycle, Context Pack and result in the
     * runtime store and spends two provider calls. An anonymous endpoint would
     * therefore let any visitor mutate public run history and make unbounded
     * spend possible across serverless instances. Judges can inspect the
     * accepted recorded run; creating new work requires an authenticated,
     * workspace-scoped route with CSRF and durable per-workspace budgets.
     */
    if ((path === '/api/explore/agent/run' || path === '/api/demo/agent/run') && method === 'POST') {
      send(response, 403, { error: 'public_preview_read_only' });
      return HANDLED;
    }

    if (path === '/api/workspace/ingest' && method === 'POST') {
      if (!csrfOk(request, cookies)) {
        send(response, 403, { error: 'csrf' }, this.#csrfCookie(cookies));
        return HANDLED;
      }
      if (!voiceBindingOk(request, cookies, false)) {
        send(response, 401, { error: 'voice_binding' });
        return HANDLED;
      }
      if (this.#siteOrigin !== undefined
        && !exactVoiceOrigin(firstHeader(request.headers.origin), this.#siteOrigin)) {
        send(response, 403, { error: 'permission' });
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

      const workspace = workspaceCollection(account.email);
      const ingestBudget = this.#privateIngestLimit.check(workspace, this.#now());
      if (!ingestBudget.allowed) {
        sendRateLimited(response, ingestBudget.retryAfterSeconds, 'workspace_ingest_budget');
        return HANDLED;
      }

      try {
        const report = await ingestInto(
          workspace,
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
        send(response, 200, { ok: true, ...serializeIngestReport(report) });
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

    /**
     * A question in a sentence, over the corpus anybody can read.
     *
     * Same resolver, same evidence, same abstentions. What is new is only that
     * the caller does not have to already know the vocabulary, which is the
     * difference between a product and an API somebody has read the docs for.
     */
    if ((path === '/api/explore/query' || path === '/api/demo/query') && method === 'POST') {
      let body: Record<string, unknown> | null;
      try {
        body = await readJsonBody(request);
      } catch (error) {
        send(response, error instanceof BodyTooLarge ? 413 : 400, { error: 'body' });
        return HANDLED;
      }
      const text = body?.['question'];
      if (typeof text !== 'string' || text.trim() === '' || text.length > 300) {
        send(response, 422, invalidRequest('question_unreadable'));
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
      const source = openSource();
      try {
        send(response, 200, await plannedAskEnvelope(
          source,
          text,
          await knownSubjects(source),
          ASK_TIMEOUT_MS,
        ));
      } catch {
        send(response, 503, { error: 'context_unavailable' });
      }
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

      // Authenticate at the write boundary, after the bounded body read. A
      // credential rotation during request upload must revoke this mutation.
      const account = await this.#accountFor(cookies);
      if (account === null) {
        send(response, 401, { error: 'session' });
        return HANDLED;
      }

      try {
        await this.#store.updateWorkspace(account.email, name.trim());
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
    if (!this.#allowPasswordSignup) {
      // HydraDB's document upsert has no conditional-create/CAS primitive. A
      // hosted same-email signup race could therefore replace credentials. The
      // Google path proves address ownership and is the only hosted creator
      // until identities live behind a unique transactional constraint.
      send(response, 403, { error: 'google_required' });
      return HANDLED;
    }
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
      /**
       * The code is generated here and returned exactly once.
       *
       * Only its hash is stored, so this response is the only moment it exists
       * anywhere it can be read. That is the point and it is what the screen
       * has to say: nothing here can send it again, because nothing here can
       * recover it either.
       */
      const recovery = newRecoveryCode();
      const created = await this.#store.create({
        email,
        passwordHash: await hashPassword(password),
        authProvider: 'password',
        providerSubject: null,
        sessionVersion: newSessionVersion(),
        createdAt: new Date(now).toISOString(),
        workspace: null,
        onboarded: false,
        recoveryHash: await hashPassword(canonicalRecoveryCode(recovery)),
      });
      if (created === null) {
        send(response, 409, { error: 'exists' });
        return HANDLED;
      }
      const token = await this.#store.startSession(email, now, created.sessionVersion);
      send(response, 201, { signedIn: true, recoveryCode: recovery }, [this.#sessionCookie(token)]);
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
    const headers: Record<string, string | string[]> = {
      Location: to,
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    };
    if (cookies.length > 0) headers['Set-Cookie'] = [...cookies];
    response.writeHead(302, headers);
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
  #googleStart(request: IncomingMessage, response: ServerResponse): Handled {
    const google = this.#google;
    if (google === undefined) return this.#redirect(response, '/signin?google=unconfigured');
    const verdict = this.#googleStartLimit.check(sourceKey(request), this.#now());
    if (!verdict.allowed) return this.#redirect(response, '/signin?google=rate');

    const state = mintToken();
    const proof = newGoogleAuthorizationProof();
    const cookie = googleAttemptCookie(state);
    return this.#redirect(response, authorizeUrl(google, state, proof), [
      serialiseCookie(cookie, JSON.stringify({ state, codeVerifier: proof.codeVerifier, nonce: proof.nonce }), {
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
    const url = new URL(request.url ?? '/', 'http://placeholder');
    const state = url.searchParams.get('state');
    // State is always a 43-character base64url proof minted by Lacuna. Reject
    // malformed values before hashing attacker-controlled query bytes or
    // looking up a dynamically named cookie.
    const cookie = state !== null && GOOGLE_PROOF_SHAPE.test(state)
      ? googleAttemptCookie(state)
      : null;
    const clear = cookie === null ? [] : [clearCookie(cookie, this.#secure)];
    if (google === undefined) return this.#redirect(response, '/signin?google=unconfigured', clear);

    const attempt = parseGoogleAttempt(cookie === null ? undefined : cookies[cookie]);
    const expected = attempt?.state;
    if (
      typeof expected !== 'string' || expected === '' || state === null
      || state.length !== expected.length
      || !sameDigest(hashToken(state), hashToken(expected))
    ) {
      return this.#redirect(response, '/signin?google=state', clear);
    }

    // Even a cancelled authorization is only meaningful when it belongs to
    // the browser attempt that started it. Checking state before honoring the
    // provider's error prevents a forged cancellation callback from consuming
    // a real in-flight attempt (and keeps every callback outcome CSRF-bound).
    if (url.searchParams.get('error') !== null) {
      return this.#redirect(response, '/signin?google=cancelled', clear);
    }

    const code = url.searchParams.get('code');
    if (code === null || code === '' || code.length > GOOGLE_CODE_MAX_CHARS) {
      return this.#redirect(response, '/signin?google=code', clear);
    }

    const codeVerifier = attempt?.codeVerifier;
    const expectedNonce = attempt?.nonce;
    if (typeof codeVerifier !== 'string' || codeVerifier === ''
      || typeof expectedNonce !== 'string' || expectedNonce === '') {
      return this.#redirect(response, '/signin?google=state', clear);
    }

    if (!await this.#store.available()) {
      return this.#redirect(response, '/signin?google=store', clear);
    }

    let identity;
    try {
      identity = await identityFromCode(google, code, fetch, { codeVerifier, expectedNonce });
    } catch (error) {
      return this.#redirect(
        response,
        `/signin?google=${error instanceof GoogleAuthError && error.message === 'the Google provider timed out' ? 'timeout' : 'identity'}`,
        clear,
      );
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
          authProvider: 'google',
          providerSubject: identity.subject,
          sessionVersion: newSessionVersion(),
          createdAt: new Date(this.#now()).toISOString(),
          workspace: null,
          onboarded: false,
          recoveryHash: null,
        });
        // Null means the address was taken between the read and the write, which
        // means an account exists and signing in is still the right outcome.
        account = created ?? await this.#store.find(identity.email);
        if (account === null) return this.#redirect(response, '/signin?google=store', clear);
      }

      // A verified address alone is not enough to merge providers. The only
      // exception is a one-time operator-approved migration for one exact
      // legacy address. Google still proves the address and stable subject;
      // the server-side allowlist supplies the separate administrative proof.
      const binding = googleBinding(account, identity);
      if (!binding.allowed) {
        if (
          binding.failure !== 'legacy_unbound'
          || this.#legacyGoogleMigrationEmail !== identity.email
        ) {
          return this.#redirect(response, `/signin?google=${binding.failure}`, clear);
        }

        // Resolve the expensive Argon2 decoy before the eligibility re-read so
        // no local computation widens the remaining non-atomic write window.
        const replacementPasswordHash = await decoy();
        const replacementSessionVersion = newSessionVersion();

        // Re-read at the write boundary. HydraDB does not offer conditional
        // document updates, so this cannot be a CAS, but it prevents a stale
        // callback from knowingly replacing a record whose credential epoch or
        // provider changed after the first read. A partially bound legacy row
        // is also refused instead of guessed into ownership.
        const current = await this.#store.find(identity.email);
        if (
          current === null
          || current.authProvider !== undefined
          || (current.providerSubject !== undefined && current.providerSubject !== null)
          || (current.sessionVersion ?? '') !== (account.sessionVersion ?? '')
        ) {
          return this.#redirect(response, '/signin?google=legacy_unbound', clear);
        }

        // Migration makes Google the sole credential. Rotating the credential
        // epoch invalidates every legacy session; replacing both password
        // recovery paths prevents an old secret from remaining a hidden second
        // provider after the record says it is Google-owned.
        const migrated: Account = {
          ...current,
          passwordHash: replacementPasswordHash,
          authProvider: 'google',
          providerSubject: identity.subject,
          sessionVersion: replacementSessionVersion,
          recoveryHash: null,
        };
        await this.#store.update(migrated);
        account = migrated;
      }

      const token = await this.#store.startSession(account.email, this.#now(), account.sessionVersion);
      return this.#redirect(response, this.#afterSignIn(account), [...clear, this.#sessionCookie(token)]);
    } catch {
      return this.#redirect(response, '/signin?google=store', clear);
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
      const token = await this.#store.startSession(email, this.#now(), account.sessionVersion);
      send(response, 200, { signedIn: true }, [this.#sessionCookie(token)]);
    } catch (error) {
      if (error instanceof CredentialChanged) {
        send(response, 401, { error: 'credentials' });
      } else {
        send(response, error instanceof StoreUnavailable ? 503 : 500, { error: 'store' });
      }
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
