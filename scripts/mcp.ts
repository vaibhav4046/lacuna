import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { format } from 'node:util';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadHydraConfig } from '../src/hydra/config.js';
import { openSource } from '../src/hydra/open.js';
import { createMcpListener, MCP_PATH } from '../src/mcp/http.js';
import { describeNode } from '../src/mcp/result.js';
import { createMcpServer, SERVER_NAME, SERVER_VERSION, type ToolContext } from '../src/mcp/server.js';

/**
 * Run the MCP server.
 *
 *   npm run mcp -- --stdio
 *   npm run mcp -- --http --port 3015
 *
 * stdio is the primary transport: an MCP client spawns this process and talks
 * over the pipe, which needs no port and no origin policy. The HTTP transport
 * exists for clients that cannot spawn a process, and binds to loopback for the
 * same reason the web server does. The bearer token in .env.local is for a node
 * on this machine, and a default that quietly listens on every interface is how
 * a local demo becomes an open proxy to it.
 *
 * Every diagnostic goes to stderr. Under stdio, stdout is the JSON-RPC stream
 * and one stray line on it corrupts the session.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

const DEFAULT_PORT = 3015;

const USAGE = 'usage: npm run mcp -- --stdio | npm run mcp -- --http [--port 3015]';

interface Options {
  readonly transport: 'stdio' | 'http';
  readonly port: number;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`port must be an integer between 1 and 65535, got "${raw}"`);
  }
  return value;
}

function parseArgs(argv: readonly string[]): Options {
  let transport: 'stdio' | 'http' | null = null;
  let port: string | undefined = process.env['MCP_PORT'];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';

    if (arg === '--stdio') {
      transport = 'stdio';
    } else if (arg === '--http') {
      transport = 'http';
    } else if (arg === '--port') {
      port = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--port=')) {
      port = arg.slice('--port='.length);
    } else {
      throw new Error(`unrecognised argument "${arg}"\n${USAGE}`);
    }
  }

  if (transport === null) {
    throw new Error(`choose a transport\n${USAGE}`);
  }
  return { transport, port: parsePort(port) };
}

/**
 * Hands stdout to the protocol and gives the console somewhere else to go.
 *
 * Nothing in this repository writes to stdout, and the deliberate diagnostics
 * all go to stderr already. What this defends against is the accident: a
 * dependency printing a deprecation notice, a debug line left in during a
 * change, anything at all reaching `console.log` while the JSON-RPC stream is
 * open. One stray line on fd 1 corrupts the frame it lands in, and the client
 * reports a parse error rather than the thing that actually happened, which is
 * the worst kind of failure to debug. Rebinding costs nothing and turns that
 * accident into a readable line on stderr.
 *
 * Only the stdio branch does this. Under HTTP, stdout is nobody's transport
 * and a console line there is merely untidy.
 */
function sendConsoleToStderr(): void {
  const toStderr = (...parts: readonly unknown[]): void => {
    process.stderr.write(`${format(...parts)}
`);
  };
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  console.warn = toStderr;
  console.error = toStderr;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  // Whichever store this machine is configured for. LACUNA_PROFILE=cloud
  // makes this server read the same workspace production reads.
  const opened = openSource();
  const context: ToolContext = {
    source: opened.source,
    node: opened.client === null
      ? {
        namespace: opened.cloud?.database ?? 'unknown',
        graph: opened.cloud?.collection ?? 'unknown',
        cell: 'hydradb-cloud',
      }
      : describeNode(loadHydraConfig()),
    store: opened.profile,
  };

  if (options.transport === 'stdio') {
    sendConsoleToStderr();
    const server = createMcpServer(context);
    await server.connect(new StdioServerTransport());
    process.stderr.write(
      `${SERVER_NAME} ${SERVER_VERSION} on stdio, `
      + `namespace ${context.node.namespace}, graph ${context.node.graph}\n`,
    );

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void server.close().then(() => process.exit(0));
      });
    }
    return;
  }

  const host = process.env['HOST'] ?? '127.0.0.1';
  const server = createServer(
    createMcpListener({
      context,
      log: (line) => process.stderr.write(`${line}\n`),
    }),
  );

  // Same posture as the web server: short header and request windows, so a
  // half-open connection cannot hold a slot indefinitely.
  server.headersTimeout = 10_000;
  server.requestTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  await new Promise<void>((resolve) => {
    server.listen(options.port, host, resolve);
  });
  process.stderr.write(
    `${SERVER_NAME} ${SERVER_VERSION} on http://${host}:${options.port}${MCP_PATH}, `
    + `namespace ${context.node.namespace}, graph ${context.node.graph}\n`,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeIdleConnections();
    });
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
