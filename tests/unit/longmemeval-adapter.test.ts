import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { adaptHaystack, messageKey } from '../../benchmarks/longmemeval/adapt.js';
import {
  BENCHMARK_LINKS,
  datasetProvenance,
  environment,
  KNOWN_LIMITATIONS,
  lacunaCommit,
  writeRunArtifact,
  type RunArtifact,
} from '../../benchmarks/longmemeval/artifact.js';
import { LongMemEvalDatasetError, parseRecord, stripGroundTruth } from '../../benchmarks/longmemeval/load.js';
import {
  abilityOf,
  isAbstention,
  QUESTION_TYPES,
  serialiseHypotheses,
  type LongMemEvalRecord,
} from '../../benchmarks/longmemeval/schema.js';
import { buildPlan } from '../../src/ingest/plan.js';
import type { Corpus } from '../../src/corpus/types.js';

/**
 * What the LongMemEval integration has to get right before a number from it
 * would mean anything.
 *
 * The fixtures are handwritten in the official schema rather than sampled from
 * the dataset, because the dataset is not committed and a test that needs a
 * 15 MB download is a test that gets skipped. They carry the two things that
 * make the schema awkward: a turn level `has_answer` marker, and a session id
 * whose text says which session holds the evidence.
 *
 * The leakage assertions are the point of the file. Two of them are structural
 * in the type system and would fail as compile errors rather than as failed
 * expectations, so they are written as type annotations here and noted where
 * they appear. The rest check the runtime shape, because a type is not a
 * guarantee about a value that came out of `JSON.parse`.
 */

/**
 * One instance in the official format. `answer`, `answer_session_ids` and the
 * `has_answer` flags are the ground truth, and no assertion below may find any
 * of them past the strip.
 */
const RECORD: LongMemEvalRecord = {
  question_id: 'e47becba',
  question_type: 'single-session-user',
  question: 'What degree did I graduate with?',
  answer: 'Business Administration',
  answer_session_ids: ['answer_280352e9'],
  question_date: '2023/05/30 (Tue) 23:40',
  haystack_session_ids: ['1f0e3dad', 'answer_280352e9'],
  haystack_dates: ['2023/04/02 (Sun) 09:14', '2023/05/20 (Sat) 02:16'],
  haystack_sessions: [
    [
      { role: 'user', content: 'Any tips for repotting a monstera?' },
      { role: 'assistant', content: 'Go one pot size up and keep the aerial roots above the soil.' },
    ],
    [
      { role: 'user', content: 'I finally graduated with a Business Administration degree.', has_answer: true },
      { role: 'assistant', content: 'Congratulations, that is a real milestone.' },
    ],
  ],
};

const ABSTENTION: LongMemEvalRecord = {
  ...RECORD,
  question_id: 'e47becba_abs',
  question: 'What did my sister say about her new job?',
  answer: 'The user never mentioned a sister.',
  answer_session_ids: [],
};

describe('the sessions and their timestamps survive the adapter', () => {
  it('keeps every session, in order, under its official id', () => {
    const adapted = adaptHaystack(stripGroundTruth(RECORD));
    expect(adapted.sessions.map((session) => session.key)).toEqual(['1f0e3dad', 'answer_280352e9']);
  });

  it('keeps the session timestamps byte for byte, unconverted', () => {
    // "2023/05/20 (Sat) 02:16" is not ISO 8601. Parsing it would mean guessing
    // a timezone, and the guess would land on the axis this benchmark tests
    // hardest, so the adapter is required not to try.
    const adapted = adaptHaystack(stripGroundTruth(RECORD));
    expect(adapted.sessions.map((session) => session.startedAt)).toEqual(RECORD.haystack_dates);
  });

  it('keeps every turn, its role and its text, and stamps it with its session time', () => {
    const adapted = adaptHaystack(stripGroundTruth(RECORD));
    const evidence = adapted.sessions[1]!;
    expect(evidence.messages.map((message) => [message.speaker, message.text])).toEqual([
      ['user', 'I finally graduated with a Business Administration degree.'],
      ['assistant', 'Congratulations, that is a real milestone.'],
    ]);
    // The dataset timestamps sessions, not turns.
    expect(evidence.messages.every((message) => message.timestamp === '2023/05/20 (Sat) 02:16')).toBe(true);
  });

  it('keys messages the way the official retrieval evaluation does', () => {
    // sess_id + '_' + str(i_turn+1), from src/retrieval/run_retrieval.py.
    expect(messageKey('answer_280352e9', 0)).toBe('answer_280352e9_1');
    const adapted = adaptHaystack(stripGroundTruth(RECORD));
    expect(adapted.sessions[1]!.messages.map((message) => message.key)).toEqual([
      'answer_280352e9_1',
      'answer_280352e9_2',
    ]);
  });

  it('counts what it carried rather than asserting it', () => {
    const adapted = adaptHaystack(stripGroundTruth(RECORD));
    const characters = RECORD.haystack_sessions
      .flat()
      .reduce((total, turn) => total + turn.content.length, 0);
    expect(adapted.stats).toEqual({
      sessions: 2,
      messages: 4,
      // No extractor exists, so there are no claims. Saying zero is the honest
      // report; a nonzero count here would mean something invented them.
      claims: 0,
      characters,
      estimatedTokens: Math.round(characters / 4),
    });
  });
});

describe('the answer cannot reach the ingestion shape', () => {
  it('drops the answer and the evidence session ids at the strip', () => {
    const stripped = stripGroundTruth(RECORD);
    expect(Object.keys(stripped).sort()).toEqual([
      'haystack_dates',
      'haystack_session_ids',
      'haystack_sessions',
      'question',
      'question_date',
      'question_id',
      'question_type',
    ]);
    // Structural, not incidental: `IngestibleQuestion` is `LongMemEvalRecord`
    // with those fields Omit-ed, so `stripped.answer` does not compile.
    expect('answer' in stripped).toBe(false);
    expect('answer_session_ids' in stripped).toBe(false);
  });

  it('drops the turn level has_answer marker, key and all', () => {
    const stripped = stripGroundTruth(RECORD);
    const turns = stripped.haystack_sessions.flat();
    expect(turns).toHaveLength(4);
    // The record it came from does carry one, so this is testing the strip
    // rather than testing a fixture that never had the field.
    expect(RECORD.haystack_sessions.flat().some((turn) => turn.has_answer === true)).toBe(true);
    expect(turns.every((turn) => !('has_answer' in turn))).toBe(true);
  });

  it('names no part of the answer anywhere in what gets ingested', () => {
    const serialised = JSON.stringify(adaptHaystack(stripGroundTruth(RECORD)));
    expect(serialised).not.toContain('has_answer');
    expect(serialised).not.toContain('answer_session_ids');
    // The evidence sentence is in the transcript and must stay there. What must
    // not appear is a field saying that sentence is the answer.
    expect(serialised).toContain('Business Administration degree');
  });

  it('hands ingestion a value that has nowhere to put an expected answer', () => {
    // The compile time half of the claim. `AdaptedHaystack.questions` is typed
    // `readonly never[]`, whose only inhabitant is the empty array, and the
    // annotation below is what proves the value is still ingestible.
    const corpus: Corpus = adaptHaystack(stripGroundTruth(RECORD));
    expect(corpus.questions).toEqual([]);
    expect(JSON.stringify(buildPlan(corpus))).not.toContain('expected');
  });

  it('plans a graph of sessions and messages and no claims', () => {
    // Honest consequence of having no extractor: the graph this produces has
    // nothing for the resolver to resolve. Pinned so that changes.
    const counts = buildPlan(adaptHaystack(stripGroundTruth(RECORD))).counts;
    expect(counts.vertices.Session).toBe(2);
    expect(counts.vertices.Message).toBe(4);
    expect(counts.vertices.Claim).toBe(0);
    expect(counts.vertices.Entity).toBe(0);
  });
});

describe('question types map onto the ability taxonomy', () => {
  it('maps the five confirmed types to their abilities', () => {
    expect(abilityOf('single-session-user')).toBe('information_extraction');
    expect(abilityOf('single-session-assistant')).toBe('information_extraction');
    expect(abilityOf('multi-session')).toBe('multi_session_reasoning');
    expect(abilityOf('knowledge-update')).toBe('knowledge_updates');
    expect(abilityOf('temporal-reasoning')).toBe('temporal_reasoning');
  });

  it('gives single-session-preference its own bucket rather than a guess', () => {
    // Which of the five headline abilities this rolls up to could not be
    // confirmed. See docs/BENCHMARK_LONGMEMEVAL.md.
    expect(abilityOf('single-session-preference')).toBe('preference');
  });

  it('has an ability for every official type and no type outside the six', () => {
    expect([...QUESTION_TYPES]).toEqual([
      'single-session-user',
      'single-session-assistant',
      'single-session-preference',
      'multi-session',
      'temporal-reasoning',
      'knowledge-update',
    ]);
    for (const type of QUESTION_TYPES) {
      expect(abilityOf(type)).toBeTypeOf('string');
    }
  });
});

describe('an abstention question is carried through as one', () => {
  it('is detected by the substring the official scripts use', () => {
    // `'_abs' in entry['question_id']`, which is containment rather than a
    // suffix test. Matching the official rule matters more than matching the
    // shape of the ids.
    expect(isAbstention(ABSTENTION.question_id)).toBe(true);
    expect(isAbstention(RECORD.question_id)).toBe(false);
    expect(isAbstention('abc_abs_2')).toBe(true);
  });

  it('survives the strip and the adapter with its id and its type intact', () => {
    const stripped = stripGroundTruth(ABSTENTION);
    expect(stripped.question_id).toBe('e47becba_abs');
    expect(isAbstention(stripped.question_id)).toBe(true);
    // Abstention is orthogonal to type, not a seventh value of it.
    expect(stripped.question_type).toBe('single-session-user');
    expect(abilityOf(stripped.question_type)).toBe('information_extraction');
    expect(adaptHaystack(stripped).seed).toBe('longmemeval:e47becba_abs');
  });

  it('carries no trace of what the abstention question was hiding', () => {
    const stripped = stripGroundTruth(ABSTENTION);
    expect(JSON.stringify(stripped)).not.toContain('never mentioned a sister');
  });
});

describe('the loader refuses malformed input rather than guessing', () => {
  const where = 'fixture[0]';

  it('rejects a question_type that is not official', () => {
    expect(() => parseRecord({ ...RECORD, question_type: 'vibes' }, where)).toThrow(
      LongMemEvalDatasetError,
    );
  });

  it('rejects haystack arrays that disagree in length', () => {
    // The official code zips the three, so a mismatch here would silently
    // truncate the haystack instead of failing.
    expect(() =>
      parseRecord({ ...RECORD, haystack_dates: ['2023/04/02 (Sun) 09:14'] }, where),
    ).toThrow(/haystack arrays disagree/);
  });

  it('rejects a has_answer that is not a boolean, as the official code asserts', () => {
    expect(() =>
      parseRecord(
        { ...RECORD, haystack_sessions: [[{ role: 'user', content: 'x', has_answer: 'yes' }]], haystack_session_ids: ['a'], haystack_dates: ['b'] },
        where,
      ),
    ).toThrow(/has_answer/);
  });

  it('accepts a well formed record and keeps the fields it was given', () => {
    expect(parseRecord(JSON.parse(JSON.stringify(RECORD)), where)).toEqual(RECORD);
  });
});

describe('a run records enough about itself to be repeated', () => {
  it('writes a run.json naming the dataset by digest, the commit and the gaps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lacuna-lme-'));
    const dataset = join(dir, 'fixture.json');
    writeFileSync(dataset, JSON.stringify([RECORD]), 'utf8');

    const artifact: RunArtifact = {
      benchmark: { ...BENCHMARK_LINKS, tier: dataset },
      dataset: datasetProvenance(dataset, 1),
      lacunaCommit: lacunaCommit(),
      ranAt: new Date().toISOString(),
      environment: environment(),
      hydra: 'HydraDB node, namespace test, graph default',
      // Null because nothing answered. An artifact that named a model here
      // without one having run would be the exact lie this file guards.
      answerModel: null,
      config: { limit: 1, profile: 'node' },
      questionsAttempted: 1,
      hypothesesWritten: 0,
      hypothesisFile: null,
      limitations: KNOWN_LIMITATIONS,
    };

    const written = JSON.parse(readFileSync(writeRunArtifact(dir, artifact), 'utf8'));
    expect(written.dataset.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(written.dataset.bytes).toBe(statSync(dataset).size);
    expect(written.benchmark.repository).toBe('https://github.com/xiaowu0162/LongMemEval');
    expect(written.answerModel).toBeNull();
    expect(written.hypothesesWritten).toBe(0);
    expect(written.limitations.length).toBeGreaterThan(0);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('hypotheses come out in the official format', () => {
  it('writes one JSON object per line with exactly two fields', () => {
    const text = serialiseHypotheses([
      { question_id: 'e47becba', hypothesis: 'Business Administration' },
      { question_id: 'e47becba_abs', hypothesis: 'I do not have that information.' },
    ]);
    expect(text).toBe(
      '{"question_id":"e47becba","hypothesis":"Business Administration"}\n'
      + '{"question_id":"e47becba_abs","hypothesis":"I do not have that information."}\n',
    );
    for (const line of text.trimEnd().split('\n')) {
      expect(Object.keys(JSON.parse(line))).toEqual(['question_id', 'hypothesis']);
    }
  });

  /**
   * The type says `Omit<..., 'has_answer'>`, and a type is not a barrier.
   * TypeScript only rejects excess properties on object literals, so handing
   * the adapter a full record through a variable compiles cleanly. That was
   * checked, and it does compile. The guarantee is therefore not the type: it
   * is that the adapter enumerates the fields it copies rather than spreading
   * the turn, so ground truth has no path into the output even when it is
   * present on the input.
   *
   * This test hands it the answer bearing record on purpose.
   */
  it('strips ground truth at runtime even when handed the full record', () => {
    const full = {
      ...RECORD,
      haystack_sessions: [[
        { role: 'user', content: 'The decisive turn.', has_answer: true },
      ]],
      haystack_session_ids: ['answer_session_1'],
      haystack_dates: ['2023/05/30 (Tue) 23:40'],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adapted = adaptHaystack(full as any);
    const serialised = JSON.stringify(adapted);

    expect(serialised).not.toContain('has_answer');
    expect(serialised).not.toContain(RECORD.answer as string);
    for (const session of adapted.sessions) {
      for (const message of session.messages) {
        expect(Object.keys(message).sort()).toEqual(
          ['claims', 'index', 'key', 'sessionKey', 'spans', 'speaker', 'text', 'timestamp'],
        );
      }
    }
  });
});
