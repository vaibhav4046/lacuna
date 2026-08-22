import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertOfficialOracleDataset,
  datasetIdentity,
  LongMemEvalIntegrityError,
  sortedQuestionIdsSha256,
} from '../../benchmarks/longmemeval/integrity.js';

describe('LongMemEval oracle identity gate', () => {
  it('hashes the canonical sorted question-id stream', () => {
    expect(sortedQuestionIdsSha256(['b', 'a', 'c'])).toBe(
      sortedQuestionIdsSha256(['c', 'b', 'a']),
    );
    expect(sortedQuestionIdsSha256(['a'])).not.toBe(sortedQuestionIdsSha256(['a', 'a']));
  });

  it('reports bytes and question-set identity without claiming a score', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-longmemeval-integrity-'));
    try {
      const path = join(directory, 'fixture.json');
      writeFileSync(path, '[{"question_id":"q-1"}]\n', 'utf8');
      expect(datasetIdentity(path, [{ question_id: 'q-1' }])).toMatchObject({
        file: 'fixture.json',
        bytes: 24,
        questions: 1,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects a partial or renamed dataset before an official run', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-longmemeval-integrity-'));
    try {
      const path = join(directory, 'fixture.json');
      writeFileSync(path, '[{"question_id":"q-1"}]\n', 'utf8');
      expect(() => assertOfficialOracleDataset(path, [{ question_id: 'q-1' }])).toThrow(
        LongMemEvalIntegrityError,
      );
      expect(() => assertOfficialOracleDataset(path, [{ question_id: 'q-1' }])).toThrow(
        'longmemeval_oracle.json',
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects duplicate ids even when a caller supplies an otherwise large file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lacuna-longmemeval-integrity-'));
    try {
      const path = join(directory, 'longmemeval_oracle.json');
      writeFileSync(path, 'not-the-official-dataset', 'utf8');
      const records = Array.from({ length: 500 }, () => ({ question_id: 'duplicate' }));
      expect(() => assertOfficialOracleDataset(path, records)).toThrow(/bytes\/digest mismatch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
