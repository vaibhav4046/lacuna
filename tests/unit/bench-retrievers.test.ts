import { describe, expect, it } from 'vitest';

import {
  hybridRetriever,
  lexicalRetriever,
  recencyRetriever,
  vectorRetriever,
} from '../../src/bench/retrievers.js';
import type { Ranking, Retriever } from '../../src/bench/types.js';
import type { GoldQuestion } from '../../src/corpus/types.js';
import { claim, corpusIndex, question, sequence } from '../support/bench-fixtures.js';

/**
 * The four baselines Lacuna is measured against.
 *
 * A comparison is only worth reading if the things being compared are the
 * things they are named after. These cases check that recency is recency, that
 * BM25 is asked about the question rather than the subject, that the vector
 * ranking is cosine order, and that the fusion is the published reciprocal rank
 * formula rather than a reordering that happens to suit the result.
 */

const vector = (...values: number[]): Float32Array => Float32Array.from(values);

/** A retriever with a fixed answer, which also records what it was asked for. */
function stub(name: string, ranking: Ranking): { retriever: Retriever; limits: number[] } {
  const limits: number[] = [];
  return {
    limits,
    retriever: {
      name,
      description: `stub ${name}`,
      rank(_question: GoldQuestion, limit: number): Ranking {
        limits.push(limit);
        return ranking;
      },
    },
  };
}

describe('recencyRetriever', () => {
  const index = corpusIndex(
    sequence([
      { text: 'Meridian kicked off in January.' },
      { text: 'Halcyon has its own timeline.' },
      { text: 'Meridian slipped a week.' },
      { text: 'Meridian is now mid August.' },
    ]),
  );

  it('returns the newest messages first', () => {
    expect(recencyRetriever(index).rank(question(), 10)).toEqual([3, 2, 0]);
  });

  it('keeps only the messages that name the subject', () => {
    expect(recencyRetriever(index).rank(question(), 10)).not.toContain(1);
  });

  it('stops at the limit, counting from the newest', () => {
    expect(recencyRetriever(index).rank(question(), 2)).toEqual([3, 2]);
  });

  it('returns nothing when no message names the subject', () => {
    expect(recencyRetriever(index).rank(question({ subject: 'Larkspur' }), 10)).toEqual([]);
  });

  it('matches on the message text and not on the annotations', () => {
    // Recency is the baseline that stands in for scrollback plus a search box,
    // and a search box reads what was written. Letting it match the annotated
    // subject would hand it a structured index that the baseline is defined by
    // not having.
    const annotatedOnly = corpusIndex(
      sequence([{ text: 'It slipped a week.', claims: [claim({ subject: 'Meridian' })] }]),
    );

    expect(recencyRetriever(annotatedOnly).rank(question(), 10)).toEqual([]);
  });

  it('returns nothing over an empty corpus', () => {
    expect(recencyRetriever(corpusIndex([])).rank(question(), 10)).toEqual([]);
  });
});

describe('lexicalRetriever', () => {
  const index = corpusIndex(
    sequence([
      { text: 'Meridian launch is scheduled.' },
      { text: 'Halcyon rollout notes.' },
      { text: 'Meridian notes.' },
    ]),
  );

  it('ranks by how much of the question a message covers', () => {
    // "When does Meridian launch?" shares two terms with the first message and
    // one with the third.
    expect(lexicalRetriever(index).rank(question(), 10)).toEqual([0, 2]);
  });

  it('reads the question text rather than the subject', () => {
    // Ranking on the subject alone would make this baseline a slower recency
    // filter. The distinction shows up here: on the subject these two messages
    // are indistinguishable, and on the question they are not.
    const onSubject = lexicalRetriever(index).rank(
      question({ text: 'Meridian', subject: 'Meridian' }),
      10,
    );

    expect(onSubject).toEqual([2, 0]);
  });

  it('stops at the limit', () => {
    expect(lexicalRetriever(index).rank(question(), 1)).toEqual([0]);
  });

  it('returns nothing when no term matches', () => {
    expect(lexicalRetriever(index).rank(question({ text: 'quarterly budget?' }), 10)).toEqual([]);
  });
});

describe('vectorRetriever', () => {
  const index = corpusIndex(sequence([{ text: 'a' }, { text: 'b' }, { text: 'c' }]));
  const messageVectors = [vector(1, 0), vector(0, 1), vector(0.6, 0.8)];

  it('ranks by cosine similarity to the query', () => {
    const queries = new Map([['When does Meridian launch?', vector(1, 0)]]);

    expect(
      vectorRetriever(index, messageVectors, queries, 'test-model').rank(question(), 3),
    ).toEqual([0, 2, 1]);
  });

  it('breaks a tie on the ordinal', () => {
    const queries = new Map([['When does Meridian launch?', vector(1, 0)]]);
    const identical = [vector(1, 0), vector(1, 0)];
    const twoMessages = corpusIndex(sequence([{ text: 'a' }, { text: 'b' }]));

    expect(
      vectorRetriever(twoMessages, identical, queries, 'test-model').rank(question(), 2),
    ).toEqual([0, 1]);
  });

  it('stops at the limit', () => {
    const queries = new Map([['When does Meridian launch?', vector(1, 0)]]);

    expect(
      vectorRetriever(index, messageVectors, queries, 'test-model').rank(question(), 1),
    ).toEqual([0]);
  });

  it('is keyed by the query text, so a second round query gets its own vector', () => {
    // A follow up carries the id of the question that spawned it and asks
    // something else. Keyed by id, round two would be ranked by round one's
    // meaning and the harness would never notice.
    const queries = new Map([
      ['When does Meridian launch?', vector(1, 0)],
      ['launch_date Northbeam', vector(0, 1)],
    ]);
    const retriever = vectorRetriever(index, messageVectors, queries, 'test-model');

    expect(retriever.rank(question({ text: 'launch_date Northbeam' }), 1)).toEqual([1]);
  });

  it('throws on a query it has no vector for rather than ranking on nothing', () => {
    const retriever = vectorRetriever(index, messageVectors, new Map(), 'test-model');

    expect(() => retriever.rank(question(), 3)).toThrow('no query embedding for text');
  });

  it('names the model it used, since the description goes in the report', () => {
    expect(vectorRetriever(index, messageVectors, new Map(), 'test-model').description).toContain(
      'test-model',
    );
  });
});

describe('hybridRetriever', () => {
  it('fuses by reciprocal rank, so agreement outranks either list alone', () => {
    // Ordinal 3 is third in one list and first in the other. Neither list puts
    // it on top, and the fusion does, which is the whole reason for fusing.
    const lexical = stub('lexical', [1, 2, 3]);
    const vec = stub('vector', [3, 4, 5]);

    expect(hybridRetriever(lexical.retriever, vec.retriever, 10).rank(question(), 10)).toEqual([
      3, 1, 2, 4, 5,
    ]);
  });

  it('breaks a fusion tie on the ordinal', () => {
    // 2 and 4 both appear once, at the same rank, in different lists.
    const lexical = stub('lexical', [1, 2, 3]);
    const vec = stub('vector', [3, 4, 5]);
    const fused = hybridRetriever(lexical.retriever, vec.retriever, 10).rank(question(), 10);

    expect(fused.indexOf(2)).toBeLessThan(fused.indexOf(4));
  });

  it('asks both inputs for the fusion depth, not for the output limit', () => {
    // Fusing two already truncated lists throws away the agreement that makes
    // fusion worth doing, so the depth is deliberately deeper than the k the
    // caller wants back.
    const lexical = stub('lexical', [1, 2, 3]);
    const vec = stub('vector', [3, 4, 5]);

    hybridRetriever(lexical.retriever, vec.retriever, 50).rank(question(), 5);

    expect(lexical.limits).toEqual([50]);
    expect(vec.limits).toEqual([50]);
  });

  it('returns at most the limit it was asked for', () => {
    const lexical = stub('lexical', [1, 2, 3]);
    const vec = stub('vector', [3, 4, 5]);

    expect(hybridRetriever(lexical.retriever, vec.retriever, 10).rank(question(), 2)).toEqual([
      3, 1,
    ]);
  });

  it('falls back to one list when the other finds nothing', () => {
    const lexical = stub('lexical', []);
    const vec = stub('vector', [7, 8]);

    expect(hybridRetriever(lexical.retriever, vec.retriever, 10).rank(question(), 10)).toEqual([
      7, 8,
    ]);
  });

  it('records its depth and constant in the description', () => {
    const lexical = stub('lexical', []);
    const vec = stub('vector', []);
    const { description } = hybridRetriever(lexical.retriever, vec.retriever, 50);

    expect(description).toContain('depth 50');
    expect(description).toContain('k=60');
  });
});
