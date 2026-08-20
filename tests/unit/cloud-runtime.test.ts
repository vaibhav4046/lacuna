import { describe, expect, it } from 'vitest';

import { builtInAgents } from '../../src/agent/registry.js';
import { CloudAgentRuntimeStore } from '../../src/agent/store.js';
import type { AppRecord, HydraCloud, InspectedSource, IngestResult } from '../../src/hydra/cloud.js';
import { dailyContextHealthSchedule } from '../../src/scheduler/dispatcher.js';
import { CloudScheduleStore } from '../../src/scheduler/store.js';

/** Exact-id, immediate fake of only the Hydra application-record seam used here. */
class RecordCloud {
  readonly records = new Map<string, string>();

  async inspect(id: string, _timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    const text = this.records.get(`${collection}:${id}`);
    return text === undefined ? null : {
      id,
      envelope: JSON.stringify({ content: { text } }),
      latencyMs: 1,
    };
  }

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    for (const record of records) this.records.set(`${collection}:${record.id}`, record.text);
    return records.map((record) => ({ id: record.id, filename: record.title, status: 'completed', error: null }));
  }
}

function hydra(value: RecordCloud): HydraCloud {
  return value as unknown as HydraCloud;
}

describe('HydraDB hosted runtime records', () => {
  it('reloads agent definitions across cold store instances without persisting credentials', async () => {
    const cloud = new RecordCloud();
    const first = new CloudAgentRuntimeStore(hydra(cloud));
    await first.putAgents('workspace-a', builtInAgents(
      'workspace-a',
      'groq',
      'groq/compound-mini',
      '2026-08-20T00:00:00.000Z',
    ));

    const second = new CloudAgentRuntimeStore(hydra(cloud));
    const reloaded = await second.listAgents('workspace-a');
    expect(reloaded.map((agent) => agent.role)).toEqual(['RESEARCHER', 'REVIEWER']);
    expect(JSON.stringify([...cloud.records.values()])).not.toMatch(/api[_-]?key|bearer/i);
  });

  it('reloads daily schedules and preserves completed dispatch idempotency', async () => {
    const cloud = new RecordCloud();
    const first = new CloudScheduleStore(hydra(cloud));
    const schedule = await first.putSchedule(dailyContextHealthSchedule(
      'workspace-a',
      '06:00',
      'UTC',
      Date.parse('2026-08-20T00:00:00.000Z'),
    ));
    const key = `daily:${schedule.id}:${schedule.nextEligibleAt}`;
    const claim = await first.claimDispatch(
      'workspace-a', schedule.id, key, schedule.nextEligibleAt, 70_000, 3, 'lease-a',
    );
    expect(claim.outcome).toBe('CLAIMED');
    await first.completeDispatch(
      'workspace-a', key, 'lease-a', 'run-a', schedule.nextEligibleAt, '2026-08-21T06:00:00.000Z',
    );

    const cold = new CloudScheduleStore(hydra(cloud));
    const reloaded = await cold.listSchedules('workspace-a');
    expect(reloaded[0]).toMatchObject({ lastRunId: 'run-a', nextEligibleAt: '2026-08-21T06:00:00.000Z' });
    const duplicate = await cold.claimDispatch(
      'workspace-a', schedule.id, key, '2026-08-20T06:01:00.000Z', 70_000, 3, 'lease-b',
    );
    expect(duplicate.outcome).toBe('DUPLICATE');
  });
});
