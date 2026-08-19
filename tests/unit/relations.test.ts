import { describe, expect, it } from 'vitest';

import { normaliseRelations } from '../../src/hydra/relations.js';

/**
 * Reading a third party shape, defensively.
 *
 * These fields belong to HydraDB and are theirs to change, and this is the only
 * place in the product that reads them. The screen renders whatever comes back
 * here, so a missing field has to become a null the screen can decide about
 * rather than the string "undefined" in front of a reader.
 */

const REAL = [
  {
    source: { name: 'Vaibhav', type: 'PERSON', namespace: 'users' },
    target: { name: 'junco', type: 'PROJECT', namespace: 'projects' },
    relations: [
      {
        canonical_predicate: 'reviewed',
        raw_predicate: 'reviewed',
        context: 'The user read back through the older notes on Junco.',
        confidence: 0.8,
      },
    ],
  },
];

describe('the relations HydraDB returns', () => {
  it('flattens one source and target pair into a row per predicate', () => {
    const rows = normaliseRelations([
      {
        source: { name: 'a', type: 'PERSON' },
        target: { name: 'b', type: 'PROJECT' },
        relations: [
          { canonical_predicate: 'owns', confidence: 0.9 },
          { canonical_predicate: 'reviewed', confidence: 0.5 },
        ],
      },
    ]);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.predicate)).toEqual(['owns', 'reviewed']);
    expect(rows.every((row) => row.source === 'a' && row.target === 'b')).toBe(true);
  });

  it('reads the shape the service actually returned', () => {
    const [row] = normaliseRelations(REAL);
    expect(row).toEqual({
      source: 'Vaibhav',
      sourceType: 'PERSON',
      target: 'junco',
      targetType: 'PROJECT',
      predicate: 'reviewed',
      confidence: 0.8,
      context: 'The user read back through the older notes on Junco.',
    });
  });

  it('falls back through the predicate names the service uses', () => {
    const [canonical] = normaliseRelations([
      { source: { name: 'a' }, target: { name: 'b' }, relations: [{ raw_predicate: 'ships' }] },
    ]);
    expect(canonical?.predicate).toBe('ships');
  });

  it('drops a row that names neither end, rather than drawing two dashes', () => {
    expect(normaliseRelations([{ relations: [{ canonical_predicate: 'owns' }] }])).toEqual([]);
    expect(normaliseRelations([{ source: {}, target: {} }])).toEqual([]);
  });

  it('turns anything missing or wrongly typed into null', () => {
    const [row] = normaliseRelations([
      { source: { name: 'a' }, target: { name: 'b' }, relations: [{ confidence: 'high' }] },
    ]);
    expect(row?.predicate).toBeNull();
    expect(row?.confidence).toBeNull();
    expect(row?.context).toBeNull();
    expect(row?.sourceType).toBeNull();
  });

  it('survives junk without throwing, because this is somebody else\'s response', () => {
    expect(normaliseRelations([])).toEqual([]);
    expect(normaliseRelations([null, 42, 'text', []])).toEqual([]);
  });

  it('keeps a pair that has no nested relations as one row', () => {
    const rows = normaliseRelations([
      { source: { name: 'a' }, target: { name: 'b' }, predicate: 'touches' },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.predicate).toBe('touches');
  });
});
