/**
 * Matching a name the reader typed against the name the sessions used.
 *
 * This exists because of a wrong answer, and the wrong answer was the worst
 * kind this product can give. Asking about `Foxglove` returned a partner and a
 * citation. Asking about `foxglove` returned an abstention with the reason
 * `out_of_scope`, which does not mean "not found"; it means "this subject never
 * appears in the sessions at all". That is a claim about the corpus, and it was
 * false. A product whose thesis is that a refusal is a finding had produced a
 * finding that was not true, over a capital letter.
 *
 * Both stores addressed the name exactly and neither could do better on its
 * own. The cloud derives a record id from a hash of the name, so a folded name
 * hashes to a record that does not exist. The node stores the name as a
 * property, and this HydraDB build's Cypher subset has no `toLower`: it answers
 * `OpenCypher query is not supported yet` for a function call in a predicate.
 *
 * So both fall back the same way. On an exact miss, and only then, they read
 * the names they hold once, look for one that differs by case alone, and retry
 * with that. One extra read on the path that was about to return nothing, and
 * the two stores stay identical to each other, which the parity gates require.
 *
 * Folding is `toLowerCase` and nothing else. No trimming, no accent stripping,
 * no punctuation removal, no fuzzy distance. A near miss that is not a case
 * difference is a genuine absence and has to keep saying so, because widening
 * this into a similarity search is how a product that refuses honestly turns
 * into one that guesses.
 */

/**
 * The stored spelling of `name`, when the only difference is case.
 *
 * Returns null when there is no such name, and null when `name` is already
 * exactly one of them, so a caller can treat a non-null result as "retry with
 * this" rather than having to compare it back.
 *
 * An ambiguous fold, two stored names differing only in case, returns null.
 * Picking one would answer from a record the reader did not ask for.
 */
export function canonicalName(stored: Iterable<string>, name: string): string | null {
  const folded = name.toLowerCase();
  let found: string | null = null;

  for (const candidate of stored) {
    if (candidate === name) return null;
    if (candidate.toLowerCase() !== folded) continue;
    if (found !== null && found !== candidate) return null;
    found = candidate;
  }

  return found;
}
