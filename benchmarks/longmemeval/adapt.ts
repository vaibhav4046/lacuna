import type { CorpusEntity, CorpusStats, Message, Session } from '../../src/corpus/types.js';

import type { IngestibleQuestion } from './schema.js';

/**
 * One question's haystack, turned into the raw timestamped sessions ingestion
 * reads.
 *
 * The parameter type is the reason this file is short. `IngestibleQuestion`
 * has no `answer`, no `answer_session_ids` and no turn level `has_answer`, so
 * there is no field here to accidentally forward. The return type says
 * `questions: readonly never[]`, so the value handed to `buildPlan` cannot be
 * given an expected answer either. Both halves are compile time; neither is a
 * convention.
 *
 * What this deliberately does not do is invent structure. Lacuna ingests
 * claims and evidence spans, and LongMemEval supplies neither, so `claims` and
 * `spans` come out empty and `entities` comes out empty. A graph built from
 * this holds sessions and messages and nothing to resolve. That is the honest
 * state of the integration and docs/BENCHMARK_LONGMEMEVAL.md says so under
 * "What a real run still needs". Filling those arrays with guesses would turn
 * a known gap into an unknown one.
 */

export class LongMemEvalAdapterError extends Error {
  override readonly name = 'LongMemEvalAdapterError';
}

/**
 * Assignable to `Corpus`, and narrower on the one field that matters.
 *
 * `readonly never[]` has exactly one inhabitant, the empty array. A future
 * edit that tries to carry the gold answer through here does not compile.
 */
export interface AdaptedHaystack {
  readonly seed: string;
  readonly sessions: readonly Session[];
  readonly entities: readonly CorpusEntity[];
  readonly stats: CorpusStats;
  readonly questions: readonly never[];
}

/** Characters per token. The same estimate the rest of the repository uses. */
const CHARS_PER_TOKEN = 4;

/**
 * The message key convention the official retrieval evaluation uses:
 * `sess_id + '_' + str(i_turn+1)`. Matching it means a hypothesis can be traced
 * back to a turn without a second mapping table.
 */
export function messageKey(sessionId: string, turnIndex: number): string {
  return `${sessionId}_${turnIndex + 1}`;
}

export function adaptHaystack(question: IngestibleQuestion): AdaptedHaystack {
  const { haystack_session_ids: ids, haystack_dates: dates, haystack_sessions: turns } = question;

  if (ids.length !== dates.length || ids.length !== turns.length) {
    throw new LongMemEvalAdapterError(
      `${question.question_id}: haystack arrays disagree, ${ids.length} ids, `
      + `${dates.length} dates, ${turns.length} sessions`,
    );
  }

  const sessions: Session[] = [];
  let characters = 0;
  let messages = 0;

  for (let index = 0; index < ids.length; index += 1) {
    const key = ids[index];
    const startedAt = dates[index];
    const session = turns[index];
    if (key === undefined || startedAt === undefined || session === undefined) {
      throw new LongMemEvalAdapterError(`${question.question_id}: haystack hole at ${index}`);
    }

    const built: Message[] = session.map((turn, turnIndex) => {
      characters += turn.content.length;
      messages += 1;
      return {
        key: messageKey(key, turnIndex),
        sessionKey: key,
        index: turnIndex,
        speaker: turn.role,
        // The dataset timestamps sessions, not turns. Every turn in a session
        // therefore carries the session's timestamp, verbatim and unconverted:
        // "2023/05/30 (Tue) 23:40" is not ISO 8601, and a conversion that
        // guesses a timezone would corrupt the axis this benchmark tests
        // hardest.
        timestamp: startedAt,
        text: turn.content,
        claims: [],
        spans: [],
      };
    });

    sessions.push({
      // Preserved verbatim. Note that an official evidence session id contains
      // the substring "answer", so the ids themselves carry a weak ground truth
      // signal. Lacuna never reads a session key to decide anything, but a
      // retriever that scored on identifiers would be cheating.
      key,
      title: key,
      startedAt,
      messages: built,
    });
  }

  const stats: CorpusStats = {
    sessions: sessions.length,
    messages,
    claims: 0,
    characters,
    estimatedTokens: Math.round(characters / CHARS_PER_TOKEN),
  };

  return {
    seed: `longmemeval:${question.question_id}`,
    sessions,
    entities: [],
    stats,
    questions: [],
  };
}
