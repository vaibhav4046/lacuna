import {
  abilityOf,
  isAbstention,
  QUESTION_TYPES,
  type Ability,
  type IngestibleQuestion,
  type QuestionType,
} from './schema.js';

/** One published-dataset coverage row, grouped exactly as the official scorer does. */
export interface CoverageRow {
  readonly questionType: QuestionType;
  readonly ability: Ability;
  readonly instances: number;
  readonly instancesWithClaim: number;
  readonly claims: number;
  readonly abstentions: number;
}

/** The input needed to measure extraction coverage without loading ground truth. */
export interface CoverageInput {
  readonly question: IngestibleQuestion;
  readonly claims: number;
}

/**
 * Summarise adapter coverage by the benchmark's own type taxonomy.
 *
 * This is deliberately a count of ingestion support, not answer accuracy. It
 * accepts only the stripped question shape, so the report cannot accidentally
 * use the answer or evidence-session fields while it is being produced.
 */
export function coverageByQuestionType(inputs: readonly CoverageInput[]): readonly CoverageRow[] {
  const rows = new Map<QuestionType, CoverageRow>(QUESTION_TYPES.map((questionType) => [
    questionType,
    {
      questionType,
      ability: abilityOf(questionType),
      instances: 0,
      instancesWithClaim: 0,
      claims: 0,
      abstentions: 0,
    },
  ]));

  for (const input of inputs) {
    const current = rows.get(input.question.question_type);
    if (current === undefined) continue;
    rows.set(input.question.question_type, {
      ...current,
      instances: current.instances + 1,
      instancesWithClaim: current.instancesWithClaim + (input.claims > 0 ? 1 : 0),
      claims: current.claims + input.claims,
      abstentions: current.abstentions + (isAbstention(input.question.question_id) ? 1 : 0),
    });
  }

  return QUESTION_TYPES.map((questionType) => rows.get(questionType)!);
}
