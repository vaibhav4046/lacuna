import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { workspaceFingerprint } from '../../src/agent/registry.js';
import { runAgents } from '../../src/agent/run.js';
import { FileAgentRuntimeStore } from '../../src/agent/store.js';
import type { AgentRun } from '../../src/agent/types.js';
import type { HydraSource } from '../../src/hydra/source.js';
import type { ProviderConfig } from '../../src/provider/openai.js';
import {
  ScheduleAuthorizationFailed,
  dailyContextHealthSchedule,
  dispatchDueDaily,
  runScheduleNow,
} from '../../src/scheduler/dispatcher.js';
import { FileScheduleStore, ScheduleAccessDenied } from '../../src/scheduler/store.js';
import { nextDailyOccurrence } from '../../src/scheduler/time.js';
import type { DailySchedule, ScheduleDispatchResult } from '../../src/scheduler/types.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'lacuna-scheduler-'));
  directories.push(value);
  return value;
}

const PROVIDER: ProviderConfig = {
  name: 'stub',
  baseUrl: 'https://provider.invalid/v1',
  apiKey: 'never-persist-this-key',
  where: 'cloud',
};

const SOURCE: HydraSource = {
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
        validFrom: '2026-08-01T00:00:00.000Z',
        txTime: '2026-08-01T00:00:00.000Z',
        supersededBy: [],
      }],
      mentions: [],
    },
    traces: [],
  }),
  evidence: async () => ({ value: [], traces: [] }),
  dependents: async () => ({ value: [], traces: [] }),
};

function model(): typeof fetch {
  let call = 0;
  return (async () => {
    const text = call++ === 0
      ? 'Sessions currently use Redis. No unresolved conflict is present in the supplied evidence.'
      : '{"approved":true,"supported":["Sessions currently use Redis."],"unsupported":[],"note":"supported"}';
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], model: 'stub-model' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

function realRunner(agentStore: FileAgentRuntimeStore): (schedule: DailySchedule, key: string) => Promise<AgentRun> {
  let id = 0;
  return (schedule, key) => runAgents({
    source: SOURCE,
    provider: PROVIDER,
    model: 'stub-model',
    workspace: schedule.workspace,
    collection: schedule.workspace,
    task: schedule.task,
    kind: schedule.runKind,
    knownSubjects: ['Sessions'],
    predicates: ['storage'],
    store: agentStore,
    idempotencyKey: key,
    idFactory: () => `scheduled-${id++}`,
    fetchImpl: model(),
  });
}

const NOW = Date.parse('2026-08-20T10:00:00.000Z');

function dueSchedule(): DailySchedule {
  return {
    ...dailyContextHealthSchedule('workspace-a', '06:00', 'UTC', NOW),
    nextEligibleAt: '2026-08-20T06:00:00.000Z',
  };
}

describe('daily time calculation', () => {
  it('uses the named timezone and a real future wall-clock occurrence', () => {
    expect(nextDailyOccurrence(
      Date.parse('2026-08-20T05:59:30.000Z'),
      '07:00',
      'Europe/London',
    )).toBe('2026-08-20T06:00:00.000Z');
    expect(nextDailyOccurrence(
      Date.parse('2026-08-20T06:00:00.000Z'),
      '07:00',
      'Europe/London',
    )).toBe('2026-08-21T06:00:00.000Z');
  });

  it('does not invent a local minute skipped by daylight saving time', () => {
    expect(nextDailyOccurrence(
      Date.parse('2026-03-29T00:00:00.000Z'),
      '01:30',
      'Europe/London',
    )).toBe('2026-03-30T00:30:00.000Z');
  });
});

describe('the daily dispatcher', () => {
  it('authenticates, dispatches a persisted Context Health run and advances the daily slot', async () => {
    const root = directory();
    const schedules = new FileScheduleStore(root);
    const agents = new FileAgentRuntimeStore(root);
    const schedule = await schedules.putSchedule(dueSchedule());

    await expect(dispatchDueDaily({
      store: schedules,
      workspace: 'workspace-a',
      authorization: 'Bearer wrong',
      cronSecret: 'cron-secret',
      run: realRunner(agents),
      now: () => NOW,
    })).rejects.toBeInstanceOf(ScheduleAuthorizationFailed);

    const result = await dispatchDueDaily({
      store: schedules,
      workspace: 'workspace-a',
      authorization: 'Bearer cron-secret',
      cronSecret: 'cron-secret',
      run: realRunner(agents),
      now: () => NOW,
      leaseId: () => 'lease-daily',
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.outcome).toBe('DISPATCHED');

    const persistedRun = (await agents.listRuns('workspace-a'))[0];
    expect(persistedRun?.kind).toBe('CONTEXT_HEALTH');
    expect(persistedRun?.status).toBe('COMPLETED');
    expect(persistedRun?.writebackDecision.authoritativeMutation).toBe(false);

    const updated = await schedules.getSchedule('workspace-a', schedule.id);
    expect(updated?.lastRunId).toBe(persistedRun?.id);
    expect(updated?.nextEligibleAt).toBe('2026-08-21T06:00:00.000Z');
    expect(updated?.retry.state).toBe('IDLE');
    const stored = readFileSync(join(root, workspaceFingerprint('workspace-a'), 'scheduler.json'), 'utf8');
    expect(stored).not.toContain('cron-secret');
    expect(stored).not.toContain(PROVIDER.apiKey);
  });

  it('claims once under concurrent dispatch and makes manual run-now idempotent', async () => {
    const root = directory();
    const schedules = new FileScheduleStore(root);
    const agents = new FileAgentRuntimeStore(root);
    const schedule = await schedules.putSchedule(dueSchedule());
    const real = realRunner(agents);
    let release = (): void => undefined;
    const pause = new Promise<void>((resolve) => { release = resolve; });
    let entered = (): void => undefined;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let calls = 0;
    const runner = async (value: DailySchedule, key: string): Promise<AgentRun> => {
      calls += 1;
      entered();
      await pause;
      return real(value, key);
    };
    const first = dispatchDueDaily({
      store: schedules,
      workspace: 'workspace-a',
      authorization: 'Bearer cron-secret',
      cronSecret: 'cron-secret',
      run: runner,
      now: () => NOW,
      leaseId: () => 'lease-first',
    });
    await started;
    const second = await dispatchDueDaily({
      store: schedules,
      workspace: 'workspace-a',
      authorization: 'Bearer cron-secret',
      cronSecret: 'cron-secret',
      run: runner,
      now: () => NOW,
      leaseId: () => 'lease-second',
    });
    release();
    expect(second[0]?.outcome).toBe('BUSY');
    expect((await first)[0]?.outcome).toBe('DISPATCHED');
    expect(calls).toBe(1);

    const manualOne = await runScheduleNow({
      store: schedules,
      workspace: 'workspace-a',
      scheduleId: schedule.id,
      requestId: 'button-click-1',
      run: real,
      now: () => NOW + 1_000,
      leaseId: () => 'lease-manual-1',
    });
    const manualTwo = await runScheduleNow({
      store: schedules,
      workspace: 'workspace-a',
      scheduleId: schedule.id,
      requestId: 'button-click-1',
      run: real,
      now: () => NOW + 2_000,
      leaseId: () => 'lease-manual-2',
    });
    expect(manualOne.outcome).toBe('DISPATCHED');
    expect(manualTwo).toEqual({ scheduleId: schedule.id, outcome: 'DUPLICATE', runId: manualOne.runId });
    expect(await agents.listRuns('workspace-a')).toHaveLength(2);
  });

  it('records bounded retry state and refuses cross-workspace access', async () => {
    const root = directory();
    const schedules = new FileScheduleStore(root);
    const schedule = await schedules.putSchedule(dueSchedule());
    const failed = async (): Promise<AgentRun> => { throw new Error('provider secret must not be stored'); };
    const outcomes: ScheduleDispatchResult[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = await dispatchDueDaily({
        store: schedules,
        workspace: 'workspace-a',
        authorization: 'Bearer cron-secret',
        cronSecret: 'cron-secret',
        run: failed,
        now: () => NOW + attempt * 1_000,
        leaseId: () => `lease-${attempt}`,
      });
      const entry = result[0];
      if (entry !== undefined) outcomes.push(entry);
    }
    expect(outcomes.map((entry) => entry.outcome)).toEqual(['FAILED', 'FAILED', 'FAILED', 'EXHAUSTED']);
    expect((await schedules.getSchedule('workspace-a', schedule.id))?.retry).toEqual({
      state: 'EXHAUSTED', attempts: 3, lastError: 'dispatch_failed',
    });
    await expect(schedules.getSchedule('workspace-b', schedule.id)).rejects.toBeInstanceOf(ScheduleAccessDenied);
    const stored = readFileSync(join(root, workspaceFingerprint('workspace-a'), 'scheduler.json'), 'utf8');
    expect(stored).not.toContain('provider secret');
  });
});
