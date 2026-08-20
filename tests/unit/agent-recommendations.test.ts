import { describe, expect, it } from 'vitest';

import { recommendedAgents, type ResolvedMemorySignal } from '../../src/agent/registry.js';
import { recommendedDailySchedule } from '../../src/scheduler/dispatcher.js';

const ROWS: readonly ResolvedMemorySignal[] = [
  { entity: 'Billing Gate', claim: 'Billing Gate owner Priya Raman', st: 'CON' },
  { entity: 'Billing Gate', claim: 'Billing Gate owner Rasmus Berg', st: 'CON' },
  { entity: 'Atlas Relay', claim: 'Atlas Relay owner Mira Chen', st: 'SUP' },
  { entity: 'Atlas Relay', claim: 'Atlas Relay owner Jonas Vale', st: 'CUR' },
  { entity: 'Kepler Gateway', claim: 'Kepler Gateway region eu-central-1', st: 'CUR' },
  { entity: 'Roadmap', claim: 'Roadmap proposal:launch October', st: 'PRO' },
];

describe('memory-derived agent recommendations', () => {
  it('turns resolved standings into deterministic, bounded, no-write suggestions', () => {
    const first = recommendedAgents('workspace-a', ROWS);
    const second = recommendedAgents('workspace-a', [...ROWS].reverse());

    expect(first.map((item) => item.kind)).toEqual(['CONFLICT_TRIAGE', 'CHANGE_BRIEF', 'CONTEXT_BRIEF']);
    expect(second).toEqual(first);
    expect(first[0]).toMatchObject({
      subject: 'Billing Gate',
      flow: ['RESEARCHER', 'REVIEWER'],
      tools: ['lacuna_context_pack'],
      permissions: { write: [] },
      writeback: 'NO_WRITE',
      suggestedSchedule: { cadence: 'DAILY', localTime: '06:00', timezone: 'UTC' },
    });
    expect(first.every((item) => item.task.length <= 600 && item.budgets.maxWallMs === 60_000)).toBe(true);
    expect(JSON.stringify(first)).not.toContain('proposal:launch');
  });

  it('scopes ids to the server-derived workspace and ignores unusable signals', () => {
    const a = recommendedAgents('workspace-a', ROWS);
    const b = recommendedAgents('workspace-b', ROWS);
    expect(a.map((item) => item.id)).not.toEqual(b.map((item) => item.id));
    expect(recommendedAgents('workspace-a', [
      { entity: '', claim: 'unscoped', st: 'CUR' },
      { entity: 'Only a proposal', claim: 'Only a proposal launch October', st: 'PRO' },
    ])).toEqual([]);
  });

  it('materialises only the supported daily schedule and remains idempotent by id', () => {
    const recommendation = recommendedAgents('workspace-a', ROWS)[0];
    if (recommendation === undefined) throw new Error('missing recommendation');
    const first = recommendedDailySchedule('workspace-a', recommendation, '09:30', 'Europe/London', Date.UTC(2026, 7, 20, 8));
    const second = recommendedDailySchedule('workspace-a', recommendation, '09:30', 'Europe/London', Date.UTC(2026, 7, 20, 8));

    expect(second).toEqual(first);
    expect(first).toMatchObject({ cadence: 'DAILY', localTime: '09:30', timezone: 'Europe/London', enabled: true });
    expect(first.task).toBe(recommendation.task);
    expect(first.agentId).toContain('researcher');
    expect(() => recommendedDailySchedule('workspace-b', recommendation, '09:30', 'UTC', 0)).toThrow(/another workspace/);
    expect(() => recommendedDailySchedule('workspace-a', recommendation, '25:00', 'UTC', 0)).toThrow(/HH:mm/);
    expect(() => recommendedDailySchedule('workspace-a', recommendation, '09:30', 'not a zone', 0)).toThrow(/timezone/);
  });
});
