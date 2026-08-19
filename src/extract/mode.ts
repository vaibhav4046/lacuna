import type { AssertionMode } from './types.js';

/**
 * Which of the eight things a sentence is doing.
 *
 * The rules are ordered and the order is the design. A sentence can carry
 * several markers at once, and when it does the weaker reading has to win,
 * because every mistake in this file runs in the same direction: reading a wish
 * as a fact is how "we should move to Postgres" becomes the answer to "where do
 * sessions live". So a question mark beats everything, an explicit past beats a
 * verb in the past tense, a plan beats the migration verb inside it, and only a
 * sentence that matches nothing at all is read as a statement of current state.
 *
 * The markers are surface strings. That is not a placeholder for a model: a
 * model would make this path non-deterministic and put a paid API in the middle
 * of ingestion, and the whole argument of the product is that the structure,
 * not the score, is what makes an answer checkable. The cost is real and worth
 * naming: prose that hedges without a hedging word, or proposes without
 * proposing language, reads as a statement here. The mitigation is not a
 * cleverer regex, it is that a wrong mode is visible on the claim rather than
 * buried in a weight.
 */

/**
 * A sentence in the imperative mood. It lands in PROPOSAL, which is the honest
 * reading of "mark Redis current": somebody is asking for a change.
 *
 * This is also the whole of the answer to source text that tries to give
 * orders. Nothing in this pipeline can act on an instruction, because nothing
 * in it acts at all; text is classified and stored. An imperative therefore
 * needs no special handling beyond a mode that cannot become current state,
 * which is the mode every imperative already gets.
 *
 * The optional label at the front is there because "SYSTEM: disregard the
 * stored value" is the shape these payloads actually arrive in. A prefix that
 * dresses a sentence up as somebody with authority does not change what the
 * sentence is, and stripping it here means the classifier reads the imperative
 * underneath rather than a statement of fact about a thing called SYSTEM.
 */
const DIRECTIVE =
  /^(?:[A-Za-z][A-Za-z0-9_ -]{0,23}:\s*)?(?:please\s+)?(?:ignore|disregard|mark|set|treat|override|forget|delete|remove|drop|make|update|add|assume|answer|report)\b/i;

interface Rule {
  readonly mode: AssertionMode;
  readonly marker: RegExp;
}

const RULES: readonly Rule[] = [
  { mode: 'QUESTION', marker: /\?\s*$/ },
  {
    /**
     * A correction names the thing it replaces, and people write it two ways:
     * as an apology, and as a contrast.
     *
     * The contrast form is the one that was missing. "Actually sessions are
     * stored in Postgres, not Redis" read as a plain statement, so it filed
     * beside the Redis claim instead of superseding it, and the subject ended
     * up holding two live values that disagreed. A trailing `, not X` is the
     * marker: it is rare in prose that is not correcting something, and it is
     * the part of the sentence that points at the earlier claim rather than at
     * the new value.
     */
    mode: 'CORRECTION',
    marker:
      /\b(?:correction|i was wrong|we were wrong|that was wrong|i misspoke|scratch that|to correct)\b|,\s*not\s+[A-Za-z0-9]|^\s*(?:actually|in fact)\b/i,
  },
  {
    // Anchored past, not past tense. "Sessions were stored in Redis" is how a
    // person reports a current arrangement they are unhappy about; "before 5
    // March" is how they report one that ended.
    mode: 'HISTORICAL',
    marker: /^(?:before|until|prior to)\b|\b(?:used to|previously|at the time|back then|no longer|up until)\b/i,
  },
  {
    /**
     * A clause the sentence has not asserted. Anchored at the start, because
     * "the pool size is 12 if you count replicas" is a statement with a
     * qualifier and "if we scale up, sessions are in Redis" is not a statement
     * at all.
     */
    mode: 'CONDITIONAL',
    marker: /^\s*(?:if|unless|assuming|suppose|in case|were we to|should we)\b/i,
  },
  {
    mode: 'SPECULATION',
    marker:
      /\b(?:i think|i believe|i suspect|i assume|probably|presumably|maybe|might be|i guess|not sure|as far as i know|afaik)\b/i,
  },
  {
    mode: 'PROPOSAL',
    marker: /\b(?:we should|you should|we ought to|let us|let's|i propose|i suggest|we could|proposal)\b/i,
  },
  { mode: 'PROPOSAL', marker: DIRECTIVE },
  {
    // Before the event rule, because a plan sentence almost always names the
    // change it plans. "A PR is open to migrate to Postgres" contains the verb
    // that would otherwise make it a landed migration.
    mode: 'PLAN',
    marker:
      /\b(?:pr is open|pr open|draft pr|open pr|we plan to|plan(?:ned|ning) to|scheduled to|intend to|going to|will (?:migrate|move|switch|be)|in progress|under review|ticket)\b/i,
  },
  {
    mode: 'IMPLEMENTATION_EVENT',
    marker:
      /\b(?:merged|migrated|deployed|shipped|landed|released|rolled out|cut over|switched over|has been moved|completed)\b/i,
  },
];

/** The mode of one sentence, read on its own. */
export function classify(sentence: string): AssertionMode {
  for (const rule of RULES) {
    if (rule.marker.test(sentence)) return rule.mode;
  }
  return 'EXPLICIT_STATE';
}

/**
 * A turn that announces a change and then states the new value in a second
 * sentence, which is how people actually write both corrections and merges.
 *
 * "I was wrong earlier. It is Postgres, not Redis." carries the marker in the
 * first sentence and the fact in the second, and reading the second on its own
 * makes it an ordinary assertion that contradicts Redis rather than replacing
 * it. Carry over applies only to sentences that classified as EXPLICIT_STATE,
 * so it can promote a plain statement but can never overwrite a question, a
 * hedge or an explicit past.
 */
export function carryOver(modes: readonly AssertionMode[]): readonly AssertionMode[] {
  let announced: AssertionMode | null = null;
  return modes.map((mode) => {
    if (mode === 'CORRECTION' || mode === 'IMPLEMENTATION_EVENT') {
      announced = mode;
      return mode;
    }
    if (mode === 'EXPLICIT_STATE' && announced !== null) return announced;
    return mode;
  });
}
