import { describe, expect, it } from 'vitest';

import { Bm25 } from '../../src/bench/bm25.js';
import { message, sequence } from '../support/bench-fixtures.js';

/**
 * The lexical baseline, checked against the properties BM25 is supposed to have.
 *
 * The point of writing BM25 out by hand was that a judge could check it is a
 * real BM25 rather than a bag of words with a flattering constant in it. These
 * cases are that check, mechanised: term frequency raises a score but with
 * diminishing returns, a longer document is penalised for the same number of
 * hits, and a rare term is worth more than a common one. Each is asserted as a
 * relation between scores rather than against a hard coded number, so the test
 * says what the formula must do instead of restating what it currently
 * computes.
 */

function scoreOf(results: readonly { ordinal: number; score: number }[], ordinal: number): number {
  const hit = results.find((result) => result.ordinal === ordinal);
  if (hit === undefined) {
    throw new Error(`no score for ordinal ${ordinal}`);
  }
  return hit.score;
}

describe('Bm25', () => {
  it('scores only the documents that share a term with the query', () => {
    const bm25 = new Bm25(
      sequence([{ tokens: ['alpha', 'beta'] }, { tokens: ['gamma', 'delta'] }]),
    );

    expect(bm25.score(['alpha']).map((hit) => hit.ordinal)).toEqual([0]);
  });

  it('returns nothing for a term the corpus has never seen', () => {
    const bm25 = new Bm25(sequence([{ tokens: ['alpha'] }]));

    expect(bm25.score(['nonesuch'])).toEqual([]);
  });

  it('ignores an unknown term rather than letting it change the ranking', () => {
    const bm25 = new Bm25(sequence([{ tokens: ['alpha', 'beta'] }, { tokens: ['alpha'] }]));

    expect(bm25.score(['alpha', 'nonesuch'])).toEqual(bm25.score(['alpha']));
  });

  it('ranks more occurrences of a term above fewer, at equal length', () => {
    const bm25 = new Bm25(
      sequence([
        { tokens: ['alpha', 'beta', 'gamma'] },
        { tokens: ['alpha', 'alpha', 'gamma'] },
      ]),
    );

    expect(bm25.score(['alpha']).map((hit) => hit.ordinal)).toEqual([1, 0]);
  });

  it('saturates: three hits are worth more than one and less than three times one', () => {
    // Same length in every document, so k1 saturation is the only thing that
    // separates them. A bag of words would score these 1, 2, 3.
    const bm25 = new Bm25(
      sequence([
        { tokens: ['alpha', 'beta', 'beta', 'beta'] },
        { tokens: ['alpha', 'alpha', 'beta', 'beta'] },
        { tokens: ['alpha', 'alpha', 'alpha', 'beta'] },
      ]),
    );
    const scores = bm25.score(['alpha']);
    const one = scoreOf(scores, 0);
    const two = scoreOf(scores, 1);
    const three = scoreOf(scores, 2);

    expect(two).toBeGreaterThan(one);
    expect(three).toBeGreaterThan(two);
    expect(two).toBeLessThan(one * 2);
    expect(three).toBeLessThan(one * 3);
  });

  it('penalises a longer document for the same single hit', () => {
    const bm25 = new Bm25(
      sequence([
        { tokens: ['alpha', 'beta'] },
        { tokens: ['alpha', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'] },
      ]),
    );

    expect(bm25.score(['alpha']).map((hit) => hit.ordinal)).toEqual([0, 1]);
  });

  it('is worth more to match a rare term than a common one', () => {
    const bm25 = new Bm25(
      sequence([
        { tokens: ['rare', 'common'] },
        { tokens: ['common', 'filler'] },
        { tokens: ['common', 'filler'] },
        { tokens: ['common', 'filler'] },
        { tokens: ['common', 'filler'] },
      ]),
    );

    // Same document, same frequency, same length. Only the idf differs.
    expect(scoreOf(bm25.score(['rare']), 0)).toBeGreaterThan(scoreOf(bm25.score(['common']), 0));
  });

  it('sums the contribution of every query term', () => {
    const bm25 = new Bm25(
      sequence([{ tokens: ['alpha', 'beta'] }, { tokens: ['alpha', 'gamma'] }]),
    );
    const both = bm25.score(['alpha', 'beta']);

    expect(scoreOf(both, 0)).toBeCloseTo(
      scoreOf(bm25.score(['alpha']), 0) + scoreOf(bm25.score(['beta']), 0),
      10,
    );
    expect(both.map((hit) => hit.ordinal)).toEqual([0, 1]);
  });

  it('breaks a tie on the ordinal, so the older message wins', () => {
    const bm25 = new Bm25(sequence([{ tokens: ['alpha'] }, { tokens: ['alpha'] }]));

    expect(bm25.score(['alpha']).map((hit) => hit.ordinal)).toEqual([0, 1]);
  });

  it('identifies documents by ordinal rather than by position in the array', () => {
    const bm25 = new Bm25([
      message({ ordinal: 7, tokens: ['alpha'] }),
      message({ ordinal: 3, tokens: ['alpha', 'alpha'] }),
    ]);

    expect(bm25.score(['alpha']).map((hit) => hit.ordinal)).toEqual([3, 7]);
  });

  it('returns results sorted best first', () => {
    const bm25 = new Bm25(
      sequence([
        { tokens: ['alpha', 'x', 'y', 'z'] },
        { tokens: ['alpha', 'alpha', 'alpha'] },
        { tokens: ['alpha', 'alpha'] },
      ]),
    );
    const scores = bm25.score(['alpha']).map((hit) => hit.score);

    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((score) => Number.isFinite(score) && score > 0)).toBe(true);
  });

  it('scores nothing over an empty corpus instead of dividing by zero', () => {
    const bm25 = new Bm25([]);

    expect(bm25.score(['alpha'])).toEqual([]);
  });

  it('scores nothing for an empty query', () => {
    const bm25 = new Bm25(sequence([{ tokens: ['alpha'] }]));

    expect(bm25.score([])).toEqual([]);
  });
});
