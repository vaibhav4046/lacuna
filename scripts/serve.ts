import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { ApiRouter } from '../src/api/router.js';
import { evaluationRows } from '../src/report/evaluations.js';
import { AccountStore } from '../src/auth/store.js';
import { runDoctor } from '../src/cli/doctor.js';
import { doctorPayload } from '../src/cli/json.js';
import { NodeSource } from '../src/hydra/node-source.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { loadArtifacts } from '../src/report/load.js';
import { buildDemo } from '../src/server/examples.js';
import { FixedWindow } from '../src/server/ratelimit.js';
import { createHandler } from '../src/server/server.js';
import { describeNode } from '../src/view/proof.js';

/**
 * Serves the site against a running HydraDB node.
 *
 *   npm run serve
 *   PORT=8080 npm run serve
 *
 * Binds to loopback by default. The bearer token in .env.local is for a node on
 * this machine, and a default that quietly listens on every interface is how a
 * local demo becomes an open proxy to it.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

const DEFAULT_PORT = 3014;

function port(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

const config = loadHydraConfig();
const demo = buildDemo();
// Read once, here, so a missing or malformed artifact fails at start up with a
// path in the message rather than on the first request for an evidence page.
const artifacts = loadArtifacts();

// Accounts live outside the graph and outside the repository. The default is
// gitignored, and the directory is created on first write rather than at start
// up, so a read-only checkout still serves every public page.
const store = new AccountStore(process.env['LACUNA_ACCOUNTS_DIR'] ?? '.lacuna-store');

// The same six checks `lacuna doctor` runs, in the same order, from the same
// function. The application shows HYDRADB CONNECTED only when this says so.
const HEALTH_TIMEOUT_MS = 5_000;
const health = async (): Promise<unknown> => doctorPayload(await runDoctor(process.env, HEALTH_TIMEOUT_MS, {
  root: new URL('..', import.meta.url),
  requiredNode: '>=20.11.0',
}));

const server = createServer(createHandler({
  client: new HydraClient(config),
  node: describeNode(config),
  examples: demo.examples,
  facts: demo.facts,
  inventory: demo.inventory,
  artifacts,
  // One page load is three requests, so this is roughly forty page loads a
  // minute from one address: generous for a reader, a ceiling for a script.
  limiter: new FixedWindow({ limit: 120, windowMs: 60_000, maxKeys: 4_096 }),
  // Secure cookies need TLS, and this listens on plain HTTP for local work.
  // Set LACUNA_SECURE_COOKIES=1 when something terminates TLS in front.
  api: new ApiRouter({
    store,
    secure: process.env['LACUNA_SECURE_COOKIES'] === '1',
    health,
    // The same client and the same corpus the pages use. One core.
    source: () => new NodeSource(new HydraClient(config)),
    inventory: demo.inventory,
    evaluations: evaluationRows(artifacts.bench),
  }),
}));

// Defaults here are minutes long, which is a long time to hold a socket open
// against a process whose whole job is to answer in milliseconds.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

const host = process.env['HOST'] ?? '127.0.0.1';
const listenOn = port();

server.listen(listenOn, host, () => {
  process.stdout.write(
    `Lacuna on http://${host}:${listenOn}\n`
    + `  graph ${config.graph}, namespace ${config.namespace}, cell ${config.cell}\n`
    + `  ${demo.examples.length} example questions, `
    + `${demo.facts.sessions} sessions, ${demo.facts.claims} claims\n`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // A keep-alive socket that is idle will not close on its own in time.
    server.closeIdleConnections();
  });
}
