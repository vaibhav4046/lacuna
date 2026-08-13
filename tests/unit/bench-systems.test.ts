import { describe, expect, it } from 'vitest';

import { flatSystem, followUpText, twoHopSystem } from '../../src/bench/systems';
import type { Ranking, Retriever } from '../../src/bench/types';
import type { GoldQuestion } from '../../src/corpus/types';
import { claim, corpusIndex, question, sequence } from '../support/bench-fixtures';

/**
 * The baselines dressed as one interface: question in, decision out, with what
 * it cost to get there.
 *
 * Two things here decide whether the comparison is honest. The second retrieval
 * round has to be a real one, because leaving it out would beat the multi hop
 * questions against a pipeline nobody would ship. And the context charged has
 * to be everything the reader was handed, including both rounds, because the
 * context column is the claim being made.
 *
 * `lacunaSystem` is not covered here. It needs a live HydraDB connection, so it
 * is exercised by the contract tests and by the harness run itself.
 */

const HOP_TEXT = 'Who is the owner for the vendor behind Meridian?';

interface Call {
  readonly question: GoldQuestion;
  readonly limit: number;
}

/** A retriever with one prepared ranking per round, which records what it was asked. */
function scripted(rankings: readonly Ranking[]): { retriever: Retriever; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    retriever: {
      name: 'scripted',
      description: 'a prepared ranking per round',
      rank(asked: GoldQuestion, limit: number): Ranking {
        calls.push({ question: asked, limit });
        return rankings[calls.length - 1] ?? [];
      },
    },
  };
}

describe('followUpText', () => {
  it('is the predicate and the entity the hop landed on', () => {
    expect(followUpText('owner', 'Northbeam')).toBe('owner Northbeam');
  });

  it('is one definition, so the text embedded is the text asked', () => {
    // The vector baseline has to embed its queries before the run and cannot
    // embed a string it has not seen. Two spellings of this would drift apart
    // the first time either was edited, and the vector baseline would throw
    // halfway through a benchmark.
    expect(followUpText('launch_date', 'Larkspur')).toBe('launch_date Larkspur');
  });
});

describe('flatSystem', () => {
  const index = corpusIndex(
    sequence([
      { text: 'Meridian sits in eu-west-1.', claims: [claim({ predicate: 'region', objectText: 'eu-west-1', validFrom: '2026-01-01T00:00:00.000Z' })] },
      { text: 'Meridian moved to us-east-1.', claims: [claim({ predicate: 'region', objectText: 'us-east-1', validFrom: '2026-02-01T00:00:00.000Z' })] },
    ]),
  );
  const asked = question({ predicate: 'region', text: 'Which region is Meridian in?' });

  it('names itself after its retriever and its k', () => {
    const { retriever } = scripted([[0]]);

    expect(flatSystem(retriever, index, 20, 'latest').name).toBe('scripted@20');
    expect(flatSystem(retriever, index, 20, 'latest').description).toBe('a prepared ranking per round');
  });

  it('retrieves once, asking for k', async () => {
    const { retriever, calls } = scripted([[0, 1]]);
    await flatSystem(retriever, index, 5, 'latest').answer(asked);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.limit).toBe(5);
    expect(calls[0]?.question).toBe(asked);
  });

  it('charges the full text of every message it retrieved', async () => {
    const { retriever } = scripted([[0, 1]]);
    const result = await flatSystem(retriever, index, 5, 'latest').answer(asked);

    // A flat baseline hands its reader whole messages, because a chunk is the
    // unit it stores. Charging it for the sentence it happened to need would be
    // measuring a system that does not exist.
    const expected = 'Meridian sits in eu-west-1.'.length + 'Meridian moved to us-east-1.'.length;
    expect(result.contextChars).toBe(expected);
  });

  it('charges nothing when the retriever found nothing', async () => {
    const { retriever } = scripted([[]]);
    const result = await flatSystem(retriever, index, 5, 'latest').answer(asked);

    expect(result.contextChars).toBe(0);
    expect(result.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });
  });

  it('passes the reader mode through, which is what the ablation varies', async () => {
    const latest = await flatSystem(scripted([[0, 1]]).retriever, index, 5, 'latest').answer(asked);
    const careful = await flatSystem(
      scripted([[0, 1]]).retriever,
      index,
      5,
      'conflict_aware',
    ).answer(asked);

    expect(latest.outcome).toEqual({ type: 'answer', text: 'us-east-1' });
    expect(careful.outcome).toEqual({ type: 'abstain', reason: 'contradicted' });
  });

  it('reports a wall clock time', async () => {
    const { retriever } = scripted([[0]]);
    const result = await flatSystem(retriever, index, 5, 'latest').answer(asked);

    expect(result.ms).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.ms)).toBe(true);
  });
});

describe('twoHopSystem', () => {
  const index = corpusIndex(
    sequence([
      {
        text: 'Meridian is run by Northbeam.',
        claims: [claim({ predicate: 'vendor', objectText: 'Northbeam', objectEntity: 'Northbeam' })],
      },
      {
        text: 'Northbeam has Priya on the account.',
        claims: [claim({ subject: 'Northbeam', predicate: 'owner', objectText: 'Priya Raman' })],
      },
      { text: 'Unrelated scheduling chatter.' },
    ]),
  );
  const hop = question({ predicate: 'owner', text: HOP_TEXT, subject: 'Meridian' });

  it('names itself so the extra round is visible in the results table', () => {
    const { retriever } = scripted([[0]]);

    expect(twoHopSystem(retriever, index, 20, 'latest').name).toBe('scripted+2hop@20');
    expect(twoHopSystem(retriever, index, 20, 'latest').description).toContain('second retrieval round');
  });

  it('follows the relation and answers from the entity it landed on', async () => {
    const { retriever, calls } = scripted([[0], [1]]);
    const result = await twoHopSystem(retriever, index, 5, 'latest').answer(hop);

    expect(result.outcome).toEqual({ type: 'answer', text: 'Priya Raman' });
    expect(calls).toHaveLength(2);
  });

  it('asks the second round about the bridge entity', async () => {
    const { retriever, calls } = scripted([[0], [1]]);
    await twoHopSystem(retriever, index, 5, 'latest').answer(hop);

    expect(calls[1]?.question.subject).toBe('Northbeam');
    expect(calls[1]?.question.text).toBe(followUpText('owner', 'Northbeam'));
    expect(calls[1]?.limit).toBe(5);
  });

  it('charges both rounds, deduped', async () => {
    const { retriever } = scripted([
      [0, 2],
      [1, 2],
    ]);
    const result = await twoHopSystem(retriever, index, 5, 'latest').answer(hop);

    // Message 2 came back in both rounds and is paid for once, which is what a
    // pipeline holding one context window actually spends.
    const expected =
      'Meridian is run by Northbeam.'.length +
      'Northbeam has Priya on the account.'.length +
      'Unrelated scheduling chatter.'.length;
    expect(result.contextChars).toBe(expected);
  });

  it('does not retrieve twice when the question names no relation', async () => {
    const { retriever, calls } = scripted([[2]]);
    const direct = question({ predicate: 'owner', text: 'Who owns Meridian?' });
    const result = await twoHopSystem(retriever, index, 5, 'latest').answer(direct);

    expect(calls).toHaveLength(1);
    expect(result.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });
  });

  it('does not retrieve twice when the first round already answered', async () => {
    const { retriever, calls } = scripted([[0, 1]]);
    // Both the relation and the answer are in view, so the hop is unnecessary.
    const answerable = corpusIndex(
      sequence([
        {
          text: 'Meridian is run by Northbeam.',
          claims: [
            claim({ predicate: 'vendor', objectText: 'Northbeam', objectEntity: 'Northbeam' }),
            claim({ predicate: 'owner', objectText: 'Dana Whitfield' }),
          ],
        },
        { text: 'Northbeam has Priya on the account.' },
      ]),
    );
    const result = await twoHopSystem(retriever, answerable, 5, 'latest').answer(hop);

    expect(calls).toHaveLength(1);
    expect(result.outcome).toEqual({ type: 'answer', text: 'Dana Whitfield' });
  });

  it('stops at one round when the first round never found the relation', async () => {
    const { retriever, calls } = scripted([[2], [1]]);
    const result = await twoHopSystem(retriever, index, 5, 'latest').answer(hop);

    expect(calls).toHaveLength(1);
    expect(result.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });
    expect(result.contextChars).toBe('Unrelated scheduling chatter.'.length);
  });

  it('abstains unconnected when the hop lands somewhere with nothing stated', async () => {
    const { retriever } = scripted([[0], [2]]);
    const result = await twoHopSystem(retriever, index, 5, 'latest').answer(hop);

    // The vendor exists and the second round found nothing about it. That is a
    // gap in the record rather than an entity nobody ever mentioned, and the
    // two abstention reasons are not interchangeable.
    expect(result.outcome).toEqual({ type: 'abstain', reason: 'unconnected' });
  });
});
