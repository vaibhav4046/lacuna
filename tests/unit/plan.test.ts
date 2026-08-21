import { describe, expect, it } from 'vitest';

import { UNDERSTOOD_PREDICATES, predicateIn, subjectsIn } from '../../src/retrieval/plan.js';

/**
 * Reading a sentence, and refusing to guess at one it cannot read.
 *
 * The failures matter more than the successes. A parser in front of this
 * resolver can produce the one kind of wrong answer no other part of the system
 * can: a confident, fully evidenced answer to a question nobody asked. So most
 * of what is checked here is that it declines — on a name the workspace does
 * not hold, on a property it does not record, and on the ambiguity between a
 * name that contains another name.
 *
 * `available` is always passed explicitly, because that is the real contract:
 * the predicates come from the store, per subject. An earlier version of this
 * parser carried its own hand-written list and it was wrong in both directions,
 * inventing three properties the corpus does not record while missing six it
 * does. A test that supplied a fixed vocabulary would have passed anyway.
 */

const KNOWN = ['Sessions', 'Checkout', 'trace-collector', 'replay-queue', 'queue', 'Bellwether'];

/** What the public corpus actually records, taken from its own claims. */
const CORPUS = [
  'owner', 'runbook_owner', 'depends_on', 'pool_size', 'region',
  'launch_date', 'migration_window', 'beta_partner', 'budget_code',
  'on_call_length', 'contact', 'status',
];

describe('names in a sentence', () => {
  it('are found regardless of case, punctuation or separator', () => {
    // "trace collector" with a space has to find `trace-collector`, because
    // that is how somebody reading the name aloud would type it.
    expect(subjectsIn('who owns the trace collector?', KNOWN)).toEqual(['trace-collector']);
  });

  it('prefer the longer name when one contains another', () => {
    // `queue` is also a known name. Answering about queues when the question
    // said replay-queue would be wrong and would look completely confident.
    expect(subjectsIn('what does the replay-queue depend on', KNOWN)).toEqual(['replay-queue']);
  });

  it('keep the order the sentence gave them, not the order of their length', () => {
    // Bellwether is asked about and replay-queue is the hop. Sorting by length
    // would swap the two and answer a different question with no sign anything
    // had gone wrong.
    expect(subjectsIn('who owns the service Bellwether depends on, via replay-queue', KNOWN))
      .toEqual(['Bellwether', 'replay-queue']);
  });

  it('find nothing in a sentence naming nothing this workspace holds', () => {
    expect(subjectsIn('who owns Cassandra', KNOWN)).toEqual([]);
  });

  it('do not match a name that merely shares a prefix', () => {
    // `Sess` is not `Sessions`, and a parser that folded them would answer
    // about an entity nobody asked about.
    expect(subjectsIn('what about Sess', KNOWN)).toEqual([]);
  });
});

describe('the predicate', () => {
  it('is read from the words people use rather than its internal name', () => {
    expect(predicateIn('who owns Checkout', CORPUS)?.predicate).toBe('owner');
    expect(predicateIn('what is the connection pool size', CORPUS)?.predicate).toBe('pool_size');
    expect(predicateIn('when does Lowbank launch', CORPUS)?.predicate).toBe('launch_date');
  });

  it('matches a predicate by its own name, with no synonym entry needed', () => {
    // The point of this: a workspace built from a pasted transcript has
    // predicates this file has never heard of, and they still have to be
    // askable.
    const found = predicateIn('what is the escalation tier', ['escalation_tier']);
    expect(found?.predicate).toBe('escalation_tier');
    expect(found?.matched).toBe('escalation tier');
  });

  it('reports the words the reader wrote, so the reading can be checked', () => {
    expect(predicateIn('who is the runbook owner for billing-gate', CORPUS)?.matched).toBe('runbook owner');
  });

  it('lets an explicit runbook noun disambiguate a preceding generic ownership verb', () => {
    expect(predicateIn('Who owns the billing-gate runbook?', CORPUS)?.predicate).toBe('runbook_owner');
  });

  it('takes the earliest cue, because English asks first and qualifies after', () => {
    // "who owns the service Bellwether depends on" holds both `owns` and
    // `depends on`, and it is a question about ownership.
    expect(predicateIn('who owns the service Bellwether depends on', CORPUS)?.predicate).toBe('owner');
  });

  it('breaks a tie at the same position by length', () => {
    // `pool size` and `pool` start at the same word.
    expect(predicateIn('what is the pool size', CORPUS)?.matched).toBe('pool size');
  });
});

describe('what is askable versus what is recorded', () => {
  it('understands a predicate the subject does not hold, so the resolver can say nothing states it', () => {
    // Foxglove records only beta_partner. "Connection pool size" is still a
    // real question with a real answer — evidenced absence — and refusing it
    // here would replace the strongest thing this product does with a shrug.
    const askable = [...new Set(['beta_partner', ...UNDERSTOOD_PREDICATES])];
    expect(predicateIn('what is the connection pool size for Foxglove', askable)?.predicate).toBe('pool_size');
  });

  it('still refuses a word that is in neither list', () => {
    const askable = [...new Set(['beta_partner', ...UNDERSTOOD_PREDICATES])];
    // The product has no notion of storage anywhere.
    expect(predicateIn('what is Foxglove stored in', askable)).toBeNull();
  });
});

describe('what the predicate reader refuses', () => {
  it('refuses a property this workspace does not record', () => {
    // The corpus has no notion of storage. Picking the nearest predicate would
    // produce a well-evidenced answer to a different question.
    expect(predicateIn('what is Foxglove stored in', CORPUS)).toBeNull();
  });

  it('refuses everything when the subject records nothing', () => {
    expect(predicateIn('who owns Checkout', [])).toBeNull();
  });

  it('cannot be made to invent a property by adding a synonym', () => {
    // `owner` is in the synonym table. It must still not fire for a subject
    // whose claims do not include it, because the table maps English onto what
    // exists rather than defining what exists.
    expect(predicateIn('who owns Checkout', ['region', 'status'])).toBeNull();
  });
});
