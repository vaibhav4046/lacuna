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
import { CloudMcpCapabilities } from '../src/auth/mcp-capability-store.js';
import { cloudFromEnv } from '../src/hydra/cloud.js';
import { CloudSource } from '../src/hydra/cloud-source.js';
import { createCloudImpactReadPort } from '../src/hydra/impact-read.js';
import { normaliseGraphContext, normaliseRelations, type ServiceRelation } from '../src/hydra/relations.js';
import { buildDemo } from '../src/server/examples.js';
import { evaluationRows } from '../src/report/evaluations.js';
import { loadArtifacts } from '../src/report/load.js';
import { createSnapshotHandler } from '../src/snapshot/serve.js';
import { ingestPreparedSource, ingestSource } from '../src/api/ingest.js';
import { runAgents } from '../src/agent/run.js';
import { builtInAgents } from '../src/agent/registry.js';
import { CloudAgentRuntimeStore, FileAgentRuntimeStore } from '../src/agent/store.js';
import { CloudScheduleStore, FileScheduleStore } from '../src/scheduler/store.js';
import { dailyContextHealthSchedule } from '../src/scheduler/dispatcher.js';
import { ElevenLabsVoiceProvider, VoiceBoundary, elevenLabsVoiceConfig } from '../src/api/voice.js';
import { configured } from '../src/provider/registry.js';
import { MCP_PATH, createMcpListener } from '../src/mcp/http.js';
import { PREDICATE_NAMES } from '../src/corpus/types.js';
import { planVoiceIntent } from '../src/voice/intent.js';
import { catalogue } from '../src/connectors/catalog.js';
import { CloudConnectorStore } from '../src/connectors/store.js';
import { ConnectorRunner } from '../src/connectors/run.js';
import { FileConnectorService } from '../src/connectors/files.js';
import { GitHubImporter } from '../src/connectors/github.js';
import { GitLabImporter } from '../src/connectors/gitlab.js';
import { PinnedHttpsReader } from '../src/connectors/https.js';
import { FilePreviewTokenService, previewSigningKey } from '../src/connectors/preview-token.js';
import { CloudWebhookRecordStore } from '../src/connectors/webhook-store.js';
import {
  WebhookService,
  parseWebhookMasterKey,
  redactWebhookPath,
} from '../src/connectors/webhook.js';

/** 240s internal settlement plus a 30s platform cleanup margin. */
export const maxDuration = 270;

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
const agentProvider = configured(process.env).find((provider) => (
  (provider.name === 'groq' || provider.name === 'perplexity') && provider.apiKey !== undefined
));
// Pinned to a model this account actually serves, confirmed against the
// provider's own model list rather than assumed. A name that is not there
// answers 404 and the run fails at the model call, which is how the first
// attempt failed.
const AGENT_MODEL = process.env['LACUNA_AGENT_MODEL']
  ?? (agentProvider?.name === 'perplexity' ? 'sonar' : 'groq/compound-mini');

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
const mcpCapabilities = cloud === null ? null : new CloudMcpCapabilities(cloud);
const connectorStore = cloud === null ? null : new CloudConnectorStore(cloud);
const filePreviewKey = previewSigningKey(process.env['LACUNA_FILE_PREVIEW_KEY']);
const connectorRunner = cloud === null || connectorStore === null ? null : new ConnectorRunner({
  store: connectorStore,
  ingest: (workspace, prepared, options) => ingestPreparedSource(cloud, workspace, prepared, options),
});
const githubImporter = connectorRunner === null ? null : new GitHubImporter();
const gitlabImporter = connectorRunner === null ? null : new GitLabImporter();
const httpsReader = connectorRunner === null ? null : new PinnedHttpsReader();
const fileConnector = connectorRunner === null || filePreviewKey === null ? null : new FileConnectorService({
  runner: connectorRunner,
  tokens: new FilePreviewTokenService({ key: filePreviewKey }),
  // Kept beside this function entry and included explicitly by vercel.json,
  // so import.meta.url resolves the same way in source and native output.
  parserIsolation: { workerUrl: new URL('./file-parser-worker.mjs', import.meta.url) },
});

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
const webhookMasterKey = parseWebhookMasterKey(process.env['LACUNA_WEBHOOK_KEY']);
const webhookService = (() => {
  if (cloud === null || connectorRunner === null || webhookMasterKey === null) return null;
  try {
    return new WebhookService({
      masterKey: webhookMasterKey,
      store: new CloudWebhookRecordStore(cloud),
      runner: connectorRunner,
      siteOrigin: SITE_ORIGIN,
    });
  } catch {
    return null;
  }
})();
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
  // The hosted account store has no atomic conditional-create primitive.
  // Google is therefore the only hosted account creator until identity data
  // moves behind a unique transactional constraint.
  allowPasswordSignup: false,
  ...(mcpCapabilities === null ? {} : { mcpCapabilities }),
  ...(connectorStore === null ? {} : { connectorStore }),
  ...(fileConnector === null ? {} : { fileConnector }),
  ...(githubImporter === null || gitlabImporter === null || httpsReader === null || connectorRunner === null
    ? {}
    : { githubImporter, gitlabImporter, httpsReader, connectorRunner }),
  ...(webhookService === null ? {} : { webhookService }),
  connectorCatalog: () => catalogue({
    webhookService: webhookService !== null,
    fileImport: fileConnector !== null,
    githubImport: githubImporter !== null && connectorRunner !== null,
    gitlabImport: gitlabImporter !== null && connectorRunner !== null,
    httpsImport: httpsReader !== null && connectorRunner !== null,
  }),
  secure: true,
  health: cloudHealth,
  voice,
  siteOrigin: SITE_ORIGIN,
  voiceIntent: planVoiceIntent,
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
    impact: (collection?: string) => createCloudImpactReadPort(
      collection === undefined ? cloud : cloud.withCollection(collection),
    ),
    // Prose into this account's own collection. The public demo collection is
    // never written to, so ingesting a transcript cannot publish it.
    ingest: (collection: string, title: string, text: string) =>
      ingestSource(cloud, collection, title, text),
    // One agent run over that workspace, when a real model provider answers.
    // Absent otherwise, so the route says 501 rather than inventing a run.
  ...(agentProvider === undefined ? {} : {
      // The router admits only an authenticated workspace here. The nullable
      // type remains at the injected boundary for compatibility, but anonymous
      // public run creation is refused before this function can be called.
      agent: (collection: string | null, task: string, run = {}) => runAgents({
        source: new CloudSource(collection === null ? cloud : cloud.withCollection(collection)),
        provider: agentProvider,
        model: AGENT_MODEL,
        workspace: collection ?? 'public',
        collection: collection ?? 'public',
        task,
        knownSubjects: SUBJECT_NAMES,
        // Keep the runtime on the same vocabulary ingestion writes. A former
        // hand-built subset omitted temporal fields such as runbook_owner and
        // included fields the corpus never stores, producing healthy-looking
        // runs with the wrong Context Pack.
        predicates: [...PREDICATE_NAMES],
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
            builtInAgents(workspace, agentProvider.name, AGENT_MODEL, new Date().toISOString()),
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
  ...(process.env['LACUNA_LEGACY_GOOGLE_MIGRATION_EMAIL'] === undefined ? {} : {
    legacyGoogleMigrationEmail: process.env['LACUNA_LEGACY_GOOGLE_MIGRATION_EMAIL'],
  }),
});

/**
 * The MCP endpoint, reachable by any client that speaks Streamable HTTP.
 *
 * Without this the server existed and could only be run on the machine that
 * cloned the repository, which is a different product from one an agent
 * somewhere else can connect to. It reads the same public demo corpus
 * `/api/demo/*` already serves, over the same resolver, so exposing it widens
 * who can ask and not what can be read. The public endpoint is read-only. A
 * private capability can additionally call the governed `remember` ingest.
 *
 * The deployed web origin is allowed explicitly. MCP clients such as a CLI do
 * not send Origin and remain supported, but another web page cannot reach the
 * public corpus or present a workspace capability from an arbitrary origin.
 */
const mcp = cloud === null || mcpCapabilities === null ? null : createMcpListener({
  allowedOrigins: [SITE_ORIGIN],
  context: {
    source: new CloudSource(cloud),
    node: { namespace: cloud.database, graph: cloud.collection, cell: 'cloud' },
    store: 'cloud',
  },
  // Private tools require an independently random, revocable bearer. The raw
  // capability never reaches HydraDB; its digest resolves to the server-derived
  // workspace collection and only then is a scoped context constructed.
  authorizeWorkspace: async (capability) => {
    const collection = await mcpCapabilities.resolve(capability);
    if (collection === null) return null;
    return {
      source: new CloudSource(cloud.withCollection(collection)),
      node: { namespace: cloud.database, graph: collection, cell: 'cloud' },
      store: 'cloud',
      /**
       * Prose enters the same governed extraction pipeline as the web ingest.
       * The extractor, not the caller, decides what may become a claim.
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
    };
  },
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
  console.error(`[${id}] ${redactWebhookPath(where)}: ${error instanceof Error ? error.name : 'unknown'}`);
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
