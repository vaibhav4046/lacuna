import { describe, expect, it } from 'vitest';

import { HydraGuardError } from '../../src/hydra/errors.js';
import {
  claimsAbout,
  contradictionPartners,
  entityByName,
  evidenceForClaim,
  MAX_SUPERSESSION_DEPTH,
  mentionsFrom,
  supersededByClaim,
} from '../../src/retrieval/queries.js';

/**
 * The read shapes, checked for the properties a test can check without a node.
 *
 * These do not prove a query runs. That is what the contract suite is for, and
 * nothing here is a substitute for it. What these do prove is that every value
 * reaching the engine goes through a guard, that no caller-supplied string is
 * ever concatenated into Cypher, and that the walk stays bounded.
 */

const BUILDERS = [
  ['claimsAbout', claimsAbout],
  ['mentionsFrom', mentionsFrom],
  ['evidenceForClaim', evidenceForClaim],
  ['contradictionPartners', contradictionPartners],
  ['supersededByClaim', supersededByClaim],
] as const;

describe('id guards', () => {
  it.each(BUILDERS)('%s rejects values that are not vertex ids', (_name, build) => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
      expect(() => build(bad as number)).toThrow(HydraGuardError);
    }
  });

  it.each(BUILDERS)('%s passes the id as a parameter, never as text', (_name, build) => {
    const prepared = build(4242);

    expect(Object.values(prepared.parameters)).toContain(4242);
    expect(prepared.cypher).not.toContain('4242');
  });
});

describe('entityByName', () => {
  it('passes the name as a parameter', () => {
    const prepared = entityByName('Meridian');

    expect(prepared.parameters).toEqual({ name: 'Meridian' });
    expect(prepared.cypher).not.toContain('Meridian');
  });

  it('rejects an empty name', () => {
    expect(() => entityByName('')).toThrow(HydraGuardError);
  });

  it('rejects a name over the character cap', () => {
    expect(() => entityByName('x'.repeat(201))).toThrow(HydraGuardError);
  });

  it('does not let Cypher syntax in a name reach the query text', () => {
    // Not because the engine would run it, but because a builder that
    // interpolated would show up here rather than in production.
    const hostile = "Meridian'}) RETURN 1 //";
    const prepared = entityByName(hostile);

    expect(prepared.parameters).toEqual({ name: hostile });
    expect(prepared.cypher).not.toContain('RETURN 1');
  });

  it('scopes the match to the Entity label', () => {
    expect(entityByName('Meridian').cypher).toContain('(e:Entity');
  });
});

describe('claimsAbout', () => {
  it('asks for the superseding claim, not just the claim', () => {
    // Without this the resolver cannot tell a current value from a replaced one,
    // which collapses `revised` and `contradicted` into the same shape.
    const { cypher } = claimsAbout(1);

    expect(cypher).toContain('OPTIONAL MATCH');
    expect(cypher).toContain('SUPERSEDES');
    expect(cypher).toContain('superseded_by');
  });

  it('returns every column the decoder requires', () => {
    const { cypher } = claimsAbout(1);

    for (const column of ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time']) {
      expect(cypher).toContain(`AS ${column}`);
    }
  });
});

describe('evidenceForClaim', () => {
  it('walks session to message to span so a quote arrives with its provenance', () => {
    const { cypher } = evidenceForClaim(1);

    expect(cypher).toContain(':CONTAINS');
    expect(cypher).toContain(':HAS_SPAN');
    expect(cypher).toContain(':SUPPORTS');
  });

  it('aliases the span end, which is a reserved word bare', () => {
    expect(evidenceForClaim(1).cypher).toContain('AS end_offset');
  });
});

describe('supersededByClaim', () => {
  it('bounds the variable length walk', () => {
    // An unbounded walk on a graph that can hold a cycle does not terminate.
    // The bound is the reason this query is safe to expose to a request path.
    expect(supersededByClaim(1).cypher).toContain(`*1..${MAX_SUPERSESSION_DEPTH}`);
    expect(supersededByClaim(1).cypher).not.toMatch(/SUPERSEDES\*\]/);
  });

  it('keeps the depth small enough to be a bound rather than a formality', () => {
    expect(MAX_SUPERSESSION_DEPTH).toBeLessThanOrEqual(8);
  });
});
