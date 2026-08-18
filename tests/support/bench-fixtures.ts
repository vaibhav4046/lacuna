import { tokenize } from '../../src/bench/index-corpus.js';
import type { CorpusIndex, IndexedMessage } from '../../src/bench/types.js';
import type { ClaimAnnotation, EntityKind, GoldQuestion } from '../../src/corpus/types.js';

/**
 * Fixture builders shared by the bench unit tests.
 *
 * One definition of a claim and a message, so that a test about how the reader
 * treats a retraction and a test about how BM25 ranks one are looking at the
 * same shape. Every default here is deliberately boring: a case overrides the
 * one field it is about, which keeps that field visible in the case instead of
 * buried in setup.
 */

let nextClaim = 0;

export function claim(over: Partial<ClaimAnnotation> = {}): ClaimAnnotation {
  nextClaim += 1;
  return {
    key: `claim-${nextClaim}`,
    subject: 'Meridian',
    predicate: 'launch_date',
    kind: 'assert',
    objectText: '25 July 2026',
    objectEntity: null,
    supersedes: null,
    validFrom: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

/**
 * Tokens are derived from the final text rather than defaulted beside it.
 * `buildIndex` guarantees that relationship, and a fixture that broke it would
 * let a retrieval case pass on text no retriever could have matched.
 */
export function message(over: Partial<IndexedMessage> = {}): IndexedMessage {
  const base: IndexedMessage = {
    ordinal: 0,
    key: 'm-0',
    sessionKey: 'session-planning',
    sessionTitle: 'Planning',
    timestamp: '2026-01-01T00:00:00.000Z',
    speaker: 'user',
    text: 'Meridian ships on 25 July 2026.',
    claims: [],
    tokens: [],
  };
  const merged = { ...base, ...over };
  return {
    ...merged,
    key: over.key ?? `m-${merged.ordinal}`,
    tokens: over.tokens ?? tokenize(merged.text),
  };
}

/**
 * Messages numbered by position, which is the invariant every retriever relies
 * on: a ranking is a list of ordinals, and the system layer resolves it by
 * indexing straight into `messages`.
 */
export function sequence(overrides: readonly Partial<IndexedMessage>[]): IndexedMessage[] {
  return overrides.map((over, ordinal) => message({ ordinal, ...over }));
}

/**
 * Entity kinds default to empty, because only the blast cases care what a name
 * is and a case that does care should say so where it can be read.
 */
export function corpusIndex(
  messages: readonly IndexedMessage[],
  kinds: ReadonlyMap<string, EntityKind> = new Map(),
): CorpusIndex {
  const subjects = new Set<string>();
  for (const item of messages) {
    for (const annotation of item.claims) {
      subjects.add(annotation.subject);
    }
  }
  return { messages, subjects, kinds };
}

export function question(over: Partial<GoldQuestion> = {}): GoldQuestion {
  return {
    id: 'q-1',
    kind: 'stable',
    text: 'When does Meridian launch?',
    subject: 'Meridian',
    predicate: 'launch_date',
    expected: { type: 'answer', text: '25 July 2026', claimKey: 'claim-1' },
    ...over,
  };
}
