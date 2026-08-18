import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus } from '../src/corpus/index.js';
import { HydraClient } from '../src/hydra/client.js';
import { cloudFromEnv } from '../src/hydra/cloud.js';
import { CloudSource } from '../src/hydra/cloud-source.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { NodeSource } from '../src/hydra/node-source.js';
import type { HydraSource } from '../src/hydra/source.js';
import {
  ask,
  blastRadius,
  buildPackageName,
  buildQuestion,
  parseBlast,
  parseVia,
  type Answer,
  type BlastAnswer,
} from '../src/retrieval/index.js';

/**
 * The same questions, asked of both stores, compared value for value.
 *
 *   npm run parity:cloud
 *
 * npm run parity proves the three surfaces agree with each other. It cannot
 * prove the two stores agree, because all three surfaces read whichever store
 * is configured. This is that check: every gold question through the
 * self-hosted node and through HydraDB Cloud, with the answers compared field
 * by field.
 *
 * Two fields are excluded and only two. Wall clock milliseconds measure the
 * network. The read log is the one thing that is meant to differ: a Cypher
 * read against the node, a record fetch against the cloud, and a question that
 * costs three round trips on one store and one on the other. Everything a
 * person would call the answer has to be identical: the verdict, the value,
 * the claims with their supersession edges, the quotations with their offsets,
 * the reason behind an abstention, the whole blast radius with the claim id on
 * every hop.
 *
 * If this run is not identical, the deployed product is a different product
 * from the one the tests cover, and no amount of green elsewhere says
 * otherwise.
 */

const LOCAL_ENV = fileURLToPath(new URL('../.env.local', import.meta.url));
const CLOUD_ENV = fileURLToPath(new URL('../.env.deploy', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../artifacts/hydra', import.meta.url));

for (const path of [LOCAL_ENV, CLOUD_ENV]) {
  if (!existsSync(path)) {
    process.stderr.write(`${path} is missing.\n`);
    process.exit(2);
  }
}

// Order matters: both files name HYDRA_HTTP_URL, and the node's config is read
// before the cloud's file overwrites it.
process.loadEnvFile(LOCAL_ENV);
const node = new NodeSource(new HydraClient(loadHydraConfig()));

// Read rather than loaded into the process: both files name HYDRA_HTTP_URL,
// and loadEnvFile leaves an already-set variable alone, so loading the second
// would silently point the cloud client at the node's loopback address.
const cloudClient = cloudFromEnv(readEnv(CLOUD_ENV));
if (cloudClient === null) {
  process.stderr.write('no HydraDB Cloud database is configured in .env.deploy\n');
  process.exit(2);
}

const print = (line: string): void => void process.stdout.write(`${line}\n`);

function readEnv(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(String.fromCharCode(10))) {
    const at = line.indexOf('=');
    if (at <= 0 || line.startsWith('#')) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** Everything but the clock and the read log, which are meant to differ. */
function semantics(answer: Answer | BlastAnswer): string {
  const { ms: _ms, queries: _queries, ...rest } = answer as Answer & BlastAnswer;
  return JSON.stringify(rest, null, 2);
}

interface Compared {
  readonly id: string;
  readonly text: string;
  readonly same: boolean;
  readonly nodeReads: number;
  readonly cloudReads: number;
  readonly nodeMs: number;
  readonly cloudMs: number;
  readonly diff: string | null;
}

/** The first line that differs, which is enough to find the disagreement. */
function firstDifference(left: string, right: string): string | null {
  const a = left.split('\n');
  const b = right.split('\n');
  for (let at = 0; at < Math.max(a.length, b.length); at += 1) {
    if (a[at] !== b[at]) {
      return `line ${at + 1}: node ${JSON.stringify(a[at] ?? null)} vs cloud ${JSON.stringify(b[at] ?? null)}`;
    }
  }
  return null;
}

async function run(
  source: HydraSource,
  question: { subject: string; predicate: string; text: string },
  blast: string | null,
): Promise<Answer | BlastAnswer> {
  if (blast !== null) return blastRadius(source, buildPackageName(blast));
  return ask(source, buildQuestion(question.subject, question.predicate, parseVia(question.text)));
}

const corpus = generateCorpus();
print(`Comparing ${corpus.questions.length} gold questions, node versus HydraDB Cloud.\n`);

const compared: Compared[] = [];

for (const question of corpus.questions) {
  const blast = parseBlast(question.text);
  // A fresh source per question on the cloud side, so the memo cannot make a
  // later question cheaper than it really is or hide a record that is missing.
  const cloud = new CloudSource(cloudClient);

  const fromNode = await run(node, question, blast);
  const fromCloud = await run(cloud, question, blast);

  const left = semantics(fromNode);
  const right = semantics(fromCloud);
  const same = left === right;

  compared.push({
    id: question.id,
    text: question.text,
    same,
    nodeReads: fromNode.queries.length,
    cloudReads: fromCloud.queries.length,
    nodeMs: fromNode.ms,
    cloudMs: fromCloud.ms,
    diff: same ? null : firstDifference(left, right),
  });

  print(
    `${same ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(24)}`
    + `node ${String(fromNode.queries.length).padStart(2)} reads ${String(fromNode.ms).padStart(7)}ms   `
    + `cloud ${String(fromCloud.queries.length).padStart(2)} reads ${String(fromCloud.ms).padStart(7)}ms`,
  );
  if (!same) print(`      ${compared[compared.length - 1]?.diff ?? ''}`);
}

const identical = compared.every((entry) => entry.same);
const nodeReads = compared.reduce((total, entry) => total + entry.nodeReads, 0);
const cloudReads = compared.reduce((total, entry) => total + entry.cloudReads, 0);

const report = {
  questions: compared.length,
  identical,
  mismatches: compared.filter((entry) => !entry.same).map((entry) => ({ id: entry.id, diff: entry.diff })),
  reads: { node: nodeReads, cloud: cloudReads },
  medianMs: {
    node: median(compared.map((entry) => entry.nodeMs)),
    cloud: median(compared.map((entry) => entry.cloudMs)),
  },
  database: cloudClient.database,
  collection: cloudClient.collection,
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 0
    ? Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2)
    : Math.round(sorted[middle] ?? 0);
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/cloud-parity.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print('');
print(`ALL_IDENTICAL: ${identical}`);
print(`reads: node ${nodeReads}, cloud ${cloudReads}`);
print(`median: node ${report.medianMs.node}ms, cloud ${report.medianMs.cloud}ms`);
print('artifacts/hydra/cloud-parity.json written.');

if (!identical) process.exit(1);
