import { describe, expect, it } from 'vitest';

import { RetrievalDecodeError } from '../../src/retrieval/errors.js';
import {
  decodeClaims,
  decodeDependents,
  decodeEntity,
  decodeEvidence,
  decodeMentions,
  type Row,
} from '../../src/retrieval/decode.js';

/**
 * The wire boundary, where a row either fits the declared shape or fails.
 *
 * Nothing here coerces or defaults. The reason is the product: a missing
 * `object_text` quietly becoming an empty string would travel to a screen and
 * sit under a citation looking like an answer, which is the one failure this
 * whole system exists to prevent.
 */

function claimRow(over: Partial<Row> = {}): Row {
  return {
    id: 1,
    predicate: 'launch_date',
    object_text: '25 July 2026',
    polarity: 'positive',
    valid_from: '2026-01-01T00:00:00.000Z',
    tx_time: '2026-01-01T00:00:00.000Z',
    superseded_by: null,
    ...over,
  };
}

describe('decodeEntity', () => {
  it('reads a present entity', () => {
    expect(decodeEntity([{ id: 42, kind: 'project' }])).toEqual({ id: 42, kind: 'project' });
  });

  it('returns null for no rows, which is what an unknown name looks like', () => {
    expect(decodeEntity([])).toBeNull();
  });

  it('tolerates a missing kind', () => {
    expect(decodeEntity([{ id: 42, kind: null }])).toEqual({ id: 42, kind: null });
  });

  it('refuses to pick a winner when a name matches twice', () => {
    expect(() => decodeEntity([{ id: 1, kind: null }, { id: 2, kind: null }]))
      .toThrow(RetrievalDecodeError);
  });

  it('rejects a row without a usable id', () => {
    expect(() => decodeEntity([{ id: null, kind: 'project' }])).toThrow(RetrievalDecodeError);
    expect(() => decodeEntity([{ id: '42', kind: 'project' }])).toThrow(RetrievalDecodeError);
  });
});

describe('decodeClaims', () => {
  it('reads a claim with no superseder as current', () => {
    const [only] = decodeClaims([claimRow()]);

    expect(only?.supersededBy).toEqual([]);
    expect(only?.objectText).toBe('25 July 2026');
  });

  it('collapses the rows of one claim into one record', () => {
    // Two superseders arrive as two rows agreeing on everything else. Counting
    // rows as claims would report a contradiction that does not exist.
    const claims = decodeClaims([
      claimRow({ superseded_by: 7 }),
      claimRow({ superseded_by: 9 }),
    ]);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.supersededBy).toEqual([7, 9]);
  });

  it('does not repeat a superseder that arrives twice', () => {
    const claims = decodeClaims([claimRow({ superseded_by: 7 }), claimRow({ superseded_by: 7 })]);

    expect(claims[0]?.supersededBy).toEqual([7]);
  });

  it('throws when the same id arrives with different properties', () => {
    expect(() => decodeClaims([claimRow(), claimRow({ object_text: 'something else' })]))
      .toThrow(/two different sets of properties/);
  });

  it('sorts oldest first, breaking ties on id', () => {
    const claims = decodeClaims([
      claimRow({ id: 3, valid_from: '2026-03-01T00:00:00.000Z' }),
      claimRow({ id: 2, valid_from: '2026-01-01T00:00:00.000Z' }),
      claimRow({ id: 1, valid_from: '2026-01-01T00:00:00.000Z' }),
    ]);

    expect(claims.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('accepts an empty object_text, because that is what a retraction stores', () => {
    const [withdrawal] = decodeClaims([claimRow({ object_text: '', polarity: 'negative' })]);

    expect(withdrawal?.objectText).toBe('');
    expect(withdrawal?.polarity).toBe('negative');
  });

  it('rejects a missing object_text rather than defaulting it', () => {
    expect(() => decodeClaims([claimRow({ object_text: null })])).toThrow(RetrievalDecodeError);
  });

  it('rejects a polarity outside the two it knows', () => {
    expect(() => decodeClaims([claimRow({ polarity: 'maybe' })])).toThrow(/positive/);
  });

  it('rejects a non-numeric superseded_by', () => {
    expect(() => decodeClaims([claimRow({ superseded_by: 'yes' })])).toThrow(RetrievalDecodeError);
  });
});

describe('decodeMentions', () => {
  it('reads the target entity off the row', () => {
    const mentions = decodeMentions([
      { claim: 1, predicate: 'vendor', other: 200, other_name: 'Northfold' },
    ]);

    expect(mentions).toEqual([
      { claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northfold' },
    ]);
  });

  it('rejects a mention with no name to show', () => {
    expect(() => decodeMentions([{ claim: 1, predicate: 'vendor', other: 200, other_name: null }]))
      .toThrow(RetrievalDecodeError);
  });
});

describe('decodeDependents', () => {
  function dependentRow(over: Partial<Row> = {}): Row {
    return {
      claim: 1,
      predicate: 'depends_on',
      polarity: 'positive',
      dependent: 200,
      dependent_name: 'checkout',
      dependent_kind: 'service',
      superseded_by: null,
      ...over,
    };
  }

  it('reads the entity that depends on ours, not the one asked about', () => {
    // The direction is the whole point. This query walks inbound: the row names
    // the depender, and a decoder that read it as the dependency would send the
    // blast walk off in the direction nothing is affected by.
    expect(decodeDependents([dependentRow()])).toEqual([
      {
        claimId: 1,
        predicate: 'depends_on',
        polarity: 'positive',
        entityId: 200,
        entityName: 'checkout',
        entityKind: 'service',
        supersededBy: [],
      },
    ]);
  });

  it('collapses the rows of one claim into one edge', () => {
    // Same reason as decodeClaims: a claim with two superseders arrives twice,
    // and counting rows as edges would walk one dependency twice.
    const edges = decodeDependents([
      dependentRow({ superseded_by: 7 }),
      dependentRow({ superseded_by: 9 }),
    ]);

    expect(edges).toHaveLength(1);
    expect(edges[0]?.supersededBy).toEqual([7, 9]);
  });

  it('sorts by claim id, so the walk that consumes this is deterministic', () => {
    const edges = decodeDependents([
      dependentRow({ claim: 5, dependent: 500, dependent_name: 'admin' }),
      dependentRow({ claim: 2, dependent: 200, dependent_name: 'checkout' }),
      dependentRow({ claim: 3, dependent: 300, dependent_name: 'api' }),
    ]);

    expect(edges.map((edge) => edge.claimId)).toEqual([2, 3, 5]);
  });

  it('keeps a withdrawal, and lets the walk decide what to do with it', () => {
    // Filtering here would hide the count the trace reports. A retracted
    // dependency is a fact about the graph, not a row to drop on the floor.
    const [edge] = decodeDependents([dependentRow({ polarity: 'negative' })]);

    expect(edge?.polarity).toBe('negative');
  });

  it('tolerates a dependent with no kind', () => {
    const [edge] = decodeDependents([dependentRow({ dependent_kind: null })]);

    expect(edge?.entityKind).toBeNull();
  });

  it('throws when one claim id names two different dependents', () => {
    expect(() => decodeDependents([dependentRow(), dependentRow({ dependent: 999 })]))
      .toThrow(/two different dependents/);
  });

  it('rejects a dependent with no name to walk to', () => {
    expect(() => decodeDependents([dependentRow({ dependent_name: null })]))
      .toThrow(RetrievalDecodeError);
  });
});

describe('decodeEvidence', () => {
  function evidenceRow(over: Partial<Row> = {}): Row {
    return {
      span: 1,
      quote: 'Meridian launches on 25 July 2026.',
      start: 0,
      end_offset: 34,
      message: 10,
      role: 'user',
      ts: '2026-01-01T09:00:00.000Z',
      session: 100,
      title: 'Planning',
      ...over,
    };
  }

  it('carries the claim id it was fetched for', () => {
    const [span] = decodeEvidence(77, [evidenceRow()]);

    expect(span?.claimId).toBe(77);
    expect(span?.end).toBe(34);
  });

  it('orders by conversation position, not by the order rows arrived', () => {
    const spans = decodeEvidence(1, [
      evidenceRow({ span: 3, ts: '2026-03-01T00:00:00.000Z' }),
      evidenceRow({ span: 1, ts: '2026-01-01T00:00:00.000Z' }),
      evidenceRow({ span: 2, ts: '2026-01-01T00:00:00.000Z', message: 11 }),
    ]);

    expect(spans.map((s) => s.spanId)).toEqual([1, 2, 3]);
  });

  it('rejects a span with no quote to render', () => {
    expect(() => decodeEvidence(1, [evidenceRow({ quote: null })])).toThrow(RetrievalDecodeError);
  });
});
