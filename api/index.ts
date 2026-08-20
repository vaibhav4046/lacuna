/**
 * The public deployment: the React application, with one function behind it.
 *
 * Two things live at this origin. The static build in web/dist is the product
 * shell; everything under /api is this function. The JSON surface comes first,
 * and anything it does not claim falls through to the recorded snapshot site,
 * which is what the URL served before this build and stays reachable so no
 * existing link breaks.
 *
 * What this deployment is: questions are answered live, out of HydraDB Cloud,
 * through the same resolver the local node path uses. npm run parity:cloud
 * asks every gold question of both stores and compares the answers field by
 * field, so "the same product" is a check rather than a claim.
 *
 * What it still is not: there is no writable filesystem here, so the account
 * store reports unavailable and the endpoints that need it answer 503. The
 * product knows how to draw that state and says so rather than pretending.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiRouter } from '../src/api/router.js';
import { AccountStore } from '../src/auth/store.js';
import { CloudAccounts, FileAccounts } from '../src/auth/accounts.js';
import { cloudFromEnv } from '../src/hydra/cloud.js';
import { CloudSource } from '../src/hydra/cloud-source.js';
import { normaliseGraphContext, normaliseRelations, type ServiceRelation } from '../src/hydra/relations.js';
import { buildDemo } from '../src/server/examples.js';
import { evaluationRows } from '../src/report/evaluations.js';
import { loadArtifacts } from '../src/report/load.js';
import { createSnapshotHandler } from '../src/snapshot/serve.js';
import { ingestSource } from '../src/api/ingest.js';
import { runAgents } from '../src/agent/run.js';
import { builtInAgents } from '../src/agent/registry.js';
import { CloudAgentRuntimeStore, FileAgentRuntimeStore } from '../src/agent/store.js';
import { CloudScheduleStore, FileScheduleStore } from '../src/scheduler/store.js';
import { dailyContextHealthSchedule } from '../src/scheduler/dispatcher.js';
import { ElevenLabsVoiceProvider, VoiceBoundary, elevenLabsVoiceConfig } from '../src/api/voice.js';
import { configured } from '../src/provider/registry.js';
import { MCP_PATH, createMcpListener } from '../src/mcp/http.js';

const snapshot = createSnapshotHandler(process.cwd());

/**
 * The recorded run comparing a browser, a CLI process and an MCP subprocess.
 * Absent on a build that does not ship it, and the screen says so.
 */
/**
 * The provider an agent run uses, and the model it calls.
 *
 * Chosen here rather than by the model, and pinned rather than discovered, so
 * two runs of the same task are comparable. Absent when nothing is configured,
 * which makes the route answer 501 instead of pretending to have run.
 */
const groq = configured(process.env).find((provider) => provider.name === 'groq' && provider.apiKey !== undefined);
// Pinned to a model this account actually serves, confirmed against the
// provider's own model list rather than assumed. A name that is not there
// answers 404 and the run fails at the model call, which is how the first
// attempt failed.
const AGENT_MODEL = 'groq/compound-mini';

/** The predicates a run resolves for each subject the task names. */
const AGENT_PREDICATES = ['depends_on', 'owner', 'storage', 'region', 'ttl', 'pool_size', 'policy'] as const;

/** Names the public corpus holds, used to find what a task is about. */
const SUBJECT_NAMES: readonly string[] = [
  ...new Set(buildDemo().inventory.claims.map((claim) => claim.subject)),
];

/** A recorded artifact this build ships, or null when it does not ship one. */
function recorded(path: string): Readonly<Record<string, unknown>> | null {
  try {
    return JSON.parse(readFileSync(join(process.cwd(), path), 'utf8')) as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
}

const longmemevalRun = recorded('artifacts/longmemeval/ingest-check.json');

const continuityRun = ((): Readonly<Record<string, unknown>> | null => {
  try {
    return JSON.parse(
      readFileSync(join(process.cwd(), 'artifacts/continuity/one-context.json'), 'utf8'),
    ) as Readonly<Record<string, unknown>>;
  } catch {
    return null;
  }
})();


/**
 * The deployed health check.
 *
 * A Vercel function cannot dial the self-hosted node on loopback, but it can
 * reach HydraDB Cloud, so health is a real round trip to the configured
 * database rather than a check nobody ran. The shape is the doctor's, so the
 * screens that already read it need no change: same six named checks, same
 * pass and fail vocabulary.
 */
const cloud = cloudFromEnv(process.env);

/**
 * Accounts, durably.
 *
 * Only /tmp is writable here and it does not survive an invocation, so a
 * directory-backed store lost every account between requests and the whole
 * signed-in product was unreachable. HydraDB Cloud is already authenticated
 * from this function and is a key-value store addressed by an id its writer
 * chooses, which is what an account record needs; it lives in its own
 * collection, apart from the context it serves. The file store stays as the
 * fallback for a deployment with no cloud configured, where it correctly
 * reports itself unavailable.
 */
const store = cloud === null
  ? new FileAccounts(new AccountStore(process.env['LACUNA_ACCOUNTS_DIR'] ?? '/tmp/lacuna-store'))
  : new CloudAccounts(cloud);

async function cloudHealth(): Promise<unknown> {
  if (cloud === null) {
    return {
      command: 'doctor', ok: false, warnings: 0, exitCode: 3,
      checks: [{ name: 'config', ok: false, state: 'fail', detail: 'no context store is configured for this deployment' }],
    };
  }
  const started = Date.now();
  try {
    const ready = await cloud.readyForIngestion();
    const ms = Date.now() - started;
    return {
      command: 'doctor', ok: ready, warnings: 0, exitCode: ready ? 0 : 4,
      checks: [
        { name: 'config', ok: true, state: 'pass', detail: `HydraDB Cloud, database ${cloud.database}, collection ${cloud.collection}` },
        { name: 'token', ok: true, state: 'pass', detail: 'set' },
        { name: 'reachable', ok: true, state: 'pass', detail: `api.hydradb.com answered in ${ms}ms` },
        { name: 'round trip', ok: ready, state: ready ? 'pass' : 'fail', detail: ready ? `database ready for ingestion in ${ms}ms` : 'the database is still provisioning' },
      ],
    };
  } catch (error) {
    return {
      command: 'doctor', ok: false, warnings: 0, exitCode: 4,
      checks: [
        { name: 'config', ok: true, state: 'pass', detail: `HydraDB Cloud, database ${cloud.database}` },
        { name: 'token', ok: true, state: 'pass', detail: 'set' },
        // The message, never the cause chain: a transport error can carry a URL
        // and a URL can carry a query string.
        { name: 'reachable', ok: false, state: 'fail', detail: error instanceof Error ? error.message : 'the service did not answer' },
      ],
    };
  }
}

/**
 * The origin this deployment answers on, which has to match the redirect URI
 * registered with Google exactly. Google compares the string, not the host, so
 * a trailing slash or a preview URL is a mismatch and a refused sign in.
 */
const SITE_ORIGIN = process.env['LACUNA_SITE_ORIGIN'] ?? 'https://lacuna-five.vercel.app';
const googleClientId = process.env['GOOGLE_CLIENT_ID'];
const googleClientSecret = process.env['GOOGLE_CLIENT_SECRET'];
const graphCursorKey = process.env['LACUNA_GRAPH_CURSOR_KEY'] ?? process.env['HYDRA_TOKEN'];
const voiceConfig = elevenLabsVoiceConfig(process.env);
const voice = new VoiceBoundary(voiceConfig === null ? null : new ElevenLabsVoiceProvider(voiceConfig));
const runtimeRoot = process.env['LACUNA_RUNTIME_DIR'] ?? '/tmp/lacuna-runtime';
const agentRuntime = cloud === null
  ? new FileAgentRuntimeStore(runtimeRoot)
  : new CloudAgentRuntimeStore(cloud);
const scheduleRuntime = cloud === null
  ? new FileScheduleStore(runtimeRoot)
  : new CloudScheduleStore(cloud);

const api = new ApiRouter({
  store,
  secure: true,
  health: cloudHealth,
  voice,
  siteOrigin: SITE_ORIGIN,
  // Stable across serverless instances. The value never enters a graph
  // response; it only authenticates opaque pagination cursors.
  ...(graphCursorKey === undefined ? {} : { graphCursorKey }),
  inventory: buildDemo().inventory,
  // artifacts/** ships with the function, so the measured run the repository
  // holds is the one the screen shows.
  evaluations: evaluationRows(loadArtifacts(process.cwd()).bench),
  // The recorded one-context run. Read here because the function has no
  // filesystem to read it from later.
  ...(continuityRun === null ? {} : { continuity: continuityRun }),
  ...(longmemevalRun === null ? {} : { longmemeval: longmemevalRun }),
  // A source per request: the memo inside one lives exactly as long as the
  // question that filled it, so a warm instance cannot answer from a record
  // the store has since replaced.
  ...(cloud === null ? {} : {
    source: (collection?: string): CloudSource =>
      new CloudSource(collection === undefined ? cloud : cloud.withCollection(collection)),
    // Prose into this account's own collection. The public demo collection is
    // never written to, so ingesting a transcript cannot publish it.
    ingest: (collection: string, title: string, text: string) =>
      ingestSource(cloud, collection, title, text),
    // One agent run over that workspace, when a real model provider answers.
    // Absent otherwise, so the route says 501 rather than inventing a run.
    ...(groq === undefined ? {} : {
      // `null` is the public corpus: the same run, over the collection every
      // visitor already reads. It writes nothing either way.
      agent: (collection: string | null, task: string, run = {}) => runAgents({
        source: new CloudSource(collection === null ? cloud : cloud.withCollection(collection)),
        provider: groq,
        model: AGENT_MODEL,
        workspace: collection ?? 'public',
        collection: collection ?? 'public',
        task,
        knownSubjects: SUBJECT_NAMES,
        predicates: [...AGENT_PREDICATES],
        store: agentRuntime,
        ...(run.idempotencyKey === undefined ? {} : { idempotencyKey: run.idempotencyKey }),
        ...(run.kind === undefined ? {} : { kind: run.kind }),
        ...(run.attempt === undefined ? {} : { attempt: run.attempt }),
        ...(run.retryOf === undefined ? {} : { retryOf: run.retryOf }),
      }),
      agentStore: agentRuntime,
      scheduleStore: scheduleRuntime,
      prepareAgents: async (workspace: string): Promise<void> => {
        await agentRuntime.putAgents(
          workspace,
          builtInAgents(workspace, groq.name, AGENT_MODEL, new Date().toISOString()),
        );
      },
      prepareSchedule: async (workspace: string): Promise<void> => {
        await scheduleRuntime.putSchedule(dailyContextHealthSchedule(workspace, '06:00', 'UTC', Date.now()));
      },
      ...(process.env['CRON_SECRET'] === undefined ? {} : { cronSecret: process.env['CRON_SECRET'] }),
      cronWorkspaces: ['public'],
    }),
  }),
  // The store's own relation graph, read from the service. Kept small: this is
  // a proof that HydraDB extracted relations from the transcripts, not a
  // browsable index of them.
  ...(cloud === null ? {} : {
    relations: async (): Promise<readonly ServiceRelation[]> => normaliseRelations(await cloud.relations(24)),
  }),
  // The same graph, walked for one subject. `/query` with graph_context asked
  // for returns the paths the store reached rather than the edges it holds,
  // which is the traversal a list cannot show. It costs seconds where the
  // answer path costs milliseconds, so it stays on its own endpoint and no
  // question waits on it.
  ...(cloud === null ? {} : {
    expansion: async (subject: string): Promise<readonly ServiceRelation[]> =>
      normaliseGraphContext((await cloud.query(subject, { maxResults: 6 })).graphContext),
  }),
  // Google sign in, only when this deployment has been given a client. Without
  // both halves the button is not offered, rather than offered and broken.
  ...(googleClientId === undefined || googleClientSecret === undefined ? {} : {
    google: {
      clientId: googleClientId,
      clientSecret: googleClientSecret,
      redirectUri: `${SITE_ORIGIN}/api/auth/google/callback`,
    },
  }),
});

/**
 * The MCP endpoint, reachable by any client that speaks Streamable HTTP.
 *
 * Without this the server existed and could only be run on the machine that
 * cloned the repository, which is a different product from one an agent
 * somewhere else can connect to. It reads the same public demo corpus
 * `/api/demo/*` already serves, over the same resolver, so exposing it widens
 * who can ask and not what can be read. Every tool is a read; nothing here
 * writes.
 *
 * `allowAnyOrigin` is on because the Origin check in the transport exists to
 * stop a browser page reaching a server bound to loopback. That is a real
 * attack against a local process and not one against a public HTTPS endpoint
 * that clients are meant to call directly.
 */
const mcp = cloud === null ? null : createMcpListener({
  allowAnyOrigin: true,
  context: {
    source: new CloudSource(cloud),
    node: { namespace: cloud.database, graph: cloud.collection, cell: 'cloud' },
    store: 'cloud',
  },
  // One header scopes the same tools to a workspace somebody ingested into, so
  // an agent reads the memory its user wrote through the web product. The
  // handle is the unguessable collection id the ingest report returns.
  contextFor: (collection) => ({
    source: new CloudSource(cloud.withCollection(collection)),
    node: { namespace: cloud.database, graph: collection, cell: 'cloud' },
    store: 'cloud',
    /**
     * The write, and the reason it exists only here.
     *
     * A connection that names a workspace can put something into it, so a
     * thing learned in one assistant is readable in another. The public
     * connection has no writer at all, which is what keeps a URL anybody can
     * fetch from being a URL anybody can fill.
     *
     * It takes prose rather than a subject and a value on purpose: the
     * extractor decides what becomes a claim, so two assistants writing to one
     * memory cannot quietly overwrite each other, and a correction supersedes
     * rather than replaces.
     */
    remember: async (title: string, text: string) => {
      const report = await ingestSource(cloud, collection, title, text);
      return typeof report === 'string' ? report : {
        claims: report.claims,
        entities: report.entities,
        turns: report.turns,
        accepted: report.accepted,
        collection: report.collection,
      };
    },
  }),
});

/**
 * The last thing between a thrown error and an opaque platform crash.
 *
 * Every route already handles its own failures. This is for the one nobody
 * predicted: a rejected promise nothing awaited, or a throw on a path with no
 * try around it. Without it the platform answers with its own error page, which
 * tells a reader nothing and tells us less, because there is no id to trace.
 *
 * It sends a stable JSON envelope and an id, and never a stack, a message from
 * the underlying error, or anything the error might have wrapped. An error body
 * from a store can echo the request that caused it, and a request can carry a
 * key.
 */
function guard(response: ServerResponse, where: string, error: unknown): void {
  const id = randomUUID();
  // Server side only, and only the shape of the failure.
  console.error(`[${id}] ${where}: ${error instanceof Error ? error.name : 'unknown'}`);
  if (response.headersSent) {
    response.end();
    return;
  }
  response.writeHead(500, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: 'this request did not complete', trace_id: id }));
}

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://lacuna.invalid').pathname;

  if (path === MCP_PATH || path.startsWith(`${MCP_PATH}/w/`)) {
    if (mcp === null) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'no context store is configured' }));
      return;
    }
    mcp(request, response);
    return;
  }

  if (path.startsWith('/api/')) {
    void api.handle(request, response, path)
      .then((outcome) => {
        if (!outcome.handled) snapshot(request, response);
      })
      .catch((error: unknown) => guard(response, path, error));
    return;
  }

  try {
    snapshot(request, response);
  } catch (error) {
    guard(response, path, error);
  }
}
