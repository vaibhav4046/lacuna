import { describe, expect, it } from 'vitest';

import { normaliseGraphContext, normaliseRelations } from '../../src/hydra/relations.js';

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
      id: null,
      source: 'Vaibhav',
      sourceType: 'PERSON',
      target: 'junco',
      targetType: 'PROJECT',
      predicate: 'reviewed',
      confidence: 0.8,
      context: 'The user read back through the older notes on Junco.',
    });
  });

  it('keeps the id the service gave the edge', () => {
    const [row] = normaliseRelations([
      {
        source: { name: 'mobile team' },
        target: { name: 'meridian' },
        relations: [{ canonical_predicate: 'asked about', relationship_id: '4c4b9c73' }],
      },
    ]);
    expect(row?.id).toBe('4c4b9c73');
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

/**
 * The graph context a query comes back with.
 *
 * Trimmed from a real answer to "What does tenant-router depend on?" against
 * the deployed database, keeping the shape and the two rows that matter: the
 * correction, and the edge the correction replaced. The store returns both and
 * marks neither, which is the fact the HydraDB screen exists to show, so it is
 * pinned here rather than described.
 */
const WALK = {
  query_paths: [
    {
      relevancy_score: 0.34,
      triplets: [
        {
          source: { name: 'tenant-router', type: 'PRODUCT', entity_id: 'e1' },
          relation: {
            canonical_predicate: 'depends on',
            raw_predicate: 'depends on',
            context: 'The user corrected the notes for tenant-router, stating it now depends on hash-fence.',
            relationship_id: 'r-hash-fence',
            chunk_id: 'lacuna:session:2805988192216546_chunk_0001',
            temporal_details: null,
          },
          target: { name: 'hash-fence', type: 'PRODUCT', entity_id: 'e2' },
        },
      ],
    },
    {
      relevancy_score: 0.30,
      triplets: [
        {
          source: { name: 'tenant-router', type: 'PRODUCT', entity_id: 'e1' },
          relation: {
            canonical_predicate: 'depends on',
            raw_predicate: 'depends on',
            context: 'The user corrected the notes for tenant-router, stating it now depends on hash-fence.',
            relationship_id: 'r-hash-fence',
            chunk_id: 'lacuna:session:2805988192216546_chunk_0001',
            temporal_details: null,
          },
          target: { name: 'hash-fence', type: 'PRODUCT', entity_id: 'e2' },
        },
        {
          source: { name: 'tenant-router', type: 'PROJECT', entity_id: 'e1' },
          relation: {
            canonical_predicate: 'depends on',
            raw_predicate: 'depends on',
            context: 'tenant-router was on the list this week and it depends on moss-index.',
            relationship_id: 'r-moss-index',
            chunk_id: 'lacuna:session:1808120042183873_chunk_0004',
            temporal_details: null,
          },
          target: { name: 'moss-index', type: 'PROJECT', entity_id: 'e3' },
        },
      ],
    },
  ],
};

describe('the graph HydraDB walks for a question', () => {
  it('flattens the paths into rows and keeps the relation id', () => {
    const rows = normaliseGraphContext(WALK);
    expect(rows.map((row) => row.id)).toEqual(['r-hash-fence', 'r-moss-index']);
    expect(rows.map((row) => row.target)).toEqual(['hash-fence', 'moss-index']);
    expect(rows.every((row) => row.source === 'tenant-router')).toBe(true);
    expect(rows.every((row) => row.predicate === 'depends on')).toBe(true);
  });

  it('counts an edge reached by two paths once', () => {
    const rows = normaliseGraphContext(WALK);
    expect(rows.filter((row) => row.id === 'r-hash-fence')).toHaveLength(1);
  });

  it('returns the superseded edge beside the current one, unmarked', () => {
    const rows = normaliseGraphContext(WALK);
    // Neither carries anything separating them. That is the point: the store
    // reached both, and only the resolver above it knows one was replaced.
    expect(rows.every((row) => row.confidence === null)).toBe(true);
    expect(new Set(rows.map((row) => row.predicate)).size).toBe(1);
  });

  it('carries the sentence each edge was read out of', () => {
    const [current] = normaliseGraphContext(WALK);
    expect(current?.context).toContain('now depends on hash-fence');
  });

  it('answers nothing for a question the store found no paths for', () => {
    expect(normaliseGraphContext({ query_paths: [] })).toEqual([]);
  });

  it('survives a shape it was not handed, because this is somebody else\'s response', () => {
    expect(normaliseGraphContext(undefined)).toEqual([]);
    expect(normaliseGraphContext(null)).toEqual([]);
    expect(normaliseGraphContext({})).toEqual([]);
    expect(normaliseGraphContext({ query_paths: 'text' })).toEqual([]);
    expect(normaliseGraphContext({ query_paths: [null, 7, { triplets: 'text' }] })).toEqual([]);
  });

  it('drops a triplet naming neither end and keeps one naming a single end', () => {
    const rows = normaliseGraphContext({
      query_paths: [{
        triplets: [
          { relation: { canonical_predicate: 'owns', relationship_id: 'r-nameless' } },
          { source: { name: 'a' }, relation: { canonical_predicate: 'owns', relationship_id: 'r-half' } },
        ],
      }],
    });
    expect(rows.map((row) => row.id)).toEqual(['r-half']);
    expect(rows[0]?.target).toBeNull();
  });

  it('keeps two id-less edges rather than collapsing them into one', () => {
    const rows = normaliseGraphContext({
      query_paths: [{
        triplets: [
          { source: { name: 'a' }, relation: { canonical_predicate: 'owns' }, target: { name: 'b' } },
          { source: { name: 'a' }, relation: { canonical_predicate: 'ships' }, target: { name: 'c' } },
        ],
      }],
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.id === null)).toBe(true);
  });
});
