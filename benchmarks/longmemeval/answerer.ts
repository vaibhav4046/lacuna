import { plannedAskEnvelope } from '../../src/api/workspace.js';
import type { HydraSource } from '../../src/hydra/source.js';
import type { IngestibleQuestion } from './schema.js';
import type { LongMemEvalAnswerer } from './run.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const ABSTENTION = 'I do not have enough evidence in this memory to answer that.';

/**
 * The repository-native LongMemEval answerer.
 *
 * This is intentionally deterministic and model-free: it sends every question
 * through the same sentence planner and evidence resolver as the shipped web,
 * CLI and MCP surfaces. It is a real hypothesis producer, not a placeholder,
 * while the optional paid judge remains a separate concern. The answerer never
 * receives the gold answer or the answer-session ids.
 */
export function createDeterministicAnswerer(timeoutMs = DEFAULT_TIMEOUT_MS): LongMemEvalAnswerer {
  return {
    model: 'lacuna-deterministic-planner-v1',
    answer: async (question: IngestibleQuestion, source: HydraSource): Promise<string> => {
      try {
        const known = source.subjects === undefined
          ? []
          : (await source.subjects(timeoutMs)).value;
        const planned = await plannedAskEnvelope(source, question.question, known, timeoutMs);
        if (planned.answer?.status === 'ANSWERED' && typeof planned.answer.answer === 'string'
          && planned.answer.answer.trim() !== '') {
          return planned.answer.answer.trim();
        }
        if (planned.answer?.status === 'CONFLICT') {
          return 'The evidence conflicts, so I cannot choose one claim.';
        }
        return ABSTENTION;
      } catch {
        return ABSTENTION;
      }
    },
  };
}
