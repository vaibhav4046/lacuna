import { describe, expect, it } from 'vitest';

import { runAgents } from '../../src/agent/run.js';
import type { ReviewVerdict } from '../../src/agent/types.js';
import {
  RERANKER_MAX_PAIRS,
  judgeSentences,
  mergeVerdict,
  rerankerConfig,
  scorePairs,
  splitSentences,
  verifyDraft,
} from '../../src/agent/verifier.js';
import type { HydraSource } from '../../src/hydra/source.js';
import type { FetchLike, ProviderConfig } from '../../src/provider/openai.js';

/**
 * The claim verifier is optional and may only make a review stricter. These
 * check that it is inert when unset, that a sidecar outage changes nothing,
 * and that it can never approve a draft the Reviewer rejected.
 */

const CONFIG = { url: 'http://127.0.0.1:8765', threshold: 0.5 };

/** A fake sidecar: scores each pair with `score`, and records every request body. */
function sidecar(score: (claim: string, passage: string) => number) {
  const requests: { claim: string; passage: string }[][] = [];
  const fetchImpl: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init.body)) as { pairs: { claim: string; passage: string }[] };
    requests.push(body.pairs);
    const scores = body.pairs.map((pair) => score(pair.claim, pair.passage));
    return new Response(JSON.stringify({ scores, model: 'fake', threshold: 0.5 }), { status: 200 });
  };
  return { fetchImpl, requests };
}

const VERDICT: ReviewVerdict = { approved: true, supported: ['a'], unsupported: [], note: 'ok' };

describe('configuration', () => {
  it('is off when the flag is unset or blank', () => {
    expect(rerankerConfig({})).toBeNull();
    expect(rerankerConfig({ LACUNA_RERANKER_URL: '  ' })).toBeNull();
  });

  it('accepts http(s) with a default threshold of 0.5', () => {
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'http://127.0.0.1:8765/' }))
      .toEqual({ url: 'http://127.0.0.1:8765', threshold: 0.5 });
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'https://r.example', LACUNA_RERANKER_THRESHOLD: '0.7' }))
      .toEqual({ url: 'https://r.example', threshold: 0.7 });
  });

  it('reports a non-http URL or an out-of-range threshold as invalid', () => {
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'file:///etc/passwd' })).toHaveProperty('invalid');
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'not a url' })).toHaveProperty('invalid');
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'http://x', LACUNA_RERANKER_THRESHOLD: '2' })).toHaveProperty('invalid');
    expect(rerankerConfig({ LACUNA_RERANKER_URL: 'http://x', LACUNA_RERANKER_THRESHOLD: 'high' })).toHaveProperty('invalid');
  });
});

describe('sentence splitting', () => {
  it('splits prose and bullets and drops citation-only fragments', () => {
    const draft = 'Sessions use Redis. It replaced Postgres on 3 May 2026! [1]\n- Owner is Priya Raman.\n(source: standup)\n\n';
    expect(splitSentences(draft)).toEqual([
      'Sessions use Redis.',
      'It replaced Postgres on 3 May 2026!',
      'Owner is Priya Raman.',
    ]);
  });

  it('does not split inside a value like a budget code or decimal', () => {
    expect(splitSentences('Halcyon bills to BC-7365. Budget is 1.5 million.'))
      .toEqual(['Halcyon bills to BC-7365.', 'Budget is 1.5 million.']);
  });
});

describe('threshold logic', () => {
  it('supports a sentence when its best passage score reaches the threshold', () => {
    // two sentences x three passages, row major
    const scores = [0.1, 0.5, 0.2, 0.49, 0.3, 0.0];
    expect(judgeSentences(['s1', 's2'], 3, scores, 0.5)).toEqual({ supported: ['s1'], unsupported: ['s2'] });
  });
});

describe('merging with the Reviewer verdict', () => {
  it('only ever makes the verdict stricter', () => {
    const stricter = mergeVerdict(VERDICT, { supported: [], unsupported: ['b'] });
    expect(stricter).toEqual({ approved: false, supported: ['a'], unsupported: ['b'], note: expect.stringContaining('ok Claim verifier') });

    const rejected: ReviewVerdict = { approved: false, supported: [], unsupported: ['x'], note: '' };
    expect(mergeVerdict(rejected, { supported: ['x', 'y'], unsupported: [] })).toBe(rejected);
    expect(mergeVerdict(VERDICT, { supported: ['a'], unsupported: [] })).toBe(VERDICT);
  });
});

describe('batching', () => {
  it('sends at most 256 pairs per request and keeps score order', async () => {
    const { fetchImpl, requests } = sidecar((claim) => Number(claim) / 1000);
    const pairs = Array.from({ length: 600 }, (_, i) => ({ claim: String(i), passage: 'p' }));
    const scores = await scorePairs(CONFIG, pairs, { fetch: fetchImpl });
    expect(requests.map((r) => r.length)).toEqual([RERANKER_MAX_PAIRS, RERANKER_MAX_PAIRS, 88]);
    expect(scores).toHaveLength(600);
    expect(scores[599]).toBeCloseTo(0.599);
  });

  it('rejects a reply whose score count does not match', async () => {
    const bad: FetchLike = async () => new Response(JSON.stringify({ scores: [0.9] }), { status: 200 });
    await expect(scorePairs(CONFIG, [{ claim: 'a', passage: 'b' }, { claim: 'c', passage: 'd' }], { fetch: bad }))
      .rejects.toThrow('do not match');
  });
});

describe('a sidecar that is down', () => {
  it('reports unavailable and never throws', async () => {
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const outcome = await verifyDraft(CONFIG, 'Sessions use Redis.', ['Sessions use Redis.'], { fetch: down });
    expect(outcome).toEqual({ status: 'unavailable', detail: 'fetch failed' });
  });
});

const PROVIDER: ProviderConfig = { name: 'stub', baseUrl: 'https://provider.invalid/v1', apiKey: 'k', where: 'cloud' };

const SOURCE = {
  kind: 'cloud',
  subjects: async () => ({ value: ['Sessions'], traces: [] }),
  entity: async () => ({ value: { id: 1, kind: 'service' }, traces: [] }),
  subject: async () => ({
    value: {
      name: 'Sessions',
      id: 1,
      kind: 'service',
      claims: [{
        id: 1,
        predicate: 'storage',
        objectText: 'Redis',
        polarity: 'positive' as const,
        validFrom: '2026-01-01T00:00:00.000Z',
        txTime: '2026-01-01T00:00:00.000Z',
        supersededBy: [],
      }],
      mentions: [],
    },
    traces: [],
  }),
  evidence: async () => ({ value: [], traces: [] }),
  dependents: async () => ({ value: [], traces: [] }),
} as unknown as HydraSource;

const DRAFT = 'Sessions use Redis. They also run on Cassandra.';
const APPROVE = '{"approved": true, "supported": ["Sessions use Redis.", "They also run on Cassandra."], "unsupported": [], "note": "ok"}';

function model(...replies: string[]): FetchLike {
  let at = 0;
  return async () => {
    const text = replies[Math.min(at, replies.length - 1)] ?? '';
    at += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], model: 'stub' }), { status: 200 });
  };
}

function runWith(env: Record<string, string>, rerankerFetch?: FetchLike) {
  return runAgents({
    provider: PROVIDER,
    model: 'stub-model',
    workspace: 'lacuna-ws-test',
    collection: 'lacuna-ws-test',
    knownSubjects: ['Sessions'],
    predicates: ['storage'],
    source: SOURCE,
    task: 'What is the storage for Sessions?',
    fetchImpl: model(DRAFT, APPROVE),
    env,
    ...(rerankerFetch === undefined ? {} : { rerankerFetch }),
  });
}

const cassandraUnsupported = sidecar((claim) => (claim.includes('Cassandra') ? 0.02 : 0.97));

describe('a run with the flag off', () => {
  it('keeps the Reviewer verdict and never calls the sidecar', async () => {
    const { fetchImpl, requests } = sidecar(() => 0);
    const run = await runWith({}, fetchImpl);
    expect(run.status).toBe('COMPLETED');
    expect(run.verdict).toEqual(JSON.parse(APPROVE));
    expect(run.result).toBe(DRAFT);
    expect(requests).toHaveLength(0);
    expect(run.trace.some((t) => t.detail.includes('claim verifier'))).toBe(false);
  });
});

describe('a run with the flag on', () => {
  it('rejects a draft sentence no evidence line supports, even after Reviewer approval', async () => {
    const run = await runWith({ LACUNA_RERANKER_URL: 'http://127.0.0.1:8765' }, cassandraUnsupported.fetchImpl);
    expect(run.status).toBe('COMPLETED');
    expect(run.verdict?.approved).toBe(false);
    expect(run.verdict?.unsupported).toEqual(['They also run on Cassandra.']);
    expect(run.result).toBeNull();
    // The quote is null in this pack, so the rendered line is the passage.
    expect(cassandraUnsupported.requests[0]?.[0]).toEqual({
      claim: 'Sessions use Redis.',
      passage: 'Sessions storage = Redis [CURRENT]',
    });
    expect(run.trace.some((t) => t.kind === 'TOOL' && t.detail.includes('1 of 2 sentence(s) unsupported'))).toBe(true);
  });

  it('keeps the Reviewer verdict unchanged and records the status when the sidecar is down', async () => {
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const run = await runWith({ LACUNA_RERANKER_URL: 'http://127.0.0.1:8765' }, down);
    expect(run.status).toBe('COMPLETED');
    expect(run.verdict).toEqual(JSON.parse(APPROVE));
    expect(run.result).toBe(DRAFT);
    expect(run.trace.some((t) => t.detail.includes('claim verifier unavailable: fetch failed'))).toBe(true);
  });

  it('skips with a recorded reason when the URL is not http(s)', async () => {
    const run = await runWith({ LACUNA_RERANKER_URL: 'ftp://127.0.0.1' }, cassandraUnsupported.fetchImpl);
    expect(run.verdict).toEqual(JSON.parse(APPROVE));
    expect(run.trace.some((t) => t.detail.startsWith('claim verifier skipped'))).toBe(true);
  });
});
