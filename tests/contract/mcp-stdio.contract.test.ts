import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generateCorpus } from '../../src/corpus/index.js';
import { loadHydraConfig, type HydraConfig } from '../../src/hydra/config.js';
import { describeNode } from '../../src/mcp/result.js';
import { SERVER_ICONS, SERVER_NAME, SERVER_VERSION, TOOL_TIMEOUT_MS } from '../../src/mcp/server.js';
import { toolsFor } from '../../src/mcp/tools.js';
import { ABSTENTION_REASONS } from '../../src/model/abstention.js';
import { MAX_TERM_CHARS, parseVia } from '../../src/retrieval/index.js';

/**
 * The wire, not the resolver.
 *
 * `scripts/parity.ts` already proves that the answer arriving over stdio is the
 * same value the CLI and the HTTP transport return, and it proves it for every
 * gold question. What it could not tell us was why, on one run, a tool call came
 * back as something that was not an answer at all. It read the payload through
 * the SDK client, which had already decided the frames were well formed and
 * already thrown away everything that was not one, so the only thing left to
 * inspect was the shape of what survived.
 *
 * This file spawns the same server the same way and speaks JSON-RPC to it by
 * hand. Every line the process writes to stdout is kept, and any line that is
 * not a complete frame is recorded as contamination rather than discarded, so
 * stdout purity is not one test here but a property of all of them. On top of
 * that it checks the thing an SDK client cannot: that `structuredContent`
 * validates against the `outputSchema` the tool itself advertised, field for
 * field, rather than merely being an object with a `status` on it.
 *
 * Nothing here is skipped when the node is unreachable. A contract test that
 * quietly passes because it could not reach the thing it tests is worse than
 * one that fails, because only one of the two gets investigated.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const ENV_PATH = fileURLToPath(new URL('../../.env.local', import.meta.url));
const MCP_SCRIPT = fileURLToPath(new URL('../../scripts/mcp.ts', import.meta.url));
const TIMINGS_PATH = fileURLToPath(new URL('../../artifacts/mcp/stdio-timings.txt', import.meta.url));

/** A file URL, because `--import` will not take a bare Windows path. */
const NOISE_PRELOAD = new URL('../support/noisy-console.mjs', import.meta.url).href;

if (!existsSync(ENV_PATH)) {
  throw new Error(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.`);
}
process.loadEnvFile(ENV_PATH);

const PROTOCOL_VERSION = '2025-06-18';
const REPLY_TIMEOUT_MS = 60_000;

interface Frame {
  readonly id: number | null;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

interface Pending {
  readonly resolve: (frame: Frame) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A JSON-RPC client written out longhand.
 *
 * The SDK client would be less code and would hide the one thing this file
 * exists to watch. `lines` is every string the server put on stdout between one
 * newline and the next; `contamination` is the subset of those that a transport
 * would have choked on. A test asserting the second is empty is asserting that
 * nothing in the process, at any depth, wrote to the descriptor carrying the
 * protocol.
 */
class Session {
  readonly lines: string[] = [];
  readonly contamination: string[] = [];
  private readonly pending = new Map<number, Pending>();
  private readonly child: ChildProcessWithoutNullStreams;
  private buffer = '';
  private stderrText = '';
  private nextId = 1;
  private exited: string | null = null;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { this.take(chunk); });
    child.stderr.on('data', (chunk: string) => { this.stderrText += chunk; });
    child.on('exit', (code, signal) => {
      this.exited = `the server exited with code ${String(code)} signal ${String(signal)}`;
      for (const [id, waiting] of this.pending) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error(`${this.exited} while request ${String(id)} was open`));
      }
      this.pending.clear();
    });
  }

  /** Spawned exactly the way `scripts/parity.ts` spawns it, plus any preload. */
  static async start(extraNodeArgs: readonly string[] = []): Promise<Session> {
    const args = ['--import', 'tsx', ...extraNodeArgs, MCP_SCRIPT, '--stdio'];
    const child = spawn(process.execPath, args, { cwd: ROOT }) as ChildProcessWithoutNullStreams;
    const session = new Session(child);

    const hello = await session.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'lacuna-contract-test', version: '0.0.0' },
    });
    if (hello.error !== undefined) {
      throw new Error(`initialize failed: ${hello.error.message}`);
    }
    session.notify('notifications/initialized', {});
    return session;
  }

  get stdout(): string {
    return this.lines.join('\n');
  }

  get stderr(): string {
    return this.stderrText;
  }

  private take(chunk: string): void {
    this.buffer += chunk;
    let cut = this.buffer.indexOf('\n');
    while (cut !== -1) {
      const line = this.buffer.slice(0, cut).replace(/\r$/, '');
      this.buffer = this.buffer.slice(cut + 1);
      this.line(line);
      cut = this.buffer.indexOf('\n');
    }
  }

  /**
   * One newline delimited message.
   *
   * A blank line counts as contamination on purpose: the SDK's read buffer
   * hands every delimited string to `JSON.parse`, and an empty one throws there
   * the same as a log line would.
   */
  private line(line: string): void {
    this.lines.push(line);

    let frame: unknown;
    try {
      frame = JSON.parse(line);
    } catch {
      this.contamination.push(line);
      return;
    }
    if (!isRecord(frame) || frame['jsonrpc'] !== '2.0') {
      this.contamination.push(line);
      return;
    }

    const id = frame['id'];
    if (typeof id !== 'number') return;

    const waiting = this.pending.get(id);
    if (waiting === undefined) return;
    clearTimeout(waiting.timer);
    this.pending.delete(id);
    waiting.resolve(isRecord(frame['error'])
      ? {
        id,
        result: frame['result'],
        error: {
          code: Number(frame['error']['code']),
          message: String(frame['error']['message']),
        },
      }
      : { id, result: frame['result'] });
  }

  private write(message: Record<string, unknown>): void {
    if (this.exited !== null) throw new Error(this.exited);
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async request(method: string, params: unknown): Promise<Frame> {
    const id = this.nextId++;
    return new Promise<Frame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} did not reply within ${String(REPLY_TIMEOUT_MS)}ms`));
      }, REPLY_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.write({ jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  call(name: string, args: unknown): Promise<Frame> {
    return this.request('tools/call', { name, arguments: args });
  }

  async stop(): Promise<void> {
    if (this.exited !== null) return;
    this.child.stdin.end();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => { this.child.kill(); resolve(); }, 5_000);
      this.child.on('exit', () => { clearTimeout(timer); resolve(); });
    });
  }
}

/** What a value is, said the way a schema error should say it. */
function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (Number.isInteger(value)) return `the integer ${String(value)}`;
  return `a ${typeof value}`;
}

function matchesType(expected: string, value: unknown): boolean {
  switch (expected) {
    case 'null': return value === null;
    case 'array': return Array.isArray(value);
    case 'object': return isRecord(value);
    case 'integer': return typeof value === 'number' && Number.isInteger(value);
    case 'number': return typeof value === 'number';
    default: return typeof value === expected;
  }
}

/**
 * The subset of JSON Schema the tools actually declare, checked by hand.
 *
 * Pulling in a validator would cover more of the specification than these four
 * schemas use, and would add a dependency to a project whose only runtime one
 * is the MCP SDK. What is here is what `src/mcp/tools.ts` writes: types, unions
 * of types, enums, required properties, closed objects, and item schemas. If a
 * schema ever grows a keyword this does not know, it is ignored rather than
 * silently passed, which is the failure direction that gets noticed.
 */
function schemaProblems(schema: unknown, value: unknown, path: string): string[] {
  if (!isRecord(schema)) return [];
  const problems: string[] = [];
  const where = path === '' ? 'the payload' : path;

  const declared = schema['type'];
  const types = typeof declared === 'string'
    ? [declared]
    : Array.isArray(declared) ? declared.filter((one): one is string => typeof one === 'string') : [];
  if (types.length > 0 && !types.some((one) => matchesType(one, value))) {
    return [`${where} is ${describeValue(value)}, not ${types.join(' or ')}`];
  }

  const allowed = schema['enum'];
  if (Array.isArray(allowed) && !allowed.includes(value as never)) {
    problems.push(`${where} is ${JSON.stringify(value)}, which the schema does not allow`);
  }

  if (isRecord(value)) {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    const required = Array.isArray(schema['required']) ? schema['required'] : [];
    for (const key of required) {
      if (typeof key === 'string' && !(key in value)) problems.push(`${where}.${key} is missing`);
    }
    if (schema['additionalProperties'] === false) {
      for (const key of Object.keys(value)) {
        if (!(key in properties)) problems.push(`${where}.${key} is not in the schema`);
      }
    }
    for (const [key, sub] of Object.entries(properties)) {
      if (key in value) problems.push(...schemaProblems(sub, value[key], `${where === 'the payload' ? '' : where}.${key}`));
    }
  }

  if (Array.isArray(value) && schema['items'] !== undefined) {
    value.forEach((item, index) => {
      problems.push(...schemaProblems(schema['items'], item, `${where === 'the payload' ? '' : where}[${String(index)}]`));
    });
  }

  return problems;
}

function outputSchemaFor(name: string): unknown {
  const tool = toolsFor(false).find((one) => one.name === name);
  if (tool === undefined) throw new Error(`no tool is named ${name}`);
  return tool.outputSchema;
}

/**
 * The successful half of the result contract, in one place.
 *
 * Content and structured content are two views of one value, so this checks
 * they are the same value rather than two independently plausible ones, then
 * holds the structured half against the schema the tool published.
 */
function payload(name: string, frame: Frame): Record<string, unknown> {
  expect(frame.error, `${name} answered with a protocol error`).toBeUndefined();
  const result = frame.result;
  expect(isRecord(result), `${name} returned ${describeValue(result)}`).toBe(true);
  const record = result as Record<string, unknown>;

  expect(record['isError'], `${name} reported a tool failure`).toBeFalsy();

  const content = record['content'];
  expect(Array.isArray(content) && content.length > 0).toBe(true);
  const first = (content as unknown[])[0];
  expect(isRecord(first) && first['type'] === 'text').toBe(true);

  const structured = record['structuredContent'];
  expect(isRecord(structured), `${name} returned no structuredContent`).toBe(true);
  expect(
    JSON.parse(String((first as Record<string, unknown>)['text'])),
    'the text content and the structured content are different values',
  ).toEqual(structured);

  const problems = schemaProblems(outputSchemaFor(name), structured, '');
  expect(problems, `${name} broke its own output schema`).toEqual([]);

  return structured as Record<string, unknown>;
}

/**
 * A refusal, of either kind.
 *
 * A bad argument may come back as a JSON-RPC error or as a result flagged with
 * `isError`; both are honest. What must never happen is a success payload, and
 * what must never happen after either is a session that has stopped working.
 */
function rejection(label: string, frame: Frame): void {
  if (frame.error !== undefined) {
    expect(frame.error.message, `${label} refused without saying why`).not.toEqual('');
    return;
  }
  const result = frame.result;
  expect(isRecord(result), `${label} returned ${describeValue(result)}`).toBe(true);
  const record = result as Record<string, unknown>;
  expect(record['isError'], `${label} was accepted when it should have been refused`).toBe(true);
  expect(record['structuredContent'], `${label} failed but still carried a payload`).toBeUndefined();
}

const ask = (subject: string, predicate: string, via: string | null = null): Record<string, unknown> => (
  via === null ? { subject, predicate } : { subject, predicate, via }
);

/** The five reasons, one named question each, checked against the enum below. */
const ABSTENTIONS = [
  { label: 'a value that was taken back', subject: 'Junco', predicate: 'launch_date', via: null, reason: 'retracted' },
  { label: 'two sources that disagree', subject: 'notify-relay', predicate: 'budget_code', via: null, reason: 'contradicted' },
  { label: 'a subject with no such hop', subject: 'Meridian', predicate: 'contact', via: 'vendor', reason: 'unconnected' },
  { label: 'a question nobody answered', subject: 'Ostara', predicate: 'migration_window', via: null, reason: 'never_stated' },
  { label: 'a subject the graph never held', subject: 'Redshank', predicate: 'launch_date', via: null, reason: 'out_of_scope' },
] as const;

describe('the MCP server over stdio', () => {
  let session: Session;
  let config: HydraConfig;

  beforeAll(async () => {
    config = loadHydraConfig();
    session = await Session.start();
  });

  afterAll(async () => {
    await session?.stop();
  });

  describe('the handshake', () => {
    it('names itself and speaks the version it was asked for', async () => {
      const fresh = await Session.start();
      try {
        const hello = await fresh.request('initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'lacuna-contract-test', version: '0.0.0' },
        });
        const result = hello.result as Record<string, unknown>;
        expect(result['protocolVersion']).toEqual(PROTOCOL_VERSION);
        expect(result['serverInfo']).toEqual({
          name: SERVER_NAME,
          version: SERVER_VERSION,
          title: 'Lacuna',
          icons: SERVER_ICONS.map((icon) => ({ ...icon, sizes: [...icon.sizes] })),
        });
      } finally {
        await fresh.stop();
      }
    });

    it('lists the seven public read-only tools, each with an output schema', async () => {
      const frame = await session.request('tools/list', {});
      expect(frame.error).toBeUndefined();
      const tools = (frame.result as Record<string, unknown>)['tools'] as Record<string, unknown>[];

      expect(tools.map((tool) => tool['name']).sort()).toEqual(
        toolsFor(false).map((tool) => tool.name).slice().sort(),
      );
      for (const tool of tools) {
        expect(isRecord(tool['inputSchema']), `${String(tool['name'])} has no input schema`).toBe(true);
        expect(isRecord(tool['outputSchema']), `${String(tool['name'])} has no output schema`).toBe(true);
        expect((tool['annotations'] as Record<string, unknown>)['readOnlyHint']).toBe(true);
      }
    });
  });

  describe('the answers', () => {
    it('answers a question the graph settles', async () => {
      const value = payload('lacuna_ask', await session.call('lacuna_ask', ask('Meridian', 'launch_date')));

      expect(value['status']).toEqual('answered');
      expect(typeof value['answer']).toEqual('string');
      expect(String(value['answer']).length).toBeGreaterThan(0);
      expect(value['reasonCode']).toBeNull();
      expect(typeof value['claimId']).toEqual('number');
      expect((value['evidence'] as unknown[]).length).toBeGreaterThan(0);
      expect(value['sourceState']).toEqual('live');
    });

    it('resolves a value that changed, and keeps what it replaced', async () => {
      const value = payload('lacuna_ask', await session.call('lacuna_ask', ask('Everstone', 'migration_window')));

      expect(value['status']).toEqual('answered');
      expect((value['supersededClaims'] as unknown[]).length).toBeGreaterThan(0);
      expect(value['supersededClaims']).not.toContain(value['claimId']);
    });

    it('walks a hop to answer a question about a second entity', async () => {
      const value = payload('lacuna_ask', await session.call('lacuna_ask', ask('replay-queue', 'contact', 'vendor')));

      expect(value['status']).toEqual('answered');
      expect((value['evidence'] as unknown[]).length).toBeGreaterThan(0);
    });

    it('reaches a package the question did not name', async () => {
      const value = payload('lacuna_ask', await session.call('lacuna_ask', ask('pact-check', 'depends_on')));

      expect(value['status']).toEqual('answered');
      expect(String(value['answer']).length).toBeGreaterThan(0);
    });

    it('explains an answer with a trace, not with reasoning', async () => {
      const value = payload('lacuna_explain', await session.call('lacuna_explain', ask('Meridian', 'launch_date')));

      expect(value['status']).toEqual('answered');
      expect(typeof value['explanation']).toEqual('string');
      expect((value['trace'] as unknown[]).length).toBeGreaterThan(0);
    });

    it('shows the history behind a value that was revised', async () => {
      const value = payload('lacuna_timeline', await session.call('lacuna_timeline', ask('Everstone', 'migration_window')));

      const considered = value['considered'] as Record<string, unknown>[];
      expect(considered.length).toBeGreaterThan(1);
      expect(considered.some((claim) => claim['current'] === true)).toBe(true);
      expect(considered.some((claim) => (claim['supersededBy'] as unknown[]).length > 0)).toBe(true);
    });

    it('reports the node it is reading from', async () => {
      const value = payload('lacuna_health', await session.call('lacuna_health', {}));

      expect(value['reachable']).toBe(true);
      expect(value['error']).toBeNull();
      expect(value['hydra']).toMatchObject(describeNode(config));
    });
  });

  describe('the refusals', () => {
    /**
     * Every one of these is a real Lacuna result and none of them is an error.
     * A client that turned an abstention into a protocol failure would be
     * telling its user the server broke, when what happened is that the server
     * declined to make something up.
     */
    it('covers every reason the system can abstain for', () => {
      expect(new Set(ABSTENTIONS.map((one) => one.reason)))
        .toEqual(new Set(ABSTENTION_REASONS));
    });

    for (const one of ABSTENTIONS) {
      it(`abstains, and says why, for ${one.label}`, async () => {
        const frame = await session.call('lacuna_ask', ask(one.subject, one.predicate, one.via));
        const value = payload('lacuna_ask', frame);

        expect(value['status']).toEqual('abstained');
        expect(value['reasonCode']).toEqual(one.reason);
        expect(value['answer']).toBeNull();
        expect(value['claimId']).toBeNull();
      });
    }
  });

  describe('the bad arguments', () => {
    const cases: readonly { readonly label: string; readonly name: string; readonly args: unknown }[] = [
      { label: 'a tool that does not exist', name: 'lacuna_guess', args: {} },
      { label: 'a question with no predicate', name: 'lacuna_ask', args: { subject: 'Meridian' } },
      { label: 'a question with no subject', name: 'lacuna_ask', args: { predicate: 'launch_date' } },
      { label: 'a subject that is a number', name: 'lacuna_ask', args: { subject: 123, predicate: 'launch_date' } },
      { label: 'an argument the schema closed off', name: 'lacuna_ask', args: { subject: 'Meridian', predicate: 'launch_date', limit: 5 } },
      { label: 'no arguments at all', name: 'lacuna_ask', args: {} },
      {
        label: 'a subject longer than a subject can be',
        name: 'lacuna_ask',
        args: { subject: 'M'.repeat(MAX_TERM_CHARS + 1), predicate: 'launch_date' },
      },
    ];

    for (const one of cases) {
      it(`refuses ${one.label}`, async () => {
        rejection(one.label, await session.call(one.name, one.args));
      });
    }

    it('survives a subject written in another alphabet', async () => {
      const frame = await session.call('lacuna_ask', ask('メリディアン', 'launch_date'));

      if (frame.error === undefined) {
        const value = payload('lacuna_ask', frame);
        expect(value['status']).toEqual('abstained');
        expect(ABSTENTION_REASONS).toContain(value['reasonCode']);
      }
      // Either way the point is the next line: the session is still a session.
      const after = payload('lacuna_ask', await session.call('lacuna_ask', ask('Meridian', 'launch_date')));
      expect(after['status']).toEqual('answered');
    });
  });

  describe('the whole corpus', () => {
    it('answers all sixty four gold questions inside the tool deadline', async () => {
      const questions = generateCorpus().questions.map((question) => ({
        id: question.id,
        subject: question.subject,
        predicate: question.predicate,
        via: parseVia(question.text),
      }));

      const rows: string[] = [];
      let worstWall = 0;
      let worstServer = 0;

      for (const question of questions) {
        const started = Date.now();
        const frame = await session.call('lacuna_ask', ask(question.subject, question.predicate, question.via));
        const wall = Date.now() - started;
        const value = payload('lacuna_ask', frame);

        const server = Number(value['timingMs']);
        worstWall = Math.max(worstWall, wall);
        worstServer = Math.max(worstServer, server);
        rows.push([
          question.id.padEnd(22),
          String(value['status']).padEnd(10),
          `server ${String(server).padStart(6)}ms`,
          `wall ${String(wall).padStart(6)}ms`,
        ].join(' '));
      }

      expect(rows.length).toEqual(64);
      expect(worstWall, 'a question came within reach of the tool deadline').toBeLessThan(TOOL_TIMEOUT_MS);

      mkdirSync(fileURLToPath(new URL('../../artifacts/mcp/', import.meta.url)), { recursive: true });
      writeFileSync(TIMINGS_PATH, [
        'Every gold question through the MCP stdio transport, one call each.',
        `deadline ${String(TOOL_TIMEOUT_MS)}ms · slowest server ${String(worstServer)}ms · slowest wall ${String(worstWall)}ms`,
        '',
        ...rows,
        '',
      ].join('\n'), 'utf8');
    }, 240_000);
  });

  describe('the descriptor', () => {
    it('carried nothing but protocol', () => {
      expect(session.contamination).toEqual([]);
      expect(session.lines.length).toBeGreaterThan(64);
    });

    it('never printed the token it authenticates with', () => {
      expect(session.stdout).not.toContain(config.token);
      expect(session.stderr).not.toContain(config.token);
    });
  });
});

describe('the MCP server with a stray console.log injected', () => {
  let session: Session;

  beforeAll(async () => {
    session = await Session.start(['--import', NOISE_PRELOAD]);
  });

  afterAll(async () => {
    await session.stop();
  });

  /**
   * The preload writes through `console.log` on a timer for as long as the
   * process lives. Before the guard in `scripts/mcp.ts` this would have landed
   * between frames and taken the session down with it; the guard sends every
   * console method to stderr the moment the stdio branch starts. The assertion
   * is not that the noise stopped, it is that the noise went somewhere else.
   */
  it('answers correctly while the noise is being written', async () => {
    const first = payload('lacuna_ask', await session.call('lacuna_ask', ask('Meridian', 'launch_date')));
    expect(first['status']).toEqual('answered');

    await new Promise((resolve) => setTimeout(resolve, 250));

    const second = payload('lacuna_ask', await session.call('lacuna_ask', ask('Ostara', 'migration_window')));
    expect(second['status']).toEqual('abstained');

    expect(session.contamination).toEqual([]);
    expect(session.stdout).not.toContain('noisy-console');
    expect(session.stderr).toContain('noisy-console');
  });
});
