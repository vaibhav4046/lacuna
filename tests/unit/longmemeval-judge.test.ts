import { describe, expect, it } from 'vitest';

import {
  buildJudgePrompt,
  parseJudgeLabel,
  runOfficialJudge,
  supportedJudgeModel,
} from '../../benchmarks/longmemeval/judge.js';

describe('official LongMemEval judge contract', () => {
  it('matches the official task-specific prompt branches', () => {
    expect(buildJudgePrompt('single-session-user', 'Q', 'A', 'R', false)).toContain('Correct Answer: A');
    expect(buildJudgePrompt('temporal-reasoning', 'Q', 'A', 'R', false)).toContain('off-by-one errors');
    expect(buildJudgePrompt('knowledge-update', 'Q', 'A', 'R', false)).toContain('updated answer');
    expect(buildJudgePrompt('single-session-preference', 'Q', 'A', 'R', false)).toContain('Rubric: A');
    expect(buildJudgePrompt('single-session-user', 'Q', 'A', 'R', true)).toContain('unanswerable question');
  });

  it('accepts only the official model names and keeps the yes/no label boundary', () => {
    expect(supportedJudgeModel('gpt-4o')).toBe('gpt-4o-2024-08-06');
    expect(supportedJudgeModel('gpt-4o-mini')).toBe('gpt-4o-mini-2024-07-18');
    expect(supportedJudgeModel('llama-3.1-70b-instruct')).toBe('meta-llama/Meta-Llama-3.1-70B-Instruct');
    expect(() => supportedJudgeModel('other')).toThrow('unsupported judge model');
    expect(parseJudgeLabel('yes')).toBe(true);
    expect(parseJudgeLabel('NO')).toBe(false);
    expect(parseJudgeLabel('The answer is yes.')).toBe(true);
  });

  it('fails closed before reading data when the paid judge key is absent', async () => {
    await expect(runOfficialJudge({
      model: 'gpt-4o-mini',
      apiKey: '   ',
      hypothesesPath: 'missing.jsonl',
      referencePath: 'missing.json',
      outputPath: 'artifacts/longmemeval/test/judge.jsonl',
    })).rejects.toThrow('OPENAI_API_KEY is required');
  });
});
