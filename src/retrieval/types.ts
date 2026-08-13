import type { AbstentionReason } from '../model/abstention';

/**
 * What retrieval reads out of the graph, and what it decides from it.
 *
 * The split matters: everything above `SubgraphView` is a record of what the
 * graph holds, and everything below it is a conclusion drawn from that record.
 * The conclusion is reached by a pure function, so the same view always yields
 * the same answer, and a disagreement between a run and a test is a disagreement
 * about the data rather than about timing or network order.
 */

export type Polarity = 'positive' | 'negative';

/** One claim as stored, plus whether anything has replaced it. */
export interface ClaimRecord {
  readonly id: number;
  readonly predicate: string;
  readonly objectText: string;
  readonly polarity: Polarity;
  /** When the fact was true, per the sessions. ISO 8601. */
  readonly validFrom: string;
  /** When the graph learned it. ISO 8601. */
  readonly txTime: string;
  /**
   * Ids of the claims that supersede this one. Empty means current.
   *
   * This is an array rather than a flag because it is read off
   * `OPTIONAL MATCH (newer)-[:SUPERSEDES]->(c)`, which returns one row per
   * superseding claim, and because two claims replacing the same one is a
   * thing the graph can express whether or not the corpus does it.
   */
  readonly supersededBy: readonly number[];
}

/** A claim that names a second entity, which is what makes a hop possible. */
export interface Mention {
  readonly claimId: number;
  readonly predicate: string;
  readonly entityId: number;
  readonly entityName: string;
}

/** Everything the graph holds about one subject. */
export interface SubjectView {
  readonly name: string;
  /** null means no node carries this name, which is what out of scope looks like. */
  readonly id: number | null;
  readonly kind: string | null;
  readonly claims: readonly ClaimRecord[];
  readonly mentions: readonly Mention[];
}

/** A question in the form retrieval can act on. */
export interface RetrievalQuestion {
  /** The entity the question is about, as written. */
  readonly subject: string;
  /** The property being asked for. */
  readonly predicate: string;
  /**
   * The relation to follow before asking, when the question asks about
   * something reached through the subject rather than about the subject
   * itself. "Who is our contact for the vendor behind X" is
   * `{subject: X, predicate: contact, via: vendor}`.
   *
   * Nothing else in the question distinguishes a hop that lands on an answer
   * from one that lands on nothing. That is the point.
   */
  readonly via: string | null;
}

export interface SubgraphView {
  readonly question: RetrievalQuestion;
  readonly subject: SubjectView;
  /** Filled only when the question names a relation and exactly one live claim follows it. */
  readonly bridge: SubjectView | null;
}

export interface Hop {
  readonly via: string;
  readonly throughClaimId: number;
  readonly toEntityId: number;
  readonly toEntityName: string;
}

export type Outcome =
  | { readonly type: 'answer'; readonly claimId: number; readonly text: string }
  | { readonly type: 'abstain'; readonly reason: AbstentionReason };

export interface Resolution {
  readonly outcome: Outcome;
  /** One sentence, in the product's voice, saying why. */
  readonly explanation: string;
  /**
   * Every claim on the pair the question resolved to, current and superseded
   * alike, oldest first. This is what the timeline draws, and it is deliberately
   * not filtered down to the winner: the superseded ones are the evidence that
   * a change happened rather than that a value was always this.
   */
  readonly considered: readonly ClaimRecord[];
  readonly hop: Hop | null;
  /** The steps taken, in order, each one a thing that was looked at and what it held. */
  readonly trace: readonly string[];
}

/** One quotation, with the message and session it came from. */
export interface EvidenceRecord {
  readonly claimId: number;
  readonly spanId: number;
  readonly quote: string;
  readonly start: number;
  readonly end: number;
  readonly messageId: number;
  readonly role: string;
  readonly ts: string;
  readonly sessionId: number;
  readonly sessionTitle: string;
}

/**
 * One HydraDB round trip, kept rather than counted.
 *
 * The point of holding the statement and its parameters is that the cost of an
 * answer stops being a number the product asserts and becomes something a
 * reader can run themselves. Nothing here is a secret: parameters are entity
 * names, predicates and integer ids, and the bearer token lives on the
 * transport rather than in a query. See DECISIONS.md D-042.
 */
export interface QueryTrace {
  readonly cypher: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly rows: number;
  readonly ms: number;
  /** The object store version the read observed, when the node reports one. */
  readonly readEpoch: number | null;
}

/**
 * The subgraph, what was concluded from it, and what it cost to read.
 *
 * It extends the view rather than holding one, because an answer is not a thing
 * accompanied by its evidence, it is the evidence plus a conclusion. The
 * extension buys a checkable property as well: `resolve(answer)` returns
 * `answer.resolution`, since the resolver is pure and an answer carries every
 * input it was given. A screen that draws the graph and a screen that states the
 * verdict are then reading the same object rather than two objects that have to
 * be kept in step.
 */
export interface Answer extends SubgraphView {
  readonly resolution: Resolution;
  readonly evidence: readonly EvidenceRecord[];
  /** Every round trip it took, in the order they were issued. */
  readonly queries: readonly QueryTrace[];
  /** Wall clock milliseconds, end to end. */
  readonly ms: number;
}
