/**
 * Two agents, and the rule that neither of them decides what is true.
 *
 * The point of running a model over this memory is not to have it write nicer
 * sentences. It is that a long-running task needs somebody to gather the
 * relevant state, and somebody else to check that what came back is actually
 * supported. Both of those are jobs a model can do and neither is a job it may
 * be trusted with unsupervised, which is why the Reviewer exists and why its
 * output is a verdict about evidence rather than a second opinion.
 *
 * What the model never gets to do:
 *
 *   - decide that a claim is current. The resolver did that before the model
 *     saw anything, and the Context Pack carries the standing it decided.
 *   - reach a tool it was not granted. The capability manifest is resolved
 *     before the run and the model cannot widen it by asking.
 *   - write to memory. A run produces a record of itself and nothing else;
 *     turning agent output into a claim is a separate decision a person makes.
 *
 * What is deliberately absent: chain of thought. It is not stored, not
 * returned and not rendered. A run is judged on its output and its evidence.
 */

export type AgentRole = 'RESEARCHER' | 'REVIEWER';

export interface Agent {
  readonly id: AgentRole;
  readonly name: string;
  /** What this agent is for, in one sentence, shown in the product. */
  readonly purpose: string;
  /** Tools it may call. Resolved into the manifest before a run starts. */
  readonly tools: readonly string[];
  /** What a run of this agent is allowed to write. */
  readonly writeback: WritebackPolicy;
}

/**
 * Agent output is never truth by assertion.
 *
 * `NO_WRITE` is the only policy in use. The others are named because the
 * distinction is the design, and adding one later should be a change to a
 * policy rather than a change to whether a policy exists.
 */
export type WritebackPolicy = 'NO_WRITE' | 'EPISODIC_RUN_OUTCOME' | 'PROCEDURE_CANDIDATE';

/**
 * Everything a run may spend, decided before it starts.
 *
 * A model that can ask for more calls is a model that can spend somebody's
 * money in a loop, so the numbers are resolved from the agent and the
 * workspace and are never read back out of the model's output.
 */
export interface CapabilityManifest {
  readonly workspace: string;
  readonly collection: string;
  readonly model: string;
  readonly allowedTools: readonly string[];
  readonly maxModelCalls: number;
  readonly maxContextClaims: number;
  readonly maxWallMs: number;
  readonly canWrite: false;
}

export type RunStatus =
  | 'RETRIEVING'
  | 'COMPILING'
  | 'RUNNING'
  | 'REVIEWING'
  | 'COMPLETED'
  | 'FAILED';

/** One thing that happened, in order. No percentages, no invented progress. */
export interface RunEvent {
  readonly at: string;
  readonly stage: RunStatus;
  readonly detail: string;
  readonly ms?: number;
}

/**
 * One claim the Context Pack carries, already resolved.
 *
 * `standing` is the resolver's, not the model's. A model reading this cannot
 * promote a superseded value by describing it confidently, because the word
 * next to the value already says what it is.
 */
export interface PackedClaim {
  readonly subject: string;
  readonly predicate: string;
  readonly value: string;
  readonly standing: string;
  readonly quote: string | null;
  readonly source: string | null;
  readonly observedAt: string | null;
}

/**
 * What the model is given. Bounded, resolved, and quotable.
 *
 * This is the same shape for every surface: the researcher gets it, the
 * reviewer gets the subset the handoff carried, and both are reading claims the
 * resolver already decided rather than raw transcript.
 */
export interface ContextPack {
  readonly id: string;
  readonly workspace: string;
  readonly claims: readonly PackedClaim[];
  readonly conflicts: readonly string[];
  readonly missing: readonly string[];
  readonly estimatedTokens: number;
}

/**
 * What crosses between the two agents.
 *
 * Not the conversation. A handoff is the goal, what was found with the evidence
 * behind it, and what is still open, because a reviewer that receives the
 * researcher's reasoning is a reviewer that inherits its mistakes.
 */
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

/** The verdict, which is about evidence rather than about quality. */
export interface ReviewVerdict {
  readonly approved: boolean;
  readonly supported: readonly string[];
  readonly unsupported: readonly string[];
  readonly note: string;
}

export interface AgentRun {
  readonly id: string;
  readonly task: string;
  readonly workspace: string;
  readonly status: RunStatus;
  readonly manifest: CapabilityManifest;
  readonly pack: ContextPack | null;
  readonly events: readonly RunEvent[];
  readonly draft: string | null;
  readonly handoff: ContextHandoff | null;
  readonly verdict: ReviewVerdict | null;
  readonly writeback: WritebackPolicy;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly ms: number;
}

export const AGENTS: Readonly<Record<AgentRole, Agent>> = Object.freeze({
  RESEARCHER: {
    id: 'RESEARCHER',
    name: 'Researcher',
    purpose:
      'Reads the governed workspace context and reports what it supports, naming conflicts and missing evidence rather than filling them in.',
    tools: ['lacuna_query', 'lacuna_graph_impact'],
    writeback: 'NO_WRITE',
  },
  REVIEWER: {
    id: 'REVIEWER',
    name: 'Reviewer',
    purpose:
      'Checks every material claim in a draft against the evidence it was handed, and rejects the ones nothing supports.',
    tools: [],
    writeback: 'NO_WRITE',
  },
});
