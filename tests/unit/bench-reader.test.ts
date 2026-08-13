import { describe, expect, it } from 'vitest';

import { bridgeFrom, read } from '../../src/bench/reader';
import type { BenchOutcome } from '../../src/bench/types';
import { claim, question, sequence } from '../support/bench-fixtures';

/**
 * The answering step the baselines share, on retrieved sets built by hand.
 *
 * This reader is the steelman: it reads the corpus annotations rather than the
 * prose, so it never misreads a sentence. Everything it can still get wrong is
 * a consequence of what reached it, which is the whole point of the comparison.
 * The cases below cover both reader modes and all five abstention reasons,
 * including the ones the generated corpus does not happen to produce.
 */

const LATEST = 'latest' as const;
const CONFLICT = 'conflict_aware' as const;

function reasonOf(outcome: BenchOutcome): string {
  return outcome.type === 'abstain' ? outcome.reason : `answered ${outcome.text}`;
}

describe('read, direct questions', () => {
  it('answers with the value of the newest matching claim', () => {
    const retrieved = sequence([
      { claims: [claim({ objectText: '25 July 2026', validFrom: '2026-01-01T00:00:00.000Z' })] },
      { claims: [claim({ objectText: '8 August 2026', validFrom: '2026-02-01T00:00:00.000Z' })] },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST })).toEqual({
      type: 'answer',
      text: '8 August 2026',
    });
  });

  it('orders by the stated date, not by the order the retriever returned', () => {
    // A retriever ranks by relevance, so the newest claim can arrive first. A
    // reader that took the last element of the retrieved list would answer with
    // whatever happened to rank lowest.
    const retrieved = sequence([
      { claims: [claim({ objectText: '8 August 2026', validFrom: '2026-02-01T00:00:00.000Z' })] },
      { claims: [claim({ objectText: '25 July 2026', validFrom: '2026-01-01T00:00:00.000Z' })] },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST })).toEqual({
      type: 'answer',
      text: '8 August 2026',
    });
  });

  it('breaks a tie on the stated date with the message ordinal', () => {
    const stamp = '2026-01-01T00:00:00.000Z';
    const retrieved = sequence([
      { claims: [claim({ objectText: 'first', validFrom: stamp })] },
      { claims: [claim({ objectText: 'second', validFrom: stamp })] },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST })).toEqual({
      type: 'answer',
      text: 'second',
    });
  });

  it('ignores a claim about a different subject', () => {
    const retrieved = sequence([
      { text: 'Meridian and Halcyon both came up.', claims: [claim({ subject: 'Halcyon' })] },
    ]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('never_stated');
  });

  it('ignores a claim on a different predicate', () => {
    const retrieved = sequence([{ claims: [claim({ predicate: 'owner', objectText: 'Priya' })] }]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('never_stated');
  });

  it('reads several claims out of one message', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({ objectText: '25 July 2026', validFrom: '2026-01-01T00:00:00.000Z' }),
          claim({ objectText: '8 August 2026', validFrom: '2026-02-01T00:00:00.000Z' }),
        ],
      },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST })).toEqual({
      type: 'answer',
      text: '8 August 2026',
    });
  });
});

describe('read, retraction', () => {
  it('abstains retracted when the newest claim withdraws the value', () => {
    const retrieved = sequence([
      { claims: [claim({ objectText: '25 July 2026', validFrom: '2026-01-01T00:00:00.000Z' })] },
      {
        claims: [
          claim({ kind: 'retract', objectText: '', validFrom: '2026-02-01T00:00:00.000Z' }),
        ],
      },
    ]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('retracted');
    expect(reasonOf(read({ question: question(), retrieved, mode: CONFLICT }))).toBe('retracted');
  });

  it('answers when a later claim restates a value after a withdrawal', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({ kind: 'retract', objectText: '', validFrom: '2026-01-01T00:00:00.000Z' }),
        ],
      },
      { claims: [claim({ objectText: '8 August 2026', validFrom: '2026-02-01T00:00:00.000Z' })] },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST })).toEqual({
      type: 'answer',
      text: '8 August 2026',
    });
  });
});

describe('read, disagreement', () => {
  const disagreeing = () =>
    sequence([
      { claims: [claim({ objectText: 'eu-west-1', validFrom: '2026-01-01T00:00:00.000Z' })] },
      { claims: [claim({ objectText: 'us-east-1', validFrom: '2026-02-01T00:00:00.000Z' })] },
    ]);

  it('latest takes the newest of two assertions that disagree', () => {
    expect(read({ question: question(), retrieved: disagreeing(), mode: LATEST })).toEqual({
      type: 'answer',
      text: 'us-east-1',
    });
  });

  it('conflict_aware declines when nothing announced itself as a correction', () => {
    expect(reasonOf(read({ question: question(), retrieved: disagreeing(), mode: CONFLICT }))).toBe(
      'contradicted',
    );
  });

  it('conflict_aware answers when a revision is in view', () => {
    // An announced correction orders the pair, which is the one ordering a flat
    // reader can see without the supersession edges.
    const retrieved = sequence([
      { claims: [claim({ objectText: 'eu-west-1', validFrom: '2026-01-01T00:00:00.000Z' })] },
      {
        claims: [
          claim({ kind: 'revise', objectText: 'us-east-1', validFrom: '2026-02-01T00:00:00.000Z' }),
        ],
      },
    ]);

    expect(read({ question: question(), retrieved, mode: CONFLICT })).toEqual({
      type: 'answer',
      text: 'us-east-1',
    });
  });

  it('conflict_aware answers when two assertions agree', () => {
    const retrieved = sequence([
      { claims: [claim({ objectText: 'eu-west-1', validFrom: '2026-01-01T00:00:00.000Z' })] },
      { claims: [claim({ objectText: 'eu-west-1', validFrom: '2026-02-01T00:00:00.000Z' })] },
    ]);

    expect(read({ question: question(), retrieved, mode: CONFLICT })).toEqual({
      type: 'answer',
      text: 'eu-west-1',
    });
  });

  it('conflict_aware answers a single assertion', () => {
    const retrieved = sequence([{ claims: [claim({ objectText: 'eu-west-1' })] }]);

    expect(read({ question: question(), retrieved, mode: CONFLICT })).toEqual({
      type: 'answer',
      text: 'eu-west-1',
    });
  });
});

describe('read, absence', () => {
  it('abstains out_of_scope when nothing retrieved names the subject', () => {
    const retrieved = sequence([{ text: 'The migration window moved again.', claims: [] }]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('out_of_scope');
  });

  it('abstains out_of_scope when nothing was retrieved at all', () => {
    expect(reasonOf(read({ question: question(), retrieved: [], mode: LATEST }))).toBe(
      'out_of_scope',
    );
  });

  it('abstains never_stated when the text names the subject but nothing states the property', () => {
    const retrieved = sequence([{ text: 'Meridian came up again in standup.', claims: [] }]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('never_stated');
  });

  it('abstains never_stated when only a claim names the subject', () => {
    // The name never appears in this message's prose, so the text check misses
    // it and the claim check is what makes this a gap rather than a stranger.
    const retrieved = sequence([
      { text: 'Ownership moved last week.', claims: [claim({ predicate: 'owner' })] },
    ]);

    expect(reasonOf(read({ question: question(), retrieved, mode: LATEST }))).toBe('never_stated');
  });

  it('abstains unconnected when the reader arrived at the subject through a hop', () => {
    const retrieved = sequence([{ text: 'Northbeam invoices monthly.', claims: [] }]);

    expect(
      reasonOf(read({ question: question(), retrieved, mode: LATEST, subject: 'Northbeam' })),
    ).toBe('unconnected');
  });

  it('prefers unconnected over out_of_scope after a hop, even with nothing retrieved', () => {
    // Following a relation means the entity was named by a claim, so it exists.
    // An entity that exists with nothing stated about the property is a gap in
    // the record, which is a different thing from a name never heard before.
    expect(reasonOf(read({ question: question(), retrieved: [], mode: LATEST, subject: 'X' }))).toBe(
      'unconnected',
    );
  });

  it('answers about the hop subject rather than the one the question names', () => {
    const retrieved = sequence([
      { claims: [claim({ subject: 'Meridian', objectText: 'wrong' })] },
      { claims: [claim({ subject: 'Northbeam', objectText: 'right' })] },
    ]);

    expect(read({ question: question(), retrieved, mode: LATEST, subject: 'Northbeam' })).toEqual({
      type: 'answer',
      text: 'right',
    });
  });
});

describe('bridgeFrom', () => {
  it('reads the entity a relation points at', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({ predicate: 'vendor', objectText: 'Northbeam', objectEntity: 'Northbeam' }),
        ],
      },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBe('Northbeam');
  });

  it('returns null when nothing states the relation', () => {
    const retrieved = sequence([{ claims: [claim({ predicate: 'owner' })] }]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBeNull();
  });

  it('returns null when the relation names no entity', () => {
    // A value that is text and not a node is not a place to hop to.
    const retrieved = sequence([
      { claims: [claim({ predicate: 'vendor', objectText: 'unknown', objectEntity: null })] },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBeNull();
  });

  it('ignores a relation stated about a different subject', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({
            subject: 'Halcyon',
            predicate: 'vendor',
            objectText: 'Northbeam',
            objectEntity: 'Northbeam',
          }),
        ],
      },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBeNull();
  });

  it('takes the newest entity when the relation moved', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({
            predicate: 'vendor',
            objectText: 'Northbeam',
            objectEntity: 'Northbeam',
            validFrom: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
      {
        claims: [
          claim({
            kind: 'revise',
            predicate: 'vendor',
            objectText: 'Larkspur',
            objectEntity: 'Larkspur',
            validFrom: '2026-02-01T00:00:00.000Z',
          }),
        ],
      },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBe('Larkspur');
  });

  it('returns null when the newest statement withdraws the relation', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({
            predicate: 'vendor',
            objectText: 'Northbeam',
            objectEntity: 'Northbeam',
            validFrom: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
      {
        claims: [
          claim({
            kind: 'retract',
            predicate: 'vendor',
            objectText: '',
            objectEntity: 'Northbeam',
            validFrom: '2026-02-01T00:00:00.000Z',
          }),
        ],
      },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBeNull();
  });

  it('hops anyway when the withdrawal is older than the statement', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({
            kind: 'retract',
            predicate: 'vendor',
            objectText: '',
            objectEntity: 'Northbeam',
            validFrom: '2026-01-01T00:00:00.000Z',
          }),
        ],
      },
      {
        claims: [
          claim({
            predicate: 'vendor',
            objectText: 'Larkspur',
            objectEntity: 'Larkspur',
            validFrom: '2026-02-01T00:00:00.000Z',
          }),
        ],
      },
    ]);

    expect(bridgeFrom(retrieved, 'Meridian', 'vendor')).toBe('Larkspur');
  });

  it('returns null over an empty retrieved set', () => {
    expect(bridgeFrom([], 'Meridian', 'vendor')).toBeNull();
  });
});
