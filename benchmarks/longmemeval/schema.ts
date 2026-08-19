/**
 * The official LongMemEval record shapes, and the strictly smaller shapes the
 * product is allowed to see.
 *
 * Field names here are the dataset's, snake_case and all, because renaming a
 * wire format is how a reader stops being able to check it against the source.
 * See docs/BENCHMARK_LONGMEMEVAL.md for where each one is confirmed.
 *
 * The pair of types is the whole point of this file. `LongMemEvalRecord` is
 * what is on disk and it carries the answer. `IngestibleQuestion` is what the
 * adapter takes, and it is that type with the answer, the evidence session ids
 * and the turn level `has_answer` flag removed. Reading a gold answer on the
 * ingestion path is then a type error rather than something a reviewer has to
 * notice.
 */

/** The six values the official `print_qa_metrics.py` reports accuracy for. */
export const QUESTION_TYPES = [
  'single-session-user',
  'single-session-assistant',
  'single-session-preference',
  'multi-session',
  'temporal-reasoning',
  'knowledge-update',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * The five abilities the paper names, plus one bucket that is honestly a gap.
 *
 * `single-session-preference` is a real question type and it is scored, but
 * which of the five headline abilities it rolls up to is not stated anywhere
 * this integration could confirm. It gets its own name rather than a guess.
 */
export type Ability =
  | 'information_extraction'
  | 'multi_session_reasoning'
  | 'knowledge_updates'
  | 'temporal_reasoning'
  | 'preference';

const ABILITY_OF: Readonly<Record<QuestionType, Ability>> = Object.freeze({
  'single-session-user': 'information_extraction',
  'single-session-assistant': 'information_extraction',
  'multi-session': 'multi_session_reasoning',
  'knowledge-update': 'knowledge_updates',
  'temporal-reasoning': 'temporal_reasoning',
  // NOT CONFIRMED. See docs/BENCHMARK_LONGMEMEVAL.md.
  'single-session-preference': 'preference',
});

export function abilityOf(type: QuestionType): Ability {
  return ABILITY_OF[type];
}

export function isQuestionType(value: unknown): value is QuestionType {
  return typeof value === 'string' && (QUESTION_TYPES as readonly string[]).includes(value);
}

/**
 * Whether this is an abstention question.
 *
 * Substring rather than suffix, because that is what `evaluate_qa.py` and
 * `print_qa_metrics.py` both do: `if '_abs' in entry['question_id']`. Matching
 * the official test exactly matters more than matching what the ids look like.
 */
export function isAbstention(questionId: string): boolean {
  return questionId.includes('_abs');
}

export interface HaystackTurn {
  readonly role: 'user' | 'assistant';
  readonly content: string;
  /**
   * Present and true on turns that hold the evidence. Ground truth at turn
   * granularity, used by the official retrieval evaluation to compute recall.
   * It must not reach ingestion, which is why `IngestibleTurn` omits it.
   */
  readonly has_answer?: boolean;
}

/** A turn with the evidence marker removed at the type level. */
export type IngestibleTurn = Omit<HaystackTurn, 'has_answer'>;

/**
 * One evaluation instance, as it sits in the JSON array on disk.
 *
 * `answer` is `unknown` rather than `string` on purpose. The Hugging Face
 * dataset viewer reports the column mixes strings and integers, and nothing in
 * this repository reads the field, so the loose type costs nothing and the
 * looseness is a second small barrier to anyone who tries.
 */
export interface LongMemEvalRecord {
  readonly question_id: string;
  readonly question_type: QuestionType;
  readonly question: string;
  readonly answer: unknown;
  readonly answer_session_ids: readonly string[];
  readonly question_date: string;
  readonly haystack_session_ids: readonly string[];
  readonly haystack_dates: readonly string[];
  readonly haystack_sessions: readonly (readonly HaystackTurn[])[];
}

/**
 * The same instance with every ground truth field removed.
 *
 * This is the only shape the adapter, the runner and any answering system are
 * given. `stripGroundTruth` in load.ts is the only function that produces one.
 */
export type IngestibleQuestion = Omit<
  LongMemEvalRecord,
  'answer' | 'answer_session_ids' | 'haystack_sessions'
> & {
  readonly haystack_sessions: readonly (readonly IngestibleTurn[])[];
};

/** One line of the official hypothesis file. */
export interface Hypothesis {
  readonly question_id: string;
  readonly hypothesis: string;
}

/**
 * The official output format, from the repository README: "a `jsonl` format
 * with each line containing two fields: `question_id` and `hypothesis`".
 *
 * Two fields, written in that order, and nothing else. An extra field would be
 * ignored by the judge, but it would also be the obvious place for someone to
 * park a debugging copy of the answer.
 */
export function serialiseHypotheses(rows: readonly Hypothesis[]): string {
  return rows
    .map((row) => `${JSON.stringify({ question_id: row.question_id, hypothesis: row.hypothesis })}\n`)
    .join('');
}
