import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Corpus, EvidenceSpan, Message } from '../../src/corpus/types.js';
import { HydraClient } from '../../src/hydra/client.js';
import { loadHydraConfig, type HydraConfig } from '../../src/hydra/config.js';
import { detachDeleteVertex, upsertVertices } from '../../src/hydra/queries.js';
import { IngestCollisionError } from '../../src/ingest/errors.js';
import { buildPlan, type EdgeType, type IngestPlan } from '../../src/ingest/plan.js';
import { runIngest, type IngestReport } from '../../src/ingest/run.js';
import { canonicalKey, deriveId } from '../../src/model/ids.js';

/**
 * Ingestion against a live HydraDB node. Nothing here is mocked.
 *
 * The claim this file exists to check is idempotence: ids are derived from what
 * a node *is*, every write is a MERGE on that id, so ingesting the same corpus
 * twice leaves the same graph. That is not something a unit test can establish,
 * because the thing being trusted is the engine's MERGE, not our code's
 * arithmetic. So it is ingested twice, for real, and the graph is diffed.
 *
 * The fixture is a hand-written corpus of fourteen vertices and sixteen edges
 * rather than the demo corpus. Two reasons. It runs in about a second instead of
 * two minutes, and every edge type in the schema appears in it, which the demo
 * corpus achieves only incidentally. It still goes through `buildPlan`, so the
 * path under test is the real one end to end.
 *
 * A missing node is a failure, not a skip.
 */

const ENV_PATH = fileURLToPath(new URL('../../.env.local', import.meta.url));

/**
 * Every fixture key starts with this. Ids are a hash of the key, so a prefix no
 * real corpus uses is what keeps this test's cleanup from deleting real nodes.
 */
const PREFIX = 'contract-fixture';

const PROJECT = `${PREFIX}/project-atlas`;
const PERSON = `${PREFIX}/person-rowan`;
const VENDOR = `${PREFIX}/vendor-northgate`;

const SESSION_KEY = `${PREFIX}/session-1`;
const messageKey = (n: number): string => `${SESSION_KEY}/m${n}`;

/** Locates the quote in the text rather than trusting hand-counted offsets. */
function span(claimKey: string, text: string, quote: string): EvidenceSpan {
  const start = text.indexOf(quote);
  if (start < 0) {
    throw new Error(`fixture quote ${JSON.stringify(quote)} is not in the message text`);
  }
  return { claimKey, start, end: start + quote.length, quote };
}

function message(
  n: number,
  speaker: Message['speaker'],
  text: string,
  claims: Message['claims'],
  spans: readonly EvidenceSpan[],
): Message {
  return {
    key: messageKey(n),
    sessionKey: SESSION_KEY,
    index: n,
    speaker,
    timestamp: `2026-03-0${n}T09:00:00Z`,
    text,
    claims,
    spans,
  };
}

/**
 * Four claims arranged so that all seven edge types appear:
 *
 *   c1  owner is Rowan          names an entity, so MENTIONS
 *   c2  owner is someone else   corrects c1, so SUPERSEDES
 *   c3  vendor is Northgate     stands
 *   c4  vendor is Southport     stands, and disagrees with c3, so CONTRADICTS
 *
 * c1 is superseded, which is what keeps it out of the contradiction pass; if it
 * were not, c1 and c2 would be read as a disagreement rather than a correction.
 */
function fixtureCorpus(): Corpus {
  const t1 = 'Rowan owns Atlas for now, confirmed on the call.';
  const t2 = 'Correction: Atlas is owned by the platform group, not Rowan.';
  const t3 = 'Atlas bills through Northgate.';
  const t4 = 'Atlas bills through Southport.';

  const sessions = [{
    key: SESSION_KEY,
    title: 'Contract fixture thread',
    startedAt: '2026-03-01T09:00:00Z',
    messages: [
      message(1, 'user', t1, [{
        key: `${PREFIX}/c1`,
        subject: PROJECT,
        predicate: 'owner' as const,
        kind: 'assert' as const,
        objectText: PERSON,
        objectEntity: PERSON,
        supersedes: null,
        validFrom: '2026-03-01T09:00:00Z',
      }], [span(`${PREFIX}/c1`, t1, 'Rowan owns Atlas')]),

      message(2, 'user', t2, [{
        key: `${PREFIX}/c2`,
        subject: PROJECT,
        predicate: 'owner' as const,
        kind: 'revise' as const,
        objectText: 'the platform group',
        objectEntity: null,
        supersedes: `${PREFIX}/c1`,
        validFrom: '2026-03-02T09:00:00Z',
      }], [span(`${PREFIX}/c2`, t2, 'owned by the platform group')]),

      message(3, 'user', t3, [{
        key: `${PREFIX}/c3`,
        subject: PROJECT,
        predicate: 'vendor' as const,
        kind: 'assert' as const,
        objectText: VENDOR,
        objectEntity: null,
        supersedes: null,
        validFrom: '2026-03-03T09:00:00Z',
      }], []),

      message(4, 'user', t4, [{
        key: `${PREFIX}/c4`,
        subject: PROJECT,
        predicate: 'vendor' as const,
        kind: 'assert' as const,
        objectText: `${PREFIX}/vendor-southport`,
        objectEntity: null,
        supersedes: null,
        validFrom: '2026-03-04T09:00:00Z',
      }], []),
    ],
  }];

  const characters = [t1, t2, t3, t4].reduce((sum, text) => sum + text.length, 0);
  return {
    seed: `${PREFIX}-v1`,
    sessions,
    questions: [],
    entities: [
      { name: PROJECT, kind: 'project' },
      { name: PERSON, kind: 'person' },
      { name: VENDOR, kind: 'vendor' },
    ],
    stats: {
      sessions: 1,
      messages: 4,
      claims: 4,
      characters,
      estimatedTokens: Math.round(characters / 4),
    },
  };
}

/** What the fixture is worth: change it and these numbers say so. */
const EXPECTED_VERTICES = 14;
const EXPECTED_EDGES = 16;

let config: HydraConfig;
let client: HydraClient;
let plan: IngestPlan;

async function outDegree(id: number, type: EdgeType): Promise<number> {
  const rows = await client.queryObjects({
    cypher: `MATCH (a {id: $src})-[:${type}]->(b) RETURN count(*) AS n`,
    parameters: { src: id },
  });
  const n = rows[0]?.['n'];
  if (typeof n !== 'number') {
    throw new Error(`out-degree query returned ${JSON.stringify(n)}`);
  }
  return n;
}

/** Every edge the fixture plants, addressed from its source node. */
async function edgeCensus(): Promise<Record<string, number>> {
  const session = deriveId('Session', SESSION_KEY);
  const entries: readonly (readonly [string, number, EdgeType])[] = [
    ['session CONTAINS', session, 'CONTAINS'],
    ['m1 HAS_SPAN', deriveId('Message', messageKey(1)), 'HAS_SPAN'],
    ['m2 HAS_SPAN', deriveId('Message', messageKey(2)), 'HAS_SPAN'],
    ['c1 ABOUT', deriveId('Claim', `${PREFIX}/c1`), 'ABOUT'],
    ['c1 MENTIONS', deriveId('Claim', `${PREFIX}/c1`), 'MENTIONS'],
    ['c2 SUPERSEDES', deriveId('Claim', `${PREFIX}/c2`), 'SUPERSEDES'],
    ['c3 CONTRADICTS', deriveId('Claim', `${PREFIX}/c3`), 'CONTRADICTS'],
    ['c4 CONTRADICTS', deriveId('Claim', `${PREFIX}/c4`), 'CONTRADICTS'],
  ];

  const census: Record<string, number> = {};
  for (const [name, id, type] of entries) {
    census[name] = await outDegree(id, type);
  }
  return census;
}

async function removeFixture(): Promise<void> {
  for (const id of plan.keys.keys()) {
    await client.write(detachDeleteVertex(id));
  }
  client.forgetWriteBookmark();
}

beforeAll(async () => {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `${ENV_PATH} is missing. Copy .env.example to .env.local and fill in the `
      + 'token from the running node before running the contract tests.',
    );
  }
  process.loadEnvFile(ENV_PATH);
  config = loadHydraConfig();
  client = new HydraClient(config);
  plan = buildPlan(fixtureCorpus());

  try {
    await client.query({ cypher: 'MATCH (n:Entity) RETURN count(*) AS n' });
  } catch (cause) {
    throw new Error(
      `no HydraDB node answered at ${config.baseUrl}. Start one before running `
      + 'the contract tests; they do not mock the database.',
      { cause },
    );
  }

  /*
   * Start from nothing. "The first ingest reports zero already present" is only
   * a meaningful assertion against a graph that does not already hold the
   * fixture, and a run that failed halfway leaves one that does. Deleting an id
   * that is not there is a no-op the engine accepts, so this is safe on a clean
   * graph as well.
   */
  await removeFixture();
});

afterAll(async () => {
  if (client !== undefined) await removeFixture();
});

describe('the fixture plan', () => {
  it('covers every node label and every edge type', () => {
    expect(plan.counts.vertices).toEqual({
      Session: 1, Message: 4, EvidenceSpan: 2, Claim: 4, Entity: 3,
    });
    expect(plan.counts.edges).toEqual({
      CONTAINS: 4, HAS_SPAN: 2, SUPPORTS: 2, ABOUT: 4,
      MENTIONS: 1, SUPERSEDES: 1, CONTRADICTS: 2,
    });
    expect(plan.keys.size).toBe(EXPECTED_VERTICES);
    expect(plan.edges).toHaveLength(EXPECTED_EDGES);
  });
});

describe('ingesting twice', () => {
  let first: IngestReport;
  let census: Record<string, number>;

  it('writes the whole plan on a graph that does not hold it', async () => {
    first = await runIngest(client, plan, { concurrency: 4 });

    expect(first.alreadyPresent).toBe(0);
    expect(first.vertices).toBe(EXPECTED_VERTICES);
    expect(first.edges).toBe(EXPECTED_EDGES);
    expect(first.bookmark).not.toBe(null);
  });

  it('leaves every planned edge in the graph', async () => {
    census = await edgeCensus();
    expect(census).toEqual({
      'session CONTAINS': 4,
      'm1 HAS_SPAN': 1,
      'm2 HAS_SPAN': 1,
      'c1 ABOUT': 1,
      'c1 MENTIONS': 1,
      'c2 SUPERSEDES': 1,
      'c3 CONTRADICTS': 1,
      'c4 CONTRADICTS': 1,
    });
  });

  it('finds all of it already there the second time', async () => {
    const second = await runIngest(client, plan, { concurrency: 4 });

    // Every planned id read back exactly once. A duplicated node would count
    // twice here, which is the reason this is an equality and not a floor.
    expect(second.alreadyPresent).toBe(EXPECTED_VERTICES);
    expect(second.vertices).toBe(EXPECTED_VERTICES);
    expect(second.edges).toBe(EXPECTED_EDGES);
  });

  it('changes nothing by doing it', async () => {
    expect(await edgeCensus()).toEqual(census);
  });
});

describe('the collision check', () => {
  /*
   * ADR 0002 stores the full canonical key on every node so that two keys
   * truncating to the same 52-bit id is detectable rather than silent. Forcing a
   * real hash collision is not possible, so the condition it produces is staged
   * instead: a node under a planned id holding a different key.
   */
  it('refuses to write over a node holding a different key', async () => {
    const id = deriveId('Entity', PROJECT);
    const planted = `${PREFIX}/not-the-key-this-id-was-derived-from`;

    await client.write(upsertVertices({
      label: 'Entity',
      properties: ['key', 'name', 'kind'],
      rows: [{ id, key: planted, name: PROJECT, kind: 'project' }],
    }));

    try {
      const error = await runIngest(client, plan, { concurrency: 4 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IngestCollisionError);
      const collision = error as IngestCollisionError;
      expect(collision.id).toBe(id);
      expect(collision.storedKey).toBe(planted);
      expect(collision.plannedKey).toBe(canonicalKey('Entity', PROJECT));
    } finally {
      // Put the real key back. Skipping the check is exactly right here: the
      // graph is knowingly in the state the check exists to refuse.
      await runIngest(client, plan, { concurrency: 4, verifyKeys: false });
    }
  });

  it('is happy again once the key matches', async () => {
    const report = await runIngest(client, plan, { concurrency: 4 });
    expect(report.alreadyPresent).toBe(EXPECTED_VERTICES);
  });
});
