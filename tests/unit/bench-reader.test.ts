import { describe, expect, it } from 'vitest';

import { blastReach, bridgeFrom, read, readBlast } from '../../src/bench/reader.js';
import type { BenchOutcome } from '../../src/bench/types.js';
import type { ClaimAnnotation, EntityKind } from '../../src/corpus/types.js';
import { claim, question, sequence } from '../support/bench-fixtures.js';

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

/** "dependent depends on dependency", the one claim shape a blast radius walks. */
function dep(dependent: string, dependency: string, over: Partial<ClaimAnnotation> = {}): ClaimAnnotation {
  return claim({
    subject: dependent,
    predicate: 'depends_on',
    objectText: dependency,
    objectEntity: dependency,
    ...over,
  });
}

function kindsOf(entries: readonly (readonly [string, EntityKind])[]): ReadonlyMap<string, EntityKind> {
  return new Map<string, EntityKind>(entries);
}

describe('blastReach', () => {
  it('reaches what depends on the root directly', () => {
    const retrieved = sequence([{ claims: [dep('checkout', 'wire-format')] }]);

    expect(blastReach(retrieved, 'wire-format')).toEqual(['checkout']);
  });

  it('follows the chain past the first hop', () => {
    const retrieved = sequence([
      { claims: [dep('cursor-walk', 'wire-format')] },
      { claims: [dep('checkout', 'cursor-walk')] },
    ]);

    expect(blastReach(retrieved, 'wire-format')).toEqual(['cursor-walk', 'checkout']);
  });

  it('returns the closest names first', () => {
    // Breadth first, because the order is what a second retrieval round searches
    // in, and a depth-first order would spend the budget on one branch.
    const retrieved = sequence([
      { claims: [dep('cursor-walk', 'wire-format')] },
      { claims: [dep('checkout', 'cursor-walk')] },
      { claims: [dep('quota-ring', 'wire-format')] },
    ]);

    expect(blastReach(retrieved, 'wire-format')).toEqual(['cursor-walk', 'quota-ring', 'checkout']);
  });

  it('never includes the root', () => {
    const retrieved = sequence([{ claims: [dep('checkout', 'wire-format')] }]);

    expect(blastReach(retrieved, 'wire-format')).not.toContain('wire-format');
  });

  it('terminates on a cycle and names each reached entity once', () => {
    // The corpus does not generate cycles. A retrieved set is a fragment of the
    // record rather than the record, so the walk cannot assume that.
    const retrieved = sequence([
      { claims: [dep('b', 'a')] },
      { claims: [dep('a', 'b')] },
      { claims: [dep('c', 'b')] },
    ]);

    expect(blastReach(retrieved, 'a')).toEqual(['b', 'c']);
  });

  it('drops a dependency that announced itself as withdrawn', () => {
    const retrieved = sequence([
      { claims: [dep('checkout', 'wire-format', { kind: 'retract' })] },
      { claims: [dep('quota-ring', 'wire-format')] },
    ]);

    expect(blastReach(retrieved, 'wire-format')).toEqual(['quota-ring']);
  });

  it('keeps a dependency that was silently replaced', () => {
    // The reader is not shown supersession, and inferring it from two claims
    // that do not announce an order is the thing under test rather than a
    // shortcut this layer gets to take.
    const retrieved = sequence([
      {
        claims: [
          dep('tenant-router', 'moss-index', { validFrom: '2026-01-01T00:00:00.000Z' }),
          dep('tenant-router', 'hash-fence', { validFrom: '2026-02-01T00:00:00.000Z' }),
        ],
      },
    ]);

    expect(blastReach(retrieved, 'moss-index')).toEqual(['tenant-router']);
  });

  it('ignores a claim on another predicate', () => {
    const retrieved = sequence([
      {
        claims: [
          claim({ subject: 'checkout', predicate: 'owner', objectText: 'Priya', objectEntity: 'Priya' }),
        ],
      },
    ]);

    expect(blastReach(retrieved, 'Priya')).toEqual([]);
  });

  it('ignores a dependency stated as text rather than as a name', () => {
    const retrieved = sequence([
      { claims: [dep('checkout', 'wire-format', { objectEntity: null })] },
    ]);

    expect(blastReach(retrieved, 'wire-format')).toEqual([]);
  });

  it('reaches nothing over an empty retrieved set', () => {
    expect(blastReach([], 'wire-format')).toEqual([]);
  });
});

describe('readBlast', () => {
  it('answers with the services it reached, sorted', () => {
    // Sorted rather than in walk order, because the scorer compares this string
    // against the gold answer and a set has no order to preserve.
    const retrieved = sequence([
      { claims: [dep('quota-ring', 'wire-format')] },
      { claims: [dep('checkout', 'quota-ring')] },
      { claims: [dep('admin', 'wire-format')] },
    ]);
    const kinds = kindsOf([
      ['quota-ring', 'package'],
      ['checkout', 'service'],
      ['admin', 'service'],
    ]);

    expect(readBlast({ root: 'wire-format', retrieved, kinds })).toEqual({
      type: 'answer',
      text: 'admin, checkout',
    });
  });

  it('leaves the packages it walked through out of the answer', () => {
    const retrieved = sequence([
      { text: 'cursor-walk pulls wire-format in.', claims: [dep('cursor-walk', 'wire-format')] },
    ]);
    const kinds = kindsOf([['cursor-walk', 'package']]);

    // Reached, and correctly reached, but the question asked which services.
    expect(blastReach(retrieved, 'wire-format')).toEqual(['cursor-walk']);
    expect(reasonOf(readBlast({ root: 'wire-format', retrieved, kinds }))).toBe('never_stated');
  });

  it('abstains never_stated when the root is in view and nothing depends on it', () => {
    const retrieved = sequence([{ text: 'wire-format came up in review.', claims: [] }]);

    expect(reasonOf(readBlast({ root: 'wire-format', retrieved, kinds: kindsOf([]) }))).toBe(
      'never_stated',
    );
  });

  it('abstains never_stated when only a claim names the root', () => {
    const retrieved = sequence([
      { text: 'The dependency list changed.', claims: [dep('wire-format', 'clock-skew')] },
    ]);

    expect(reasonOf(readBlast({ root: 'wire-format', retrieved, kinds: kindsOf([]) }))).toBe(
      'never_stated',
    );
  });

  it('abstains out_of_scope when nothing retrieved mentions the root', () => {
    const retrieved = sequence([{ text: 'The migration window moved again.', claims: [] }]);

    expect(reasonOf(readBlast({ root: 'wire-format', retrieved, kinds: kindsOf([]) }))).toBe(
      'out_of_scope',
    );
  });

  it('abstains out_of_scope when nothing was retrieved at all', () => {
    expect(reasonOf(readBlast({ root: 'wire-format', retrieved: [], kinds: kindsOf([]) }))).toBe(
      'out_of_scope',
    );
  });

  it('treats an unknown kind as not a service', () => {
    // A name the index has no kind for is a name this reader cannot claim is
    // affected, and guessing from the shape of the string is not reading.
    const retrieved = sequence([
      { text: 'checkout pulls wire-format in.', claims: [dep('checkout', 'wire-format')] },
    ]);

    expect(reasonOf(readBlast({ root: 'wire-format', retrieved, kinds: kindsOf([]) }))).toBe(
      'never_stated',
    );
  });
});
