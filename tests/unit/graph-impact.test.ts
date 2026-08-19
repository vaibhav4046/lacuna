import { describe, expect, it } from 'vitest';

import { graphImpact } from '../../src/api/impact.js';
import type { ServiceRelation } from '../../src/hydra/relations.js';
import type { Inventory } from '../../src/report/inventory.js';

/**
 * The one result HydraDB's graph decides and this project's policy filters.
 *
 * The edges are entirely the store's: it extracted them from the transcripts
 * and traverses them server side. What is tested here is the half the store
 * cannot do, because it has no idea which of its own edges the conversation
 * later replaced, disputed, or never asserted in the first place.
 *
 * The rejection worth reading twice is `unstated`. A general extractor reads a
 * typed relation out of "the discussion was deferred", because that is a
 * well-formed sentence. Walking it would answer a question about what depends
 * on a service with a thing that did not happen.
 */

function relation(over: Partial<ServiceRelation>): ServiceRelation {
  return {
    id: null,
    source: 'tenant-router',
    sourceType: null,
    target: 'token-forge',
    targetType: null,
    predicate: 'depends on',
    confidence: null,
    context: null,
    ...over,
  } as ServiceRelation;
}

function inventory(claims: readonly { subject: string; objectText: string; state: string }[]): Inventory {
  return { seed: 'test', claims, states: [], structural: {}, totals: {} } as unknown as Inventory;
}

const NOW = () => 1_000;

describe('what the policy lets a walk cross', () => {
  const held = inventory([
    { subject: 'tenant-router', objectText: 'token-forge', state: 'current' },
    { subject: 'tenant-router', objectText: 'moss-index', state: 'historical' },
    { subject: 'tenant-router', objectText: 'quota-broker', state: 'contradicted' },
  ]);

  const seed: readonly ServiceRelation[] = [
    relation({ target: 'token-forge' }),
    relation({ target: 'moss-index', context: 'The tenant-router project depends on moss-index.' }),
    relation({ target: 'quota-broker' }),
    relation({ target: 'trust team', predicate: 'queried by', context: 'nothing to report' }),
    relation({ target: 'discussion', predicate: 'deferred', context: 'the discussion was deferred' }),
  ];

  const result = graphImpact(held, 'tenant-router', seed, [], 0, NOW);

  it('crosses the edge the claim graph still holds', () => {
    expect(result.accepted.map((edge) => edge.target)).toEqual(['token-forge']);
    expect(result.affected).toEqual(['token-forge']);
  });

  it('refuses the edge a later claim replaced', () => {
    const moss = result.rejected.find((edge) => edge.target === 'moss-index');
    expect(moss?.reason).toBe('historical');
  });

  it('refuses the edge two live claims disagree about', () => {
    expect(result.rejected.find((edge) => edge.target === 'quota-broker')?.reason).toBe('contradicted');
  });

  it('refuses the relations that are not about one thing resting on another', () => {
    // "queried by" and "deferred" are real relations the store read out of real
    // sentences. They are not paths, and a blast radius over them is a list of
    // things that did not happen.
    for (const target of ['trust team', 'discussion']) {
      expect(result.rejected.find((edge) => edge.target === target)?.reason).toBe('not_structural');
    }
  });

  it('keeps the store’s own sentence on every rejection, so each one is checkable', () => {
    const moss = result.rejected.find((edge) => edge.target === 'moss-index');
    expect(moss?.context).toBe('The tenant-router project depends on moss-index.');
  });

  it('accounts for every edge the store returned', () => {
    expect(result.reached).toBe(seed.length);
    expect(result.accepted.length + result.rejected.length + result.duplicates).toBe(result.reached);
  });
});

describe('a graph with nothing current in it', () => {
  it('affects nothing rather than falling back to the raw edges', () => {
    const held = inventory([{ subject: 'a', objectText: 'b', state: 'historical' }]);
    const result = graphImpact(held, 'a', [relation({ source: 'a', target: 'b' })], [], 0, NOW);
    expect(result.accepted).toEqual([]);
    expect(result.affected).toEqual([]);
    expect(result.depth).toBe(0);
  });
});

describe('walking outward', () => {
  it('follows a second hop over the store’s wider relation set', () => {
    const held = inventory([
      { subject: 'a', objectText: 'b', state: 'current' },
      { subject: 'b', objectText: 'c', state: 'current' },
    ]);
    const result = graphImpact(
      held,
      'a',
      [relation({ source: 'a', target: 'b' })],
      [relation({ source: 'b', target: 'c' })],
      0,
      NOW,
    );
    expect(result.affected).toEqual(['b', 'c']);
    expect(result.depth).toBe(2);
    expect(result.accepted.find((edge) => edge.target === 'c')?.depth).toBe(2);
  });

  it('does not cross a replaced edge on the second hop either', () => {
    const held = inventory([
      { subject: 'a', objectText: 'b', state: 'current' },
      { subject: 'b', objectText: 'c', state: 'historical' },
    ]);
    const result = graphImpact(
      held,
      'a',
      [relation({ source: 'a', target: 'b' })],
      [relation({ source: 'b', target: 'c' })],
      0,
      NOW,
    );
    expect(result.affected).toEqual(['b']);
  });
});

describe('the same pair stated twice', () => {
  it('is one edge and one counted duplicate', () => {
    const held = inventory([{ subject: 'a', objectText: 'b', state: 'current' }]);
    const result = graphImpact(
      held,
      'a',
      [relation({ source: 'a', target: 'b' }), relation({ source: 'a', target: 'b' })],
      [],
      0,
      NOW,
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.duplicates).toBe(1);
    expect(result.accepted.length + result.rejected.length + result.duplicates).toBe(result.reached);
  });
});
