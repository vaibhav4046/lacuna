import { describe, expect, it } from 'vitest';

import type { Answer, QueryTrace } from '../../src/retrieval/index.js';
import { comparableAnswer } from '../../src/snapshot/compare.js';

/**
 * The verifier's equality. What it must ignore is exactly the two figures
 * that measure the run — wall-clock ms and the read epoch — and the
 * completion order of parallel reads. What it must never ignore is content:
 * the verdict, the value, the rows a query returned. The regression this
 * file pins: a node that has been ingested into after the snapshot was
 * exported reports a later read epoch on every query, and the verifier used
 * to fail all sixty questions on that alone.
 */

function trace(overrides: Partial<QueryTrace> = {}): QueryTrace {
  return {
    cypher: 'MATCH (e:Entity {name: $name}) RETURN id(e) AS id, e.kind AS kind',
    request: 'MATCH (e:Entity {name: $name}) RETURN id(e) AS id, e.kind AS kind',
    parameters: { name: 'Bellwether' },
    rows: 1,
    ms: 3.2,
    readEpoch: 6459,
    ...overrides,
  };
}

function answer(overrides: Partial<Answer> = {}): Answer {
  return {
    question: { subject: 'Bellwether', predicate: 'beta_partner', via: null },
    subject: {
      name: 'Bellwether',
      id: 41,
      kind: 'project',
      claims: [],
      mentions: [],
    },
    bridge: null,
    resolution: {
      outcome: { type: 'answer', claimId: 7, text: 'Halverd' },
      explanation: 'This replaced 2 earlier values and nothing has superseded it.',
      considered: [],
      hop: null,
      trace: [],
    },
    evidence: [],
    queries: [trace()],
    ms: 12.5,
    ...overrides,
  };
}

describe('comparableAnswer', () => {
  it('holds two identical answers equal', () => {
    expect(comparableAnswer(answer())).toBe(comparableAnswer(answer()));
  });

  it('ignores wall-clock ms on the answer and on every query', () => {
    const fast = answer({ ms: 1.1, queries: [trace({ ms: 0.4 })] });
    const slow = answer({ ms: 480.9, queries: [trace({ ms: 302.6 })] });
    expect(comparableAnswer(fast)).toBe(comparableAnswer(slow));
  });

  it('ignores the read epoch, which any later write advances', () => {
    const atExport = answer({ queries: [trace({ readEpoch: 6459 })] });
    const afterIngest = answer({ queries: [trace({ readEpoch: 17871 })] });
    expect(comparableAnswer(atExport)).toBe(comparableAnswer(afterIngest));
  });

  it('ignores an epoch the node did not report at all', () => {
    const reported = answer({ queries: [trace({ readEpoch: 6459 })] });
    const unreported = answer({ queries: [trace({ readEpoch: null })] });
    expect(comparableAnswer(reported)).toBe(comparableAnswer(unreported));
  });

  it('ignores the completion order of parallel reads', () => {
    const claims = trace({ cypher: 'MATCH (c:Claim) RETURN c', rows: 3 });
    const mentions = trace({ cypher: 'MATCH (m:Mention) RETURN m', rows: 2 });
    const oneOrder = answer({ queries: [claims, mentions] });
    const otherOrder = answer({ queries: [mentions, claims] });
    expect(comparableAnswer(oneOrder)).toBe(comparableAnswer(otherOrder));
  });

  it('fails on a different value', () => {
    const halverd = answer();
    const millbrace = answer({
      resolution: {
        ...answer().resolution,
        outcome: { type: 'answer', claimId: 5, text: 'Millbrace' },
      },
    });
    expect(comparableAnswer(halverd)).not.toBe(comparableAnswer(millbrace));
  });

  it('fails on a different verdict', () => {
    const answered = answer();
    const abstained = answer({
      resolution: {
        ...answer().resolution,
        outcome: { type: 'abstain', reason: 'never_stated' },
      },
    });
    expect(comparableAnswer(answered)).not.toBe(comparableAnswer(abstained));
  });

  it('fails on a different row count for the same query', () => {
    const oneRow = answer({ queries: [trace({ rows: 1 })] });
    const twoRows = answer({ queries: [trace({ rows: 2 })] });
    expect(comparableAnswer(oneRow)).not.toBe(comparableAnswer(twoRows));
  });

  it('fails on different query parameters', () => {
    const bellwether = answer();
    const meridian = answer({ queries: [trace({ parameters: { name: 'Meridian' } })] });
    expect(comparableAnswer(bellwether)).not.toBe(comparableAnswer(meridian));
  });
});
