import { describe, expect, it } from 'vitest';

import { standingOfClaim } from '../../src/contract/result.js';
import type { ClaimRecord, Outcome } from '../../src/retrieval/types.js';

/**
 * What a piece of evidence is, relative to the question that reached it.
 *
 * This used to be derived from whether the request answered:
 *
 *   standing: standingOf(core.status === 'answered', false)
 *
 * which is a property of the request and not of the claim. It mislabels the
 * two cases this product is most specifically about. An unresolved
 * contradiction does not answer, so both of its sources were reported
 * `superseded`, which asserts that each of the two replaced the other. A
 * withdrawal does not answer either, so the live withdrawing claim was
 * reported as history.
 *
 * Standing is now read off the claim graph in the shared core, which is what
 * makes the web, the CLI and the MCP server agree without any of them knowing
 * about the others.
 */

function claim(over: Partial<ClaimRecord> & { id: number }): ClaimRecord {
  return {
    predicate: 'storage',
    objectText: 'Postgres',
    polarity: 'positive',
    validFrom: '2026-01-01T00:00:00.000Z',
    txTime: '2026-01-01T00:00:00.000Z',
    supersededBy: [],
    ...over,
  };
}

const ANSWER: Outcome = { type: 'answer', claimId: 1, text: 'Postgres' };
const CONTRADICTED: Outcome = { type: 'abstain', reason: 'contradicted' };
const RETRACTED: Outcome = { type: 'abstain', reason: 'retracted' };

describe('a claim that supports the answer', () => {
  it('is current', () => {
    const considered = [claim({ id: 1 })];
    expect(standingOfClaim(1, considered, ANSWER)).toBe('current');
  });
});

describe('a claim something replaced', () => {
  it('is superseded, whatever the request did', () => {
    const considered = [claim({ id: 1, objectText: 'Redis', supersededBy: [2] }), claim({ id: 2 })];
    expect(standingOfClaim(1, considered, ANSWER)).toBe('superseded');
    expect(standingOfClaim(2, considered, ANSWER)).toBe('current');
  });
});

describe('two live claims that disagree', () => {
  /**
   * The case the old code got backwards. Neither superseded the other, which
   * is exactly why the resolver refuses to pick, and reporting either as
   * history would be reporting a resolution that did not happen.
   */
  const considered = [
    claim({ id: 1, objectText: 'Redis' }),
    claim({ id: 2, objectText: 'Postgres' }),
  ];

  it('reports source A as live and conflicting', () => {
    expect(standingOfClaim(1, considered, CONTRADICTED)).toBe('current_conflicting');
  });

  it('reports source B as live and conflicting', () => {
    expect(standingOfClaim(2, considered, CONTRADICTED)).toBe('current_conflicting');
  });

  it('reports neither as superseded', () => {
    for (const id of [1, 2]) {
      expect(standingOfClaim(id, considered, CONTRADICTED)).not.toBe('superseded');
    }
  });
});

describe('a value taken back and not replaced', () => {
  const considered = [
    claim({ id: 1, objectText: 'Redis', supersededBy: [2] }),
    claim({ id: 2, objectText: 'Redis', polarity: 'negative' }),
  ];

  it('reports the withdrawal as live, because it is what stands', () => {
    expect(standingOfClaim(2, considered, RETRACTED)).toBe('withdrawal_current');
  });

  it('reports the value it withdrew as history', () => {
    expect(standingOfClaim(1, considered, RETRACTED)).toBe('superseded');
  });
});

describe('a claim the resolver never weighed', () => {
  it('is reported current rather than given a relationship nobody recorded', () => {
    // Nothing is known against it. Inventing `superseded` here would be
    // asserting a supersession edge that does not exist.
    expect(standingOfClaim(99, [claim({ id: 1 })], ANSWER)).toBe('current');
  });
});

describe('one claim quoted by several sources', () => {
  it('gives every one of them the same standing', () => {
    const considered = [claim({ id: 7, supersededBy: [8] }), claim({ id: 8 })];
    const first = standingOfClaim(7, considered, ANSWER);
    const second = standingOfClaim(7, considered, ANSWER);
    expect(first).toBe(second);
    expect(first).toBe('superseded');
  });
});
