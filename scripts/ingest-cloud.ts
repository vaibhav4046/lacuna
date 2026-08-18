import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus } from '../src/corpus/index.js';
import { buildPlan } from '../src/ingest/plan.js';
import { cloudFromEnv, type AppRecord } from '../src/hydra/cloud.js';
import {
  buildCloudGraph,
  entityRecordId,
  INDEX_ID,
  toAppRecords,
  unwrapEnvelope,
} from '../src/hydra/cloud-graph.js';

/**
 * Writes the corpus and the claim graph derived from it into HydraDB Cloud.
 *
 *   npm run ingest:cloud            everything
 *   npm run ingest:cloud -- --graph only the claim records and the index
 *
 * Two kinds of record go in, and the difference is the product's own thesis.
 * The seventy-two sessions are the evidence: whole conversations, unedited,
 * which is what the service's vector search and its own graph extraction see.
 * The entity records are the claims: what those conversations were read to
 * state, when each became true, what replaced what, and which span supports
 * each. Evidence and claims are stored apart because they are different kinds
 * of thing, and a product that conflates them cannot tell you what changed.
 *
 * Ids are derived from the graph rather than assigned by the service, and
 * ingestion upserts, so running this twice writes the same records to the same
 * ids rather than a second copy of the corpus.
 *
 * Nothing here is destructive: it adds and replaces, and never deletes.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.deploy', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('../artifacts/hydra', import.meta.url));

if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. It holds the cloud key.\n`);
  process.exit(2);
}
process.loadEnvFile(ENV_PATH);

const cloud = cloudFromEnv(process.env);
if (cloud === null) {
  process.stderr.write('no HydraDB Cloud database is configured in .env.deploy\n');
  process.exit(2);
}

const graphOnly = process.argv.includes('--graph');
const print = (line: string): void => void process.stdout.write(`${line}\n`);

/** Small enough that one rejected batch is a small loss, large enough to be few. */
const BATCH = 12;

const started = Date.now();
print(`HydraDB Cloud, database ${cloud.database}, collection ${cloud.collection}.`);

if (!await cloud.readyForIngestion()) {
  print('The database is not ready for ingestion yet. Provisioning, then waiting.');
  await cloud.createDatabase();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await cloud.readyForIngestion()) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!await cloud.readyForIngestion()) {
    process.stderr.write('the database did not become ready\n');
    process.exit(4);
  }
}
print('Ready for ingestion.');

const corpus = generateCorpus();
const graph = buildCloudGraph(buildPlan(corpus));
const all = toAppRecords(graph);
const records: readonly AppRecord[] = graphOnly
  ? all.filter((record) => record.metadata?.['lacuna_record'] !== 'session')
  : all;

print(
  `${graph.entities.length} entities, ${Object.keys(graph.index.claims).length} claims, `
  + `${graph.sessions.length} sessions. Writing ${records.length} records.`,
);

const accepted: string[] = [];
const refused: { id: string; error: string }[] = [];

for (let at = 0; at < records.length; at += BATCH) {
  const batch = records.slice(at, at + BATCH);
  const results = await cloud.ingestApp(batch);
  for (const result of results) {
    if (result.error === null || result.error === '') accepted.push(result.id);
    else refused.push({ id: result.id, error: result.error });
  }
  print(`  ${Math.min(at + BATCH, records.length)}/${records.length} queued`);
}

if (refused.length > 0) {
  print('');
  print(`${refused.length} records were refused:`);
  for (const entry of refused.slice(0, 10)) print(`  ${entry.id}: ${entry.error}`);
}

print('');
print(`Waiting for ${accepted.length} records to index.`);

// Polled in slices because the status endpoint takes a list, and a list of a
// hundred and sixty ids in a query string is a request some proxy will refuse.
const statuses = new Map<string, string>();
for (let at = 0; at < accepted.length; at += 20) {
  const slice = accepted.slice(at, at + 20);
  const done = await cloud.waitForIndexing(slice, { timeoutMs: 900_000, intervalMs: 5_000 });
  for (const status of done) statuses.set(status.id, status.indexingStatus);
  const completed = [...statuses.values()].filter((state) => state === 'completed').length;
  print(`  ${completed}/${accepted.length} indexed`);
}

const failed = [...statuses].filter(([, state]) => state !== 'completed');

// Read one record back and compare it to what was written, because "queued"
// and "completed" are the service's words for its own progress and neither is
// a statement about the bytes.
const sample = graph.entities.find((entity) => entity.claims.length > 0) ?? graph.entities[0];
let verified = false;
if (sample !== undefined) {
  const fetched = await cloud.inspect(entityRecordId(sample.name));
  const text = fetched === null ? null : unwrapEnvelope(fetched.envelope);
  verified = text === JSON.stringify(sample);
}

const index = await cloud.inspect(INDEX_ID);
const indexOk = index !== null && unwrapEnvelope(index.envelope) === JSON.stringify(graph.index);

const report = {
  database: cloud.database,
  collection: cloud.collection,
  written: records.length,
  accepted: accepted.length,
  refused: refused.length,
  indexed: [...statuses.values()].filter((state) => state === 'completed').length,
  failed: failed.map(([id, state]) => ({ id, state })),
  entities: graph.entities.length,
  claims: Object.keys(graph.index.claims).length,
  sessions: graph.sessions.length,
  sampleEntity: sample?.name ?? null,
  sampleReadBackMatches: verified,
  indexReadBackMatches: indexOk,
  seconds: Math.round((Date.now() - started) / 1000),
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/cloud-ingest.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print('');
print(JSON.stringify(report, null, 2));
print('');
print(`artifacts/hydra/cloud-ingest.json written.`);

if (!verified || !indexOk || refused.length > 0) {
  process.stderr.write('the read back did not match what was written\n');
  process.exit(5);
}
