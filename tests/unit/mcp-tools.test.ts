import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { describe, expect, it } from 'vitest';

import type { HydraConfig } from '../../src/hydra/config';
import {
  askResult,
  describeNode,
  explainResult,
  lastReadEpoch,
  MAX_EVIDENCE_ITEMS,
  type NodeIdentity,
  renderJson,
  timelineResult,
} from '../../src/mcp/result';
import { readQuestion } from '../../src/mcp/server';
import { MAX_TERM_CHARS } from '../../src/retrieval/question';
import type {
  Answer,
  ClaimRecord,
  EvidenceRecord,
  QueryTrace,
  SubjectView,
} from '../../src/retrieval/types';

/**
 * The Answer to MCP result mapping, on made up answers.
 *
 * Nothing here touches a node or a socket. The mapping is the part a client
 * writes code against, so it is worth pinning down on fixtures that can express
 * arrangements the seeded corpus does not happen to contain: an evidence list
 * long enough to hit the cap, a revision chain with two replaced claims, a run
 * where only some reads reported an epoch.
 *
 * The live path is exercised elsewhere. What these tests protect is the promise
 * that a caller can branch on `status` alone, that every number in a result came
 * from the answer rather than from this layer, and that a credential cannot
 * reach a result even by accident.
 */

const NODE: NodeIdentity = { namespace: 'test-namespace', graph: 'default', cell: 'cell-0' };

function claim(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: 1,
    predicate: 'beta_partner',
    objectText: 'Northfold',
    polarity: 'positive',
    validFrom: '2026-01-01T00:00:00.000Z',
    txTime: '2026-01-02T00:00:00.000Z',
    supersededBy: [],
    ...over,
  };
}

function evidence(over: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    claimId: 1,
    spanId: 500,
    quote: 'Northfold is the beta partner.',
    start: 0,
    end: 30,
    messageId: 4_000,
    role: 'user',
    ts: '2026-01-02T09:15:00.000Z',
    sessionId: 12,
    sessionTitle: 'Partner selection',
    ...over,
  };
}

function query(over: Partial<QueryTrace> = {}): QueryTrace {
  return {
    cypher: 'MATCH (e:Entity {name: $name}) RETURN e.id',
    parameters: { name: 'Bellwether' },
    rows: 1,
    ms: 2.4,
    readEpoch: 11,
    ...over,
  };
}

function subject(over: Partial<SubjectView> = {}): SubjectView {
  return { name: 'Bellwether', id: 100, kind: 'project', claims: [], mentions: [], ...over };
}

function answer(over: Partial<Answer> = {}): Answer {
  return {
    question: { subject: 'Bellwether', predicate: 'beta_partner', via: null },
    subject: subject(),
    bridge: null,
    resolution: {
      outcome: { type: 'answer', claimId: 1, text: 'Northfold' },
      explanation: 'Stated once and never contradicted or withdrawn.',
      considered: [claim()],
      hop: null,
      trace: ['Looked up Bellwether.', 'One live claim on beta_partner.'],
    },
    evidence: [evidence()],
    queries: [query()],
    ms: 18.6,
    ...over,
  };
}

describe('askResult, answered', () => {
  it('carries the value, the claim it came from, and no reason code', () => {
    const result = askResult(answer(), NODE);

    expect(result.status).toBe('answered');
    expect(result.answer).toBe('Northfold');
    expect(result.claimId).toBe(1);
    expect(result.reasonCode).toBeNull();
  });

  it('reports the node and the epoch without the address or the token', () => {
    const result = askResult(answer(), NODE);

    expect(result.hydra).toEqual({
      namespace: 'test-namespace',
      graph: 'default',
      cell: 'cell-0',
      readEpoch: 11,
    });
    expect(result.sourceState).toBe('live');
    expect(result.timingMs).toBe(18.6);
  });

  it('passes the queries through with their own measurements', () => {
    const result = askResult(answer({
      queries: [query({ ms: 3.1, rows: 2 }), query({ ms: 9.9, rows: 7 })],
    }), NODE);

    expect(result.queries).toHaveLength(2);
    expect(result.queries.map((item) => item.ms)).toEqual([3.1, 9.9]);
    expect(result.queries[0]?.parameters).toEqual({ name: 'Bellwether' });
  });

  it('keeps each quotation attached to its session and message', () => {
    const result = askResult(answer(), NODE);

    expect(result.evidence).toEqual([{
      spanId: 500,
      claimId: 1,
      quote: 'Northfold is the beta partner.',
      sessionId: 12,
      sessionTitle: 'Partner selection',
      messageId: 4_000,
      role: 'user',
      ts: '2026-01-02T09:15:00.000Z',
    }]);
  });
});

describe('askResult, abstained', () => {
  it('reports the reason and nothing that looks like an answer', () => {
    const result = askResult(answer({
      resolution: {
        outcome: { type: 'abstain', reason: 'never_stated' },
        explanation: 'The corpus never states this.',
        considered: [],
        hop: null,
        trace: ['Looked up Bellwether.'],
      },
      evidence: [],
    }), NODE);

    expect(result.status).toBe('abstained');
    expect(result.answer).toBeNull();
    expect(result.claimId).toBeNull();
    expect(result.reasonCode).toBe('never_stated');
    expect(result.evidence).toEqual([]);
    expect(result.evidenceTotal).toBe(0);
  });

  it('still cites evidence when the abstention is a contradiction', () => {
    // Abstaining is not the same as having nothing to show. Two live claims
    // disagreeing is a finding, and the quotations are what make it checkable.
    const result = askResult(answer({
      resolution: {
        outcome: { type: 'abstain', reason: 'contradicted' },
        explanation: 'Two live claims disagree.',
        considered: [claim({ id: 1 }), claim({ id: 2, objectText: 'Millbrace' })],
        hop: null,
        trace: [],
      },
      evidence: [evidence({ claimId: 1 }), evidence({ claimId: 2, spanId: 501 })],
    }), NODE);

    expect(result.status).toBe('abstained');
    expect(result.evidence).toHaveLength(2);
    expect(result.supersededClaims).toEqual([]);
  });
});

describe('askResult, revision chains', () => {
  const revised = answer({
    resolution: {
      outcome: { type: 'answer', claimId: 9, text: 'Halverd' },
      explanation: 'Replaced 2 earlier values.',
      considered: [
        claim({ id: 50, objectText: 'Stonecrop', supersededBy: [9] }),
        claim({ id: 70, objectText: 'Millbrace', supersededBy: [9] }),
        claim({ id: 9, objectText: 'Halverd' }),
      ],
      hop: null,
      trace: [],
    },
  });

  it('lists the replaced claims in the order the resolver considered them', () => {
    const result = askResult(revised, NODE);

    expect(result.supersededClaims).toEqual([50, 70]);
    expect(result.claimId).toBe(9);
  });

  it('gives the timeline every claim, oldest first, with what replaced it', () => {
    const result = timelineResult(revised, NODE);

    expect(result.considered.map((item) => item.claimId)).toEqual([50, 70, 9]);
    expect(result.considered.map((item) => item.current)).toEqual([false, false, true]);
    expect(result.considered[0]).toEqual({
      claimId: 50,
      predicate: 'beta_partner',
      objectText: 'Stonecrop',
      polarity: 'positive',
      validFrom: '2026-01-01T00:00:00.000Z',
      txTime: '2026-01-02T00:00:00.000Z',
      supersededBy: [9],
      current: false,
    });
  });

  it('keeps validFrom and txTime apart, because they answer different questions', () => {
    const result = timelineResult(answer({
      resolution: {
        outcome: { type: 'answer', claimId: 1, text: 'Northfold' },
        explanation: '',
        considered: [claim({
          validFrom: '2026-03-01T00:00:00.000Z',
          txTime: '2026-05-20T00:00:00.000Z',
        })],
        hop: null,
        trace: [],
      },
    }), NODE);

    expect(result.considered[0]?.validFrom).toBe('2026-03-01T00:00:00.000Z');
    expect(result.considered[0]?.txTime).toBe('2026-05-20T00:00:00.000Z');
  });
});

describe('askResult, evidence cap', () => {
  it('truncates the list and reports how many there were', () => {
    const many = Array.from(
      { length: MAX_EVIDENCE_ITEMS + 12 },
      (_unused, index) => evidence({ spanId: 900 + index }),
    );
    const result = askResult(answer({ evidence: many }), NODE);

    expect(result.evidence).toHaveLength(MAX_EVIDENCE_ITEMS);
    expect(result.evidenceTotal).toBe(MAX_EVIDENCE_ITEMS + 12);
    // The first ones, not a sample, so the ids stay contiguous and a caller can
    // ask for the rest by claim.
    expect(result.evidence[0]?.spanId).toBe(900);
    expect(result.evidence[MAX_EVIDENCE_ITEMS - 1]?.spanId).toBe(900 + MAX_EVIDENCE_ITEMS - 1);
  });

  it('leaves a short list alone and reports the same number twice', () => {
    const result = askResult(answer({ evidence: [evidence(), evidence({ spanId: 501 })] }), NODE);

    expect(result.evidence).toHaveLength(2);
    expect(result.evidenceTotal).toBe(2);
  });
});

describe('explainResult', () => {
  it('adds the resolver\'s own explanation and trace to the envelope', () => {
    const result = explainResult(answer(), NODE);

    expect(result.status).toBe('answered');
    expect(result.explanation).toBe('Stated once and never contradicted or withdrawn.');
    expect(result.trace).toEqual([
      'Looked up Bellwether.',
      'One live claim on beta_partner.',
    ]);
  });
});

describe('lastReadEpoch', () => {
  it('takes the last read that reported one', () => {
    expect(lastReadEpoch([query({ readEpoch: 4 }), query({ readEpoch: 6 })])).toBe(6);
  });

  it('skips reads that reported nothing rather than reading them as zero', () => {
    expect(lastReadEpoch([query({ readEpoch: 4 }), query({ readEpoch: null })])).toBe(4);
  });

  it('is null when no read reported one', () => {
    expect(lastReadEpoch([query({ readEpoch: null })])).toBeNull();
    expect(lastReadEpoch([])).toBeNull();
  });
});

describe('describeNode', () => {
  it('drops the base URL and the token', () => {
    const config: HydraConfig = {
      baseUrl: 'http://127.0.0.1:18443',
      namespace: 'test-namespace',
      graph: 'default',
      cell: 'cell-0',
      // Not a credential. It is here so this test can assert it never survives.
      token: 'token-that-must-never-be-rendered',
    };

    const identity = describeNode(config);

    expect(Object.keys(identity).sort()).toEqual(['cell', 'graph', 'namespace']);
    expect(JSON.stringify(identity)).not.toContain('18443');
    expect(JSON.stringify(identity)).not.toContain('token-that-must-never-be-rendered');
  });
});

describe('renderJson', () => {
  it('produces text that parses back to the same object', () => {
    // The text block and structuredContent carry the same payload. A client that
    // reads only one of them must not see a different answer from one that reads
    // the other.
    const result = askResult(answer(), NODE);

    expect(JSON.parse(renderJson(result))).toEqual(result);
  });
});

describe('readQuestion', () => {
  it('trims and passes a well formed question through', () => {
    expect(readQuestion({ subject: '  Bellwether ', predicate: 'beta_partner' })).toEqual({
      subject: 'Bellwether',
      predicate: 'beta_partner',
      via: null,
    });
  });

  it('reads a hop when one is given, and treats an empty string as none', () => {
    expect(readQuestion({ subject: 'Bellwether', predicate: 'contact', via: 'vendor' }).via)
      .toBe('vendor');
    expect(readQuestion({ subject: 'Bellwether', predicate: 'contact', via: '' }).via).toBeNull();
    expect(readQuestion({ subject: 'Bellwether', predicate: 'contact', via: null }).via).toBeNull();
  });

  it('rejects a term over the length cap as bad parameters', () => {
    const long = 'B'.repeat(MAX_TERM_CHARS + 1);

    expect(() => readQuestion({ subject: long, predicate: 'beta_partner' }))
      .toThrow(McpError);

    try {
      readQuestion({ subject: long, predicate: 'beta_partner' });
      expect.unreachable('a term over the cap must not be accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(McpError);
      expect((error as McpError).code).toBe(ErrorCode.InvalidParams);
      // The message says what was wrong with the term without echoing it back.
      expect((error as McpError).message).toContain(`${MAX_TERM_CHARS} character cap`);
      expect((error as McpError).message).not.toContain(long);
    }
  });

  it('rejects a control character in a term', () => {
    expect(() => readQuestion({ subject: 'Bell wether', predicate: 'beta_partner' }))
      .toThrow(/control character/);
  });

  it('rejects arguments that are not an object, or that omit a required term', () => {
    expect(() => readQuestion('Bellwether')).toThrow(/must be an object/);
    expect(() => readQuestion([])).toThrow(/must be an object/);
    expect(() => readQuestion({ predicate: 'beta_partner' })).toThrow(/subject is required/);
    expect(() => readQuestion({ subject: 'Bellwether' })).toThrow(/predicate is required/);
    expect(() => readQuestion({ subject: 'Bellwether', predicate: 'p', via: 7 }))
      .toThrow(/via must be a string or null/);
  });
});
