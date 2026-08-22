import type { CorpusEntity, CorpusStats, Message, Session } from '../../src/corpus/types.js';
import { annotationsByTurn, entitiesOf } from '../../src/extract/adapt.js';
import { extractTurns } from '../../src/extract/extract.js';
import type { TurnInput } from '../../src/extract/extract.js';

import type { IngestibleQuestion } from './schema.js';
import { extractPersonalClaims } from './personal.js';

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
 * Lacuna ingests claims and evidence spans, and LongMemEval supplies neither,
 * so they are read out of the prose by `src/extract` on the way through. What
 * comes out is what the extractor could justify from a sentence and a span, not
 * everything a reader would understand, and the gap between those two is the
 * honest limit of this integration. docs/BENCHMARK_LONGMEMEVAL.md states it,
 * along with the second missing half: nothing here turns a natural language
 * question into the structured one `ask` takes.
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

  /**
   * The whole haystack is extracted in one pass, not session by session.
   *
   * Extraction carries state across turns: which spelling of a name was seen
   * first, which value currently stands for a property, and therefore which
   * later statement supersedes an earlier one. That state is per call. Calling
   * once per session throws it away at every session boundary, which is the one
   * boundary this benchmark is built to cross: "sessions are in Postgres" in
   * May and "we migrated sessions to Redis" in June are the knowledge-update
   * ability, and they are never in the same session.
   *
   * Measured, before this was one pass: the two spellings interned separately,
   * so the migration filed against a different subject and superseded nothing.
   */
  const flat: TurnInput[] = [];
  for (let index = 0; index < ids.length; index += 1) {
    const key = ids[index];
    const startedAt = dates[index];
    const session = turns[index];
    if (key === undefined || startedAt === undefined || session === undefined) {
      throw new LongMemEvalAdapterError(`${question.question_id}: haystack hole at ${index}`);
    }
    session.forEach((turn) => {
      // The dataset timestamps sessions, not turns. Every turn in a session
      // therefore carries the session's timestamp, verbatim and unconverted:
      // "2023/05/30 (Tue) 23:40" is not ISO 8601, and a conversion that guesses
      // a timezone would corrupt the axis this benchmark tests hardest.
      flat.push({ speaker: turn.role, role: turn.role, timestamp: startedAt, text: turn.content });
    });
  }

  const first = dates[0] ?? '';
  const extraction = extractTurns(flat, {
    sessionKey: question.question_id,
    title: question.question_id,
    startedAt: first,
  });
  // LongMemEval is predominantly first-person life history, while Lacuna's
  // production extractor is intentionally precision-first for infrastructure
  // prose. Keep the benchmark bridge scoped: infrastructure claims still come
  // from the core extractor, and the personal parser only adds exact-span,
  // explicit first-person facts.
  const personal = extractPersonalClaims(flat, question.question_id);
  const allClaims = [...extraction.claims, ...personal];
  const byTurn = annotationsByTurn({ ...extraction, claims: allClaims });

  const sessions: Session[] = [];
  let characters = 0;
  let messages = 0;
  let global = 0;

  for (let index = 0; index < ids.length; index += 1) {
    const key = ids[index]!;
    const startedAt = dates[index]!;
    const session = turns[index]!;

    const built: Message[] = session.map((turn, local) => {
      characters += turn.content.length;
      messages += 1;
      const made = byTurn.get(global);
      global += 1;
      return {
        key: messageKey(key, local),
        sessionKey: key,
        index: local,
        speaker: turn.role,
        timestamp: startedAt,
        text: turn.content,
        claims: made?.claims ?? [],
        spans: made?.spans ?? [],
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

  const extracted = allClaims;

  const stats: CorpusStats = {
    sessions: sessions.length,
    messages,
    claims: extracted.length,
    characters,
    estimatedTokens: Math.round(characters / CHARS_PER_TOKEN),
  };

  return {
    seed: `longmemeval:${question.question_id}`,
    sessions,
    entities: entitiesOf(extracted),
    stats,
    questions: [],
  };
}
