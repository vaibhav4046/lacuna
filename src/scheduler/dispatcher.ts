import { randomUUID, timingSafeEqual } from 'node:crypto';

import { builtInAgentId, workspaceFingerprint } from '../agent/registry.js';
import type { AgentRun } from '../agent/types.js';
import type { ScheduleStore } from './store.js';
import { nextDailyOccurrence } from './time.js';
import type { DailySchedule, DispatchClaim, ScheduleDispatchResult } from './types.js';

const LEASE_MS = 70_000;
const MAX_ATTEMPTS = 3;
const MAX_DUE_PER_TICK = 10;

export const DAILY_CONTEXT_HEALTH_TASK = [
  'Review daily context health for this workspace.',
  'Report supported changes, unresolved conflicts, stale procedure evidence and missing evidence needed for safe work.',
  'Do not mutate authoritative context.',
].join(' ');

export class ScheduleAuthorizationFailed extends Error {
  override readonly name = 'ScheduleAuthorizationFailed';
}

/** CRON_SECRET is checked in memory and never written to a schedule record. */
export function cronAuthorized(authorization: string | undefined, secret: string | undefined): boolean {
  if (authorization === undefined || secret === undefined || secret === '') return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function dailyContextHealthSchedule(
  workspace: string,
  localTime: string,
  timezone: string,
  nowMs: number,
): DailySchedule {
  const at = new Date(nowMs).toISOString();
  return {
    id: `schedule-${workspaceFingerprint(workspace)}-daily-context-health`,
    workspace,
    agentId: builtInAgentId(workspace, 'RESEARCHER'),
    name: 'Daily Context Health Agent',
    task: DAILY_CONTEXT_HEALTH_TASK,
    runKind: 'CONTEXT_HEALTH',
    cadence: 'DAILY',
    localTime,
    timezone,
    enabled: true,
    nextEligibleAt: nextDailyOccurrence(nowMs, localTime, timezone),
    lastRunAt: null,
    lastRunId: null,
    retry: { state: 'IDLE', attempts: 0, lastError: null },
    createdAt: at,
    updatedAt: at,
  };
}

export interface ScheduleRunner {
  (schedule: DailySchedule, idempotencyKey: string): Promise<AgentRun>;
}

function dueKey(schedule: DailySchedule): string {
  return `daily:${schedule.id}:${schedule.nextEligibleAt}`;
}

async function finishClaim(
  store: ScheduleStore,
  schedule: DailySchedule,
  claim: DispatchClaim,
  rawKey: string,
  now: () => number,
  run: ScheduleRunner,
  advance: boolean,
): Promise<ScheduleDispatchResult> {
  if (claim.outcome !== 'CLAIMED') {
    return {
      scheduleId: schedule.id,
      outcome: claim.outcome,
      runId: claim.dispatch.runId,
    };
  }
  try {
    const agentRun = await run(schedule, rawKey);
    const finishedMs = now();
    const next = advance
      ? nextDailyOccurrence(Math.max(finishedMs, Date.parse(schedule.nextEligibleAt)), schedule.localTime, schedule.timezone)
      : null;
    await store.completeDispatch(
      schedule.workspace,
      rawKey,
      claim.dispatch.leaseId,
      agentRun.id,
      new Date(finishedMs).toISOString(),
      next,
    );
    return { scheduleId: schedule.id, outcome: 'DISPATCHED', runId: agentRun.id };
  } catch {
    const exhausted = claim.dispatch.attempt >= MAX_ATTEMPTS;
    await store.failDispatch(
      schedule.workspace,
      rawKey,
      claim.dispatch.leaseId,
      new Date(now()).toISOString(),
      exhausted,
    );
    return { scheduleId: schedule.id, outcome: 'FAILED', runId: null };
  }
}

async function claimAndRun(
  store: ScheduleStore,
  schedule: DailySchedule,
  rawKey: string,
  now: () => number,
  run: ScheduleRunner,
  advance: boolean,
  leaseId: () => string,
): Promise<ScheduleDispatchResult> {
  const at = new Date(now()).toISOString();
  const claim = await store.claimDispatch(
    schedule.workspace,
    schedule.id,
    rawKey,
    at,
    LEASE_MS,
    MAX_ATTEMPTS,
    leaseId(),
  );
  return finishClaim(store, schedule, claim, rawKey, now, run, advance);
}

/** One authenticated daily endpoint invocation for one workspace. */
export async function dispatchDueDaily(options: {
  readonly store: ScheduleStore;
  readonly workspace: string;
  readonly authorization: string | undefined;
  readonly cronSecret: string | undefined;
  readonly run: ScheduleRunner;
  readonly now?: () => number;
  readonly leaseId?: () => string;
}): Promise<readonly ScheduleDispatchResult[]> {
  if (!cronAuthorized(options.authorization, options.cronSecret)) throw new ScheduleAuthorizationFailed('cron authorization failed');
  const now = options.now ?? Date.now;
  const at = now();
  const schedules = (await options.store.listSchedules(options.workspace))
    .filter((schedule) => schedule.enabled && Date.parse(schedule.nextEligibleAt) <= at)
    .slice(0, MAX_DUE_PER_TICK);
  const out: ScheduleDispatchResult[] = [];
  for (const schedule of schedules) {
    out.push(await claimAndRun(
      options.store,
      schedule,
      dueKey(schedule),
      now,
      options.run,
      true,
      options.leaseId ?? randomUUID,
    ));
  }
  return out;
}

/** Session-authorized routes can call this. It does not change the daily slot. */
export async function runScheduleNow(options: {
  readonly store: ScheduleStore;
  readonly workspace: string;
  readonly scheduleId: string;
  readonly requestId: string;
  readonly run: ScheduleRunner;
  readonly now?: () => number;
  readonly leaseId?: () => string;
}): Promise<ScheduleDispatchResult> {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(options.requestId)) throw new Error('invalid manual request id');
  const schedule = await options.store.getSchedule(options.workspace, options.scheduleId);
  if (schedule === null) throw new Error('schedule does not exist');
  return claimAndRun(
    options.store,
    schedule,
    `manual:${schedule.id}:${options.requestId}`,
    options.now ?? Date.now,
    options.run,
    false,
    options.leaseId ?? randomUUID,
  );
}
