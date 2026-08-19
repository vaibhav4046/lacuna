import { openSource } from '../hydra/open.js';
import { ask } from '../retrieval/fetch.js';
import { buildQuestion } from '../retrieval/question.js';
import type { Answer } from '../retrieval/types.js';

/**
 * One path for `ask`, `explain` and `timeline`.
 *
 * The three commands differ only in what they print. They ask the same question
 * over the same client and get back the same object, so running them through
 * one function keeps the guarantee that `lacuna explain` explains the answer
 * `lacuna ask` would have given rather than a second, separately derived one.
 *
 * The terms are validated by `buildQuestion`, which throws on anything that is
 * not a term. That throw is a usage error here: the words came off the command
 * line.
 */

export async function runQuestion(
  env: Record<string, string | undefined>,
  request: {
    readonly subject: string;
    readonly predicate: string;
    readonly via: string | null;
  },
  timeoutMs: number,
): Promise<Answer> {
  // Whichever store this machine is configured for. The command does not
  // know which one answered and does not need to: both return claims.
  const { source } = openSource(env);
  const question = buildQuestion(request.subject, request.predicate, request.via);
  return ask(source, question, { timeoutMs });
}
