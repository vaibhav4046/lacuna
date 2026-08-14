import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import type { AskCore } from '../src/contract/result';

/**
 * Asks the same questions through the MCP server and through the command line
 * and checks that the two answers are the same value.
 *
 *   npm run parity
 *
 * Both surfaces wrap the same resolver, so this cannot fail on the substance of
 * an answer. What it can catch, and did catch, is the two of them drifting apart
 * in how they name and shape what they return: a client that reads `reason` from
 * one and `reasonCode` from the other is a client that has to be written twice.
 * The projection under test is the one in src/contract, and this is the check
 * that says the projection is what both surfaces actually emit against a live
 * node rather than what they are declared to emit.
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

async function main(): Promise<void> {
  let allSame = true;

  for (const question of CASES) {
    const fromMcp = await overStdio(question);
    const fromCli = await overCli(question);
    const left = comparable(fromMcp);
    const right = comparable(fromCli);
    const same = left === right;
    allSame = allSame && same;

    print(`CASE: ${question.label} (${question.subject} / ${question.predicate})`);
    print(`  MCP status=${fromMcp.status} claimId=${String(fromMcp.claimId)} `
      + `reasonCode=${String(fromMcp.reasonCode)} queries=${fromMcp.queries.length}`);
    print(`  CLI status=${fromCli.status} claimId=${String(fromCli.claimId)} `
      + `reasonCode=${String(fromCli.reasonCode)} queries=${fromCli.queries.length}`);
    print(`  MCP read order: ${readOrder(fromMcp)}`);
    print(`  CLI read order: ${readOrder(fromCli)}`);
    print(`  IDENTICAL: ${same ? 'True' : 'False'}`);
    if (same) {
      print('--- the value both surfaces returned');
      print(left);
    } else {
      print('--- from the MCP server');
      print(left);
      print('--- from the command line');
      print(right);
    }
    print('');
  }

  print(`ALL_IDENTICAL: ${allSame ? 'True' : 'False'}`);
  process.exit(allSame ? 0 : 1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
