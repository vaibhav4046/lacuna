/**
 * The composition root for serving answers from the recorded snapshot.
 *
 * Two things run this: the deployed function (api/index.ts) and the local
 * check (scripts/serve-snapshot.ts). They must be the same server or the
 * local check proves nothing, so the wiring lives here once and both import
 * it. The only difference from scripts/serve.ts is the transport — a replay
 * of recorded replies instead of a socket — and the `source` flag, which
 * makes every page say so.
 */

import { HydraClient } from '../hydra/client.js';
import type { HydraConfig } from '../hydra/config.js';
import { loadArtifacts } from '../report/load.js';
import { buildDemo } from '../server/examples.js';
import { FixedWindow } from '../server/ratelimit.js';
import { createHandler, type Handler } from '../server/server.js';
import { describeNode } from '../view/proof.js';
import { loadSnapshot, snapshotTransport } from './replay.js';

/**
 * `root` is the directory holding `artifacts/`. The deployed function passes
 * its working directory because a bundler has moved the compiled files;
 * locally it is the repository checkout.
 */
export function createSnapshotHandler(root?: string): Handler {
  const snapshot = loadSnapshot(root);

  const config: HydraConfig = {
    // Loopback and unroutable: the snapshot transport never opens a socket,
    // and if it ever did, this address refuses immediately.
    baseUrl: 'http://127.0.0.1:1',
    namespace: snapshot.node.namespace,
    graph: snapshot.node.graph,
    cell: snapshot.node.cell,
    token: 'snapshot-replay-unused',
  };

  const demo = buildDemo();

  return createHandler({
    client: new HydraClient(config, { fetch: snapshotTransport(snapshot) }),
    node: describeNode(config),
    examples: demo.examples,
    facts: demo.facts,
    inventory: demo.inventory,
    artifacts: loadArtifacts(root),
    // Behind a hosting proxy every request can arrive from the same socket
    // address, which folds all readers into one bucket. The per-address
    // budget from scripts/serve.ts would ration the whole audience out of
    // that bucket, so the ceiling is five times higher here: still a wall
    // for a script, no longer a wall for a demo day.
    limiter: new FixedWindow({ limit: 600, windowMs: 60_000, maxKeys: 4_096 }),
    source: 'snapshot',
  });
}
