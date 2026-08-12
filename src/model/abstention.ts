/**
 * The five reasons a fact can be unavailable, from ADR 0001.
 *
 * They are not severity levels and they are not confidence buckets. They are
 * structurally different situations in the graph, and the whole thesis is that
 * a graph can tell them apart where a similarity score cannot. Anything that
 * produces or consumes an abstention uses this union, so the corpus, the
 * retriever, the evaluation harness and the interface cannot drift apart.
 */

export const ABSTENTION_REASONS = [
  /** No claim was ever made about this subject and predicate. */
  'never_stated',
  /** A claim existed and was withdrawn, leaving no current value. */
  'retracted',
  /** Two or more claims disagree and nothing resolves them. */
  'contradicted',
  /** The subject is known, the target is known, the connecting relation is not. */
  'unconnected',
  /** The subject does not appear anywhere in the corpus. */
  'out_of_scope',
] as const;

export type AbstentionReason = (typeof ABSTENTION_REASONS)[number];

const EXPLANATIONS: Readonly<Record<AbstentionReason, string>> = {
  never_stated: 'nothing in the sessions ever stated this',
  retracted: 'this was stated and later withdrawn, and nothing replaced it',
  contradicted: 'the sessions disagree and nothing resolves the disagreement',
  unconnected: 'the pieces exist but the link between them was never stated',
  out_of_scope: 'this subject never appears in the sessions at all',
};

export function isAbstentionReason(value: unknown): value is AbstentionReason {
  return (
    typeof value === 'string' &&
    (ABSTENTION_REASONS as readonly string[]).includes(value)
  );
}

/** One clause, lower case, suitable for splicing into a sentence. */
export function explainAbstention(reason: AbstentionReason): string {
  return EXPLANATIONS[reason];
}
