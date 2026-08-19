import { existsSync, readFileSync } from 'node:fs';

import {
  isQuestionType,
  type HaystackTurn,
  type IngestibleQuestion,
  type IngestibleTurn,
  type LongMemEvalRecord,
} from './schema.js';

/**
 * Reading the official dataset, and the one place ground truth is removed.
 *
 * Two jobs, and they are in one file because they are the same boundary. This
 * is where untrusted JSON from a download becomes typed values, so the
 * validation is thorough rather than a cast, and it is where the answer stops
 * being visible, so the strip is a rebuild rather than a delete.
 *
 * Nothing here invents. A missing file throws with the download command in the
 * message. A malformed record throws naming the index and the field. There is
 * no default, no placeholder and no partial load.
 */

export class LongMemEvalDatasetError extends Error {
  override readonly name = 'LongMemEvalDatasetError';
}

const DOWNLOAD_BASE = 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main';

/** The three official files, smallest first. */
export const DATASET_FILES = [
  'longmemeval_oracle.json',
  'longmemeval_s_cleaned.json',
  'longmemeval_m_cleaned.json',
] as const;

function missingDatasetMessage(path: string): string {
  return [
    `No LongMemEval dataset at ${path}.`,
    'This benchmark does not ship the dataset and will not fabricate one. Download it:',
    ...DATASET_FILES.map((file) => `  wget ${DOWNLOAD_BASE}/${file}`),
    'longmemeval_m_cleaned.json is 2.74 GB and cannot be read by this loader.',
    'See docs/BENCHMARK_LONGMEMEVAL.md.',
  ].join('\n');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(record: Record<string, unknown>, field: string, where: string): string {
  const value = record[field];
  if (typeof value !== 'string') {
    throw new LongMemEvalDatasetError(`${where}: ${field} is ${typeof value}, expected string`);
  }
  return value;
}

function requireStringArray(
  record: Record<string, unknown>,
  field: string,
  where: string,
): readonly string[] {
  const value = record[field];
  if (!Array.isArray(value)) {
    throw new LongMemEvalDatasetError(`${where}: ${field} is not an array`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string') {
      throw new LongMemEvalDatasetError(`${where}: ${field}[${index}] is not a string`);
    }
    return item;
  });
}

function parseTurn(value: unknown, where: string): HaystackTurn {
  if (!isObject(value)) {
    throw new LongMemEvalDatasetError(`${where}: turn is not an object`);
  }
  const role = requireString(value, 'role', where);
  if (role !== 'user' && role !== 'assistant') {
    throw new LongMemEvalDatasetError(`${where}: role is "${role}", expected user or assistant`);
  }
  const content = requireString(value, 'content', where);
  const hasAnswer = value['has_answer'];
  if (hasAnswer !== undefined && typeof hasAnswer !== 'boolean') {
    // The official retrieval code asserts the same thing before trusting it.
    throw new LongMemEvalDatasetError(`${where}: has_answer is ${typeof hasAnswer}, expected boolean`);
  }
  return hasAnswer === undefined ? { role, content } : { role, content, has_answer: hasAnswer };
}

export function parseRecord(value: unknown, where: string): LongMemEvalRecord {
  if (!isObject(value)) {
    throw new LongMemEvalDatasetError(`${where}: record is not an object`);
  }

  const questionType = value['question_type'];
  if (!isQuestionType(questionType)) {
    throw new LongMemEvalDatasetError(
      `${where}: question_type is ${JSON.stringify(questionType)}, which is not an official type`,
    );
  }

  const sessions = value['haystack_sessions'];
  if (!Array.isArray(sessions)) {
    throw new LongMemEvalDatasetError(`${where}: haystack_sessions is not an array`);
  }

  const ids = requireStringArray(value, 'haystack_session_ids', where);
  const dates = requireStringArray(value, 'haystack_dates', where);
  if (ids.length !== sessions.length || dates.length !== sessions.length) {
    // The official code zips the three, so a length mismatch would silently
    // truncate the haystack rather than fail.
    throw new LongMemEvalDatasetError(
      `${where}: haystack arrays disagree, ${ids.length} ids, ${dates.length} dates, `
      + `${sessions.length} sessions`,
    );
  }

  const haystack = sessions.map((session, index) => {
    if (!Array.isArray(session)) {
      throw new LongMemEvalDatasetError(`${where}: haystack_sessions[${index}] is not an array`);
    }
    return session.map((turn, turnIndex) =>
      parseTurn(turn, `${where}: haystack_sessions[${index}][${turnIndex}]`),
    );
  });

  if (!('answer' in value)) {
    throw new LongMemEvalDatasetError(`${where}: answer is missing`);
  }

  return {
    question_id: requireString(value, 'question_id', where),
    question_type: questionType,
    question: requireString(value, 'question', where),
    answer: value['answer'],
    answer_session_ids: requireStringArray(value, 'answer_session_ids', where),
    question_date: requireString(value, 'question_date', where),
    haystack_session_ids: ids,
    haystack_dates: dates,
    haystack_sessions: haystack,
  };
}

/**
 * The only bridge from a record to something the product may see.
 *
 * Rebuilt field by field rather than spread and deleted. A spread would carry
 * whatever the file happened to hold, including fields this integration has
 * never seen, and one of those could be another marker.
 */
export function stripGroundTruth(record: LongMemEvalRecord): IngestibleQuestion {
  const sessions: readonly (readonly IngestibleTurn[])[] = record.haystack_sessions.map((session) =>
    session.map((turn): IngestibleTurn => ({ role: turn.role, content: turn.content })),
  );

  return {
    question_id: record.question_id,
    question_type: record.question_type,
    question: record.question,
    question_date: record.question_date,
    haystack_session_ids: record.haystack_session_ids,
    haystack_dates: record.haystack_dates,
    haystack_sessions: sessions,
  };
}

/** Every record in a dataset file, validated. Ground truth still attached. */
export function loadDataset(path: string): readonly LongMemEvalRecord[] {
  if (!existsSync(path)) {
    throw new LongMemEvalDatasetError(missingDatasetMessage(path));
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new LongMemEvalDatasetError(
      `${path} is not readable as JSON: ${cause instanceof Error ? cause.message : String(cause)}. `
      + 'longmemeval_m_cleaned.json is 2.74 GB and is past what JSON.parse can hold.',
      { cause },
    );
  }

  if (!Array.isArray(parsed)) {
    throw new LongMemEvalDatasetError(`${path} is not a JSON array of evaluation instances`);
  }
  if (parsed.length === 0) {
    throw new LongMemEvalDatasetError(`${path} holds no evaluation instances`);
  }

  return parsed.map((record, index) => parseRecord(record, `${path}[${index}]`));
}

/** Every record, with the answers removed. What a run is allowed to load. */
export function loadIngestible(path: string): readonly IngestibleQuestion[] {
  return loadDataset(path).map(stripGroundTruth);
}
