import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { HydraClient } from '../src/hydra/client';
import { loadHydraConfig } from '../src/hydra/config';
import { loadArtifacts } from '../src/report/load';
import { buildDemo } from '../src/server/examples';
import { FixedWindow } from '../src/server/ratelimit';
import { createHandler } from '../src/server/server';
import { describeNode } from '../src/view/proof';

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

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

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

const server = createServer(createHandler({
  client: new HydraClient(config),
  node: describeNode(config),
  examples: demo.examples,
  facts: demo.facts,
  artifacts,
  // One page load is three requests, so this is roughly forty page loads a
  // minute from one address: generous for a reader, a ceiling for a script.
  limiter: new FixedWindow({ limit: 120, windowMs: 60_000, maxKeys: 4_096 }),
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
