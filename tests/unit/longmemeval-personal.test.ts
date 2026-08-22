import { describe, expect, it } from 'vitest';

import { extractPersonalClaims } from '../../benchmarks/longmemeval/personal.js';

describe('LongMemEval personal-memory extraction', () => {
  it('extracts a first-person degree with an exact evidence span', () => {
    const claims = extractPersonalClaims([
      {
        speaker: 'user',
        role: 'user',
        timestamp: '2023/05/20 (Sat) 02:16',
        text: 'I finally graduated with a Business Administration degree.',
      },
    ], 'degree-fixture');

    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      subject: 'I',
      property: 'degree',
      predicate: 'degree',
      objectText: 'Business Administration',
      mode: 'EXPLICIT_STATE',
      kind: 'assert',
      supersedes: null,
      turnIndex: 0,
    });
    expect(claims[0]?.span.quote).toBe('I finally graduated with a Business Administration degree.');
    expect(claims[0]?.span.start).toBe(0);
  });

  it('accepts the degree-in wording used by the official haystack', () => {
    const claims = extractPersonalClaims([
      {
        speaker: 'user',
        role: 'user',
        timestamp: '2023/05/20 (Sat) 02:16',
        text: 'I graduated with a degree in Computer Science from Berkeley.',
      },
    ], 'degree-in-fixture');

    expect(claims[0]).toMatchObject({ property: 'degree', objectText: 'Computer Science' });
  });

  it('keeps a commute duration when the sentence qualifies the commute', () => {
    const claims = extractPersonalClaims([
      {
        speaker: 'user',
        role: 'user',
        timestamp: '2023/05/20 (Sat) 02:16',
        text: "I've been listening to audiobooks during my daily commute, which takes 45 minutes each way.",
      },
    ], 'commute-fixture');

    expect(claims[0]).toMatchObject({ property: 'commute_duration', objectText: '45 minutes each way' });
  });

  it('supersedes a previous first-person value only for an explicit update', () => {
    const claims = extractPersonalClaims([
      {
        speaker: 'user',
        role: 'user',
        timestamp: '2023/05/20 (Sat) 02:16',
        text: 'My previous occupation was a teacher.',
      },
      {
        speaker: 'user',
        role: 'user',
        timestamp: '2023/06/20 (Tue) 11:00',
        text: 'My current occupation is a software engineer.',
      },
    ], 'occupation-fixture');

    expect(claims).toHaveLength(2);
    expect(claims[0]?.objectText).toBe('teacher');
    expect(claims[1]).toMatchObject({
      objectText: 'software engineer',
      kind: 'revise',
      supersedes: claims[0]?.key,
    });
  });
});
