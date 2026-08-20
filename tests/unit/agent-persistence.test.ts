import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  agentPageRecords,
} from '../../src/agent/registry.js';
import {
  AgentInputRejected,
  cancelAgentRun,
  retryAgentRun,
  runAgents,
} from '../../src/agent/run.js';
import {
  FileAgentRuntimeStore,
  InvalidRunTransition,
  WorkspaceAccessDenied,
} from '../../src/agent/store.js';
import { registeredAgentTools } from '../../src/agent/tools.js';
import type { HydraSource } from '../../src/hydra/source.js';
import type { ProviderConfig } from '../../src/provider/openai.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function store(): FileAgentRuntimeStore {
  const directory = mkdtempSync(join(tmpdir(), 'lacuna-agent-runtime-'));
  directories.push(directory);
  return new FileAgentRuntimeStore(directory);
}

const PROVIDER: ProviderConfig = {
  name: 'stub',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'this-key-must-never-be-persisted',
  where: 'cloud',
};

function source(options: { readonly pause?: Promise<void>; readonly notify?: () => void } = {}): HydraSource {
  return {
    kind: 'cloud',
    subjects: async () => ({ value: ['Sessions'], traces: [] }),
    entity: async () => ({ value: { id: 1, kind: 'service' }, traces: [] }),
    subject: async () => {
      options.notify?.();
      await options.pause;
      return {
        value: {
          name: 'Sessions',
          id: 1,
          kind: 'service',
          claims: [{
            id: 7,
            predicate: 'storage',
            objectText: 'Redis',
            polarity: 'positive' as const,
            validFrom: '2026-08-01T00:00:00.000Z',
            txTime: '2026-08-01T00:00:00.000Z',
            supersededBy: [],
          }],
          mentions: [],
        },
        traces: [],
      };
    },
    evidence: async () => ({
      value: [{
        claimId: 7,
        spanId: 70,
        quote: 'Sessions now use Redis.',
        start: 0,
        end: 23,
        messageId: 700,
        role: 'user',
        ts: '2026-08-01T00:00:00.000Z',
        sessionId: 7000,
        sessionTitle: 'Storage migration',
      }],
      traces: [],
    }),
    dependents: async () => ({ value: [], traces: [] }),
  };
}

function modelReturning(...replies: readonly string[]): typeof fetch {
  let at = 0;
  return (async () => {
    const text = replies[Math.min(at, replies.length - 1)] ?? '';
    at += 1;
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], model: 'stub-model' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const base = {
  source: source(),
  provider: PROVIDER,
  model: 'stub-model',
  workspace: 'workspace-a',
  collection: 'workspace-a',
  task: 'What storage does Sessions use?',
  knownSubjects: ['Sessions'],
  predicates: ['storage'],
};

describe('persisted agent runtime', () => {
  it('stores the full operational result and reloads it deterministically', async () => {
    const runtime = store();
    const run = await runAgents({
      ...base,
      store: runtime,
      idFactory: () => 'persisted',
      idempotencyKey: 'request-1',
      fetchImpl: modelReturning(
        'Sessions use Redis.',
        '{"approved":true,"supported":["Sessions use Redis."],"unsupported":[],"note":"supported"}',
      ),
    });

    expect(run.status).toBe('COMPLETED');
    expect(run.events.map((event) => event.stage)).toEqual([
      'CREATED', 'QUEUED', 'RUNNING', 'WAITING_TOOL', 'RUNNING', 'HANDOFF', 'RUNNING', 'COMPLETED',
    ]);
    expect(run.result).toBe('Sessions use Redis.');
    expect(run.supportedClaims).toEqual(['Sessions use Redis.']);
    expect(run.evidenceRefs[0]?.quote).toBe('Sessions now use Redis.');
    expect(run.toolEvents[0]).toMatchObject({ tool: 'lacuna_context_pack', status: 'COMPLETED', calls: 1 });
    expect(registeredAgentTools([run])).toEqual([
      expect.objectContaining({
        name: 'lacuna_context_pack',
        access: 'READ',
        sideEffect: 'NONE',
        lastVerifiedAt: run.toolEvents[0]?.finishedAt,
      }),
    ]);
    expect(JSON.stringify(registeredAgentTools([run]))).not.toMatch(/github|slack/i);
    expect(run.writebackDecision.authoritativeMutation).toBe(false);
    expect(run.trace.some((entry) => entry.detail.includes('HANDOFF'))).toBe(true);

    const page = agentPageRecords(await runtime.listAgents('workspace-a'), [run]);
    expect(page.map((agent) => agent.lastRun?.id)).toEqual([run.id, run.id]);

    const reloaded = await runtime.getRun('workspace-a', run.id);
    expect(reloaded).toEqual(run);
    expect(JSON.stringify(reloaded)).not.toContain(PROVIDER.apiKey);

    const duplicate = await runAgents({
      ...base,
      store: runtime,
      idFactory: () => 'ignored',
      idempotencyKey: 'request-1',
      fetchImpl: modelReturning('must not run'),
    });
    expect(duplicate).toEqual(run);
    expect(await runtime.listRuns('workspace-a')).toHaveLength(1);
  });

  it('rejects wrong-workspace reads and invalid terminal transitions', async () => {
    const runtime = store();
    const run = await runAgents({
      ...base,
      store: runtime,
      fetchImpl: modelReturning(
        'Sessions use Redis.',
        '{"approved":true,"supported":[],"unsupported":[],"note":"ok"}',
      ),
    });
    await expect(runtime.getRun('workspace-b', run.id)).rejects.toBeInstanceOf(WorkspaceAccessDenied);
    await expect(cancelAgentRun(runtime, 'workspace-a', run.id)).rejects.toBeInstanceOf(InvalidRunTransition);
  });

  it('never persists a task that looks like a credential', async () => {
    const runtime = store();
    await expect(runAgents({
      ...base,
      store: runtime,
      task: 'Use api_key=definitely-secret to inspect Sessions',
      fetchImpl: modelReturning('unused'),
    })).rejects.toBeInstanceOf(AgentInputRejected);
    expect(await runtime.listRuns('workspace-a')).toEqual([]);
  });
});

describe('cancellation and retry', () => {
  it('does not let a late tool result overwrite cancellation, then retries as a new attempt', async () => {
    const runtime = store();
    let release = (): void => undefined;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    let started = (): void => undefined;
    const toolStarted = new Promise<void>((resolve) => { started = resolve; });

    const pending = runAgents({
      ...base,
      source: source({ pause, notify: started }),
      store: runtime,
      idFactory: () => 'cancelled',
      fetchImpl: modelReturning(
        'Sessions use Redis.',
        '{"approved":true,"supported":[],"unsupported":[],"note":"ok"}',
      ),
    });
    await toolStarted;
    const active = (await runtime.listRuns('workspace-a'))[0];
    expect(active?.status).toBe('WAITING_TOOL');
    const cancelled = await cancelAgentRun(runtime, 'workspace-a', active?.id ?? 'missing');
    release();
    expect((await pending).status).toBe('CANCELLED');
    expect((await runtime.getRun('workspace-a', cancelled.id))?.status).toBe('CANCELLED');

    const retried = await retryAgentRun(runtime, 'workspace-a', cancelled.id, {
      ...base,
      source: source(),
      idFactory: () => 'retry',
      fetchImpl: modelReturning(
        'Sessions use Redis.',
        '{"approved":true,"supported":["Sessions use Redis."],"unsupported":[],"note":"ok"}',
      ),
    });
    expect(retried.status).toBe('COMPLETED');
    expect(retried.retryOf).toBe(cancelled.id);
    expect(retried.attempt).toBe(2);
    const duplicateRetry = await retryAgentRun(runtime, 'workspace-a', cancelled.id, {
      ...base,
      source: source(),
      idFactory: () => 'must-not-create-a-third-run',
      fetchImpl: modelReturning('unused'),
    });
    expect(duplicateRetry.id).toBe(retried.id);
    expect(await runtime.listRuns('workspace-a')).toHaveLength(2);
  });
});
