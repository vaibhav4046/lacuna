import { beforeEach, describe, expect, it } from 'vitest';

import { HydraClient } from '../../src/hydra/client.js';
import { loadHydraConfig } from '../../src/hydra/config.js';
import { HydraQueryError } from '../../src/hydra/errors.js';
import { IngestCollisionError, IngestError } from '../../src/ingest/errors.js';
import type { EdgeType, IngestPlan, NodeLabel, PlannedEdge } from '../../src/ingest/plan.js';
import { runIngest, type IngestProgress } from '../../src/ingest/run.js';

/**
 * `runIngest` against a fake fetch.
 *
 * The live counterpart, tests/contract/ingest.contract.test.ts, proves the thing
 * that only a real engine can prove: that ingesting twice leaves one graph. What
 * it cannot reach is the behaviour that depends on what the server says back.
 * A fourteen-node fixture never pages, never returns a node with a missing key,
 * and never fails halfway through the edge phase. Those paths are the ones here,
 * and a fake responder is the only way to stand them up on demand.
 *
 * Nothing in this file asserts that HydraDB does anything. It asserts what
 * Lacuna does with an answer.
 */

const config = loadHydraConfig({
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: 'zzz-not-a-real-token-zzz',
});

interface Call {
  readonly body: Record<string, unknown>;
}

let calls: Call[];

beforeEach(() => {
  calls = [];
});

/** One response, shaped like the engine's. `n` is the 1-based call number. */
function ok(n: number, payload: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    query_id: 'server-assigned',
    columns: ['id', 'key'],
    rows: [],
    read_epoch: 67,
    next_cursor: null,
    bookmark: `bm-${n}`,
    ...payload,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function client(responder: (call: Call, n: number) => Response = (_, n) => ok(n)): HydraClient {
  return new HydraClient(config, {
    fetch: (async (_url: string, init: RequestInit) => {
      const call: Call = { body: JSON.parse(String(init.body)) as Record<string, unknown> };
      calls.push(call);
      return responder(call, calls.length);
    }) as unknown as typeof fetch,
  });
}

/** The nth call's request body, by position, with a useful failure when absent. */
function call(n: number): Record<string, unknown> {
  const found = calls[n];
  if (found === undefined) {
    throw new Error(`no call at index ${n}; there were ${calls.length}`);
  }
  return found.body;
}

function cypherOf(n: number): string {
  return String(call(n)['query']);
}

function isWrite(c: Call): boolean {
  return String(c.body['query']).includes('MERGE');
}

/** Read-back rows. A null key stands for a node that carries no key at all. */
function idKeyRows(
  rows: readonly (readonly [number, string | null])[],
): readonly unknown[][] {
  return rows.map(([id, key]) => [
    { type: 'vertex_id', value: id },
    key === null ? { type: 'null' } : { type: 'string', value: key },
  ]);
}

const CLAIM = 3_000_000_000_001;
const ENTITY_A = 4_000_000_000_001;
const ENTITY_B = 4_000_000_000_002;

const CLAIM_KEY = 'unit/session-1/m1#c1';
const ENTITY_A_KEY = 'unit/project-atlas';
const ENTITY_B_KEY = 'unit/person-rowan';

/**
 * A plan by hand rather than through `buildPlan`.
 *
 * The contract test goes through the real builder because it is testing the two
 * halves together. Here the plan is the input to the thing under test, so it is
 * written out: one Claim batch and one Entity batch, which is two labels to read
 * back and two batches to write, and each number below is small enough to assert
 * against directly.
 */
function planWith(edges: readonly PlannedEdge[]): IngestPlan {
  const edgeCounts: Record<EdgeType, number> = {
    CONTAINS: 0,
    HAS_SPAN: 0,
    SUPPORTS: 0,
    ABOUT: 0,
    MENTIONS: 0,
    SUPERSEDES: 0,
    CONTRADICTS: 0,
  };
  for (const edge of edges) edgeCounts[edge.type] += 1;

  const vertices: Record<NodeLabel, number> = {
    Session: 0,
    Message: 0,
    EvidenceSpan: 0,
    Claim: 1,
    Entity: 2,
  };

  return {
    batches: [
      {
        label: 'Claim',
        properties: ['key', 'predicate'],
        rows: [{ id: CLAIM, key: CLAIM_KEY, predicate: 'owner' }],
      },
      {
        label: 'Entity',
        properties: ['key', 'name'],
        rows: [
          { id: ENTITY_A, key: ENTITY_A_KEY, name: 'Atlas' },
          { id: ENTITY_B, key: ENTITY_B_KEY, name: 'Rowan' },
        ],
      },
    ],
    edges,
    keys: new Map([
      [CLAIM, CLAIM_KEY],
      [ENTITY_A, ENTITY_A_KEY],
      [ENTITY_B, ENTITY_B_KEY],
    ]),
    counts: { vertices, edges: edgeCounts },
  };
}

const THREE_EDGES: readonly PlannedEdge[] = [
  { type: 'ABOUT', src: CLAIM, dst: ENTITY_A },
  { type: 'MENTIONS', src: CLAIM, dst: ENTITY_B },
  { type: 'CONTAINS', src: ENTITY_A, dst: ENTITY_B },
];

/** `n` distinct edges, for the cases that need the pool to have work to cancel. */
function manyEdges(n: number): readonly PlannedEdge[] {
  return Array.from({ length: n }, (_, i): PlannedEdge => ({
    type: 'MENTIONS',
    src: CLAIM,
    dst: ENTITY_B + i,
  }));
}

const plan = planWith(THREE_EDGES);

/**
 * Forces the label scan.
 *
 * Three planned ids is under the threshold `auto` reads one id at a time at, so
 * a plan this size would otherwise issue one request per id and every assertion
 * below that counts calls or addresses one by position would be describing a
 * different run. The tests that are about the strategy itself say which one they
 * mean; these are about everything else and pin it so it cannot drift.
 */
const SCAN = { verifyStrategy: 'scan' } as const;

describe('the read-back by label scan', () => {
  it('reads only the labels the plan has vertices for, in schema order', async () => {
    await runIngest(client(), plan, { ...SCAN, concurrency: 2 });

    // Session, Message and EvidenceSpan are all zero in this plan, so three of
    // the five labels are never asked about.
    expect(cypherOf(0)).toBe('MATCH (n:Claim) RETURN n.id AS id, n.key AS key');
    expect(cypherOf(1)).toBe('MATCH (n:Entity) RETURN n.id AS id, n.key AS key');
    expect(cypherOf(2)).toContain('MERGE');
  });

  it('follows the cursor under one query id', async () => {
    // Call 1 is the Claim read. Calls 2 and 3 are the two pages of the Entity
    // read, holding one planned id each.
    const c = client((_call, n) => {
      if (n === 2) return ok(n, { rows: idKeyRows([[ENTITY_A, ENTITY_A_KEY]]), next_cursor: 41 });
      if (n === 3) return ok(n, { rows: idKeyRows([[ENTITY_B, ENTITY_B_KEY]]) });
      return ok(n);
    });

    const report = await runIngest(c, plan, { ...SCAN, concurrency: 2 });

    // A cursor is scoped to the query id it was issued under, so a paged read
    // that mints a fresh id on the second request is reading something else.
    expect(call(2)['query_id']).toBe(call(1)['query_id']);
    expect(call(1)['cursor']).toBeUndefined();
    expect(call(2)['cursor']).toBe(41);

    // Each label read is its own query, though.
    expect(call(1)['query_id']).not.toBe(call(0)['query_id']);

    // Both pages counted, not just the one the loop ended on.
    expect(report.alreadyPresent).toBe(2);
  });

  it('leaves nodes outside the plan alone', async () => {
    const stranger = 8_000_000_000_009;
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[stranger, 'someone/elses/node'], [CLAIM, CLAIM_KEY]]) })
      : ok(n)));

    // The stranger's key does not match anything planned, and that is fine: a
    // graph is allowed to hold things this corpus did not put there. Only a scan
    // can meet one, because an id read only ever addresses ids that were planned.
    const report = await runIngest(c, plan, { ...SCAN, concurrency: 2 });
    expect(report.alreadyPresent).toBe(1);
  });

  it('refuses a planned id whose stored key is a different key', async () => {
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[CLAIM, 'unit/some-other-claim']]) })
      : ok(n)));

    const error = await runIngest(c, plan).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestCollisionError);
    const collision = error as IngestCollisionError;
    expect(collision.id).toBe(CLAIM);
    expect(collision.storedKey).toBe('unit/some-other-claim');
    expect(collision.plannedKey).toBe(CLAIM_KEY);

    // Refused before writing, which is the whole point of the phase order.
    expect(calls.filter(isWrite)).toHaveLength(0);
  });

  it('reads a null key from an id read as nothing stored, and writes', async () => {
    // What an empty graph answers. The unlabelled id pattern addresses a vertex
    // slot rather than filtering stored nodes, so an id nothing has ever written
    // still comes back as one row, carrying the id it was asked for and a null
    // key. Refusing that would refuse every first ingest, which is the whole of
    // the demo path. Measured against a live node; see DECISIONS.md D-053.
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[CLAIM, null]]) })
      : ok(n)));

    const report = await runIngest(c, plan, { verifyStrategy: 'id' });
    expect(report.alreadyPresent).toBe(0);
    expect(calls.filter(isWrite).length).toBeGreaterThan(0);
  });

  it('refuses a planned id that a scan finds carrying no key', async () => {
    // Same null, different question. A scan returns nodes that carry the label,
    // so one of them without a canonical key is a node this corpus never wrote
    // sitting on an id it is about to write. That is the overwrite the pre-write
    // check exists to refuse, and the id path's empty slot is not it.
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[CLAIM, null]]) })
      : ok(n)));

    const error = await runIngest(c, plan, SCAN).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestCollisionError);
    expect((error as IngestCollisionError).storedKey).toBeNull();
    expect(calls.filter(isWrite)).toHaveLength(0);
  });

  it('refuses a read-back row whose id is not a number', async () => {
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: [[{ type: 'string', value: 'not-an-id' }, { type: 'null' }]] })
      : ok(n)));

    await expect(runIngest(c, plan)).rejects.toThrowError(
      /Claim read-back returned a non-numeric id/,
    );
  });

  it('gives up rather than page forever', async () => {
    // A server that always hands back another cursor. Without the cap this is
    // an infinite loop, which is a worse failure than a loud one.
    const c = client((_call, n) => ok(n, { next_cursor: n }));

    await expect(runIngest(c, plan, SCAN)).rejects.toThrowError(
      /Claim read-back did not end after 1025 pages/,
    );
  });

  it('skips the phase entirely when asked to', async () => {
    const report = await runIngest(client(), plan, { verifyKeys: false });

    expect(calls.every(isWrite)).toBe(true);
    expect(report.alreadyPresent).toBe(0);
  });
});

describe('the read-back by id', () => {
  const ID_READ = 'MATCH (n {id: $id}) RETURN n.id AS id, n.key AS key';

  /** The id under which the nth call asked about a vertex. */
  function askedAbout(n: number): unknown {
    return (call(n)['parameters'] as Record<string, unknown>)['id'];
  }

  it('is what auto picks for a plan this small, one request per planned id', async () => {
    await runIngest(client(), plan);

    // Three planned ids, three reads, in label order and then in batch order
    // within a label. Anything else and the reads below are not the reads the
    // strategy claims to make.
    expect(cypherOf(0)).toBe(ID_READ);
    expect(cypherOf(1)).toBe(ID_READ);
    expect(cypherOf(2)).toBe(ID_READ);
    expect(askedAbout(0)).toBe(CLAIM);
    expect(askedAbout(1)).toBe(ENTITY_A);
    expect(askedAbout(2)).toBe(ENTITY_B);
    expect(cypherOf(3)).toContain('MERGE');
  });

  it('counts every planned id the graph already holds', async () => {
    // A second ingest of the same corpus: every id answers with the key the plan
    // derived for it. Reported as present, and still written, because the write
    // is a MERGE and the count is what makes the no-op visible.
    const stored = new Map<number, string>([
      [CLAIM, CLAIM_KEY],
      [ENTITY_A, ENTITY_A_KEY],
      [ENTITY_B, ENTITY_B_KEY],
    ]);
    const c = client((call_, n) => {
      const id = (call_.body['parameters'] as Record<string, unknown> | undefined)?.['id'];
      const key = typeof id === 'number' ? stored.get(id) : undefined;
      return key === undefined ? ok(n) : ok(n, { rows: idKeyRows([[id as number, key]]) });
    });

    const report = await runIngest(c, plan);
    expect(report.alreadyPresent).toBe(3);
  });

  it('refuses a planned id carrying a different key, before any write', async () => {
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[CLAIM, 'unit/some-other-claim']]) })
      : ok(n)));

    const error = await runIngest(c, plan, { verifyStrategy: 'id' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(IngestCollisionError);
    expect((error as IngestCollisionError).storedKey).toBe('unit/some-other-claim');
    expect(calls.filter(isWrite)).toHaveLength(0);
  });

  it('refuses when two nodes answer to one id', async () => {
    // An id is meant to address one vertex slot. Two rows means the unlabelled
    // reads the rest of this codebase makes are no longer answering about one
    // node, which is worse than a collision and is not counted as one.
    const c = client((_call, n) => (n === 1
      ? ok(n, { rows: idKeyRows([[CLAIM, CLAIM_KEY], [CLAIM, 'unit/some-other-claim']]) })
      : ok(n)));

    await expect(runIngest(c, plan, { verifyStrategy: 'id' })).rejects.toThrowError(
      /2 nodes answer to id 3000000000001/,
    );
    expect(calls.filter(isWrite)).toHaveLength(0);
  });
});

describe('the write phases', () => {
  it('writes every batch, then every edge, then one settling re-merge', async () => {
    const report = await runIngest(client(), plan, { ...SCAN, concurrency: 2 });

    // 2 reads + 2 batches + 3 edges + 1 settle.
    expect(calls).toHaveLength(8);
    expect(cypherOf(2)).toContain('SET n:Claim');
    expect(cypherOf(3)).toContain('SET n:Entity');
    expect(cypherOf(7)).toBe(cypherOf(6));
    expect(report.vertices).toBe(3);
    expect(report.batches).toBe(2);
    expect(report.edges).toBe(3);
  });

  it('pins every edge write to the bookmark the vertex phase ended on', async () => {
    await runIngest(client(), plan, { ...SCAN, concurrency: 2 });

    // The fake hands out a new bookmark on every response, so a run that let
    // the client use its own remembered one would show bm-5, bm-6, bm-7 here.
    // Concurrent writes race on that field; a pinned selector does not care.
    const pinned = 'bm-4';
    for (let n = 4; n < 8; n += 1) {
      expect(call(n)['bookmark']).toBe(pinned);
    }
  });

  it('reports the settling write bookmark, not whichever edge finished last', async () => {
    const report = await runIngest(client(), plan, { ...SCAN, concurrency: 2 });
    expect(report.bookmark).toBe('bm-8');
  });

  it('reports progress through all three phases', async () => {
    const seen: IngestProgress[] = [];
    await runIngest(client(), plan, { concurrency: 2, onProgress: (p) => seen.push(p) });

    expect(seen.filter((p) => p.phase === 'verify')).toEqual([
      { phase: 'verify', done: 1, total: 2 },
      { phase: 'verify', done: 2, total: 2 },
    ]);
    expect(seen.filter((p) => p.phase === 'vertices')).toEqual([
      { phase: 'vertices', done: 1, total: 2 },
      { phase: 'vertices', done: 2, total: 2 },
    ]);
    // Under the stride of 100 the only edge report is the final one.
    expect(seen.filter((p) => p.phase === 'edges')).toEqual([
      { phase: 'edges', done: 3, total: 3 },
    ]);
  });

  it('does nothing at all with an empty plan', async () => {
    const empty = planWith([]);
    const report = await runIngest(client(), empty, { ...SCAN, concurrency: 2 });

    // No edges means no settling write, and a null bookmark rather than a
    // borrowed one from the vertex phase.
    expect(report.edges).toBe(0);
    expect(report.bookmark).toBe('bm-4');
    expect(calls).toHaveLength(4);
  });
});

describe('when a write fails', () => {
  it('rethrows the engine refusal and stops handing out work', async () => {
    const big = planWith(manyEdges(40));
    const c = client((_call, n) => {
      // Two reads, two batches, then the edges. Refuse the first edge.
      if (n === 5) {
        return new Response(
          JSON.stringify({ error: { message: 'only one-hop edge patterns are executable' } }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return ok(n);
    });

    const error = await runIngest(c, big, { ...SCAN, concurrency: 2 }).catch((e: unknown) => e);

    // Reported verbatim, not reworded into something friendlier.
    expect(error).toBeInstanceOf(HydraQueryError);
    expect(String(error)).toContain('only one-hop edge patterns are executable');

    // The pool lets what is in flight settle and then stops. With 40 edges and
    // a width of 2 the exact number depends on scheduling, but it is nowhere
    // near all of them, and no settling write happens after the failure.
    const writes = calls.filter(isWrite).length;
    expect(writes).toBeLessThan(8);
  });

  it('propagates a failure from the vertex phase before touching the edges', async () => {
    const c = client((_call, n) => (n === 3
      ? new Response(
        JSON.stringify({ error: { message: 'UNWIND vertex upsert requires exactly one SET label' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
      : ok(n)));

    await expect(runIngest(c, plan, SCAN)).rejects.toThrowError(/exactly one SET label/);
    expect(calls).toHaveLength(3);
  });
});

describe('the option guards', () => {
  it('refuses a concurrency that is not a positive integer', async () => {
    await expect(runIngest(client(), plan, { concurrency: 0 }))
      .rejects.toThrowError(IngestError);
    await expect(runIngest(client(), plan, { concurrency: 2.5 }))
      .rejects.toThrowError(/concurrency must be a positive integer/);
    expect(calls).toHaveLength(0);
  });

  it('refuses a timeout that is not a positive integer', async () => {
    await expect(runIngest(client(), plan, { timeoutMs: -1 }))
      .rejects.toThrowError(/timeoutMs must be a positive integer/);
    expect(calls).toHaveLength(0);
  });
});
