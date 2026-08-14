import type { ExpectedAnswer, GoldQuestion, ThreadKind } from '../corpus/types.js';
import type { BenchOutcome } from './types.js';

/**
 * One definition of what counts as right.
 *
 * Both the single system evaluation and the comparison against other retrieval
 * approaches score through this file. Two scoring functions would drift, and a
 * comparison scored differently from the headline number is a comparison
 * nobody should believe.
 */

/**
 * `correct` is exact: the same decision, and for an answer the same text, and
 * for an abstention the same reason. The other four name how it went wrong,
 * because "wrong" covers failures with very different costs.
 */
export type Verdict =
  | 'correct'
  /** Answered, and an answer does exist, but not that one. */
  | 'wrong_answer_text'
  /** Answered where nothing supports an answer. The expensive one. */
  | 'false_answer'
  /** Abstained where an answer was available. Cautious, and still a miss. */
  | 'missed_answer'
  /** Abstained correctly, and named the wrong reason. */
  | 'wrong_reason';

export const VERDICTS: readonly Verdict[] = [
  'correct',
  'wrong_answer_text',
  'false_answer',
  'missed_answer',
  'wrong_reason',
];

export function judge(expected: ExpectedAnswer, actual: BenchOutcome): Verdict {
  if (expected.type === 'answer') {
    if (actual.type === 'abstain') return 'missed_answer';
    return actual.text === expected.text ? 'correct' : 'wrong_answer_text';
  }
  if (actual.type === 'answer') return 'false_answer';
  return actual.reason === expected.reason ? 'correct' : 'wrong_reason';
}

export function describeExpected(question: GoldQuestion): string {
  return question.expected.type === 'answer'
    ? `answer "${question.expected.text}"`
    : `abstain ${question.expected.reason}`;
}

export function describeOutcome(outcome: BenchOutcome): string {
  return outcome.type === 'answer' ? `answer "${outcome.text}"` : `abstain ${outcome.reason}`;
}

export interface Scored {
  readonly question: GoldQuestion;
  readonly outcome: BenchOutcome;
  readonly verdict: Verdict;
}

export interface Metrics {
  readonly total: number;
  readonly correct: number;
  readonly byVerdict: ReadonlyMap<Verdict, number>;
  readonly byKind: ReadonlyMap<ThreadKind, { readonly total: number; readonly correct: number }>;
  /** Abstained, and nothing supported an answer. */
  readonly truePositive: number;
  /** Abstained, and an answer was there. */
  readonly falsePositive: number;
  /** Answered, and nothing supported one. */
  readonly falseNegative: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  /** Every case where the system asserted something the corpus does not support. */
  readonly unsupported: readonly Scored[];
}

/**
 * Abstention is the positive class.
 *
 * A system that answers everything scores well on accuracy over the questions
 * that have answers, and is useless, because a confident wrong answer costs
 * more than a missing one. Making abstention the thing being detected is what
 * puts that failure in the headline instead of averaging it away.
 */
export function scoreAll(scored: readonly Scored[]): Metrics {
  const byVerdict = new Map<Verdict, number>(VERDICTS.map((verdict) => [verdict, 0]));
  const byKind = new Map<ThreadKind, { total: number; correct: number }>();

  for (const item of scored) {
    byVerdict.set(item.verdict, (byVerdict.get(item.verdict) ?? 0) + 1);
    const kind = byKind.get(item.question.kind) ?? { total: 0, correct: 0 };
    kind.total += 1;
    if (item.verdict === 'correct') kind.correct += 1;
    byKind.set(item.question.kind, kind);
  }

  const shouldAbstain = scored.filter((item) => item.question.expected.type === 'abstain');
  const truePositive = shouldAbstain.filter((item) => item.outcome.type === 'abstain').length;
  const falseNegative = shouldAbstain.length - truePositive;
  const falsePositive = scored.filter(
    (item) => item.question.expected.type === 'answer' && item.outcome.type === 'abstain',
  ).length;

  const precision =
    truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
  const recall =
    truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return {
    total: scored.length,
    correct: byVerdict.get('correct') ?? 0,
    byVerdict,
    byKind,
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
    f1,
    unsupported: scored.filter(
      (item) => item.verdict === 'false_answer' || item.verdict === 'wrong_answer_text',
    ),
  };
}

export function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Nearest rank, no interpolation, so every printed number is an observation that happened. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  // Clamped at both ends: p0 has rank zero, and reading position -1 would hand
  // back undefined as a number. The harness only ever asks for p50 and p95, so
  // this changes no reported figure, it removes a way to get a wrong one.
  const rank = Math.max(1, Math.min(Math.ceil((p / 100) * sorted.length), sorted.length));
  return sorted[rank - 1]!;
}
