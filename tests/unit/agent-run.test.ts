import { describe, expect, it } from 'vitest';

import { runAgents } from '../../src/agent/run.js';
import { AGENTS } from '../../src/agent/types.js';
import type { HydraSource } from '../../src/hydra/source.js';
import type { ProviderConfig } from '../../src/provider/openai.js';

/**
 * A run is judged on what it refuses, not on what it writes.
 *
 * The model is the least trustworthy part of this pipeline and it is called
 * last on purpose: retrieval and temporal resolution happen before it, so what
 * it receives is claims the resolver already decided. What these check is that
 * the parts around the model hold when the model misbehaves, because it will.
 *
 * Every model call here is a stub. The point is not that a particular model
 * behaves; it is that a draft nothing supports cannot come back approved, an
 * absence is reported as an answer rather than a breakage, and a run that
 * could not be reviewed is never presented as one that was.
 */

const PROVIDER: ProviderConfig = {
  name: 'stub',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'not-a-real-key',
  where: 'cloud',
};

/** A source holding one subject with a replaced value and a live one. */
function sourceWith(claims: readonly { predicate: string; value: string; superseded: boolean }[]): HydraSource {
  return {
    kind: 'cloud',
    subjects: async () => ({ value: ['Sessions'], traces: [] }),
    entity: async () => ({ value: { id: 1, kind: 'service' }, traces: [] }),
    subject: async () => ({
      value: {
        name: 'Sessions',
        id: 1,
        kind: 'service',
        claims: claims.map((claim, index) => ({
          id: index + 1,
          predicate: claim.predicate,
          objectText: claim.value,
          polarity: 'positive' as const,
          validFrom: '2026-01-0'.concat(String(index + 1), 'T00:00:00.000Z'),
          txTime: '2026-01-01T00:00:00.000Z',
          supersededBy: claim.superseded ? [99] : [],
        })),
        mentions: [],
      },
      traces: [],
    }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
  } as unknown as HydraSource;
}

/** Replies in order: first the researcher's draft, then the reviewer's JSON. */
function modelReturning(...replies: readonly string[]): typeof fetch {
  let at = 0;
  return (async () => {
    const text = replies[Math.min(at, replies.length - 1)] ?? '';
    at += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], model: 'stub' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const BASE = {
  provider: PROVIDER,
  model: 'stub-model',
  workspace: 'lacuna-ws-test',
  collection: 'lacuna-ws-test',
  knownSubjects: ['Sessions'],
  predicates: ['storage'],
};

describe('the two agents', () => {
  it('are a gatherer and a checker, and neither may write', () => {
    expect(AGENTS.RESEARCHER.writeback).toBe('NO_WRITE');
    expect(AGENTS.REVIEWER.writeback).toBe('NO_WRITE');
    // The reviewer gets no tools. It judges the evidence it was handed and
    // cannot go looking for more that would support the draft.
    expect(AGENTS.REVIEWER.tools).toEqual([]);
  });
});

describe('a run over a workspace that says nothing', () => {
  it('completes reporting the absence rather than failing', async () => {
    const run = await runAgents({
      ...BASE,
      source: sourceWith([]),
      task: 'What is the storage for Sessions?',
    });
    // Nothing stated is the answer, not a broken run. A memory that reports
    // absence as failure teaches people to distrust its absences.
    expect(run.status).toBe('COMPLETED');
    expect(run.draft).toContain('Nothing in this workspace states');
    expect(run.verdict?.approved).toBe(true);
  });
});

describe('a task naming nothing the workspace holds', () => {
  it('refuses before spending a model call', async () => {
    const run = await runAgents({
      ...BASE,
      source: sourceWith([{ predicate: 'storage', value: 'Redis', superseded: false }]),
      task: 'What is the storage for something-that-does-not-exist?',
    });
    expect(run.status).toBe('FAILED');
    expect(run.error).toBe('no_known_subject');
    expect(run.pack).toBeNull();
  });
});

describe('the reviewer', () => {
  const source = sourceWith([
    { predicate: 'storage', value: 'Postgres', superseded: true },
    { predicate: 'storage', value: 'Redis', superseded: false },
  ]);

  it('refuses a draft the evidence does not support', async () => {
    const run = await runAgents({
      ...BASE,
      source,
      task: 'What is the storage for Sessions?',
      // The draft asserts a value nothing in the pack contains.
      fetchImpl: modelReturning(
        'Sessions are stored in Cassandra.',
        '{"approved": true, "supported": [], "unsupported": ["Sessions are stored in Cassandra."], "note": "not in evidence"}',
      ),
    } as never);
    expect(run.status).toBe('COMPLETED');
    // The reviewer claimed approved while listing something unsupported.
    // Approval is derived rather than trusted, so it does not stand.
    expect(run.verdict?.approved).toBe(false);
    expect(run.verdict?.unsupported).toHaveLength(1);
  });

  it('does not let unreadable JSON count as approval', async () => {
    const run = await runAgents({
      ...BASE,
      source,
      task: 'What is the storage for Sessions?',
      fetchImpl: modelReturning('Sessions use Redis.', 'I think it looks fine to me.'),
    } as never);
    expect(run.verdict?.approved).toBe(false);
    expect(run.verdict?.note).toContain('verdict');
  });
});

describe('the handoff', () => {
  it('carries facts and evidence, never the draft or the reasoning', async () => {
    const run = await runAgents({
      ...BASE,
      source: sourceWith([
        { predicate: 'storage', value: 'Postgres', superseded: true },
        { predicate: 'storage', value: 'Redis', superseded: false },
      ]),
      task: 'What is the storage for Sessions?',
      fetchImpl: modelReturning(
        'Sessions use Redis, previously Postgres.',
        '{"approved": true, "supported": ["Sessions use Redis"], "unsupported": [], "note": "ok"}',
      ),
    } as never);

    const handoff = run.handoff;
    expect(handoff).not.toBeNull();
    expect(handoff?.from).toBe('RESEARCHER');
    expect(handoff?.to).toBe('REVIEWER');
    // Only the live value crosses. A reviewer handed the superseded one as a
    // fact would be asked to verify history as if it were current.
    expect(handoff?.supportedFacts.some((fact) => fact.includes('Redis'))).toBe(true);
    expect(handoff?.supportedFacts.some((fact) => fact.includes('Postgres'))).toBe(false);
    // And the draft is not in it.
    expect(JSON.stringify(handoff)).not.toContain('previously Postgres');
  });
});

describe('what a run may spend', () => {
  it('resolves its budget before starting and never from the model', async () => {
    const run = await runAgents({
      ...BASE,
      source: sourceWith([{ predicate: 'storage', value: 'Redis', superseded: false }]),
      task: 'What is the storage for Sessions?',
      fetchImpl: modelReturning(
        'Sessions use Redis.',
        '{"approved": true, "supported": ["Sessions use Redis."], "unsupported": [], "note": "ok"}',
      ),
    } as never);

    expect(run.manifest.canWrite).toBe(false);
    expect(run.manifest.maxModelCalls).toBe(2);
    expect(run.manifest.workspace).toBe('lacuna-ws-test');
    // No stage claims a percentage, because there is nothing to be a
    // percentage of.
    expect(JSON.stringify(run.events)).not.toMatch(/\d+%/);
  });

  it('fails closed when the wall-time budget is exhausted', async () => {
    let tick = 0;
    const run = await runAgents({
      ...BASE,
      source: sourceWith([{ predicate: 'storage', value: 'Redis', superseded: false }]),
      task: 'What is the storage for Sessions?',
      now: () => tick++ * 70_000,
      fetchImpl: modelReturning('must not be used'),
    } as never);
    expect(run.status).toBe('FAILED');
    expect(run.error).toBe('over_budget');
  });
});
