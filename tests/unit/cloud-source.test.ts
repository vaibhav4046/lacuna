import { describe, expect, it } from 'vitest';

import { generateCorpus } from '../../src/corpus/index.js';
import { buildPlan } from '../../src/ingest/plan.js';
import { HydraCloud, type AppRecord } from '../../src/hydra/cloud.js';
import {
  buildCloudGraph,
  entityRecordId,
  INDEX_ID,
  toAppRecords,
  unwrapEnvelope,
} from '../../src/hydra/cloud-graph.js';
import { CloudSource } from '../../src/hydra/cloud-source.js';
import { ask, blastRadius, buildQuestion } from '../../src/retrieval/index.js';
import { RetrievalDecodeError } from '../../src/retrieval/errors.js';

/**
 * The cloud read path, against a store that answers from what the ingest
 * would have written.
 *
 * These do not talk to HydraDB. The records under test are the ones
 * `buildCloudGraph` produces from the same corpus the node ingests, served by
 * a fetch that behaves the way the service does: the envelope one level down,
 * a 404 for an id nobody wrote, and the collection scope on every request.
 * What that buys is the ability to assert on the read count and the failure
 * modes, which a live test can only observe.
 *
 * The claim that these two stores return the same answers is not made here.
 * It is made by scripts/cloud-parity.ts, which asks both of them.
 */

const CONFIG = {
  baseUrl: 'https://api.hydradb.com',
  token: 'test-token-not-a-real-key',
  database: 'lacuna-test',
  collection: 'backend',
};

const graph = buildCloudGraph(buildPlan(generateCorpus()));
const records = new Map(toAppRecords(graph).map((record) => [record.id, record]));

/** The service's envelope: what was sent, wrapped in what it stores. */
function envelopeFor(record: AppRecord): string {
  return JSON.stringify({
    id: record.id,
    title: record.title,
    timestamp: record.timestamp,
    content: { text: record.text, markdown: '', files: [] },
    document_metadata: record.metadata ?? {},
    relations: { source_ids: record.relations ?? [] },
  });
}

interface Served {
  readonly cloud: HydraCloud;
  readonly requests: string[];
}

function serving(store: ReadonlyMap<string, AppRecord> = records): Served {
  const requests: string[] = [];
  const cloud = new HydraCloud(CONFIG, {
    fetch: async (input): Promise<Response> => {
      const url = new URL(String(input));
      requests.push(url.pathname + url.search);
      const id = url.searchParams.get('id') ?? '';
      const record = store.get(id);
      if (record === undefined) {
        return new Response(
          JSON.stringify({ success: false, error: { code: 'FILE_NOT_FOUND', message: 'ID not found' } }),
          { status: 404, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ success: true, data: { content: envelopeFor(record) } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  return { cloud, requests };
}

const withClaims = graph.entities.find((entity) => entity.claims.length > 1);
if (withClaims === undefined) throw new Error('the corpus produced no entity with claims');

describe('reading one entity', () => {
  it('answers a subject out of a single record', async () => {
    const { cloud, requests } = serving();
    const read = await new CloudSource(cloud).subject(withClaims.name, 5_000);

    expect(read.value.id).toBe(withClaims.id);
    expect(read.value.claims).toEqual(withClaims.claims);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain(encodeURIComponent(entityRecordId(withClaims.name)));
  });

  it('scopes every read to the database and the collection', async () => {
    const { cloud, requests } = serving();
    await new CloudSource(cloud).subject(withClaims.name, 5_000);

    // The scope is not decoration: a status poll without it answers
    // FILE_NOT_FOUND for a source that ingested successfully.
    expect(requests[0]).toContain('database=lacuna-test');
    expect(requests[0]).toContain('collection=backend');
  });

  it('reports a name nobody wrote as out of scope rather than as a fault', async () => {
    const { cloud } = serving();
    const read = await new CloudSource(cloud).subject('Redshank', 5_000);

    expect(read.value.id).toBeNull();
    expect(read.value.claims).toEqual([]);

    // Two reads, not one. The record id is a hash of the exact name, so before
    // reporting that a subject is absent this checks the index for the same
    // name under a different case. A miss used to cost one read and a wrong
    // refusal: `foxglove` was reported out of scope while `Foxglove` answered.
    expect(read.traces).toHaveLength(2);
    expect(read.traces[1]?.request).toContain('index');
  });

  it('spends two reads on a name that is not there, the second ruling out a case difference', async () => {
    const { cloud, requests } = serving();
    await new CloudSource(cloud).subject('Redshank', 5_000);
    expect(requests).toHaveLength(2);
  });

  it('finds a subject the reader spelled in the wrong case, and answers from it', async () => {
    const { cloud } = serving();
    const read = await new CloudSource(cloud).subject(withClaims.name.toLowerCase(), 5_000);
    expect(read.value.id).toBe(withClaims.id);
    expect(read.value.claims.length).toBeGreaterThan(0);
  });

  it('reads a record once however many times it is asked for', async () => {
    const { cloud, requests } = serving();
    const source = new CloudSource(cloud);
    await source.subject(withClaims.name, 5_000);
    const second = await source.subject(withClaims.name, 5_000);

    expect(requests).toHaveLength(1);
    expect(second.traces).toHaveLength(0);
  });

  it('refuses a record whose fields are missing rather than answering from half of it', async () => {
    const id = entityRecordId(withClaims.name);
    const broken = new Map(records);
    broken.set(id, { id, title: withClaims.name, type: 'custom', timestamp: '', text: '{"id":1}' });

    const { cloud } = serving(broken);
    await expect(new CloudSource(cloud).subject(withClaims.name, 5_000))
      .rejects.toBeInstanceOf(RetrievalDecodeError);
  });

  it('refuses a record that is not JSON', async () => {
    const id = entityRecordId(withClaims.name);
    const broken = new Map(records);
    broken.set(id, { id, title: withClaims.name, type: 'custom', timestamp: '', text: 'not json' });

    const { cloud } = serving(broken);
    await expect(new CloudSource(cloud).subject(withClaims.name, 5_000))
      .rejects.toBeInstanceOf(RetrievalDecodeError);
  });
});

describe('citations', () => {
  it('costs nothing when the claim came from a record already read', async () => {
    const { cloud, requests } = serving();
    const source = new CloudSource(cloud);
    const subject = await source.subject(withClaims.name, 5_000);
    const claim = subject.value.claims[0];
    if (claim === undefined) throw new Error('no claim to cite');

    const evidence = await source.evidence(claim.id, 5_000);

    expect(requests).toHaveLength(1);
    expect(evidence.traces).toHaveLength(0);
    expect(evidence.value.every((record) => record.claimId === claim.id)).toBe(true);
  });

  it('reaches a claim through the index when its own record was never read', async () => {
    const { cloud, requests } = serving();
    const source = new CloudSource(cloud);
    const claim = withClaims.claims[0];
    if (claim === undefined) throw new Error('no claim to cite');

    const evidence = await source.evidence(claim.id, 5_000);

    // The index, then the record it named.
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain(encodeURIComponent(INDEX_ID));
    expect(evidence.value).toEqual(withClaims.evidence[String(claim.id)]);
  });

  it('answers nothing for a claim id no record carries', async () => {
    const { cloud } = serving();
    const evidence = await new CloudSource(cloud).evidence(999_999_999, 5_000);
    expect(evidence.value).toEqual([]);
  });
});

describe('a whole question', () => {
  it('answers, cites and costs one read for a direct question', async () => {
    const claim = withClaims.claims[withClaims.claims.length - 1];
    if (claim === undefined) throw new Error('no claim to ask about');

    const { cloud } = serving();
    const answer = await ask(
      new CloudSource(cloud),
      buildQuestion(withClaims.name, claim.predicate, null),
    );

    expect(answer.subject.id).toBe(withClaims.id);
    // One fetch, against the node's three: the record holds what three Cypher
    // reads would have gathered, and the citations came with it.
    expect(answer.queries).toHaveLength(1);
    expect(answer.queries[0]?.cypher).toBeNull();
    expect(answer.queries[0]?.request.startsWith('GET /context/inspect')).toBe(true);
  });

  it('walks a blast radius out of the same records', async () => {
    const root = graph.entities.find((entity) => entity.dependents.length > 0);
    if (root === undefined) throw new Error('the corpus produced no depended-on entity');

    const { cloud } = serving();
    const walked = await blastRadius(new CloudSource(cloud), root.name);

    expect(walked.root?.id).toBe(root.id);
    expect(walked.queries.length).toBeGreaterThan(0);
  });
});

describe('the records the ingest writes', () => {
  it('derives an id from the name and nothing else', () => {
    expect(entityRecordId('package-session')).toBe(entityRecordId('package-session'));
    expect(entityRecordId('package-session')).not.toBe(entityRecordId('package-Session'));
    expect(entityRecordId('a b/c')).toMatch(/^lacuna:entity:[0-9a-f]{32}$/);
  });

  it('writes one record per entity, one per session, and one index', () => {
    const written = toAppRecords(graph);
    const kinds = new Map<string, number>();
    for (const record of written) {
      const kind = String(record.metadata?.['lacuna_record'] ?? 'none');
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }

    expect(kinds.get('entity')).toBe(graph.entities.length);
    expect(kinds.get('session')).toBe(graph.sessions.length);
    expect(kinds.get('index')).toBe(1);
  });

  it('declares the sessions behind an entity as relations rather than leaving them to inference', () => {
    const written = toAppRecords(graph).find((record) => record.id === entityRecordId(withClaims.name));
    const cited = new Set(
      Object.values(withClaims.evidence).flat().map((record) => `lacuna:session:${record.sessionId}`),
    );

    expect(new Set(written?.relations ?? [])).toEqual(cited);
  });

  it('indexes every claim to the entity whose record carries it', () => {
    for (const entity of graph.entities) {
      for (const claim of entity.claims) {
        expect(graph.index.claims[String(claim.id)]).toBe(entity.name);
      }
    }
  });

  it('is the same bytes on a second build, because two runs must not write two corpora', () => {
    const again = buildCloudGraph(buildPlan(generateCorpus()));
    expect(JSON.stringify(again)).toBe(JSON.stringify(graph));
  });

  it('reads the text back out of the service envelope', () => {
    const record = toAppRecords(graph)[0];
    if (record === undefined) throw new Error('no records');
    expect(unwrapEnvelope(envelopeFor(record))).toBe(record.text);
    expect(unwrapEnvelope('not json')).toBeNull();
    expect(unwrapEnvelope('{"content":{}}')).toBeNull();
  });
});
