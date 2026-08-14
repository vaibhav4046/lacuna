import { createServer } from 'node:http';

import { createSnapshotHandler } from '../src/snapshot/serve.js';

/**
 * Serves the site from the recorded snapshot, exactly as the deployment does.
 *
 *   npm run serve:snapshot
 *   PORT=8080 npm run serve:snapshot
 *
 * No node, no .env.local, no token: the handler comes from the same
 * composition root as api/index.ts, with the same artifact-root argument, so
 * what this serves is what the deployment serves. Port 3015 by default so it
 * can run beside the live server on 3014.
 */

const DEFAULT_PORT = 3015;

function port(): number {
  const raw = process.env['PORT'];
  if (raw === undefined || raw.trim() === '') return DEFAULT_PORT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

const server = createServer(createSnapshotHandler(process.cwd()));

// Defaults here are minutes long, which is a long time to hold a socket open
// against a process whose whole job is to answer in milliseconds.
server.headersTimeout = 10_000;
server.requestTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 64;

const host = process.env['HOST'] ?? '127.0.0.1';
const listenOn = port();

server.listen(listenOn, host, () => {
  process.stdout.write(`Lacuna (snapshot replay) on http://${host}:${listenOn}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    // A keep-alive socket that is idle will not close on its own in time.
    server.closeIdleConnections();
  });
}
