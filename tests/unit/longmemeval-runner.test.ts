import { describe, expect, it } from 'vitest';

import { createDeterministicAnswerer } from '../../benchmarks/longmemeval/answerer.js';
import type { IngestibleQuestion } from '../../benchmarks/longmemeval/schema.js';
import type { HydraSource } from '../../src/hydra/source.js';

const QUESTION: IngestibleQuestion = {
  question_id: 'sut-1',
  question_type: 'single-session-user',
  question: 'What degree did I graduate with?',
  question_date: '2023/05/30 (Tue) 23:40',
  haystack_session_ids: ['session-1'],
  haystack_dates: ['2023/05/20 (Sat) 02:16'],
  haystack_sessions: [[{ role: 'user', content: 'I graduated with a Business Administration degree.' }]],
};

function unavailable(): HydraSource {
  return {
    kind: 'node',
    subjects: async () => { throw new Error('store unavailable'); },
    entity: async () => ({ value: null, traces: [] }),
    subject: async () => ({ value: { name: '', id: null, kind: null, claims: [], mentions: [] }, traces: [] }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
  };
}

describe('LongMemEval answerer', () => {
  it('produces a truthful abstention when the store cannot answer', async () => {
    const answer = await createDeterministicAnswerer(1).answer(QUESTION, unavailable());
    expect(answer).toBe('I do not have enough evidence in this memory to answer that.');
  });
});
