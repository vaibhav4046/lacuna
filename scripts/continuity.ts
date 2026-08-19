import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { generateCorpus } from '../src/corpus/index.js';
import { ASK_TOOL } from '../src/mcp/tools.js';
import { openSource } from '../src/hydra/open.js';
import { ask, buildQuestion, parseVia, type Answer } from '../src/retrieval/index.js';

/**
 * One context, any agent — as a check rather than a slogan.
 *
 *   npm run continuity                                (against production)
 *   npm run continuity -- https://lacuna-five.vercel.app
 *
 * Three clients, one store. The deployed web API over HTTPS, the command line
 * on this machine, and an MCP server started as a subprocess the way an editor
 * starts one. All three are pointed at the same HydraDB Cloud workspace, asked
 * the same questions, and compared on what a person would call the answer.
 *
 * npm run parity proves three surfaces agree with each other over one store.
 * npm run parity:cloud proves the two stores agree. Neither proves that a
 * terminal and a browser on different machines are reading the same workspace,
 * which is the claim this product actually makes. This is that check.
 *
 * The comparison is deliberately the envelope a user sees: status, value,
 * citation count, revision count, conflict count and abstention reason.
 * Latency and read counts differ by transport and are reported, not compared.
 */

const target = (process.argv[2] ?? 'https://lacuna-five.vercel.app').replace(/\/+$/, '');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MCP_SCRIPT = fileURLToPath(new URL('./mcp.ts', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../artifacts/continuity', import.meta.url));

/** The cloud profile, read from the file the CLI reads. */
function cloudEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of ['.env.local', '.env.cloud']) {
    const path = `${ROOT}${file}`;
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(String.fromCharCode(10))) {
      const at = line.indexOf('=');
      if (at <= 0 || line.startsWith('#')) continue;
      out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
  }
  return out;
}

interface Envelope {
  readonly status: string;
  readonly answer: string | null;
  readonly evidence: number;
  readonly revisions: number;
  readonly conflicts: number;
  readonly reason: string | null;
}

/** The web's own envelope vocabulary, which the other two are mapped onto. */
function fromWeb(body: {
  status: string;
  answer: string | null;
  evidence: readonly unknown[];
  revisions: readonly unknown[];
  conflicts: readonly unknown[];
  abstain_reason: string | null;
}): Envelope {
  return {
    status: body.status,
    answer: body.answer,
    evidence: body.evidence.length,
    revisions: body.revisions.length,
    conflicts: body.conflicts.length,
    reason: body.abstain_reason,
  };
}

/**
 * A resolver answer in the same vocabulary.
 *
 * The web maps `contradicted` to CONFLICT and every other abstention to
 * NO_EVIDENCE, so the same mapping is applied here rather than comparing two
 * different vocabularies and calling the difference a disagreement.
 */
function fromCore(answer: Answer): Envelope {
  const outcome = answer.resolution.outcome;
  if (outcome.type === 'answer') {
    return {
      status: 'ANSWERED',
      answer: outcome.text,
      evidence: answer.evidence.length,
      revisions: answer.resolution.considered.filter((claim) => claim.supersededBy.length > 0).length,
      conflicts: 0,
      reason: null,
    };
  }
  return {
    status: outcome.reason === 'contradicted' ? 'CONFLICT' : 'NO_EVIDENCE',
    answer: null,
    evidence: answer.evidence.length,
    revisions: answer.resolution.considered.filter((claim) => claim.supersededBy.length > 0).length,
    conflicts: outcome.reason === 'contradicted' ? 1 : 0,
    reason: outcome.reason,
  };
}

function fromMcp(value: Record<string, unknown>): Envelope {
  const status = String(value['status'] ?? '').toUpperCase();
  const evidence = Array.isArray(value['evidence']) ? value['evidence'].length : 0;
  const superseded = Array.isArray(value['supersededClaims']) ? value['supersededClaims'].length : 0;
  const reason = value['reasonCode'] === null || value['reasonCode'] === undefined
    ? null
    : String(value['reasonCode']);
  return {
    status: status === 'ANSWERED' ? 'ANSWERED' : reason === 'contradicted' ? 'CONFLICT' : 'NO_EVIDENCE',
    answer: value['answer'] === null || value['answer'] === undefined ? null : String(value['answer']),
    evidence,
    revisions: superseded,
    conflicts: reason === 'contradicted' ? 1 : 0,
    reason,
  };
}

const print = (line: string): void => void process.stdout.write(`${line}\n`);

/** The double submit token the deployed ask endpoint requires. */
async function csrf(): Promise<string> {
  const response = await fetch(`${target}/api/session`, { headers: { Accept: 'application/json' } });
  for (const line of response.headers.getSetCookie()) {
    const match = /lacuna_csrf=([^;]+)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error('the deployment issued no CSRF cookie');
}

const corpus = generateCorpus();
// One per outcome the resolver can reach, rather than all 64: this check is
// about three clients agreeing, and the full sweep is npm run parity:cloud.
const chosen = ['q-stable-01', 'q-revised-01', 'q-retracted-01', 'q-contradicted-01', 'q-multi_hop-01', 'q-out_of_scope-01']
  .map((id) => corpus.questions.find((question) => question.id === id))
  .filter((question): question is NonNullable<typeof question> => question !== undefined);

print(`One store, three clients.\n`);
print(`  web    ${target}`);
print(`  cli    this machine, LACUNA_PROFILE=cloud`);
print(`  mcp    subprocess over stdio, LACUNA_PROFILE=cloud\n`);

const env = { ...process.env, ...cloudEnv(), LACUNA_PROFILE: 'cloud' };
const opened = openSource(env);
if (opened.profile !== 'cloud') {
  process.stderr.write('the cloud profile is not configured on this machine\n');
  process.exit(2);
}
print(`  store  ${opened.describe}\n`);

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', MCP_SCRIPT, '--stdio'],
  cwd: ROOT,
  env,
});
const mcp = new Client({ name: 'lacuna-continuity', version: '1.0.0' });
await mcp.connect(transport);

const token = await csrf();
const rows: { id: string; same: boolean; web: Envelope; cli: Envelope; mcp: Envelope }[] = [];

for (const question of chosen) {
  const via = parseVia(question.text);

  const webResponse = await fetch(`${target}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-csrf-token': token,
      Cookie: `lacuna_csrf=${token}`,
    },
    body: JSON.stringify({
      subject: question.subject,
      predicate: question.predicate,
      ...(via === null ? {} : { via }),
    }),
  });
  const web = fromWeb(await webResponse.json() as Parameters<typeof fromWeb>[0]);

  // A fresh source per question, so a memo cannot make a later answer cheaper
  // than it really is or hide a record that is missing.
  const cli = fromCore(await ask(
    openSource(env).source,
    buildQuestion(question.subject, question.predicate, via),
  ));

  const called = await mcp.callTool({
    name: ASK_TOOL,
    arguments: {
      subject: question.subject,
      predicate: question.predicate,
      ...(via === null ? {} : { via }),
    },
  });
  const structured = (called as { structuredContent?: Record<string, unknown> }).structuredContent ?? {};
  const overMcp = fromMcp(structured);

  const same = JSON.stringify(web) === JSON.stringify(cli) && JSON.stringify(cli) === JSON.stringify(overMcp);
  rows.push({ id: question.id, same, web, cli, mcp: overMcp });

  print(
    `${same ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(22)}`
    + `${web.status.padEnd(12)}${String(web.answer ?? web.reason).padEnd(26)}`
    + `${web.evidence} cited`,
  );
  if (!same) {
    print(`      web ${JSON.stringify(web)}`);
    print(`      cli ${JSON.stringify(cli)}`);
    print(`      mcp ${JSON.stringify(overMcp)}`);
  }
}

await mcp.close();

const identical = rows.every((row) => row.same);
const report = {
  store: opened.describe,
  deployment: target,
  clients: ['web (https)', 'cli (local process)', 'mcp (stdio subprocess)'],
  questions: rows.length,
  identical,
  rows: rows.map((row) => ({ id: row.id, same: row.same, envelope: row.web })),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/one-context.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print('');
print(`ONE_CONTEXT_IDENTICAL: ${identical}`);
print('artifacts/continuity/one-context.json written.');

if (!identical) process.exit(1);
