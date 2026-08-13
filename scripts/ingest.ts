import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { generateCorpus, DEFAULT_SEED } from '../src/corpus/index';
import { HydraClient } from '../src/hydra/client';
import { loadHydraConfig } from '../src/hydra/config';
import {
  buildPlan,
  runIngest,
  EDGE_TYPES,
  NODE_LABELS,
  IngestCollisionError,
  type IngestOptions,
  type IngestPlan,
} from '../src/ingest/index';

/**
 * Generates the demo corpus and writes it into HydraDB.
 *
 *   npm run ingest -- --dry-run     plan only, no node needed
 *   npm run ingest                  plan and write
 *
 * Everything it prints is meant to be pasted into a decision record or a run
 * log unchanged, which is why the numbers are plain and the timings are real.
 * It reads the connection out of .env.local and never prints the token.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

const USAGE = `Usage: npm run ingest -- [options]

  --seed <string>       corpus seed (default: ${DEFAULT_SEED})
  --concurrency <n>     edge writes in flight (default: the ingest default)
  --dry-run             build and print the plan, write nothing, need no node
  --skip-verify         skip the pre-write collision read
  --help
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** `1234.5ms` under a second, `12.3s` over, so the eye does not have to divide. */
function duration(ms: number): string {
  return ms < 1000 ? `${ms.toFixed(1)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function positiveInteger(raw: string, role: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${role} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function printPlan(plan: IngestPlan): void {
  const vertexTotal = NODE_LABELS.reduce((sum, label) => sum + plan.counts.vertices[label], 0);
  const edgeTotal = EDGE_TYPES.reduce((sum, type) => sum + plan.counts.edges[type], 0);

  process.stdout.write('vertices\n');
  for (const label of NODE_LABELS) {
    process.stdout.write(`  ${label.padEnd(13)}${String(plan.counts.vertices[label]).padStart(6)}\n`);
  }
  process.stdout.write(`  ${'total'.padEnd(13)}${String(vertexTotal).padStart(6)}`
    + ` in ${plan.batches.length} batches\n`);

  process.stdout.write('edges\n');
  for (const type of EDGE_TYPES) {
    process.stdout.write(`  ${type.padEnd(13)}${String(plan.counts.edges[type]).padStart(6)}\n`);
  }
  process.stdout.write(`  ${'total'.padEnd(13)}${String(edgeTotal).padStart(6)}\n`);
}

/**
 * Progress on a coarser stride than the ingest reports it.
 *
 * `runIngest` calls back every 100 edges, which is 57 lines for the demo corpus
 * and more noise than signal in a run log. Ten lines is enough to see it moving.
 */
function progressPrinter(edgeTotal: number): NonNullable<IngestOptions['onProgress']> {
  const stride = Math.max(1, Math.ceil(edgeTotal / 10));
  let lastEdgeMark = 0;

  return ({ phase, done, total }): void => {
    if (phase === 'edges') {
      if (done !== total && done - lastEdgeMark < stride) return;
      lastEdgeMark = done;
    }
    process.stdout.write(`  ${phase} ${done}/${total}\n`);
  };
}

const { values } = parseArgs({
  options: {
    seed: { type: 'string' },
    concurrency: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'skip-verify': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}

const seed = values.seed ?? DEFAULT_SEED;
const corpus = generateCorpus(seed);
process.stdout.write(`corpus  seed ${seed}, ${JSON.stringify(corpus.stats)}\n`);

const planStart = performance.now();
const plan = buildPlan(corpus);
const planMs = performance.now() - planStart;
process.stdout.write(`plan    built in ${duration(planMs)}\n`);
printPlan(plan);

if (values['dry-run'] === true) {
  process.stdout.write('dry run, nothing written\n');
  process.exit(0);
}

if (!existsSync(ENV_PATH)) {
  fail(
    `${ENV_PATH} is missing. Copy .env.example to .env.local and fill in the\n`
    + 'connection details, including the bearer token from the running node.\n'
    + 'Pass --dry-run to build the plan without a node.',
  );
}
process.loadEnvFile(ENV_PATH);

const config = loadHydraConfig();
const client = new HydraClient(config);
process.stdout.write(
  `target  ${config.baseUrl} namespace ${config.namespace} graph ${config.graph}`
  + ` cell ${config.cell}\n`,
);

const options: IngestOptions = {
  verifyKeys: values['skip-verify'] !== true,
  onProgress: progressPrinter(plan.edges.length),
  ...(values.concurrency === undefined
    ? {}
    : { concurrency: positiveInteger(values.concurrency, 'concurrency') }),
};

try {
  const report = await runIngest(client, plan, options);
  process.stdout.write(
    `\nwrote   ${report.vertices} vertices in ${report.batches} batches,`
    + ` ${report.edges} edges\n`
    + `already ${report.alreadyPresent} planned ids were in the graph before this run\n`
    + `timing  verify ${duration(report.timings.verifyMs)}`
    + `, vertices ${duration(report.timings.verticesMs)}`
    + `, edges ${duration(report.timings.edgesMs)}`
    + `, total ${duration(report.timings.totalMs)}\n`
    + `bookmark ${report.bookmark ?? 'none'}\n`,
  );
} catch (cause) {
  if (cause instanceof IngestCollisionError) {
    fail(
      `\nrefused before writing: id ${cause.id} already holds`
      + ` ${JSON.stringify(cause.storedKey)}, but this run planned`
      + ` ${JSON.stringify(cause.plannedKey)}.\n`
      + 'Either the graph holds someone else\'s data under that id, or two keys'
      + ' derived to the same one.',
    );
  }
  fail(`\ningest failed: ${cause instanceof Error ? cause.message : String(cause)}`);
}
