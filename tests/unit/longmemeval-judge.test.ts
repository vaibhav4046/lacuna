import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('refuses to label a partial run as the official 500-instance evaluation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lacuna-longmemeval-judge-'));
    try {
      const dataset = join(dir, 'reference.json');
      const hypotheses = join(dir, 'hypotheses.jsonl');
      writeFileSync(dataset, JSON.stringify([{
        question_id: 'q-1', question_type: 'single-session-user', question: 'Q', answer: 'A',
      }]));
      writeFileSync(hypotheses, JSON.stringify({ question_id: 'q-1', hypothesis: 'A' }) + '\n');

      await expect(runOfficialJudge({
        model: 'gpt-4o-mini',
        apiKey: 'test-key',
        hypothesesPath: hypotheses,
        referencePath: dataset,
        outputPath: join(dir, 'judge.jsonl'),
      })).rejects.toThrow('requires exactly 500 hypotheses');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
