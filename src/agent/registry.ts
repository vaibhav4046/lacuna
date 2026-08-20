import { createHash } from 'node:crypto';

import {
  AGENTS,
  DEFAULT_AGENT_BUDGETS,
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
        status: last.status,
        at: last.finishedAt ?? last.createdAt,
      },
    };
  });
}
