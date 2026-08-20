export type ScheduleCadence = 'DAILY';

export interface ScheduleRetryState {
  readonly state: 'IDLE' | 'PENDING' | 'EXHAUSTED';
  readonly attempts: number;
  readonly lastError: string | null;
}

export interface DailySchedule {
  readonly id: string;
  readonly workspace: string;
  readonly agentId: string;
  readonly name: string;
  readonly task: string;
  readonly runKind: 'CONTEXT_HEALTH';
  readonly cadence: ScheduleCadence;
  /** Local wall-clock time, HH:mm. Daily is the only supported cadence. */
  readonly localTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextEligibleAt: string;
  readonly lastRunAt: string | null;
  readonly lastRunId: string | null;
  readonly retry: ScheduleRetryState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type DispatchStatus = 'CLAIMED' | 'COMPLETED' | 'FAILED';

export interface ScheduleDispatch {
  readonly key: string;
  readonly leaseId: string;
  readonly scheduleId: string;
  readonly workspace: string;
  readonly status: DispatchStatus;
  readonly attempt: number;
  readonly claimedAt: string;
  readonly leaseExpiresAt: string;
  readonly finishedAt: string | null;
  readonly runId: string | null;
  readonly error: string | null;
}

export interface DispatchClaim {
  readonly outcome: 'CLAIMED' | 'DUPLICATE' | 'BUSY' | 'EXHAUSTED';
  readonly dispatch: ScheduleDispatch;
}

export interface ScheduleDispatchResult {
  readonly scheduleId: string;
  readonly outcome: 'DISPATCHED' | 'DUPLICATE' | 'BUSY' | 'EXHAUSTED' | 'FAILED';
  readonly runId: string | null;
}
