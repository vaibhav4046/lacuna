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
import { MCP_PATH, createMcpListener } from '../src/mcp/http.js';

const snapshot = createSnapshotHandler(process.cwd());


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

const api = new ApiRouter({
  store,
  secure: true,
  health: cloudHealth,
  inventory: buildDemo().inventory,
  // artifacts/** ships with the function, so the measured run the repository
  // holds is the one the screen shows.
  evaluations: evaluationRows(loadArtifacts(process.cwd()).bench),
  // A source per request: the memo inside one lives exactly as long as the
  // question that filled it, so a warm instance cannot answer from a record
  // the store has since replaced.
  ...(cloud === null ? {} : { source: (): CloudSource => new CloudSource(cloud) }),
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
});

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://lacuna.invalid').pathname;

  if (path === MCP_PATH) {
    if (mcp === null) {
      response.writeHead(503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'no context store is configured' }));
      return;
    }
    mcp(request, response);
    return;
  }

  if (path.startsWith('/api/')) {
    void api.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) snapshot(request, response);
    });
    return;
  }
  snapshot(request, response);
}
