import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import type { AskCore } from '../src/contract/result';
import { MCP_PATH } from '../src/mcp/http';

/**
 * Asks the same questions through the MCP server over stdio, through the same
 * server over its HTTP transport, and through the command line, and checks that
 * all three answers are the same value.
 *
 *   npm run parity
 *
 * All three surfaces wrap the same resolver, so this cannot fail on the
 * substance of an answer. What it can catch, and did catch, is them drifting
 * apart in how they name and shape what they return: a client that reads
 * `reason` from one and `reasonCode` from another is a client that has to be
 * written twice. The projection under test is the one in src/contract, and this
 * is the check that says the projection is what the surfaces actually emit
 * against a live node rather than what they are declared to emit.
 *
 * The two MCP surfaces share a tool implementation and differ only in transport,
 * so the HTTP case is here to exercise the transport: a real client doing a real
 * protocol handshake over a socket, against a listener started the way the
 * documentation says to start it.
 *
 * The reads a question needs are issued together and appended to the trace as
 * the node answers them, so the order of the trace is timing and moves between
 * two runs of the same command. The set of reads, their parameters and their row
 * counts do not move. The set is compared; the order is printed beside it so the
 * difference is visible rather than hidden by the comparison.
 *
 * Needs a node running. Nothing here prints configuration, and the payloads it
 * compares carry no credential.
 */

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MCP_SCRIPT = fileURLToPath(new URL('./mcp.ts', import.meta.url));
const CLI_SCRIPT = fileURLToPath(new URL('../bin/lacuna.js', import.meta.url));

const PROTOCOL_VERSION = '2025-06-18';
const REPLY_TIMEOUT_MS = 60_000;
const HTTP_PORT = 3015;

/** The fields a caller branches on. Timing and read epoch move; these do not. */
const CANONICAL = [
  'status',
  'answer',
  'reasonCode',
  'claimId',
  'supersededClaims',
  'evidence',
  'evidenceTotal',
  'sourceState',
] as const;

interface Question {
  readonly label: string;
  readonly subject: string;
  readonly predicate: string;
}

const CASES: readonly Question[] = [
  { label: 'answered', subject: 'Bellwether', predicate: 'beta_partner' },
  { label: 'abstained', subject: 'Meridian', predicate: 'migration_window' },
];

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed payload, trusted only as far as the fields this script reads. */
function asAskCore(value: unknown, surface: string): AskCore {
  if (!isRecord(value) || typeof value['status'] !== 'string') {
    throw new Error(`${surface} returned something that is not an answer`);
  }
  return value as unknown as AskCore;
}

function comparable(answer: AskCore): string {
  const out: Record<string, unknown> = {};
  for (const key of CANONICAL) out[key] = answer[key];
  out['queryShape'] = answer.queries
    .map((query) => ({ cypher: query.cypher, parameters: query.parameters, rows: query.rows }))
    .sort((left, right) => left.cypher.localeCompare(right.cypher));
  return JSON.stringify(out, null, 2);
}

/** The trace order, short enough to read on one line. */
function readOrder(answer: AskCore): string {
  return answer.queries.map((query) => query.cypher.slice(6, 26)).join(' | ');
}

async function overStdio(question: Question): Promise<AskCore> {
  const child = spawn(process.execPath, ['--import', 'tsx', MCP_SCRIPT, '--stdio'], { cwd: ROOT });
  const lines: string[] = [];
  const errors: string[] = [];
  let pending = '';

  child.stderr.on('data', (chunk: Buffer) => errors.push(chunk.toString()));
  child.stdout.on('data', (chunk: Buffer) => {
    pending += chunk.toString();
    let at = pending.indexOf('\n');
    while (at >= 0) {
      const line = pending.slice(0, at).trim();
      pending = pending.slice(at + 1);
      if (line !== '') lines.push(line);
      at = pending.indexOf('\n');
    }
  });

  const send = (message: unknown): void => {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  };

  const reply = (id: number): Promise<Record<string, unknown>> => new Promise((resolve, reject) => {
    const poll = setInterval(() => {
      for (const line of lines) {
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (isRecord(message) && message['id'] === id) {
          clearInterval(poll);
          clearTimeout(timer);
          resolve(message);
          return;
        }
      }
    }, 100);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`no reply to ${id} in ${REPLY_TIMEOUT_MS}ms: ${errors.join('')}`));
    }, REPLY_TIMEOUT_MS);
  });

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'lacuna-parity', version: '0.0.0' },
      },
    });
    await reply(1);
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'lacuna_ask',
        arguments: { subject: question.subject, predicate: question.predicate },
      },
    });
    const message = await reply(2);
    const result = message['result'];
    if (!isRecord(result)) {
      throw new Error(`lacuna_ask failed: ${JSON.stringify(message['error'])}`);
    }
    return asAskCore(result['structuredContent'], 'the MCP server');
  } finally {
    child.stdin.end();
    child.kill();
  }
}

interface Listener {
  readonly url: string;
  stop(): void;
}

/**
 * Starts the HTTP transport once for the whole run and waits for the line the
 * server writes to stderr after the socket is listening. One listener across
 * both questions is deliberate: the server builds a fresh server and transport
 * per request, so two requests through one listener is the part worth proving.
 */
async function startHttp(): Promise<Listener> {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', MCP_SCRIPT, '--http', '--port', String(HTTP_PORT)],
    { cwd: ROOT },
  );
  const errors: string[] = [];
  let listening = false;

  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString();
    errors.push(text);
    if (text.includes(`:${HTTP_PORT}${MCP_PATH}`)) listening = true;
  });

  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  while (!listening) {
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`the HTTP transport never started: ${errors.join('')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return {
    url: `http://127.0.0.1:${HTTP_PORT}${MCP_PATH}`,
    stop: (): void => {
      child.kill();
    },
  };
}

async function overHttp(listener: Listener, question: Question): Promise<AskCore> {
  const client = new Client({ name: 'lacuna-parity', version: '0.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(listener.url));

  try {
    // The cast covers one SDK type mismatch and nothing else. `Transport`
    // declares `sessionId: string`, while this transport declares it
    // `string | undefined`, since a stateless server never assigns one. Under
    // `exactOptionalPropertyTypes` those are different types. The server side
    // casts for the mirror image of this in src/mcp/http.ts.
    await client.connect(transport as Transport);
    const result = await client.callTool(
      {
        name: 'lacuna_ask',
        arguments: { subject: question.subject, predicate: question.predicate },
      },
      undefined,
      { timeout: REPLY_TIMEOUT_MS },
    );
    if (result['isError'] === true) {
      throw new Error(`lacuna_ask failed: ${JSON.stringify(result['content'])}`);
    }
    return asAskCore(result['structuredContent'], 'the MCP HTTP transport');
  } finally {
    await client.close();
  }
}

async function overCli(question: Question): Promise<AskCore> {
  const child = spawn(
    process.execPath,
    [CLI_SCRIPT, 'ask', question.subject, question.predicate, '--json'],
    { cwd: ROOT },
  );
  const chunks: string[] = [];
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));

  const code = await new Promise<number>((resolve) => {
    child.on('close', (status) => resolve(status ?? 1));
  });
  if (code !== 0) {
    throw new Error(`lacuna ask exited ${code}`);
  }
  return asAskCore(JSON.parse(chunks.join('')), 'the command line');
}

/** One line per surface, wide enough to read the fields that decide a branch. */
function summarise(name: string, answer: AskCore): string {
  return `  ${name.padEnd(5)} status=${answer.status} claimId=${String(answer.claimId)} `
    + `reasonCode=${String(answer.reasonCode)} queries=${answer.queries.length}`;
}

async function run(): Promise<boolean> {
  const listener = await startHttp();
  let allSame = true;

  try {
    for (const question of CASES) {
      const fromStdio = await overStdio(question);
      const fromHttp = await overHttp(listener, question);
      const fromCli = await overCli(question);

      const stdio = comparable(fromStdio);
      const http = comparable(fromHttp);
      const cli = comparable(fromCli);
      const same = stdio === http && http === cli;
      allSame = allSame && same;

      print(`CASE: ${question.label} (${question.subject} / ${question.predicate})`);
      print(summarise('stdio', fromStdio));
      print(summarise('http', fromHttp));
      print(summarise('cli', fromCli));
      print(`  stdio read order: ${readOrder(fromStdio)}`);
      print(`  http  read order: ${readOrder(fromHttp)}`);
      print(`  cli   read order: ${readOrder(fromCli)}`);
      print(`  IDENTICAL: ${same ? 'True' : 'False'}`);
      if (same) {
        print('--- the value all three surfaces returned');
        print(stdio);
      } else {
        print('--- from the MCP server over stdio');
        print(stdio);
        print('--- from the MCP server over HTTP');
        print(http);
        print('--- from the command line');
        print(cli);
      }
      print('');
    }
  } finally {
    listener.stop();
  }

  return allSame;
}

async function main(): Promise<void> {
  const allSame = await run();
  print(`ALL_IDENTICAL: ${allSame ? 'True' : 'False'}`);
  process.exit(allSame ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
