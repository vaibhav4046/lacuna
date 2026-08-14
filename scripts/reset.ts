import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { detachDeleteVertex, verticesByLabel } from '../src/hydra/queries.js';
import { NODE_LABELS } from '../src/ingest/index.js';

/**
 * Removes every vertex carrying one of Lacuna's labels, and every edge attached
 * to one.
 *
 *   npm run reset -- --dry-run    count what would go, delete nothing
 *   npm run reset -- --yes        delete it
 *
 * Ingestion merges, so it can add to a graph but never subtract from one. That
 * is the right behaviour for ingestion and the wrong behaviour for getting back
 * to a known state: a node left over from a probe, or from a corpus built under
 * a different seed, survives every re-ingest and shows up in retrieval as a
 * record with no key. This is the way back to empty.
 *
 * It deletes by label, so it touches nothing in the graph that Lacuna did not
 * put there. Everything it removes is regenerable: the corpus is deterministic
 * from its seed, and `npm run ingest` rebuilds it.
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));

/** Deletes in flight at once, matched to the ingest's edge pool. */
const CONCURRENCY = 8;

/** A label with more pages than this is a server handing back cursors forever. */
const MAX_PAGES = 1_024;

const PAGE_SIZE = 2_000;

const TIMEOUT_MS = 30_000;

const USAGE = `Usage: npm run reset -- [--yes | --dry-run]

Deletes every ${NODE_LABELS.join(', ')} vertex in the configured graph.

  --dry-run   count what would be deleted, delete nothing
  --yes       required to actually delete
`;

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Every vertex id carrying one label, read a page at a time under one query id. */
async function idsFor(client: HydraClient, label: string): Promise<number[]> {
  const query = verticesByLabel(label);
  const queryId = HydraClient.mintQueryId();
  const ids: number[] = [];
  let cursor: number | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const got = await client.queryPage(
      { ...query, pageSize: PAGE_SIZE, timeoutMs: TIMEOUT_MS },
      cursor === undefined ? { queryId } : { queryId, cursor },
    );
    for (const row of got.rows) {
      const id = row[0];
      if (typeof id !== 'number') {
        fail(`${label} returned a non-numeric id: ${JSON.stringify(id)}`);
      }
      ids.push(id);
    }
    if (got.nextCursor === null) return ids;
    cursor = got.nextCursor;
  }
  fail(`${label} still had pages after ${MAX_PAGES}, refusing to keep reading`);
}

const { values } = parseArgs({
  options: {
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});

if (values.help === true) {
  process.stdout.write(USAGE);
  process.exit(0);
}
if (values.yes !== true && values['dry-run'] !== true) {
  fail(`Refusing to delete without --yes.\n\n${USAGE}`);
}

if (!existsSync(ENV_PATH)) {
  fail(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.`);
}
process.loadEnvFile(ENV_PATH);

const config = loadHydraConfig();
const client = new HydraClient(config);
process.stdout.write(
  `target  ${config.baseUrl} namespace ${config.namespace} graph ${config.graph}`
  + ` cell ${config.cell}\n`,
);

let total = 0;
for (const label of NODE_LABELS) {
  const ids = await idsFor(client, label);
  total += ids.length;

  if (values['dry-run'] === true) {
    process.stdout.write(`  ${label.padEnd(14)}${String(ids.length).padStart(6)}\n`);
    continue;
  }

  // A shared cursor rather than a chunked split, so one slow delete does not
  // leave the other workers idle. Reading and bumping it is atomic here because
  // nothing yields between the two lines.
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      if (id === undefined) continue;
      await client.write({ ...detachDeleteVertex(id), timeoutMs: TIMEOUT_MS });
      done += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  process.stdout.write(`  ${label.padEnd(14)}${String(done).padStart(6)} deleted\n`);
}

if (values['dry-run'] === true) {
  process.stdout.write(`dry run, ${total} vertices would be deleted\n`);
  process.exit(0);
}

// Read back rather than trust the writes. A label that still has rows means a
// vertex was created while this was running, or a delete silently did nothing.
let left = 0;
for (const label of NODE_LABELS) {
  const ids = await idsFor(client, label);
  if (ids.length > 0) {
    process.stdout.write(`  ${label.padEnd(14)}${String(ids.length).padStart(6)} STILL PRESENT\n`);
    left += ids.length;
  }
}
process.stdout.write(
  left === 0
    ? `deleted ${total} vertices, every label now reads empty\n`
    : `deleted ${total} vertices, ${left} still present\n`,
);
process.exit(left === 0 ? 0 : 1);
