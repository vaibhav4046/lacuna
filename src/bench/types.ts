import type { AbstentionReason } from '../model/abstention';
import type { ClaimAnnotation, GoldQuestion, Message } from '../corpus/types';

/**
 * Shapes for the comparison between Lacuna and the retrieval approaches it
 * claims to beat.
 *
 * The split that matters here is between a retriever and a reader. A retriever
 * decides which messages reach the answering step. A reader decides what to say
 * given those messages. Every baseline in this harness gets the same reader, so
 * the only thing that varies is what reached it. Without that split the
 * comparison would measure two things at once and attribute the difference to
 * whichever one the author preferred.
 */

/** One message, flattened out of its session and given a global position. */
export interface IndexedMessage {
  /** Position in the whole corpus, oldest first. Ties broken by session then index. */
  readonly ordinal: number;
  readonly key: string;
  readonly sessionKey: string;
  readonly sessionTitle: string;
  readonly timestamp: string;
  readonly speaker: Message['speaker'];
  readonly text: string;
  readonly claims: readonly ClaimAnnotation[];
  /** Lowercased word tokens, held once because BM25 needs them on every query. */
  readonly tokens: readonly string[];
}

export interface CorpusIndex {
  readonly messages: readonly IndexedMessage[];
  /** Every name the corpus makes a claim about. Used to tell absent from unstated. */
  readonly subjects: ReadonlySet<string>;
}

/**
 * What a retriever hands the reader: message positions, best first.
 *
 * Positions rather than messages so that a fusion step can combine two
 * rankings without comparing incompatible scores, and so the cost of a
 * retriever is not hidden inside a copy.
 */
export type Ranking = readonly number[];

export interface Retriever {
  readonly name: string;
  /** One line for the report saying what this actually does. */
  readonly description: string;
  readonly rank: (question: GoldQuestion, limit: number) => Ranking;
}

/**
 * How the reader treats disagreement it can see in the retrieved messages.
 *
 * `latest` is what a straightforward pipeline does: newest statement wins. It
 * is not a strawman, it is the common case, and it is right about revisions.
 *
 * `conflict_aware` is the strongest version of a flat reader: when two
 * assertions on the same subject and predicate disagree and neither announces
 * itself as a correction, it declines to pick. That rule buys contradiction
 * detection and it costs something elsewhere, which is the point of running
 * both.
 */
export type ReaderMode = 'latest' | 'conflict_aware';

/** What a system decided, in the same vocabulary the gold answers use. */
export type BenchOutcome =
  | { readonly type: 'answer'; readonly text: string }
  | { readonly type: 'abstain'; readonly reason: AbstentionReason };

export interface BenchResult {
  readonly outcome: BenchOutcome;
  /**
   * Characters the answering step had to read. Divided by four for a token
   * estimate, and labelled an estimate everywhere it is shown, because no
   * tokenizer was run over this text.
   */
  readonly contextChars: number;
  /** Wall clock milliseconds for retrieval and reading. */
  readonly ms: number;
}

export interface BenchSystem {
  readonly name: string;
  readonly description: string;
  readonly answer: (question: GoldQuestion) => Promise<BenchResult>;
}
