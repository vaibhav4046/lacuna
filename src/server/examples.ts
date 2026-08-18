import { generateCorpus } from '../corpus/index.js';
import { buildInventory, type Inventory } from '../report/inventory.js';
import { parseVia } from '../retrieval/index.js';
import type { CorpusFacts, Example } from '../view/home.js';

/**
 * What the landing page shows, built once from the corpus at boot.
 *
 * The example list is one question per thread kind, taken in the order the
 * corpus generates them. That is a rule rather than a selection: nobody picked
 * the questions that look good, and the three kinds that produce no answer are
 * on the page for the same reason as the ones that do.
 *
 * The via is read back out of the question text with the same parser the
 * evaluation harness uses, so a link on the home page and a row in the gold set
 * ask the graph the identical thing. See `scripts/evaluate.ts`.
 */

export interface Demo {
  readonly examples: readonly Example[];
  readonly facts: CorpusFacts;
  /**
   * Every claim, its state and the structural counts, derived from the same
   * corpus rather than from a second pass over the graph. The Memory and Health
   * pages are pure functions of this, so they are rendered once at boot with
   * everything else.
   */
  readonly inventory: Inventory;
}

export function buildDemo(seed?: string): Demo {
  const corpus = seed === undefined ? generateCorpus() : generateCorpus(seed);

  const firstOfKind = new Map<string, Example>();
  for (const question of corpus.questions) {
    if (firstOfKind.has(question.kind)) continue;
    firstOfKind.set(question.kind, {
      kind: question.kind,
      text: question.text,
      subject: question.subject,
      predicate: question.predicate,
      via: parseVia(question.text),
    });
  }

  return {
    examples: [...firstOfKind.values()],
    inventory: buildInventory(corpus),
    facts: {
      sessions: corpus.stats.sessions,
      messages: corpus.stats.messages,
      claims: corpus.stats.claims,
      entities: corpus.entities.length,
      estimatedTokens: corpus.stats.estimatedTokens,
      seed: corpus.seed,
    },
  };
}
