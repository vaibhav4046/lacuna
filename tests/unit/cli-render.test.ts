import { describe, expect, it } from 'vitest';

import { PLAIN, paletteFor } from '../../src/cli/color.js';
import { renderAsk, renderExplain, renderTimeline } from '../../src/cli/human.js';
import { questionPayload, render } from '../../src/cli/json.js';
import type { Answer, ClaimRecord, EvidenceRecord, QueryTrace } from '../../src/retrieval/types.js';

/**
 * Rendering, on a hand-built answer.
 *
 * Nothing here talks to a node. The fixture is the shape `ask` returns, written
 * out by hand, which is what lets these tests assert the thing that actually
 * matters about this output: that the answer, the quote and the session it came
 * from all survive to the terminal. An answer printed without its evidence is
 * the failure mode this whole product exists to avoid, and it would still look
 * fine to a test that only checked the process exited 0.
 */

const SUPERSEDED: ClaimRecord = {
  id: 11,
  predicate: 'beta_partner',
  objectText: 'Stonecrop',
  polarity: 'positive',
  validFrom: '2025-03-03T10:18:00.000Z',
  txTime: '2025-03-03T10:18:00.000Z',
  supersededBy: [12],
};

const CURRENT: ClaimRecord = {
  id: 12,
  predicate: 'beta_partner',
  objectText: 'Halverd',
  polarity: 'positive',
  validFrom: '2025-03-11T10:12:00.000Z',
  txTime: '2025-03-11T10:12:00.000Z',
  supersededBy: [],
};

const EVIDENCE: EvidenceRecord = {
  claimId: 12,
  spanId: 501,
  quote: 'Correction on Bellwether: the beta partner is now Halverd.',
  start: 0,
  end: 57,
  messageId: 401,
  role: 'user',
  ts: '2025-03-11T10:12:00.000Z',
  sessionId: 301,
  sessionTitle: 'Platform handover notes',
};

const QUERIES: readonly QueryTrace[] = [
  {
    cypher: 'MATCH (e:Entity {name: $name}) RETURN e.id AS id, e.kind AS kind',
    parameters: { name: 'Bellwether' },
    rows: 1,
    ms: 3.2,
    readEpoch: 5844,
  },
  {
    cypher: 'MATCH (c:Claim)-[:ABOUT]->(e {id: $e}) RETURN c.id AS id',
    parameters: { e: 100 },
    rows: 3,
    ms: 4.1,
    readEpoch: 5844,
  },
];

const ANSWERED: Answer = {
  question: { subject: 'Bellwether', predicate: 'beta_partner', via: null },
  subject: {
    name: 'Bellwether',
    id: 100,
    kind: 'project',
    claims: [SUPERSEDED, CURRENT],
    mentions: [],
  },
  bridge: null,
  resolution: {
    outcome: { type: 'answer', claimId: 12, text: 'Halverd' },
    explanation: 'This replaced 1 earlier value and nothing has superseded it.',
    considered: [SUPERSEDED, CURRENT],
    hop: null,
    trace: [
      'Found "Bellwether" as a project with 2 claims about it.',
      'Read 2 "beta_partner" claims about "Bellwether", 1 of them superseded.',
    ],
  },
  evidence: [EVIDENCE],
  queries: QUERIES,
  ms: 12.4,
};

const ABSTAINED: Answer = {
  ...ANSWERED,
  question: { subject: 'Meridian', predicate: 'migration_window', via: null },
  resolution: {
    outcome: { type: 'abstain', reason: 'never_stated' },
    explanation: 'No answer given, because nothing in the sessions ever stated this.',
    considered: [],
    hop: null,
    trace: ['Found "Meridian" as a project with 0 claims about it.'],
  },
  evidence: [],
};

describe('renderAsk', () => {
  const text = renderAsk(ANSWERED, PLAIN);

  it('prints the answer', () => {
    expect(text).toContain('Halverd');
  });

  it('prints the evidence quote in full', () => {
    expect(text).toContain('Correction on Bellwether: the beta partner is now Halverd.');
  });

  it('names the session the quote came from', () => {
    expect(text).toContain('Platform handover notes');
  });

  it('prints the query count and the elapsed time', () => {
    expect(text).toContain('2 queries');
    expect(text).toContain('12.4ms');
  });

  it('prints the question it answered', () => {
    expect(text).toContain('Bellwether beta_partner');
  });

  it('says no answer and gives the reason when it abstained', () => {
    const abstained = renderAsk(ABSTAINED, PLAIN);
    expect(abstained).toContain('No answer');
    expect(abstained).toContain('never_stated');
    expect(abstained).toContain('nothing in the sessions ever stated this');
  });

  it('carries no escape sequences under the plain palette', () => {
    expect(text).not.toContain(String.fromCharCode(27));
  });
});

describe('renderExplain', () => {
  const text = renderExplain(ANSWERED, PLAIN);

  it('numbers the resolution steps in order', () => {
    expect(text).toContain('1. Found "Bellwether" as a project with 2 claims about it.');
    expect(text).toContain('2. Read 2 "beta_partner" claims');
  });

  it('shows what it asked HydraDB, with rows, latency and epoch', () => {
    expect(text).toContain('MATCH (e:Entity {name: $name})');
    expect(text).toContain('3 rows');
    expect(text).toContain('epoch 5844');
  });
});

describe('renderTimeline', () => {
  const text = renderTimeline(ANSWERED, PLAIN);

  it('lists the claims oldest first', () => {
    // The verdict prints the answer above the table, so the order has to be read
    // off the claim rows themselves rather than off the whole block of text.
    const rows = text.split('\n').filter((line) => line.trim().startsWith('#'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Stonecrop');
    expect(rows[1]).toContain('Halverd');
  });

  it('says which claim superseded which', () => {
    expect(text).toContain('superseded by #12');
    expect(text).toContain('current, answered with this');
  });

  it('prints both times for each claim', () => {
    expect(text).toContain('2025-03-03T10:18:00.000Z');
    expect(text).toContain('2025-03-11T10:12:00.000Z');
  });

  it('says so plainly when nothing was ever claimed', () => {
    expect(renderTimeline(ABSTAINED, PLAIN)).toContain('No claim was ever made on this pair.');
  });
});

describe('the json payload', () => {
  const text = render(questionPayload('ask', ANSWERED));
  const parsed: unknown = JSON.parse(text);
  const payload = parsed as Record<string, unknown>;

  it('is valid JSON', () => {
    expect(typeof parsed).toBe('object');
    expect(parsed).not.toBeNull();
  });

  it('carries the keys a caller reads', () => {
    for (const key of [
      'command',
      'question',
      'status',
      'answer',
      'claimId',
      'reasonCode',
      'explanation',
      'trace',
      'considered',
      'evidence',
      'queries',
      'queryCount',
      'timingMs',
    ]) {
      expect(payload).toHaveProperty(key);
    }
    expect(payload['status']).toBe('answered');
    expect(payload['answer']).toBe('Halverd');
    expect(payload['queryCount']).toBe(2);
  });

  it('carries the shared contract fields, under the names MCP uses', () => {
    for (const key of ['supersededClaims', 'evidenceTotal', 'sourceState']) {
      expect(payload).toHaveProperty(key);
    }
    expect(payload['sourceState']).toBe('live');
    expect(payload['evidenceTotal']).toBe(1);
    expect(payload['supersededClaims']).toEqual([SUPERSEDED.id]);
  });

  it('reports the revision chain the way the MCP server does', () => {
    const considered = payload['considered'] as readonly Record<string, unknown>[];
    expect(considered).toHaveLength(2);
    expect(considered[0]?.['claimId']).toBe(SUPERSEDED.id);
    expect(considered[0]?.['current']).toBe(false);
    expect(considered[1]?.['claimId']).toBe(CURRENT.id);
    expect(considered[1]?.['current']).toBe(true);
  });

  it('reports an abstention as a status and a reason, not as an error', () => {
    const abstained = JSON.parse(render(questionPayload('ask', ABSTAINED))) as
      Record<string, unknown>;
    expect(abstained['status']).toBe('abstained');
    expect(abstained['reasonCode']).toBe('never_stated');
    expect(abstained['answer']).toBeNull();
  });

  it('contains no token, under any spelling', () => {
    const flat = text.toLowerCase();
    for (const forbidden of ['token', 'authorization', 'bearer', 'secret', 'hydra_token']) {
      expect(flat).not.toContain(forbidden);
    }
  });

  it('carries the evidence, so a caller can check the answer', () => {
    const evidence = payload['evidence'] as readonly Record<string, unknown>[];
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.['quote']).toBe(EVIDENCE.quote);
    expect(evidence[0]?.['sessionTitle']).toBe('Platform handover notes');
  });

  it('ends with one newline', () => {
    expect(text.endsWith('}\n')).toBe(true);
  });
});

describe('paletteFor', () => {
  it('is plain when NO_COLOR is set, at any value', () => {
    expect(paletteFor({ isTTY: true }, { NO_COLOR: '1' })).toBe(PLAIN);
    expect(paletteFor({ isTTY: true }, { NO_COLOR: '' })).toBe(PLAIN);
  });

  it('is plain when stdout is not a terminal', () => {
    expect(paletteFor({ isTTY: false }, {})).toBe(PLAIN);
    expect(paletteFor({}, {})).toBe(PLAIN);
  });

  it('is plain on a dumb terminal', () => {
    expect(paletteFor({ isTTY: true }, { TERM: 'dumb' })).toBe(PLAIN);
  });

  it('colours only a real terminal that did not ask otherwise', () => {
    expect(paletteFor({ isTTY: true }, { TERM: 'xterm-256color' })).not.toBe(PLAIN);
  });
});
