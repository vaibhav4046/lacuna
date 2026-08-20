export type RunStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_TOOL'
  | 'HANDOFF'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface AgentRecord {
  readonly id: string;
  readonly name: string;
  readonly role: 'RESEARCHER' | 'REVIEWER';
  readonly workspace: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: string;
  readonly contextPolicy: string;
  readonly tools: readonly string[];
  readonly permissions: { readonly read: readonly string[]; readonly write: readonly string[] };
  readonly budgets: {
    readonly maxModelCalls: number;
    readonly maxToolCalls: number;
    readonly maxContextClaims: number;
    readonly maxOutputTokens: number;
    readonly maxWallMs: number;
  };
  readonly writeback: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastRun: { readonly id: string; readonly status: RunStatus; readonly at: string } | null;
}

export interface EvidenceReference {
  readonly id: string;
  readonly subject: string;
  readonly predicate: string;
  readonly standing: string;
  readonly quote: string;
  readonly source: string | null;
  readonly observedAt: string | null;
}

export interface AgentRunRecord {
  readonly id: string;
  readonly agentId: string;
  readonly reviewerAgentId: string;
  readonly attempt: number;
  readonly retryOf: string | null;
  readonly kind: 'TASK' | 'CONTEXT_HEALTH';
  readonly task: string;
  readonly workspace: string;
  readonly status: RunStatus;
  readonly manifest: {
    readonly model: string;
    readonly allowedTools: readonly string[];
    readonly maxModelCalls: number;
    readonly maxToolCalls: number;
    readonly maxContextClaims: number;
    readonly maxOutputTokens: number;
    readonly maxWallMs: number;
    readonly canWrite: boolean;
  };
  readonly pack: {
    readonly id: string;
    readonly claims: readonly { readonly subject: string; readonly predicate: string; readonly value: string; readonly standing: string }[];
    readonly conflicts: readonly string[];
    readonly missing: readonly string[];
    readonly estimatedTokens: number;
  } | null;
  readonly events: readonly { readonly at: string; readonly stage: RunStatus; readonly detail: string; readonly ms?: number }[];
  readonly result: string | null;
  readonly draft: string | null;
  readonly handoff: {
    readonly from: string;
    readonly to: string;
    readonly supportedFacts: readonly string[];
    readonly conflicts: readonly string[];
    readonly missing: readonly string[];
    readonly packId: string;
  } | null;
  readonly verdict: {
    readonly approved: boolean;
    readonly supported: readonly string[];
    readonly unsupported: readonly string[];
    readonly note: string;
  } | null;
  readonly supportedClaims: readonly string[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly conflicts: readonly string[];
  readonly openQuestions: readonly string[];
  readonly toolEvents: readonly {
    readonly id: string;
    readonly tool: string;
    readonly status: string;
    readonly calls: number;
    readonly ms: number | null;
    readonly outputSummary: string | null;
  }[];
  readonly provider: { readonly name: string; readonly model: string };
  readonly timings: {
    readonly contextMs: number | null;
    readonly researcherMs: number | null;
    readonly reviewerMs: number | null;
    readonly totalMs: number;
  };
  readonly writebackDecision: {
    readonly policy: string;
    readonly decision: string;
    readonly authoritativeMutation: boolean;
    readonly reason: string;
  };
  readonly trace: readonly { readonly at: string; readonly kind: string; readonly detail: string }[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly finishedAt: string | null;
}

export interface DailyScheduleRecord {
  readonly id: string;
  readonly name: string;
  readonly workspace: string;
  readonly agentId: string;
  readonly task: string;
  readonly cadence: 'DAILY';
  readonly localTime: string;
  readonly timezone: string;
  readonly enabled: boolean;
  readonly nextEligibleAt: string;
  readonly lastRunAt: string | null;
  readonly lastRunId: string | null;
  readonly retry: { readonly state: 'IDLE' | 'PENDING' | 'EXHAUSTED'; readonly attempts: number; readonly lastError: string | null };
}

export interface RegisteredToolRecord {
  readonly name: string;
  readonly version: string;
  readonly source: string;
  readonly access: 'READ' | 'WRITE';
  readonly permissions: readonly string[];
  readonly health: string;
  readonly lastVerifiedAt: string | null;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly sideEffect: string;
}
