import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus, DEFAULT_SEED } from '../src/corpus/index.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { verticesByLabel } from '../src/hydra/queries.js';
import { buildPlan, EDGE_TYPES, NODE_LABELS } from '../src/ingest/index.js';

/**
 * Counts what is actually in the graph and diffs it against what the plan says
 * should be there.
 *
 *   npm run census
 *
 * The ingest report says what it wrote. This says what survived, which is a
 * different claim and the one worth checking: it is what proves a second ingest
 * did not double anything, and it is what catches a node left behind by a probe
 * or by a corpus built under another seed. Exits non-zero on any disagreement,
 * so it works as a gate and not only as something to read.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

/** The server's admission control rejects a query timeout above this. */
const TIMEOUT_MS = 30_000;

const PAGE_SIZE = 2_000;

const MAX_PAGES = 1_024;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

if (!existsSync(ENV_PATH)) {
  fail(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.`);
}
process.loadEnvFile(ENV_PATH);

const config = loadHydraConfig();
const client = new HydraClient(config);
const seed = process.argv[2] ?? DEFAULT_SEED;
const plan = buildPlan(generateCorpus(seed));

process.stdout.write(
  `target  ${config.baseUrl} namespace ${config.namespace} graph ${config.graph}`
  + ` cell ${config.cell}\nseed    ${seed}\n\n`,
);

async function count(cypher: string): Promise<number> {
  const page = await client.queryPage({ cypher, timeoutMs: TIMEOUT_MS });
  const value = page.rows[0]?.[0];
  if (typeof value !== 'number') {
    fail(`count query returned ${JSON.stringify(value)}: ${cypher}`);
  }
  return value;
}

let disagreements = 0;

function report(name: string, got: number, want: number): void {
  const flag = got === want ? '' : '  <- differs';
  if (got !== want) disagreements += 1;
  process.stdout.write(
    `  ${name.padEnd(14)}${String(got).padStart(6)}${String(want).padStart(9)}${flag}\n`,
  );
}

process.stdout.write('label            graph  planned\n');
for (const label of NODE_LABELS) {
  report(label, await count(`MATCH (n:${label}) RETURN count(*) AS n`), plan.counts.vertices[label]);
}

process.stdout.write('\nedge             graph  planned\n');
for (const type of EDGE_TYPES) {
  report(
    type,
    await count(`MATCH ()-[r:${type}]->() RETURN count(*) AS n`),
    plan.counts.edges[type],
  );
}

// Counts alone cannot tell a missing node from a stray one, since the two
// cancel. This reads every key back and names anything the plan did not write.
const planned = new Set<string>();
for (const batch of plan.batches) {
  for (const row of batch.rows) planned.add(String(row['key']));
}

const strays: string[] = [];
for (const label of NODE_LABELS) {
  const query = verticesByLabel(label);
  const queryId = HydraClient.mintQueryId();
  let cursor: number | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const got = await client.queryPage(
      { ...query, pageSize: PAGE_SIZE, timeoutMs: TIMEOUT_MS },
      cursor === undefined ? { queryId } : { queryId, cursor },
    );
    for (const row of got.rows) {
      const key = row[1];
      if (key === null || !planned.has(String(key))) {
        strays.push(`  ${label.padEnd(14)}${String(row[0]).padEnd(18)}${JSON.stringify(key)}`);
      }
    }
    if (got.nextCursor === null) break;
    cursor = got.nextCursor;
    if (page === MAX_PAGES - 1) fail(`${label} still had pages after ${MAX_PAGES}`);
  }
}

if (strays.length > 0) {
  process.stdout.write('\nnodes in the graph that this plan did not write:\n');
  for (const line of strays) process.stdout.write(`${line}\n`);
}

process.stdout.write(
  disagreements === 0 && strays.length === 0
    ? '\ngraph matches the plan exactly\n'
    : `\n${disagreements} counts differ, ${strays.length} unplanned nodes\n`,
);
process.exit(disagreements === 0 && strays.length === 0 ? 0 : 1);
