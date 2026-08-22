import { describe, expect, it } from 'vitest';

import { RetrievalConsistencyError } from '../../src/retrieval/errors.js';
import {
  canonicalEntityName as canonical,
  citedClaims,
  evaluateTargetStanding as standing,
  resolve,
  selectHopTarget,
} from '../../src/retrieval/resolve.js';
import type {
  ClaimRecord,
  Mention,
  Resolution,
  SubgraphView,
  SubjectView,
} from '../../src/retrieval/types.js';

/**
 * The decision procedure, on made up subgraphs.
 *
 * These are unit tests in the strict sense: no node, no network, no corpus.
 * That is the whole reason `resolve` is pure. Every arrangement the five
 * abstention reasons are meant to tell apart is built here by hand, including
 * several the generated corpus does not produce, because "the corpus does not
 * happen to contain this" is not the same as "this cannot happen".
 */

let nextId = 1;

function claim(over: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: nextId++,
    predicate: 'launch_date',
    objectText: '25 July 2026',
    polarity: 'positive',
    validFrom: '2026-01-01T00:00:00.000Z',
    txTime: '2026-01-01T00:00:00.000Z',
    supersededBy: [],
    ...over,
  };
}

function subject(over: Partial<SubjectView> = {}): SubjectView {
  return {
    name: 'Meridian',
    id: 100,
    kind: 'project',
    claims: [],
    mentions: [],
    ...over,
  };
}

function view(over: Partial<SubgraphView> = {}): SubgraphView {
  return {
    question: { subject: 'Meridian', predicate: 'launch_date', via: null },
    subject: subject(),
    bridge: null,
    ...over,
  };
}

function reasonOf(resolution: Resolution): string {
  return resolution.outcome.type === 'abstain' ? resolution.outcome.reason : 'answered';
}

function relationMention(over: Partial<Mention> = {}): Mention {
  return { claimId: 1, predicate: 'depends_on', entityId: 200, entityName: 'Redis', ...over };
}

describe('canonicalEntityName', () => {
  it('NFC-normalizes, maps only remaining Unicode whitespace, and lowercases without locale folding', () => {
    expect(canonical('\u00a0Cafe\u0301\u2003I\u00a0')).toEqual({
      display: 'Café I',
      key: 'café i',
    });
    expect(canonical('Ａ')).toEqual({ display: 'Ａ', key: 'ａ' });
  });

  it('rejects unpaired surrogates, controls, and bidi controls before canonicalization', () => {
    for (const raw of [
      '\ud800', '\udc00', 'a\u0000b', 'a\tb', 'a\u0085b',
      `a${String.fromCodePoint(0x202a)}b`, `a${String.fromCodePoint(0x202e)}b`,
      `a${String.fromCodePoint(0x2066)}b`, `a${String.fromCodePoint(0x2069)}b`,
    ]) {
      expect(canonical(raw), JSON.stringify(raw)).toBeNull();
    }
    expect(canonical('A\ud83d\ude00B')).toEqual({ display: 'A😀B', key: 'a😀b' });
  });

  it('enforces inclusive scalar and UTF-8 caps before and after lowercase expansion', () => {
    expect(canonical('a'.repeat(160))).toEqual({ display: 'a'.repeat(160), key: 'a'.repeat(160) });
    expect(canonical('a'.repeat(161))).toBeNull();
    expect(canonical('😀'.repeat(128))).toEqual({ display: '😀'.repeat(128), key: '😀'.repeat(128) });
    expect(canonical('😀'.repeat(129))).toBeNull();
    expect(canonical('\u0130'.repeat(80))).toEqual({ display: '\u0130'.repeat(80), key: 'i\u0307'.repeat(80) });
    expect(canonical('\u0130'.repeat(81))).toBeNull();
    expect(canonical('\u00a0\u2003')).toBeNull();
  });
});

describe('evaluateTargetStanding', () => {
  it('requires one Mention with the exact claim, predicate, and canonical target', () => {
    const live = claim({ id: 10, predicate: 'depends_on', objectText: ' Redis ' });
    const nearMisses = [
      relationMention({ claimId: 9 }),
      relationMention({ claimId: 10, predicate: 'uses' }),
      relationMention({ claimId: 10, entityName: 'Postgres' }),
    ];
    expect(standing(subject({ claims: [live], mentions: nearMisses }), 'depends_on', 'redis'))
      .toEqual({ state: 'missing_mention' });

    const exact = relationMention({ claimId: 10, entityName: '\u00a0REDIS\u2003' });
    expect(standing(subject({ claims: [live], mentions: [...nearMisses, exact] }), 'depends_on', 'redis'))
      .toEqual({ state: 'current', claim: live, mention: exact });
  });

  it('is shuffle-stable and selects the newest equivalently supported claim and exact Mention', () => {
    const oldest = claim({ id: 7, predicate: 'depends_on', objectText: 'Redis', validFrom: '2026-01-01T00:00:00.000Z' });
    const newer = claim({ id: 5, predicate: 'depends_on', objectText: ' REDIS ', validFrom: '2026-02-01T00:00:00.000Z' });
    const newest = claim({ id: 9, predicate: 'depends_on', objectText: 'redis', validFrom: '2026-02-01T00:00:00.000Z' });
    const oldestMention = relationMention({ claimId: 7, entityId: 207 });
    const newerMention = relationMention({ claimId: 5, entityId: 205, entityName: 'REDIS' });
    const newestMention = relationMention({ claimId: 9, entityId: 209, entityName: ' redis ' });

    for (const [claims, mentions] of [
      [[oldest, newer, newest], [oldestMention, newerMention, newestMention]],
      [[newest, oldest, newer], [newestMention, oldestMention, newerMention]],
    ] as const) {
      expect(standing(subject({ claims, mentions }), 'depends_on', 'redis')).toEqual({
        state: 'current', claim: newest, mention: newestMention,
      });
    }
  });

  it('contradicts every candidate target for a single-valued predicate with two live values', () => {
    const northfold = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const millbrace = claim({ id: 2, predicate: 'vendor', objectText: 'Millbrace' });
    const view = subject({
      claims: [millbrace, northfold],
      mentions: [
        relationMention({ claimId: 1, predicate: 'vendor', entityName: 'Northfold' }),
        relationMention({ claimId: 2, predicate: 'vendor', entityName: 'Millbrace' }),
      ],
    });
    expect(standing(view, 'vendor', 'northfold')).toEqual({ state: 'contradicted' });
    expect(standing(view, 'vendor', 'millbrace')).toEqual({ state: 'contradicted' });
  });

  it('evaluates live values independently for a multi-valued predicate', () => {
    const redis = claim({ id: 1, predicate: 'depends_on', objectText: 'Redis' });
    const postgres = claim({ id: 2, predicate: 'depends_on', objectText: 'Postgres' });
    const redisMention = relationMention({ claimId: 1, entityName: 'Redis' });
    const postgresMention = relationMention({ claimId: 2, entityName: 'Postgres' });
    const view = subject({ claims: [postgres, redis], mentions: [postgresMention, redisMention] });

    expect(standing(view, 'depends_on', 'redis')).toEqual({ state: 'current', claim: redis, mention: redisMention });
    expect(standing(view, 'depends_on', 'postgres')).toEqual({ state: 'current', claim: postgres, mention: postgresMention });
  });

  it('distinguishes retracted, historical, and unstated target states', () => {
    const old = claim({ id: 1, predicate: 'depends_on', objectText: 'Redis', supersededBy: [2] });
    const withdrawal = claim({ id: 2, predicate: 'depends_on', objectText: '', polarity: 'negative' });
    expect(standing(subject({ claims: [withdrawal, old] }), 'depends_on', 'redis'))
      .toEqual({ state: 'retracted' });

    const replacement = claim({ id: 2, predicate: 'depends_on', objectText: 'Postgres' });
    expect(standing(subject({ claims: [replacement, old] }), 'depends_on', 'redis'))
      .toEqual({ state: 'historical' });

    expect(standing(subject({ claims: [replacement] }), 'depends_on', 'redis'))
      .toEqual({ state: 'unstated' });
    expect(standing(subject({ claims: [old] }), 'depends_on', 'redis'))
      .toEqual({ state: 'unstated' });
    expect(standing(subject({ claims: [claim({ predicate: 'vendor', objectText: 'Redis' })] }), 'depends_on', 'redis'))
      .toEqual({ state: 'unstated' });
  });
});

describe('resolve, direct questions', () => {
  it('answers when one current claim stands', () => {
    const only = claim();
    const resolution = resolve(view({ subject: subject({ claims: [only] }) }));

    expect(resolution.outcome).toEqual({
      type: 'answer',
      claimId: only.id,
      text: '25 July 2026',
    });
    expect(resolution.explanation).toBe('Stated once and never contradicted or withdrawn.');
  });

  it('answers with the survivor of a revision chain, not the newest row', () => {
    // Deliberately out of order and with the newest value carrying the oldest
    // id, so a resolver that trusted insertion order or id order would fail.
    const current = claim({ id: 9, objectText: 'Halverd', validFrom: '2026-03-01T00:00:00.000Z' });
    const first = claim({
      id: 50,
      objectText: 'Stonecrop',
      validFrom: '2026-01-01T00:00:00.000Z',
      supersededBy: [9],
    });
    const second = claim({
      id: 70,
      objectText: 'Millbrace',
      validFrom: '2026-02-01T00:00:00.000Z',
      supersededBy: [9],
    });

    const resolution = resolve(view({
      question: { subject: 'Bellwether', predicate: 'launch_date', via: null },
      subject: subject({ claims: [second, current, first] }),
    }));

    expect(resolution.outcome).toEqual({ type: 'answer', claimId: 9, text: 'Halverd' });
    expect(resolution.explanation).toContain('replaced 2 earlier values');
    // The superseded ones stay in `considered`: they are what makes the change
    // visible on the timeline rather than a value that was always this.
    expect(resolution.considered).toHaveLength(3);
  });

  it('abstains never_stated when no claim carries the predicate', () => {
    const resolution = resolve(view({
      subject: subject({ claims: [claim({ predicate: 'vendor' })] }),
    }));

    expect(reasonOf(resolution)).toBe('never_stated');
    expect(resolution.considered).toEqual([]);
  });

  it('abstains out_of_scope when the name is not in the graph', () => {
    const resolution = resolve(view({
      subject: { name: 'Redshank', id: null, kind: null, claims: [], mentions: [] },
    }));

    expect(reasonOf(resolution)).toBe('out_of_scope');
    expect(resolution.trace.join(' ')).toContain('No node carries that name');
  });

  it('separates out_of_scope from never_stated by whether the node exists', () => {
    const absent = resolve(view({
      subject: { name: 'Redshank', id: null, kind: null, claims: [], mentions: [] },
    }));
    const present = resolve(view({ subject: subject({ claims: [] }) }));

    expect(reasonOf(absent)).toBe('out_of_scope');
    expect(reasonOf(present)).toBe('never_stated');
  });
});

describe('resolve, retraction', () => {
  it('abstains retracted when the current claim withdraws the value', () => {
    const withdrawal = claim({ id: 2, objectText: '', polarity: 'negative' });
    const original = claim({ id: 1, supersededBy: [2] });

    const resolution = resolve(view({ subject: subject({ claims: [original, withdrawal] }) }));

    expect(reasonOf(resolution)).toBe('retracted');
    // Both, because showing the withdrawal without what it withdrew asks for
    // the same trust a bare answer does.
    expect(citedClaims(resolution)).toEqual([1, 2]);
  });

  it('abstains retracted when every claim on the predicate is superseded', () => {
    // The replacement exists but carries a different predicate, so nothing on
    // this pair is live. Distinct from the case above, same reason.
    const resolution = resolve(view({
      subject: subject({ claims: [claim({ id: 1, supersededBy: [99] })] }),
    }));

    expect(reasonOf(resolution)).toBe('retracted');
    expect(resolution.trace.join(' ')).toContain('none of the replacements remain');
  });

  it('does not treat a superseded negative claim as a retraction', () => {
    // Withdrawn, then reinstated. The live positive wins.
    const reinstated = claim({ id: 3, objectText: '25 July 2026' });
    const withdrawal = claim({ id: 2, objectText: '', polarity: 'negative', supersededBy: [3] });
    const original = claim({ id: 1, supersededBy: [2] });

    const resolution = resolve(view({
      subject: subject({ claims: [original, withdrawal, reinstated] }),
    }));

    expect(resolution.outcome).toEqual({ type: 'answer', claimId: 3, text: '25 July 2026' });
  });
});

describe('resolve, contradiction', () => {
  it('abstains contradicted when two live claims disagree', () => {
    const a = claim({ id: 1, objectText: 'BC-9699' });
    const b = claim({ id: 2, objectText: 'BC-6530' });

    const resolution = resolve(view({ subject: subject({ claims: [a, b] }) }));

    expect(reasonOf(resolution)).toBe('contradicted');
    expect(resolution.trace.join(' ')).toContain('Nothing supersedes either');
    expect(citedClaims(resolution)).toEqual([1, 2]);
  });

  it('treats the same value stated twice as agreement, not disagreement', () => {
    const a = claim({ id: 1, objectText: 'BC-9699', validFrom: '2026-01-01T00:00:00.000Z' });
    const b = claim({ id: 2, objectText: 'BC-9699', validFrom: '2026-02-01T00:00:00.000Z' });

    const resolution = resolve(view({ subject: subject({ claims: [a, b] }) }));

    expect(resolution.outcome).toEqual({ type: 'answer', claimId: 2, text: 'BC-9699' });
  });

  it('does not call it a contradiction when one side is superseded', () => {
    const older = claim({ id: 1, objectText: 'BC-9699', supersededBy: [2] });
    const newer = claim({ id: 2, objectText: 'BC-6530' });

    const resolution = resolve(view({ subject: subject({ claims: [older, newer] }) }));

    expect(resolution.outcome).toEqual({ type: 'answer', claimId: 2, text: 'BC-6530' });
  });
});

describe('selectHopTarget', () => {
  function mention(over: Partial<Mention> = {}): Mention {
    return { claimId: 1, predicate: 'vendor', entityId: 200, entityName: 'Northfold', ...over };
  }

  it('finds the single live target', () => {
    const via = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const selection = selectHopTarget(subject({ claims: [via], mentions: [mention()] }), 'vendor');

    expect(selection.type).toBe('one');
    if (selection.type !== 'one') return;
    expect(selection.mention.entityName).toBe('Northfold');
  });

  it('reports none when nothing states the relation', () => {
    expect(selectHopTarget(subject(), 'vendor').type).toBe('none');
  });

  it('reports retracted when the only claim naming the target is superseded', () => {
    const via = claim({ id: 1, predicate: 'vendor', supersededBy: [2] });
    const selection = selectHopTarget(subject({ claims: [via], mentions: [mention()] }), 'vendor');

    expect(selection.type).toBe('retracted');
  });

  it('reports a live relation without its exact Mention as missing_mention, not retracted', () => {
    const via = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const selection = selectHopTarget(subject({
      claims: [via],
      mentions: [mention({ claimId: 1, predicate: 'vendor', entityName: 'Millbrace' })],
    }), 'vendor');

    expect(selection).toEqual({ type: 'missing_mention', claims: [via] });
  });

  it('reports ambiguous when live claims name two different entities', () => {
    const first = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const second = claim({ id: 2, predicate: 'vendor', objectText: 'Millbrace' });
    const selection = selectHopTarget(
      subject({
        claims: [first, second],
        mentions: [
          mention({ claimId: 1, entityId: 200, entityName: 'Northfold' }),
          mention({ claimId: 2, entityId: 201, entityName: 'Millbrace' }),
        ],
      }),
      'vendor',
    );

    expect(selection.type).toBe('ambiguous');
  });

  it('preserves scalar ambiguity when one canonical name identifies two entity ids', () => {
    const via = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const selection = selectHopTarget(subject({
      claims: [via],
      mentions: [mention({ entityId: 201 }), mention({ entityId: 200 })],
    }), 'vendor');

    expect(selection.type).toBe('ambiguous');
    if (selection.type !== 'ambiguous') return;
    expect(selection.mentions.map((row) => row.entityId)).toEqual([200, 201]);
  });

  it('aggregates exact Mentions across shuffled equivalent live claims before selecting a hop', () => {
    const older = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold', validFrom: '2026-01-01T00:00:00.000Z' });
    const newer = claim({ id: 2, predicate: 'vendor', objectText: ' NORTHFOLD ', validFrom: '2026-02-01T00:00:00.000Z' });
    const olderMention = mention({ claimId: 1, entityId: 200, entityName: 'northfold' });
    const newerMention = mention({ claimId: 2, entityId: 201, entityName: ' Northfold ' });

    for (const [claims, mentions] of [
      [[older, newer], [olderMention, newerMention]],
      [[newer, older], [newerMention, olderMention]],
    ] as const) {
      const selection = selectHopTarget(subject({ claims, mentions }), 'vendor');

      expect(selection.type).toBe('ambiguous');
      if (selection.type !== 'ambiguous') continue;
      expect(selection.mentions.map(({ claimId, entityId }) => [claimId, entityId]))
        .toEqual([[1, 200], [2, 201]]);
    }
  });

  it('fails unconnected when only one of several shuffled multi-valued targets has an exact Mention', () => {
    const redis = claim({ id: 1, predicate: 'depends_on', objectText: 'Redis' });
    const postgres = claim({ id: 2, predicate: 'depends_on', objectText: 'Postgres' });
    const supported = relationMention({ claimId: 1, entityId: 200, entityName: 'Redis' });
    const nearMiss = relationMention({ claimId: 2, predicate: 'uses', entityId: 201, entityName: 'Postgres' });

    for (const [claims, mentions] of [
      [[redis, postgres], [supported, nearMiss]],
      [[postgres, redis], [nearMiss, supported]],
    ] as const) {
      expect(selectHopTarget(subject({ claims, mentions }), 'depends_on')).toEqual({
        type: 'missing_mention',
        claims: [redis, postgres],
      });
    }
  });

  it('treats the same target named twice as one target', () => {
    const first = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold', validFrom: '2026-01-01T00:00:00.000Z' });
    const second = claim({ id: 2, predicate: 'vendor', objectText: 'Northfold', validFrom: '2026-02-01T00:00:00.000Z' });
    const selection = selectHopTarget(
      subject({
        claims: [first, second],
        mentions: [mention({ claimId: 1 }), mention({ claimId: 2 })],
      }),
      'vendor',
    );

    expect(selection.type).toBe('one');
    if (selection.type !== 'one') return;
    // The newer statement is the one a reader would go and check.
    expect(selection.claim.id).toBe(2);
  });
});

describe('resolve, hops', () => {
  const viaClaim = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
  const bridgeMention: Mention = {
    claimId: 1,
    predicate: 'vendor',
    entityId: 200,
    entityName: 'Northfold',
  };
  const hopSubject = subject({ claims: [viaClaim], mentions: [bridgeMention] });
  const hopQuestion = { subject: 'Meridian', predicate: 'contact', via: 'vendor' } as const;

  it('answers from the bridge entity', () => {
    const contact = claim({ id: 10, predicate: 'contact', objectText: 'Farah Haddad' });
    const resolution = resolve(view({
      question: hopQuestion,
      subject: hopSubject,
      bridge: subject({ name: 'Northfold', id: 200, kind: 'vendor', claims: [contact] }),
    }));

    expect(resolution.outcome).toEqual({ type: 'answer', claimId: 10, text: 'Farah Haddad' });
    expect(resolution.hop?.toEntityName).toBe('Northfold');
    // The hop claim is cited too. The reader is owed the step, not just the end.
    expect(citedClaims(resolution)).toEqual([1, 10]);
  });

  it('abstains unconnected when the bridge exists but holds nothing on the predicate', () => {
    const resolution = resolve(view({
      question: hopQuestion,
      subject: hopSubject,
      bridge: subject({ name: 'Northfold', id: 200, kind: 'vendor', claims: [] }),
    }));

    expect(reasonOf(resolution)).toBe('unconnected');
    expect(resolution.hop?.toEntityName).toBe('Northfold');
    // The hop is still cited, and only the hop. Showing the step taken is what
    // separates "I looked and Northfold holds nothing" from a bare shrug.
    expect(citedClaims(resolution)).toEqual([1]);
  });

  it('separates unconnected from never_stated by whether the hop landed', () => {
    // Same sentence shape, same predicate. Only the graph differs, which is the
    // distinction the whole product rests on.
    const landed = resolve(view({
      question: hopQuestion,
      subject: hopSubject,
      bridge: subject({ name: 'Northfold', id: 200, claims: [] }),
    }));
    const neverLanded = resolve(view({
      question: hopQuestion,
      subject: subject({ claims: [], mentions: [] }),
    }));

    expect(reasonOf(landed)).toBe('unconnected');
    expect(reasonOf(neverLanded)).toBe('never_stated');
  });

  it('maps a stated relation with no exact Mention to the existing unconnected abstention', () => {
    const relation = claim({ id: 1, predicate: 'vendor', objectText: 'Northfold' });
    const resolution = resolve(view({
      question: hopQuestion,
      subject: subject({ claims: [relation], mentions: [] }),
      bridge: null,
    }));

    expect(reasonOf(resolution)).toBe('unconnected');
    expect(resolution.considered).toEqual([relation]);
    expect(resolution.hop).toBeNull();
    expect(resolution.trace.join(' ')).toContain('no exact entity Mention');
  });

  it('throws when the view carries a bridge the hop does not select', () => {
    expect(() => resolve(view({
      question: hopQuestion,
      subject: hopSubject,
      bridge: subject({ name: 'Millbrace', id: 999, claims: [] }),
    }))).toThrow(RetrievalConsistencyError);
  });

  it('throws when a hop resolves but the view carries no bridge', () => {
    expect(() => resolve(view({ question: hopQuestion, subject: hopSubject })))
      .toThrow(RetrievalConsistencyError);
  });
});

describe('citedClaims', () => {
  it('cites nothing for the three absence reasons', () => {
    for (const reason of ['never_stated', 'unconnected', 'out_of_scope'] as const) {
      const resolution: Resolution = {
        outcome: { type: 'abstain', reason },
        explanation: '',
        considered: [claim({ id: 1 })],
        hop: null,
        trace: [],
      };
      expect(citedClaims(resolution)).toEqual([]);
    }
  });

  it('cites only the live claims of a contradiction', () => {
    const resolution: Resolution = {
      outcome: { type: 'abstain', reason: 'contradicted' },
      explanation: '',
      considered: [claim({ id: 1 }), claim({ id: 2, supersededBy: [1] })],
      hop: null,
      trace: [],
    };

    expect(citedClaims(resolution)).toEqual([1]);
  });

  it('does not cite the same claim twice when it is both the hop and the answer', () => {
    const resolution: Resolution = {
      outcome: { type: 'answer', claimId: 5, text: 'x' },
      explanation: '',
      considered: [],
      hop: { via: 'vendor', throughClaimId: 5, toEntityId: 200, toEntityName: 'Northfold' },
      trace: [],
    };

    expect(citedClaims(resolution)).toEqual([5]);
  });
});
