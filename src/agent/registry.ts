import { createHash } from 'node:crypto';

import {
  AGENTS,
  DEFAULT_AGENT_BUDGETS,
  type AgentRecommendation,
  type AgentRecommendationKind,
  type AgentRun,
  type AgentRole,
  type PersistedAgent,
  type RunStatus,
} from './types.js';

const CONTEXT_POLICY =
  'Use only the bounded Context Pack produced by the canonical resolver. Preserve standing, conflicts and missing evidence.';

export function workspaceFingerprint(workspace: string): string {
  return createHash('sha256').update(workspace).digest('hex').slice(0, 12);
}

export function builtInAgentId(workspace: string, role: AgentRole): string {
  return `agent-${workspaceFingerprint(workspace)}-${role.toLowerCase()}`;
}

/**
 * The two built-ins are stable for a workspace and contain no provider secret.
 * Calling this again produces the same ids and timestamps supplied by the
 * caller, which makes seeding an empty persisted store idempotent.
 */
export function builtInAgents(
  workspace: string,
  provider: string,
  model: string,
  at: string,
): readonly PersistedAgent[] {
  return (['RESEARCHER', 'REVIEWER'] as const).map((role) => {
    const template = AGENTS[role];
    return {
      id: builtInAgentId(workspace, role),
      name: template.name,
      role,
      workspace,
      provider,
      model,
      purpose: template.purpose,
      contextPolicy: CONTEXT_POLICY,
      tools: template.tools,
      permissions: role === 'RESEARCHER'
        ? { read: ['context', 'evidence', 'timeline', 'graph'], write: [] }
        : { read: ['context_handoff', 'evidence'], write: [] },
      budgets: DEFAULT_AGENT_BUDGETS,
      writeback: template.writeback,
      createdAt: at,
      updatedAt: at,
    };
  });
}

export interface AgentPageRecord extends PersistedAgent {
  readonly lastRun: { readonly id: string; readonly status: RunStatus; readonly at: string } | null;
}

/** Empty context-health work is a completed no-evidence review, not a failure. */
export function agentPageStatus(run: Pick<AgentRun, 'kind' | 'error' | 'status'>): RunStatus {
  return run.kind === 'CONTEXT_HEALTH' && run.error === 'no_known_subject'
    ? 'COMPLETED'
    : run.status;
}

/** Joins persisted definitions to persisted runs for the Agents page. */
export function agentPageRecords(
  agents: readonly PersistedAgent[],
  runs: readonly AgentRun[],
): readonly AgentPageRecord[] {
  return agents.map((agent) => {
    const last = runs
      .filter((run) => run.agentId === agent.id || run.reviewerAgentId === agent.id)
      .reduce<AgentRun | null>((latest, run) => latest === null || run.createdAt > latest.createdAt ? run : latest, null);
    return {
      ...agent,
      lastRun: last === null ? null : {
        id: last.id,
        status: agentPageStatus(last),
        at: last.finishedAt ?? last.createdAt,
      },
    };
  });
}

export interface ResolvedMemorySignal {
  readonly entity: string;
  readonly claim: string;
  readonly st: 'CUR' | 'SUP' | 'PRO' | 'CON' | 'UN';
}

interface EntitySignals {
  readonly entity: string;
  readonly current: readonly ResolvedMemorySignal[];
  readonly historical: readonly ResolvedMemorySignal[];
  readonly conflicting: readonly ResolvedMemorySignal[];
}

function recommendationId(
  workspace: string,
  kind: AgentRecommendationKind,
  entity: string,
): string {
  const signal = createHash('sha256').update(`${kind}:${entity}`).digest('hex').slice(0, 10);
  return `recommendation-${workspaceFingerprint(workspace)}-${kind.toLowerCase()}-${signal}`;
}

function clippedEvidence(rows: readonly ResolvedMemorySignal[]): readonly string[] {
  return rows.slice(0, 3).map((row) => row.claim.slice(0, 240));
}

function recommendation(
  workspace: string,
  kind: AgentRecommendationKind,
  signals: EntitySignals,
): AgentRecommendation {
  const subject = signals.entity;
  const quoted = JSON.stringify(subject);
  const common = {
    id: recommendationId(workspace, kind, subject),
    workspace,
    kind,
    subject,
    flow: ['RESEARCHER', 'REVIEWER'] as const,
    tools: ['lacuna_context_pack'] as const,
    permissions: { read: ['context', 'evidence', 'timeline', 'graph'], write: [] },
    budgets: DEFAULT_AGENT_BUDGETS,
    writeback: 'NO_WRITE' as const,
  };

  if (kind === 'CONFLICT_TRIAGE') {
    const count = signals.conflicting.length;
    return {
      ...common,
      name: `Conflict guard · ${subject}`,
      reason: `${subject} has ${count} unresolved ${count === 1 ? 'claim' : 'claims'}. A reviewed evidence brief can show the disagreement without choosing a winner.`,
      evidence: clippedEvidence(signals.conflicting),
      task: `Review unresolved claims for the workspace subject named ${quoted}. Report each supported value, its evidence, and what is still needed to resolve the conflict. Do not choose a winner and do not write to memory.`,
      suggestedSchedule: {
        cadence: 'DAILY', localTime: '06:00', timezone: 'UTC',
        reason: 'A daily check catches new evidence without repeatedly acting on the conflict.',
      },
    };
  }

  if (kind === 'CHANGE_BRIEF') {
    const count = signals.historical.length;
    return {
      ...common,
      name: `Change brief · ${subject}`,
      reason: `${subject} has ${count} historical ${count === 1 ? 'claim' : 'claims'} beside its current state. A reviewed brief can separate what changed from what still holds.`,
      evidence: clippedEvidence([...signals.current, ...signals.historical]),
      task: `Prepare a change brief for the workspace subject named ${quoted}. Separate current claims from superseded history, cite the evidence, and list any unresolved questions. Do not write to memory.`,
      suggestedSchedule: {
        cadence: 'DAILY', localTime: '06:00', timezone: 'UTC',
        reason: 'A daily brief is useful while this subject continues to accumulate revisions.',
      },
    };
  }

  const count = signals.current.length;
  return {
    ...common,
    name: `Context brief · ${subject}`,
    reason: `${subject} has ${count} current ${count === 1 ? 'claim' : 'claims'}. A bounded brief can prepare the facts most likely to be needed next.`,
    evidence: clippedEvidence(signals.current),
    task: `Prepare a concise, evidence-backed context brief for the workspace subject named ${quoted}. Include only current supported claims, identify conflicts or missing evidence, and do not write to memory.`,
    suggestedSchedule: {
      cadence: 'DAILY', localTime: '06:00', timezone: 'UTC',
      reason: 'Use a daily brief only if this subject is part of recurring work.',
    },
  };
}

/**
 * Deterministic recommendations from already classified memory rows.
 * Reading this function has no side effect. Proposals and unknown rows never
 * become an automation signal.
 */
export function recommendedAgents(
  workspace: string,
  rows: readonly ResolvedMemorySignal[],
): readonly AgentRecommendation[] {
  const grouped = new Map<string, ResolvedMemorySignal[]>();
  for (const row of rows) {
    const entity = row.entity.trim();
    if (entity === '' || entity.length > 160 || row.claim.trim() === '') continue;
    const current = grouped.get(entity) ?? [];
    current.push({ ...row, entity });
    grouped.set(entity, current);
  }

  const signals = [...grouped].map(([entity, entityRows]): EntitySignals => ({
    entity,
    current: entityRows.filter((row) => row.st === 'CUR').sort((a, b) => a.claim.localeCompare(b.claim)),
    historical: entityRows.filter((row) => row.st === 'SUP').sort((a, b) => a.claim.localeCompare(b.claim)),
    conflicting: entityRows.filter((row) => row.st === 'CON').sort((a, b) => a.claim.localeCompare(b.claim)),
  }));
  const sort = (kind: keyof Omit<EntitySignals, 'entity'>) => [...signals]
    .filter((signal) => signal[kind].length > 0)
    .sort((a, b) => b[kind].length - a[kind].length || a.entity.localeCompare(b.entity));

  const out: AgentRecommendation[] = [];
  const conflict = sort('conflicting')[0];
  if (conflict !== undefined) out.push(recommendation(workspace, 'CONFLICT_TRIAGE', conflict));
  const changed = sort('historical').find((signal) => signal.entity !== conflict?.entity) ?? sort('historical')[0];
  if (changed !== undefined) out.push(recommendation(workspace, 'CHANGE_BRIEF', changed));
  const used = new Set(out.map((item) => item.subject));
  const context = sort('current').find((signal) => !used.has(signal.entity)) ?? sort('current')[0];
  if (context !== undefined) out.push(recommendation(workspace, 'CONTEXT_BRIEF', context));
  return out.slice(0, 3);
}
