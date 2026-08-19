import type { ClaimKind } from '../corpus/types.js';

/**
 * Claims read out of raw prose.
 *
 * The corpus generator can annotate its claims because it wrote the sentences
 * and therefore knows what they meant. Nothing else does, and the README has
 * said so plainly. This module reads prose nobody annotated and produces the
 * same claim shape, so ingestion, the graph and the resolver underneath stay
 * exactly as they are: the extractor is an addition to the front of the
 * pipeline, not a second opinion about what a claim is.
 *
 * The load-bearing output is not the subject and not the value, it is the
 * assertion mode. "Sessions are stored in Redis" and "we should move sessions
 * to Postgres" carry the same subject, the same property and different values,
 * and an extractor that reads both as statements of fact promotes a proposal
 * into the current state of the system. That is not a ranking error that a
 * better score would fix; it is a category error, and it is the one failure
 * that would make a memory system worse than no memory at all.
 *
 * So mode is decided first, and it decides where a claim is filed rather than
 * how confident it is. Only three modes file into the plain predicate. The rest
 * file into a slot beside it, which keeps them in the graph, quotable and
 * walkable, while leaving them structurally unable to win a question about
 * current state. The resolver needs no knowledge of any of this.
 */

export const ASSERTION_MODES = [
  /** A statement about how things are. "Sessions are stored in Redis." */
  'EXPLICIT_STATE',
  /** A change reported as having happened. "PR #184 merged. Sessions migrated." */
  'IMPLEMENTATION_EVENT',
  /** A statement that an earlier one was wrong. "I was wrong. It is Postgres, not Redis." */
  'CORRECTION',
  /** A change someone wants. Also where a bare instruction lands. */
  'PROPOSAL',
  /** A question. Carries a value without asserting it. */
  'QUESTION',
  /** A change under way and not landed. "A PR is open to migrate to Postgres." */
  'PLAN',
  /** Hedged. "I think this probably uses Redis." */
  'SPECULATION',
  /** Explicitly about the past. "Before 5 March 2026, sessions were stored in Redis." */
  'HISTORICAL',
] as const;

export type AssertionMode = (typeof ASSERTION_MODES)[number];

/**
 * The three modes whose claims compete to be current.
 *
 * A statement of state, a reported change and a correction are the only things
 * a person says that assert what is true now. Everything else is a wish, a
 * question, an intention, a guess or a memory, and each of those is worth
 * keeping and worth never answering with.
 */
export const STATING_MODES: ReadonlySet<AssertionMode> = new Set<AssertionMode>([
  'EXPLICIT_STATE',
  'IMPLEMENTATION_EVENT',
  'CORRECTION',
]);

/**
 * The slot suffix each non-stating mode files under, or null for the ones that
 * file into the plain predicate.
 *
 * A separate slot rather than a flag on the claim, because a flag would have to
 * be read by something, and the only thing that could read it is the resolver.
 * Putting the mode in the predicate means a question about `storage` cannot see
 * a proposal about `storage:proposal` at all, and that property holds without a
 * line of resolver code being aware the extractor exists.
 */
export const MODE_SLOT: Readonly<Record<AssertionMode, string | null>> = Object.freeze({
  EXPLICIT_STATE: null,
  IMPLEMENTATION_EVENT: null,
  CORRECTION: null,
  PROPOSAL: 'proposal',
  QUESTION: 'question',
  PLAN: 'plan',
  SPECULATION: 'speculation',
  HISTORICAL: 'historical',
});

/** The predicate a claim in this mode is filed under. */
export function slotFor(predicate: string, mode: AssertionMode): string {
  const slot = MODE_SLOT[mode];
  return slot === null ? predicate : `${predicate}:${slot}`;
}

/** One turn of a conversation, with the speaker and clock it arrived with. */
export interface Turn {
  readonly index: number;
  /** As written in the source. Not normalised, because it is somebody's name. */
  readonly speaker: string;
  /** Which side of the conversation, which is all the graph records. */
  readonly role: 'user' | 'assistant';
  readonly timestamp: string;
  readonly text: string;
  /** Where `text` starts in the raw source, so a span can be checked twice. */
  readonly offset: number;
}

/** A sentence and where it sits in its turn. Half open, `[start, end)`. */
export interface Sentence {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * What one sentence was read as, whether or not it yielded a claim.
 *
 * Kept for the sentences that yield nothing, which is most of them. "No claim
 * here" is the answer for a question with no answer in it, for a false premise
 * and for ordinary noise, and a caller that cannot see the classification
 * cannot tell those apart from a sentence the extractor failed on.
 */
export interface Reading {
  readonly turnIndex: number;
  readonly sentenceIndex: number;
  readonly mode: AssertionMode;
  readonly text: string;
  readonly start: number;
  readonly end: number;
  /** Keys of the claims this sentence produced. Usually empty. */
  readonly claimKeys: readonly string[];
}

/** The quotation behind a claim, as offsets into its turn. */
export interface ExtractedSpan {
  readonly start: number;
  readonly end: number;
  readonly quote: string;
}

export interface ExtractedClaim {
  readonly key: string;
  readonly subject: string;
  /** Already slotted, so this is the predicate the graph will hold. */
  readonly predicate: string;
  /** Before slotting, so a caller can ask what property was meant. */
  readonly property: string;
  readonly mode: AssertionMode;
  readonly kind: ClaimKind;
  readonly objectText: string;
  readonly objectEntity: string | null;
  readonly supersedes: string | null;
  readonly validFrom: string;
  readonly turnIndex: number;
  readonly span: ExtractedSpan;
}

/** A span that did not map back to the source, and was therefore not emitted. */
export interface RejectedSpan {
  readonly turnIndex: number;
  readonly reason: string;
  readonly quote: string;
}

export interface Extraction {
  readonly turns: readonly Turn[];
  readonly claims: readonly ExtractedClaim[];
  readonly readings: readonly Reading[];
  readonly rejected: readonly RejectedSpan[];
}

/** What the source cannot tell us: whose conversation this is, and when. */
export interface SourceMeta {
  readonly sessionKey: string;
  readonly title: string;
  /** ISO 8601. Used for any turn that carries no clock of its own. */
  readonly startedAt: string;
  readonly defaultSpeaker?: string;
}
