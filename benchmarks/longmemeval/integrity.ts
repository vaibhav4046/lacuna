import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import type { LongMemEvalRecord } from './schema.js';

/**
 * Byte and question-set identity for the pinned LongMemEval oracle tier.
 *
 * A 500-row hypothesis file is not evidence of an official run by itself: a
 * different 500-row JSON document can have the same shape.  These constants
 * are the acquisition facts recorded in the official evaluation plan and are
 * intentionally checked before any benchmark result is described as official.
 */
export const OFFICIAL_ORACLE = Object.freeze({
  file: 'longmemeval_oracle.json',
  bytes: 15_388_478,
  sha256: '821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c',
  questions: 500,
  sortedQuestionIdsSha256: 'f038965c54b03632f86a59104dd77848b66e3f80c08d5fbabdd3984d16457811',
  datasetRevision: '98d7416c24c778c2fee6e6f3006e7a073259d48f',
} as const);

export class LongMemEvalIntegrityError extends Error {
  override readonly name = 'LongMemEvalIntegrityError';
}

export interface LongMemEvalDatasetIdentity {
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly questions: number;
  readonly sortedQuestionIdsSha256: string;
}

export function sortedQuestionIdsSha256(ids: readonly string[]): string {
  return createHash('sha256').update(`${[...ids].sort().join('\n')}\n`, 'utf8').digest('hex');
}

/** Compute identity without asserting that the input is the official tier. */
export function datasetIdentity(
  path: string,
  records: readonly Pick<LongMemEvalRecord, 'question_id'>[],
): LongMemEvalDatasetIdentity {
  const bytes = statSync(path).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  return {
    file: basename(path),
    bytes,
    sha256,
    questions: records.length,
    sortedQuestionIdsSha256: sortedQuestionIdsSha256(records.map((record) => record.question_id)),
  };
}

/**
 * Fail closed unless both the bytes and the question set are the pinned
 * official oracle tier.  This does not run a judge and does not claim a score.
 */
export function assertOfficialOracleDataset(
  path: string,
  records: readonly Pick<LongMemEvalRecord, 'question_id'>[],
): LongMemEvalDatasetIdentity {
  const identity = datasetIdentity(path, records);
  if (identity.file !== OFFICIAL_ORACLE.file) {
    throw new LongMemEvalIntegrityError(
      `official oracle requires ${OFFICIAL_ORACLE.file}, got ${identity.file}`,
    );
  }
  if (identity.bytes !== OFFICIAL_ORACLE.bytes || identity.sha256 !== OFFICIAL_ORACLE.sha256) {
    throw new LongMemEvalIntegrityError(
      `official oracle bytes/digest mismatch: ${identity.bytes} bytes, ${identity.sha256}`,
    );
  }
  if (identity.questions !== OFFICIAL_ORACLE.questions) {
    throw new LongMemEvalIntegrityError(
      `official oracle requires exactly ${OFFICIAL_ORACLE.questions} questions, got ${identity.questions}`,
    );
  }
  const ids = records.map((record) => record.question_id);
  if (ids.some((id) => id.trim() === '')) {
    throw new LongMemEvalIntegrityError('official oracle contains an empty question_id');
  }
  if (new Set(ids).size !== ids.length) {
    throw new LongMemEvalIntegrityError('official oracle contains duplicate question_id values');
  }
  if (identity.sortedQuestionIdsSha256 !== OFFICIAL_ORACLE.sortedQuestionIdsSha256) {
    throw new LongMemEvalIntegrityError(
      `official oracle question-id set mismatch: ${identity.sortedQuestionIdsSha256}`,
    );
  }
  return identity;
}
