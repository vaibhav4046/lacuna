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
import { cloudFromEnv } from '../src/hydra/cloud.js';
import { CloudSource } from '../src/hydra/cloud-source.js';
import { buildDemo } from '../src/server/examples.js';
import { createSnapshotHandler } from '../src/snapshot/serve.js';

const snapshot = createSnapshotHandler(process.cwd());

// A read-only filesystem makes this store report unavailable, which is exactly
// what it should do here: the endpoints answer 503 and the screens say the
// account store is not configured rather than failing in an unexplained way.
const store = new AccountStore(process.env['LACUNA_ACCOUNTS_DIR'] ?? '/tmp/lacuna-store');

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

const api = new ApiRouter({
  store,
  secure: true,
  health: cloudHealth,
  inventory: buildDemo().inventory,
  // A source per request: the memo inside one lives exactly as long as the
  // question that filled it, so a warm instance cannot answer from a record
  // the store has since replaced.
  ...(cloud === null ? {} : { source: (): CloudSource => new CloudSource(cloud) }),
});

export default function handler(request: IncomingMessage, response: ServerResponse): void {
  const path = new URL(request.url ?? '/', 'http://lacuna.invalid').pathname;
  if (path.startsWith('/api/')) {
    void api.handle(request, response, path).then((outcome) => {
      if (!outcome.handled) snapshot(request, response);
    });
    return;
  }
  snapshot(request, response);
}
