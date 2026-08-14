import { HydraClient } from '../hydra/client';
import { loadHydraConfig } from '../hydra/config';
import { ask } from '../retrieval/fetch';
import { buildQuestion } from '../retrieval/question';
import type { Answer } from '../retrieval/types';

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
  const config = loadHydraConfig(env);
  const client = new HydraClient(config);
  const question = buildQuestion(request.subject, request.predicate, request.via);
  return ask(client, question, { timeoutMs });
}
