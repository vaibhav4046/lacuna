/**
 * Persisted agent and run contracts.
 *
 * These records contain operational state, evidence and model output. They do
 * not contain prompts, provider credentials or chain of thought. Temporal
 * standing still comes from the existing resolver before either agent runs.
 */

export type AgentRole = 'RESEARCHER' | 'REVIEWER';

export type WritebackPolicy = 'NO_WRITE' | 'EPISODIC_RUN_OUTCOME' | 'PROCEDURE_CANDIDATE';

export interface AgentTemplate {
  readonly id: AgentRole;
  readonly name: string;
  readonly purpose: string;
  readonly tools: readonly string[];
  readonly writeback: WritebackPolicy;
}

export type AgentRecommendationKind = 'CONFLICT_TRIAGE' | 'CHANGE_BRIEF' | 'CONTEXT_BRIEF';

/**
 * A read-only suggestion derived from memory the resolver has already
 * classified. It is not an agent definition and it never causes a run or a
 * schedule by being read.
 */
export interface AgentRecommendation {
  readonly id: string;
  readonly workspace: string;
  readonly kind: AgentRecommendationKind;
  readonly name: string;
  readonly subject: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly task: string;
  readonly flow: readonly ['RESEARCHER', 'REVIEWER'];
  readonly tools: readonly ['lacuna_context_pack'];
  readonly permissions: AgentPermissions;
  readonly budgets: AgentBudgets;
  readonly writeback: 'NO_WRITE';
  readonly suggestedSchedule: {
    readonly cadence: 'DAILY';
    readonly localTime: string;
    readonly timezone: string;
    readonly reason: string;
  };
}

export interface AgentPermissions {
  readonly read: readonly string[];
  readonly write: readonly string[];
}

export interface AgentBudgets {
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly maxContextClaims: number;
  readonly maxOutputTokens: number;
  readonly maxWallMs: number;
}

/** A stored configuration. Provider means an identifier, never a credential. */
export interface PersistedAgent {
  readonly id: string;
  readonly name: string;
  readonly role: AgentRole;
  readonly workspace: string;
  readonly provider: string;
  readonly model: string;
  readonly purpose: string;
  readonly contextPolicy: string;
  readonly tools: readonly string[];
  readonly permissions: AgentPermissions;
  readonly budgets: AgentBudgets;
  readonly writeback: WritebackPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CapabilityManifest extends AgentBudgets {
  readonly workspace: string;
  readonly collection: string;
  readonly model: string;
  readonly allowedTools: readonly string[];
  readonly canWrite: false;
}

export type RunStatus =
  | 'CREATED'
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING_TOOL'
  | 'HANDOFF'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export const TERMINAL_RUN_STATUSES: ReadonlySet<RunStatus> = new Set([
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const RUN_TRANSITIONS: Readonly<Record<RunStatus, readonly RunStatus[]>> = Object.freeze({
  CREATED: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'FAILED', 'CANCELLED'],
  RUNNING: ['WAITING_TOOL', 'HANDOFF', 'COMPLETED', 'FAILED', 'CANCELLED'],
  WAITING_TOOL: ['RUNNING', 'FAILED', 'CANCELLED'],
  HANDOFF: ['RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
});

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return RUN_TRANSITIONS[from].includes(to);
}

/** One observed state change. There are no percentages or inferred progress. */
export interface RunEvent {
  readonly at: string;
  readonly stage: RunStatus;
  readonly detail: string;
  readonly ms?: number;
}

export interface PackedClaim {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  /** The canonical resolver's standing, copied without reinterpretation. */
  readonly standing: string;
  readonly quote: string | null;
  readonly source: string | null;
  readonly observedAt: string | null;
}

export interface ContextPack {
  readonly id: string;
  readonly workspace: string;
  readonly claims: readonly PackedClaim[];
  readonly conflicts: readonly string[];
  readonly missing: readonly string[];
  readonly estimatedTokens: number;
}

/** Compact facts cross the handoff. Prompts, transcripts and reasoning do not. */
export interface ContextHandoff {
  readonly from: AgentRole;
  readonly to: AgentRole;
  readonly goal: string;
  readonly supportedFacts: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly conflicts: readonly string[];
  readonly missing: readonly string[];
  readonly packId: string;
}

export interface ReviewVerdict {
  readonly approved: boolean;
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
  readonly note: string;
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

export type ToolEventStatus = 'RUNNING' | 'COMPLETED' | 'FAILED';

export interface ToolEvent {
  readonly id: string;
  readonly tool: string;
  readonly status: ToolEventStatus;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly inputSummary: string;
  readonly outputSummary: string | null;
  readonly calls: number;
  readonly ms: number | null;
  readonly error: string | null;
}

/** Operational trace only. This is safe to persist and render. */
export interface RunTrace {
  readonly at: string;
  readonly kind: 'LIFECYCLE' | 'TOOL' | 'POLICY';
  readonly detail: string;
}

export interface RunTimings {
  readonly contextMs: number | null;
  readonly researcherMs: number | null;
  readonly reviewerMs: number | null;
  readonly totalMs: number;
}

export interface WritebackDecision {
  readonly policy: WritebackPolicy;
  readonly decision: 'SKIPPED_POLICY' | 'CANDIDATE_RECORDED';
  readonly authoritativeMutation: false;
  readonly reason: string;
}

export interface AgentRun {
  readonly id: string;
  readonly agentId: string;
  readonly reviewerAgentId: string;
  readonly attempt: number;
  readonly retryOf: string | null;
  readonly kind: 'TASK' | 'CONTEXT_HEALTH';
  readonly task: string;
  readonly workspace: string;
  readonly status: RunStatus;
  readonly manifest: CapabilityManifest;
  readonly pack: ContextPack | null;
  readonly events: readonly RunEvent[];
  /** Approved answer only. A rejected or unreviewed draft is not a result. */
  readonly result: string | null;
  readonly draft: string | null;
  readonly handoff: ContextHandoff | null;
  readonly verdict: ReviewVerdict | null;
  readonly supportedClaims: readonly string[];
  readonly evidenceRefs: readonly EvidenceReference[];
  readonly conflicts: readonly string[];
  readonly openQuestions: readonly string[];
  readonly toolEvents: readonly ToolEvent[];
  readonly provider: { readonly name: string; readonly model: string };
  readonly timings: RunTimings;
  readonly writeback: WritebackPolicy;
  readonly writebackDecision: WritebackDecision;
  readonly trace: readonly RunTrace[];
  readonly error: string | null;
  readonly createdAt: string;
  readonly queuedAt: string | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly cancelledAt: string | null;
  readonly ms: number;
}

export const DEFAULT_AGENT_BUDGETS: AgentBudgets = Object.freeze({
  maxModelCalls: 2,
  maxToolCalls: 40,
  maxContextClaims: 40,
  maxOutputTokens: 1_200,
  maxWallMs: 60_000,
});

export const AGENTS: Readonly<Record<AgentRole, AgentTemplate>> = Object.freeze({
  RESEARCHER: {
    id: 'RESEARCHER',
    name: 'Researcher',
    purpose:
      'Gathers resolved context, evidence, changes, conflicts and missing facts without deciding that unsupported claims are true.',
    tools: ['lacuna_context_pack'],
    writeback: 'NO_WRITE',
  },
  REVIEWER: {
    id: 'REVIEWER',
    name: 'Reviewer',
    purpose:
      'Checks a compact Researcher handoff for unsupported claims, temporal mistakes, contradictions and unsafe assumptions.',
    tools: [],
    writeback: 'NO_WRITE',
  },
});
