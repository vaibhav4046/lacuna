import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { ASK_TOOL } from '../src/mcp/tools.js';
import { openSource } from '../src/hydra/open.js';
import { blastRadius, ask, buildQuestion, buildPackageName } from '../src/retrieval/index.js';

/**
 * The two hard questions, run for real and written down.
 *
 *   npm run proof
 *   npm run proof -- https://lacuna-five.vercel.app
 *
 * These are not new questions invented to be answered well. They are the two
 * shapes this product claims to handle and most retrieval does not:
 *
 *   A  a change to one package, and which services it reaches, computed by
 *      walking the graph at request time rather than read off a list. Run
 *      against both stores, because a traversal that only works on Cypher is
 *      not the same claim as a traversal that works on the production one.
 *
 *   B  a question whose premise the sessions never support, asked beside the
 *      history and the current state of a subject that really was revised.
 *      Run through three clients, because "one context, any agent" is only
 *      true if the refusal travels as reliably as the answer does.
 *
 * Nothing here is scored against expected values and no ground truth is
 * imported. The proof is the shape of what came back: what it walked, what it
 * cited, what it refused and why, and whether the three clients said the same.
 * A change that broke the resolver would still be recorded faithfully, which is
 * the point of writing the transcript rather than a pass mark.
 *
 * The subject names are read off the corpus, not chosen to flatter it.
 * `pact-check` is the package with the widest reach in the graph, `Bellwether`
 * is a subject whose value was corrected twice with the history kept, and
 * `Meridian` is a real project with no migration window ever stated, which is
 * the false premise: the question presumes a window exists.
 */

const target = (process.argv[2] ?? 'https://lacuna-five.vercel.app').replace(/\/+$/, '');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MCP_SCRIPT = fileURLToPath(new URL('./mcp.ts', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../artifacts/proof', import.meta.url));

/**
 * Two packages, and both are reported.
 *
 * `pact-check` is the package the corpus itself asks a blast radius question
 * about. `moss-index` is the only one in this graph whose walk meets a
 * dependency claim that was superseded, so it is the one that shows the walk
 * refusing an edge rather than merely asserting it would. Reporting both is
 * the point: picking only the second would be choosing the case that flatters
 * the claim, and picking only the first would leave the temporal filter
 * untested by this proof.
 */
const PACKAGES = ['pact-check', 'moss-index'] as const;

/** Read off the same files the CLI reads. */
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

const print = (line: string): void => void process.stdout.write(`${line}\n`);

const cloudVars = cloudEnv();
const CLOUD = { ...process.env, ...cloudVars, LACUNA_PROFILE: 'cloud' };
const NODE = { ...process.env, ...cloudVars, LACUNA_PROFILE: 'node' };

// ---------------------------------------------------------------------------
// Proof A. One package changes. Which services are affected, and how far away?
// ---------------------------------------------------------------------------

interface RadiusSummary {
  readonly store: string;
  readonly services: readonly string[];
  /** Deepest hop count reached, which is how far the walk had to go. */
  readonly depth: number;
  /** Packages the walk passed through between the root and a service. */
  readonly through: readonly string[];
  /**
   * Dependency claims the walk refused to follow because they were superseded
   * or withdrawn. This is the number that separates a temporal traversal from
   * one that treats every edge it can see as current.
   */
  readonly ignored: number;
  readonly ms: number;
  readonly reads: number;
}

async function radius(
  env: Record<string, string | undefined>,
  packageName: string,
): Promise<RadiusSummary> {
  const opened = openSource(env);
  const walked = await blastRadius(opened.source, buildPackageName(packageName));
  if (walked.radius === null) {
    throw new Error(`${packageName} has no node in ${opened.describe}, so there is nothing to walk`);
  }

  const affected = [...walked.radius.affected].sort((a, b) => a.entityName.localeCompare(b.entityName));

  return {
    store: opened.describe,
    services: affected.map((entry) => entry.entityName),
    depth: affected.reduce((most, entry) => Math.max(most, entry.depth), 0),
    through: walked.radius.packagesTouched,
    ignored: walked.radius.ignored,
    ms: Math.round(walked.ms),
    reads: walked.queries.length,
  };
}

print('PROOF A  a package changes, and the graph is walked for what it reaches\n');

const walks: {
  packageName: string;
  cloud: RadiusSummary;
  node: RadiusSummary;
  agree: boolean;
}[] = [];

for (const packageName of PACKAGES) {
  const cloud = await radius(CLOUD, packageName);
  const node = await radius(NODE, packageName);
  const agree = JSON.stringify(cloud.services) === JSON.stringify(node.services);
  walks.push({ packageName, cloud, node, agree });

  print(`  if ${packageName} changes, which services are affected?\n`);
  for (const summary of [cloud, node]) {
    print(`    ${summary.store}`);
    print(
      `      ${summary.services.length} services, depth ${summary.depth}, `
      + `${summary.reads} reads, ${summary.ms}ms`,
    );
    print(`      ${summary.services.join(', ')}`);
    print(`      through ${summary.through.length === 0 ? 'no other package' : summary.through.join(', ')}`);
    print(`      ${summary.ignored} superseded or withdrawn dependency claims not followed`);
  }
  print(`      agree: ${agree}\n`);
}

const sameServices = walks.every((walk) => walk.agree);
const refusedEdges = walks.reduce((total, walk) => total + walk.cloud.ignored, 0);

print(`  BOTH_STORES_AGREE: ${sameServices}`);
print(`  stale dependency edges the walks refused to follow: ${refusedEdges}\n`);

// ---------------------------------------------------------------------------
// Proof B. An unsupported premise, the history, and the current state, through
// three clients that are not on the same machine as each other in production.
// ---------------------------------------------------------------------------

interface Envelope {
  readonly status: string;
  readonly answer: string | null;
  readonly evidence: number;
  readonly revisions: number;
  readonly reason: string | null;
}

function fromWeb(body: {
  status: string;
  answer: string | null;
  evidence: readonly unknown[];
  revisions: readonly unknown[];
  abstain_reason: string | null;
}): Envelope {
  return {
    status: body.status,
    answer: body.answer,
    evidence: body.evidence.length,
    revisions: body.revisions.length,
    reason: body.abstain_reason,
  };
}

function fromCore(answer: Awaited<ReturnType<typeof ask>>): Envelope {
  const outcome = answer.resolution.outcome;
  const revisions = answer.resolution.considered.filter((claim) => claim.supersededBy.length > 0).length;
  if (outcome.type === 'answer') {
    return { status: 'ANSWERED', answer: outcome.text, evidence: answer.evidence.length, revisions, reason: null };
  }
  return {
    status: outcome.reason === 'contradicted' ? 'CONFLICT' : 'NO_EVIDENCE',
    answer: null,
    evidence: answer.evidence.length,
    revisions,
    reason: outcome.reason,
  };
}

function fromMcp(value: Record<string, unknown>): Envelope {
  const reason = value['reasonCode'] === null || value['reasonCode'] === undefined
    ? null
    : String(value['reasonCode']);
  const status = String(value['status'] ?? '').toUpperCase();
  return {
    status: status === 'ANSWERED' ? 'ANSWERED' : reason === 'contradicted' ? 'CONFLICT' : 'NO_EVIDENCE',
    answer: value['answer'] === null || value['answer'] === undefined ? null : String(value['answer']),
    evidence: Array.isArray(value['evidence']) ? value['evidence'].length : 0,
    revisions: Array.isArray(value['supersededClaims']) ? value['supersededClaims'].length : 0,
    reason,
  };
}

async function csrf(): Promise<string> {
  const response = await fetch(`${target}/api/session`, { headers: { Accept: 'application/json' } });
  for (const line of response.headers.getSetCookie()) {
    const match = /lacuna_csrf=([^;]+)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error('the deployment issued no CSRF cookie');
}

/** Three questions about one project family, in the order a person would ask. */
const QUESTIONS = [
  { label: 'the premise the sessions never support', subject: 'Meridian', predicate: 'migration_window' },
  { label: 'the value that really was revised, twice', subject: 'Bellwether', predicate: 'beta_partner' },
  { label: 'a subject that is not in the sessions at all', subject: 'Redshank', predicate: 'launch_date' },
] as const;

print('PROOF B  an unsupported premise, beside a real revision, through three clients\n');

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx', MCP_SCRIPT, '--stdio'],
  cwd: ROOT,
  env: CLOUD as Record<string, string>,
});
const mcp = new Client({ name: 'lacuna-proof', version: '1.0.0' });
await mcp.connect(transport);

const token = await csrf();
const rows: {
  subject: string;
  predicate: string;
  label: string;
  same: boolean;
  web: Envelope;
  cli: Envelope;
  mcp: Envelope;
}[] = [];

for (const question of QUESTIONS) {
  const body = { subject: question.subject, predicate: question.predicate };

  const webResponse = await fetch(`${target}/api/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'x-csrf-token': token,
      Cookie: `lacuna_csrf=${token}`,
    },
    body: JSON.stringify(body),
  });
  const web = fromWeb(await webResponse.json() as Parameters<typeof fromWeb>[0]);

  const cli = fromCore(await ask(
    openSource(CLOUD).source,
    buildQuestion(question.subject, question.predicate, null),
  ));

  const called = await mcp.callTool({ name: ASK_TOOL, arguments: body });
  const overMcp = fromMcp(
    (called as { structuredContent?: Record<string, unknown> }).structuredContent ?? {},
  );

  const same = JSON.stringify(web) === JSON.stringify(cli) && JSON.stringify(cli) === JSON.stringify(overMcp);
  rows.push({ ...question, same, web, cli, mcp: overMcp });

  print(`  ${same ? 'ok  ' : 'FAIL'}  ${question.subject} ${question.predicate}`);
  print(`        ${question.label}`);
  print(
    `        ${web.status}, ${web.answer ?? `reason ${web.reason}`}, `
    + `${web.evidence} cited, ${web.revisions} superseded`,
  );
  if (!same) {
    print(`        web ${JSON.stringify(web)}`);
    print(`        cli ${JSON.stringify(cli)}`);
    print(`        mcp ${JSON.stringify(overMcp)}`);
  }
  print('');
}

await mcp.close();

const allSame = rows.every((row) => row.same);
const answered = rows.filter((row) => row.web.status === 'ANSWERED');
const abstained = rows.filter((row) => row.web.status !== 'ANSWERED');

print(`  THREE_CLIENTS_IDENTICAL: ${allSame}`);
print(`  answered ${answered.length}, abstained ${abstained.length}, none guessed\n`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/proofs.json`,
  `${JSON.stringify(
    {
      recorded: new Date().toISOString().slice(0, 10),
      deployment: target,
      proofA: {
        bothStoresAgree: sameServices,
        staleEdgesRefused: refusedEdges,
        walks: walks.map((walk) => ({
          question: `if ${walk.packageName} changes, which services are affected?`,
          agree: walk.agree,
          cloud: walk.cloud,
          node: walk.node,
        })),
      },
      proofB: {
        clients: ['web (https)', 'cli (local process)', 'mcp (stdio subprocess)'],
        identical: allSame,
        rows: rows.map((row) => ({
          subject: row.subject,
          predicate: row.predicate,
          label: row.label,
          same: row.same,
          envelope: row.web,
        })),
      },
    },
    null,
    2,
  )}\n`,
  'utf8',
);

print('artifacts/proof/proofs.json written.');

if (!sameServices || !allSame) process.exit(1);
