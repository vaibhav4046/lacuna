import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { generateCorpus } from '../../src/corpus/index';
import type { GoldQuestion } from '../../src/corpus/types';
import { HydraClient } from '../../src/hydra/client';
import { loadHydraConfig } from '../../src/hydra/config';
import {
  ask,
  buildQuestion,
  entityByName,
  parseVia,
  supersededByClaim,
} from '../../src/retrieval/index';

/**
 * Retrieval against a live HydraDB node holding the ingested corpus.
 *
 * The unit suite proves the decision procedure is right about subgraphs it was
 * handed. This proves the subgraphs are the ones the graph actually holds,
 * which is a different claim and the one that can quietly stop being true when
 * a query is edited.
 *
 * One question per thread kind rather than all sixty. The full sweep is
 * scripts/evaluate.ts, which writes its raw output to artifacts/eval/. This
 * suite exists to fail fast and loudly in CI, not to duplicate that.
 *
 * A node that is up but empty is a failure, not a skip. A green run that tested
 * nothing is worse than a red one.
 */

const ENV_PATH = fileURLToPath(new URL('../../.env.local', import.meta.url));

/** One representative per kind, so a break in any one of them lands here. */
const REPRESENTATIVES = [
  'q-stable-01',
  'q-revised-01',
  'q-retracted-01',
  'q-contradicted-01',
  'q-multi_hop-01',
  'q-unconnected-01',
  'q-never_stated-01',
  'q-out_of_scope-01',
] as const;

const corpus = generateCorpus();
let client: HydraClient;

function gold(id: string): GoldQuestion {
  const found = corpus.questions.find((question) => question.id === id);
  if (found === undefined) {
    throw new Error(`no gold question with id ${id}, the corpus changed under the suite`);
  }
  return found;
}

function askGold(question: GoldQuestion) {
  return ask(client, buildQuestion(question.subject, question.predicate, parseVia(question.text)));
}

beforeAll(async () => {
  if (!existsSync(ENV_PATH)) {
    throw new Error(
      `${ENV_PATH} is missing. Copy .env.example to .env.local and fill in the `
      + 'node address before running the contract suite.',
    );
  }
  process.loadEnvFile(ENV_PATH);
  client = new HydraClient(loadHydraConfig());

  // Reaching an empty store would turn every abstention case green for the
  // wrong reason: out_of_scope is exactly what an empty graph returns.
  const seeded = await client.queryObjects(entityByName('Meridian'));
  if (seeded.length === 0) {
    throw new Error(
      'the node holds no entity named "Meridian". Run `npm run ingest` before this suite.',
    );
  }
});

describe('retrieval against the live graph', () => {
  it.each(REPRESENTATIVES)('%s matches the corpus expectation', async (id) => {
    const question = gold(id);
    const { resolution } = await askGold(question);

    if (question.expected.type === 'answer') {
      expect(resolution.outcome).toMatchObject({
        type: 'answer',
        text: question.expected.text,
      });
    } else {
      expect(resolution.outcome).toEqual({
        type: 'abstain',
        reason: question.expected.reason,
      });
    }
  });

  it('cites a real quotation for every answer it gives', async () => {
    const { resolution, evidence } = await askGold(gold('q-stable-01'));

    expect(resolution.outcome.type).toBe('answer');
    expect(evidence.length).toBeGreaterThan(0);
    for (const span of evidence) {
      expect(span.quote.length).toBeGreaterThan(0);
      expect(span.sessionTitle.length).toBeGreaterThan(0);
      expect(Date.parse(span.ts)).not.toBeNaN();
      expect(span.end).toBeGreaterThan(span.start);
    }
  });

  it('cites both sides of a contradiction rather than picking one', async () => {
    const { resolution, evidence } = await askGold(gold('q-contradicted-01'));

    expect(resolution.outcome).toEqual({ type: 'abstain', reason: 'contradicted' });
    const cited = new Set(evidence.map((span) => span.claimId));
    expect(cited.size).toBeGreaterThanOrEqual(2);
  });

  it('cites the withdrawal and what it withdrew', async () => {
    const { resolution, evidence } = await askGold(gold('q-retracted-01'));

    expect(resolution.outcome).toEqual({ type: 'abstain', reason: 'retracted' });
    expect(new Set(evidence.map((span) => span.claimId)).size).toBeGreaterThanOrEqual(2);
  });

  it('quotes nothing when nothing was found to quote', async () => {
    for (const id of ['q-never_stated-01', 'q-out_of_scope-01']) {
      const { resolution, evidence } = await askGold(gold(id));

      expect(resolution.outcome.type).toBe('abstain');
      expect(evidence).toEqual([]);
    }
  });

  it('quotes the hop it took but nothing about the predicate it could not answer', async () => {
    // unconnected is not the same absence as the two above. Something was
    // found: the step from the subject to the bridge, and that step is quoted
    // because the reader is owed the route. What is missing is at the far end,
    // and there is nothing there to quote.
    const { resolution, evidence } = await askGold(gold('q-unconnected-01'));

    expect(resolution.outcome).toEqual({ type: 'abstain', reason: 'unconnected' });
    expect(resolution.hop).not.toBeNull();
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.claimId).toBe(resolution.hop?.throughClaimId);
    expect(resolution.considered).toEqual([]);
  });

  it('separates two identically shaped hop questions using only the graph', async () => {
    // The distinction the product rests on. Same sentence, same predicate, same
    // parsed relation. Different subject, and the graph does the rest.
    const answerable = gold('q-multi_hop-01');
    const unanswerable = gold('q-unconnected-01');

    const parsedA = buildQuestion(
      answerable.subject,
      answerable.predicate,
      parseVia(answerable.text),
    );
    const parsedB = buildQuestion(
      unanswerable.subject,
      unanswerable.predicate,
      parseVia(unanswerable.text),
    );
    expect(parsedA.predicate).toBe(parsedB.predicate);
    expect(parsedA.via).toBe(parsedB.via);
    expect(parsedA.via).not.toBeNull();

    const [first, second] = await Promise.all([askGold(answerable), askGold(unanswerable)]);

    expect(first.resolution.outcome.type).toBe('answer');
    expect(second.resolution.outcome).toEqual({ type: 'abstain', reason: 'unconnected' });
    // Both hopped. The second one landed somewhere that holds nothing.
    expect(first.resolution.hop).not.toBeNull();
    expect(second.resolution.hop).not.toBeNull();
  });

  it('walks a revision chain to the value that survived it', async () => {
    const { resolution } = await askGold(gold('q-revised-01'));

    expect(resolution.outcome.type).toBe('answer');
    const superseded = resolution.considered.filter((claim) => claim.supersededBy.length > 0);
    expect(superseded.length).toBeGreaterThan(0);
    // The replaced values are still there to be shown, which is what makes the
    // timeline a record rather than a single current value.
    expect(resolution.considered.length).toBeGreaterThan(superseded.length);
  });
});

describe('cost and guards on the live node', () => {
  it('spends one query on a name the graph does not hold', async () => {
    const { queries, resolution } = await ask(
      client,
      buildQuestion('Redshank', 'launch_date'),
    );

    expect(resolution.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });
    expect(queries).toHaveLength(1);
  });

  it('records the statement it ran, not just that it ran one', async () => {
    // The proof screen renders these. If they were ever a summary rather than
    // the statement issued, the screen would be a drawing of a query.
    const { queries } = await ask(client, buildQuestion('Redshank', 'launch_date'));
    const trip = queries[0]!;

    expect(trip.cypher).toBe(entityByName('Redshank').cypher);
    expect(trip.parameters).toEqual(entityByName('Redshank').parameters);
    expect(trip.rows).toBe(0);
    expect(trip.ms).toBeGreaterThanOrEqual(0);
  });

  it('costs more for a hop than for a direct question', async () => {
    const direct = await askGold(gold('q-stable-01'));
    const hopped = await askGold(gold('q-multi_hop-01'));

    expect(hopped.queries.length).toBeGreaterThan(direct.queries.length);
  });

  it('treats a name carrying Cypher as a name', async () => {
    // If the builder interpolated, this would either error or return rows. It
    // returns an ordinary out of scope, because the name is a parameter.
    const { resolution } = await ask(
      client,
      buildQuestion("Meridian'}) RETURN 1 //", 'launch_date'),
    );

    expect(resolution.outcome).toEqual({ type: 'abstain', reason: 'out_of_scope' });
  });

  it('runs the bounded supersession walk against the engine', async () => {
    // The bound is in the query text, so only a live run proves the engine
    // parses that form rather than rejecting it.
    const rows = await client.queryObjects(entityByName('Bellwether'));
    expect(rows.length).toBe(1);

    const revised = await askGold(gold('q-revised-01'));
    expect(revised.resolution.outcome.type).toBe('answer');
    if (revised.resolution.outcome.type !== 'answer') return;

    const chain = await client.queryObjects(
      supersededByClaim(revised.resolution.outcome.claimId),
    );
    expect(chain.length).toBeGreaterThan(0);
  });

  it('honours a timeout that is too small to complete', async () => {
    await expect(
      ask(client, buildQuestion('Meridian', 'launch_date'), { timeoutMs: 1 }),
    ).rejects.toThrow();
  });
});
