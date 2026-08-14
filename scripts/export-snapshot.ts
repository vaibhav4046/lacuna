/**
 * Records the graph snapshot the public deployment replays.
 *
 * Runs the production read queries — the same PreparedQuery builders the
 * server uses — against the live HydraDB node through a recording fetch
 * wrapper that tees every wire request/response pair. The recorded bodies are
 * written verbatim to artifacts/snapshot/graph-snapshot.json; nothing is
 * synthesised, reformatted or re-encoded.
 *
 * Coverage argument: the ask flow only ever issues four query shapes, keyed
 * by entity name, entity id or claim id (src/retrieval/fetch.ts). Entities
 * are enumerated from the corpus roster, claim ids are collected from the
 * claims-about replies (including superseded-by ids, which point at claims
 * about the same entity), and bridge hops resolve entity names the corpus
 * validator already proved are in the roster. One extra entity-by-name reply
 * is recorded for a name proven absent, so unknown subjects replay the node's
 * real zero-row answer.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus } from '../src/corpus/index.js';
import { OUT_OF_SCOPE_SUBJECTS } from '../src/corpus/vocab.js';
import { HydraClient, type FetchLike, type QueryPage } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import {
  claimsAbout,
  entityByName,
  evidenceForClaim,
  mentionsFrom,
} from '../src/retrieval/index.js';
import {
  canonicalKey,
  type GraphSnapshot,
  type SnapshotEntry,
} from '../src/snapshot/replay.js';

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const OUTPUT_PATH = fileURLToPath(
  new URL('../artifacts/snapshot/graph-snapshot.json', import.meta.url),
);

const recorded = new Map<string, SnapshotEntry>();

const recording: FetchLike = async (input, init) => {
  if (typeof init.body !== 'string') {
    throw new Error('expected a string wire request body to record');
  }
  const wire: unknown = JSON.parse(init.body);
  if (typeof wire !== 'object' || wire === null) {
    throw new Error('wire request body is not a JSON object');
  }
  const request = wire as Record<string, unknown>;
  if (request['cursor'] !== undefined) {
    throw new Error(
      'a query paged during export; the snapshot only holds single-page replies',
    );
  }
  const query = request['query'];
  if (typeof query !== 'string') {
    throw new Error('wire request has no query text');
  }
  const parameters = request['parameters'];
  const recordedParameters =
    typeof parameters === 'object' && parameters !== null && !Array.isArray(parameters)
      ? (parameters as Record<string, unknown>)
      : {};

  const response = await fetch(input, init);
  const body = await response.clone().text();
  if (response.ok) {
    const page: unknown = JSON.parse(body);
    const nextCursor = (page as Record<string, unknown>)['next_cursor'];
    if (nextCursor !== null && nextCursor !== undefined) {
      throw new Error(
        `query "${query.slice(0, 60)}..." returned a multi-page reply; `
        + 'the snapshot only holds single-page replies',
      );
    }
    const key = canonicalKey(query, recordedParameters);
    const existing = recorded.get(key);
    if (existing !== undefined && existing.body !== body) {
      throw new Error(
        'the same query returned two different replies during export; '
        + 'was something writing to the graph?',
      );
    }
    recorded.set(key, { cypher: query, parameters: recordedParameters, body });
  }
  return response;
};

function column(page: QueryPage, name: string): number {
  const index = page.columns.indexOf(name);
  if (index === -1) {
    throw new Error(`reply has no "${name}" column, only [${page.columns.join(', ')}]`);
  }
  return index;
}

function numberAt(page: QueryPage, row: number, col: number): number {
  const value = page.rows[row]?.[col];
  if (typeof value !== 'number') {
    throw new Error(`row ${row} column ${col} is not a number`);
  }
  return value;
}

async function main(): Promise<void> {
  const config = loadHydraConfig();
  const client = new HydraClient(config, { fetch: recording });
  const corpus = generateCorpus();

  const claimIds = new Set<number>();
  for (const entity of corpus.entities) {
    const head = await client.query(entityByName(entity.name));
    if (head.rows.length !== 1) {
      throw new Error(
        `entity "${entity.name}" matched ${head.rows.length} vertices; `
        + 'the graph does not hold the demo corpus — run npm run ingest first',
      );
    }
    const entityId = numberAt(head, 0, column(head, 'id'));

    const claims = await client.query(claimsAbout(entityId));
    const idColumn = column(claims, 'id');
    const supersededColumn = column(claims, 'superseded_by');
    for (let row = 0; row < claims.rows.length; row += 1) {
      claimIds.add(numberAt(claims, row, idColumn));
      const supersededBy = claims.rows[row]?.[supersededColumn];
      if (typeof supersededBy === 'number') {
        claimIds.add(supersededBy);
      }
    }

    await client.query(mentionsFrom(entityId));
  }

  for (const claimId of [...claimIds].sort((a, b) => a - b)) {
    await client.query(evidenceForClaim(claimId));
  }

  const absentName = OUT_OF_SCOPE_SUBJECTS[0];
  if (absentName === undefined) {
    throw new Error('OUT_OF_SCOPE_SUBJECTS is empty; no absent name to probe');
  }
  if (corpus.entities.some((entity) => entity.name === absentName)) {
    throw new Error(`absent probe "${absentName}" is in the roster`);
  }
  const probe = entityByName(absentName);
  const probePage = await client.query(probe);
  if (probePage.rows.length !== 0) {
    throw new Error(
      `absent probe "${absentName}" matched ${probePage.rows.length} vertices; `
      + 'it must not exist in the graph',
    );
  }
  const absentEntry = recorded.get(canonicalKey(probe.cypher, probe.parameters));
  if (absentEntry === undefined) {
    throw new Error('the absent probe reply was not recorded');
  }

  const snapshot: GraphSnapshot = {
    exportedAt: new Date().toISOString(),
    seed: corpus.seed,
    node: {
      namespace: config.namespace,
      graph: config.graph,
      cell: config.cell,
    },
    counts: {
      entities: corpus.entities.length,
      claims: claimIds.size,
      entries: recorded.size,
    },
    absent: {
      cypher: probe.cypher,
      body: absentEntry.body,
    },
    entries: [...recorded.values()],
  };

  mkdirSync(fileURLToPath(new URL('../artifacts/snapshot', import.meta.url)), {
    recursive: true,
  });
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  process.stdout.write(
    `recorded ${snapshot.counts.entries} replies `
    + `(${snapshot.counts.entities} entities, ${snapshot.counts.claims} claims) `
    + `to artifacts/snapshot/graph-snapshot.json\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
