import { describe, expect, it } from 'vitest';

import {
  describeExpected,
  describeOutcome,
  judge,
  percent,
  percentile,
  scoreAll,
  VERDICTS,
  type Scored,
} from '../../src/bench/score';
import type { BenchOutcome } from '../../src/bench/types';
import type { ExpectedAnswer } from '../../src/corpus/types';
import type { AbstentionReason } from '../../src/model/abstention';
import { question } from '../support/bench-fixtures';

/**
 * The scorer both the evaluation and the comparison run through.
 *
 * This is the file that decides what the headline number means, so the cases
 * here are about definitions rather than arithmetic: which failures are counted
 * separately because they cost different amounts, and what abstention precision
 * and recall are measured over. The tie in the report survives only if this
 * scorer treats every system identically, and nothing here can see which system
 * produced an outcome.
 */

const answered = (text: string): BenchOutcome => ({ type: 'answer', text });
const abstained = (reason: AbstentionReason): BenchOutcome => ({ type: 'abstain', reason });

const expectAnswer: ExpectedAnswer = { type: 'answer', text: 'us-east-1', claimKey: 'claim-1' };
const expectAbstain: ExpectedAnswer = { type: 'abstain', reason: 'never_stated' };

function scored(over: {
  expected: ExpectedAnswer;
  outcome: BenchOutcome;
  kind?: Scored['question']['kind'];
}): Scored {
  const asked = question(
    over.kind === undefined
      ? { expected: over.expected }
      : { expected: over.expected, kind: over.kind },
  );
  return { question: asked, outcome: over.outcome, verdict: judge(over.expected, over.outcome) };
}

describe('judge', () => {
  it('calls an exact answer correct', () => {
    expect(judge(expectAnswer, answered('us-east-1'))).toBe('correct');
  });

  it('separates the wrong answer from no answer', () => {
    // Both are failures on a question that had an answer, and they do not cost
    // the same, so they are never added together.
    expect(judge(expectAnswer, answered('eu-west-1'))).toBe('wrong_answer_text');
    expect(judge(expectAnswer, abstained('never_stated'))).toBe('missed_answer');
  });

  it('calls answering where nothing supports an answer a false answer', () => {
    expect(judge(expectAbstain, answered('us-east-1'))).toBe('false_answer');
  });

  it('calls the matching abstention reason correct', () => {
    expect(judge(expectAbstain, abstained('never_stated'))).toBe('correct');
  });

  it('separates declining for the wrong reason from declining correctly', () => {
    expect(judge(expectAbstain, abstained('out_of_scope'))).toBe('wrong_reason');
  });

  it('is exact about answer text, with no normalisation', () => {
    // A scorer that trimmed or lowercased would be making a judgement call on
    // every question, and the place to argue about that is the corpus.
    expect(judge(expectAnswer, answered('US-EAST-1'))).toBe('wrong_answer_text');
    expect(judge(expectAnswer, answered('us-east-1 '))).toBe('wrong_answer_text');
  });
});

describe('scoreAll', () => {
  /**
   * One correct answer, one miss, one correct abstention, one abstention for
   * the wrong reason, and one false answer. Every verdict except
   * wrong_answer_text, which the last two cases in this block add.
   */
  const sample: Scored[] = [
    scored({ expected: expectAnswer, outcome: answered('us-east-1'), kind: 'stable' }),
    scored({ expected: expectAnswer, outcome: abstained('never_stated'), kind: 'stable' }),
    scored({ expected: expectAbstain, outcome: abstained('never_stated'), kind: 'never_stated' }),
    scored({
      expected: { type: 'abstain', reason: 'retracted' },
      outcome: abstained('contradicted'),
      kind: 'retracted',
    }),
    scored({ expected: expectAbstain, outcome: answered('us-east-1'), kind: 'never_stated' }),
  ];

  it('counts the total and the correct', () => {
    const metrics = scoreAll(sample);

    expect(metrics.total).toBe(5);
    expect(metrics.correct).toBe(2);
  });

  it('counts every verdict, including the ones that did not happen', () => {
    // A report with a missing row reads as a row nobody checked.
    const metrics = scoreAll(sample);

    expect([...metrics.byVerdict.keys()]).toEqual([...VERDICTS]);
    expect(metrics.byVerdict.get('correct')).toBe(2);
    expect(metrics.byVerdict.get('missed_answer')).toBe(1);
    expect(metrics.byVerdict.get('wrong_reason')).toBe(1);
    expect(metrics.byVerdict.get('false_answer')).toBe(1);
    expect(metrics.byVerdict.get('wrong_answer_text')).toBe(0);
  });

  it('breaks the score down by thread kind', () => {
    const metrics = scoreAll(sample);

    expect(metrics.byKind.get('stable')).toEqual({ total: 2, correct: 1 });
    expect(metrics.byKind.get('never_stated')).toEqual({ total: 2, correct: 1 });
    expect(metrics.byKind.get('retracted')).toEqual({ total: 1, correct: 0 });
    expect(metrics.byKind.get('multi_hop')).toBeUndefined();
  });

  it('counts abstention as the positive class', () => {
    const metrics = scoreAll(sample);

    expect(metrics.truePositive).toBe(2);
    expect(metrics.falseNegative).toBe(1);
    expect(metrics.falsePositive).toBe(1);
  });

  it('counts an abstention with the wrong reason as a true positive', () => {
    // Deliberate. Precision and recall here measure whether the system knew to
    // decline. Whether it explained itself correctly is the wrong_reason row,
    // and folding the two together would hide which of them failed.
    const wrongReason = scoreAll([
      scored({
        expected: { type: 'abstain', reason: 'retracted' },
        outcome: abstained('contradicted'),
      }),
    ]);

    expect(wrongReason.truePositive).toBe(1);
    expect(wrongReason.correct).toBe(0);
    expect(wrongReason.f1).toBe(1);
  });

  it('computes precision, recall and f1 over the abstentions', () => {
    const metrics = scoreAll(sample);

    expect(metrics.precision).toBeCloseTo(2 / 3, 10);
    expect(metrics.recall).toBeCloseTo(2 / 3, 10);
    expect(metrics.f1).toBeCloseTo(2 / 3, 10);
  });

  it('collects every case where the system asserted something unsupported', () => {
    const metrics = scoreAll([
      ...sample,
      scored({ expected: expectAnswer, outcome: answered('eu-west-1') }),
    ]);

    expect(metrics.unsupported.map((item) => item.verdict)).toEqual([
      'false_answer',
      'wrong_answer_text',
    ]);
  });

  it('returns zeros rather than NaN when there is nothing to score', () => {
    // Division by zero here would print NaN in a results table, which reads as
    // a broken harness rather than as an empty run.
    const metrics = scoreAll([]);

    expect(metrics.total).toBe(0);
    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
    expect(metrics.unsupported).toEqual([]);
    expect(metrics.byVerdict.get('correct')).toBe(0);
  });

  it('returns zeros when a system answered everything and nothing needed declining', () => {
    const metrics = scoreAll([
      scored({ expected: expectAnswer, outcome: answered('us-east-1') }),
    ]);

    expect(metrics.precision).toBe(0);
    expect(metrics.recall).toBe(0);
    expect(metrics.f1).toBe(0);
    expect(metrics.correct).toBe(1);
  });
});

describe('percent', () => {
  it('prints one decimal place', () => {
    expect(percent(1, 3)).toBe('33.3%');
    expect(percent(1, 4)).toBe('25.0%');
  });

  it('prints n/a rather than a division by zero', () => {
    expect(percent(0, 0)).toBe('n/a');
  });
});

describe('percentile', () => {
  it('takes the nearest rank rather than interpolating between observations', () => {
    // p50 of four values is the second smallest, not the mean of the middle
    // two. Every latency figure in the report is then a run that happened.
    expect(percentile([1, 2, 3, 4], 50)).toBe(2);
  });

  it('sorts before reading, so the input order does not matter', () => {
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it('does not disturb the array it was given', () => {
    const values = [5, 1, 3];
    percentile(values, 50);

    expect(values).toEqual([5, 1, 3]);
  });

  it('reads p95 off a hundred observations', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);

    expect(percentile(values, 95)).toBe(95);
  });

  it('clamps at both ends instead of reading off the array', () => {
    expect(percentile([4, 9, 2], 0)).toBe(2);
    expect(percentile([4, 9, 2], 100)).toBe(9);
  });

  it('returns zero for no observations', () => {
    expect(percentile([], 50)).toBe(0);
  });
});

describe('descriptions', () => {
  it('says what was expected in the same words as what happened', () => {
    // The failure lines in the report put these two side by side, so a
    // difference in phrasing reads as a difference in kind.
    expect(describeExpected(question({ expected: expectAnswer }))).toBe('answer "us-east-1"');
    expect(describeOutcome(answered('us-east-1'))).toBe('answer "us-east-1"');
    expect(describeExpected(question({ expected: expectAbstain }))).toBe('abstain never_stated');
    expect(describeOutcome(abstained('never_stated'))).toBe('abstain never_stated');
  });
});
