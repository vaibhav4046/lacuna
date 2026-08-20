import type { AgentRun, ToolEvent } from './types.js';

export interface RegisteredAgentTool {
  readonly name: string;
  readonly version: string;
  readonly source: string;
  readonly access: 'READ' | 'WRITE';
  readonly permissions: readonly string[];
  readonly health: 'AVAILABLE';
  readonly lastVerifiedAt: string | null;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly sideEffect: 'NONE';
}

const CONTEXT_PACK: Omit<RegisteredAgentTool, 'lastVerifiedAt'> = Object.freeze({
  name: 'lacuna_context_pack',
  version: '1',
  source: 'src/agent/run.ts using the canonical retrieval resolver',
  access: 'READ',
  permissions: ['context:read', 'evidence:read'],
  health: 'AVAILABLE',
  inputSchema: {
    type: 'object',
    properties: {
      workspace: { type: 'string' },
      subjects: { type: 'array', items: { type: 'string' }, maxItems: 8 },
      predicates: { type: 'array', items: { type: 'string' } },
    },
    required: ['workspace', 'subjects', 'predicates'],
    additionalProperties: false,
  },
  outputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      claims: { type: 'array', maxItems: 40 },
      conflicts: { type: 'array' },
      missing: { type: 'array' },
      estimatedTokens: { type: 'number' },
    },
    required: ['id', 'claims', 'conflicts', 'missing', 'estimatedTokens'],
  },
  sideEffect: 'NONE',
});

/** The registry contains only code paths the runtime actually invokes. */
export function registeredAgentTools(runs: readonly AgentRun[] = []): readonly RegisteredAgentTool[] {
  let lastVerifiedAt: string | null = null;
  for (const run of runs) {
    for (const event of run.toolEvents) {
      if (event.tool !== CONTEXT_PACK.name || event.status !== 'COMPLETED' || event.finishedAt === null) continue;
      if (lastVerifiedAt === null || event.finishedAt > lastVerifiedAt) lastVerifiedAt = event.finishedAt;
    }
  }
  return [{ ...CONTEXT_PACK, lastVerifiedAt }];
}

export function completedToolEvent(
  event: ToolEvent,
  finishedAt: string,
  calls: number,
  outputSummary: string,
  ms: number,
): ToolEvent {
  return { ...event, status: 'COMPLETED', finishedAt, calls, outputSummary, ms, error: null };
}
