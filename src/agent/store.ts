import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { workspaceFingerprint } from './registry.js';
import {
  TERMINAL_RUN_STATUSES,
  canTransition,
  type AgentRun,
  type PersistedAgent,
  type RunStatus,
} from './types.js';

interface WorkspaceState {
  readonly version: 1;
  readonly workspace: string;
  readonly agents: readonly PersistedAgent[];
  readonly runs: readonly AgentRun[];
  /** Hashes only. An idempotency key may itself be a credential. */
  readonly idempotency: Readonly<Record<string, string>>;
}

export interface AgentRuntimeStore {
  putAgents(workspace: string, agents: readonly PersistedAgent[]): Promise<readonly PersistedAgent[]>;
  listAgents(workspace: string): Promise<readonly PersistedAgent[]>;
  getAgent(workspace: string, id: string): Promise<PersistedAgent | null>;
  createRun(run: AgentRun, idempotencyKey?: string): Promise<{ readonly run: AgentRun; readonly created: boolean }>;
  writeRun(run: AgentRun, expected: RunStatus): Promise<AgentRun>;
  getRun(workspace: string, id: string): Promise<AgentRun | null>;
  listRuns(workspace: string): Promise<readonly AgentRun[]>;
}

export class RuntimeStoreError extends Error {
  override readonly name: string = 'RuntimeStoreError';
}

export class WorkspaceAccessDenied extends RuntimeStoreError {
  override readonly name: string = 'WorkspaceAccessDenied';
}

export class RunConflict extends RuntimeStoreError {
  override readonly name: string = 'RunConflict';
}

export class InvalidRunTransition extends RuntimeStoreError {
  override readonly name: string = 'InvalidRunTransition';
}

function validateWorkspace(workspace: string): void {
  if (workspace.trim() === '' || workspace.length > 256 || workspace.includes('\0')) {
    throw new RuntimeStoreError('invalid workspace');
  }
}

function idempotencyHash(key: string): string {
  if (key === '' || key.length > 256 || key.includes('\0')) throw new RuntimeStoreError('invalid idempotency key');
  return createHash('sha256').update(key).digest('hex');
}

function assertScopedId(workspace: string, id: string, kind: 'agent' | 'run'): void {
  const prefix = `${kind}-${workspaceFingerprint(workspace)}-`;
  if (id.startsWith(`${kind}-`) && !id.startsWith(prefix)) {
    throw new WorkspaceAccessDenied(`${kind} belongs to another workspace`);
  }
}

function assertAgent(agent: PersistedAgent, workspace: string): void {
  if (agent.workspace !== workspace) throw new WorkspaceAccessDenied('agent belongs to another workspace');
  assertScopedId(workspace, agent.id, 'agent');
  if (agent.permissions.write.length > 0 && agent.writeback === 'NO_WRITE') {
    throw new RuntimeStoreError('a no-write agent cannot have write permission');
  }
  if (/api[_-]?key|client[_-]?secret|bearer/i.test(agent.provider)) {
    throw new RuntimeStoreError('provider must be an identifier, not a credential');
  }
}

function assertRun(run: AgentRun, workspace: string): void {
  if (run.workspace !== workspace) throw new WorkspaceAccessDenied('run belongs to another workspace');
  assertScopedId(workspace, run.id, 'run');
  assertScopedId(workspace, run.agentId, 'agent');
  assertScopedId(workspace, run.reviewerAgentId, 'agent');
  if (run.manifest.workspace !== workspace) throw new WorkspaceAccessDenied('manifest belongs to another workspace');
  if (run.manifest.canWrite || run.writebackDecision.authoritativeMutation) {
    throw new RuntimeStoreError('authoritative agent writes are not supported');
  }
}

function sameRunIdentity(before: AgentRun, after: AgentRun): boolean {
  return before.id === after.id
    && before.workspace === after.workspace
    && before.agentId === after.agentId
    && before.reviewerAgentId === after.reviewerAgentId
    && before.task === after.task
    && before.createdAt === after.createdAt
    && before.attempt === after.attempt
    && before.retryOf === after.retryOf;
}

function parseState(text: string, workspace: string): WorkspaceState {
  const parsed = JSON.parse(text) as Partial<WorkspaceState>;
  if (parsed.version !== 1 || parsed.workspace !== workspace || !Array.isArray(parsed.agents) || !Array.isArray(parsed.runs)) {
    throw new RuntimeStoreError('runtime state is unreadable');
  }
  if (typeof parsed.idempotency !== 'object' || parsed.idempotency === null) {
    throw new RuntimeStoreError('runtime state has no idempotency index');
  }
  return parsed as WorkspaceState;
}

/**
 * JSON persistence is intentionally small and inspectable. Writes are made to
 * a sibling temporary file and renamed, so a process stopping mid-write leaves
 * either the old complete document or the new complete document.
 */
export class FileAgentRuntimeStore implements AgentRuntimeStore {
  readonly #root: string;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(root: string) {
    if (root.trim() === '') throw new RuntimeStoreError('runtime root is required');
    this.#root = root;
  }

  async #locked<T>(workspace: string, action: () => Promise<T>): Promise<T> {
    validateWorkspace(workspace);
    const key = workspaceFingerprint(workspace);
    const previous = this.#locks.get(key) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.#locks.set(key, current);
    await previous;
    try {
      return await action();
    } finally {
      release();
      if (this.#locks.get(key) === current) this.#locks.delete(key);
    }
  }

  #directory(workspace: string): string {
    return join(this.#root, workspaceFingerprint(workspace));
  }

  #path(workspace: string): string {
    return join(this.#directory(workspace), 'agent-runtime.json');
  }

  async #read(workspace: string): Promise<WorkspaceState> {
    try {
      return parseState(await readFile(this.#path(workspace), 'utf8'), workspace);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { version: 1, workspace, agents: [], runs: [], idempotency: {} };
    }
  }

  async #write(state: WorkspaceState): Promise<void> {
    const directory = this.#directory(state.workspace);
    await mkdir(directory, { recursive: true });
    const target = this.#path(state.workspace);
    const temporary = join(directory, `agent-runtime-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, target);
  }

  async putAgents(workspace: string, agents: readonly PersistedAgent[]): Promise<readonly PersistedAgent[]> {
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      const byId = new Map(state.agents.map((agent) => [agent.id, agent]));
      for (const agent of agents) {
        assertAgent(agent, workspace);
        const existing = byId.get(agent.id);
        if (existing === undefined) byId.set(agent.id, agent);
      }
      const stored = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
      await this.#write({ ...state, agents: stored });
      return stored;
    });
  }

  async listAgents(workspace: string): Promise<readonly PersistedAgent[]> {
    return this.#locked(workspace, async () => (await this.#read(workspace)).agents);
  }

  async getAgent(workspace: string, id: string): Promise<PersistedAgent | null> {
    assertScopedId(workspace, id, 'agent');
    return this.#locked(workspace, async () => (await this.#read(workspace)).agents.find((agent) => agent.id === id) ?? null);
  }

  async createRun(run: AgentRun, idempotencyKey?: string): Promise<{ readonly run: AgentRun; readonly created: boolean }> {
    assertRun(run, run.workspace);
    if (run.status !== 'CREATED') throw new InvalidRunTransition('a new run must start CREATED');
    return this.#locked(run.workspace, async () => {
      const state = await this.#read(run.workspace);
      const key = idempotencyKey === undefined ? null : idempotencyHash(idempotencyKey);
      const priorId = key === null ? undefined : state.idempotency[key];
      if (priorId !== undefined) {
        const prior = state.runs.find((candidate) => candidate.id === priorId);
        if (prior === undefined) throw new RuntimeStoreError('idempotency index is corrupt');
        return { run: prior, created: false };
      }
      if (state.runs.some((candidate) => candidate.id === run.id)) throw new RunConflict('run id already exists');
      if (!state.agents.some((agent) => agent.id === run.agentId)
        || !state.agents.some((agent) => agent.id === run.reviewerAgentId)) {
        throw new RuntimeStoreError('run agent is not registered in this workspace');
      }
      const idempotency = key === null ? state.idempotency : { ...state.idempotency, [key]: run.id };
      await this.#write({ ...state, runs: [...state.runs, run], idempotency });
      return { run, created: true };
    });
  }

  async writeRun(run: AgentRun, expected: RunStatus): Promise<AgentRun> {
    assertRun(run, run.workspace);
    return this.#locked(run.workspace, async () => {
      const state = await this.#read(run.workspace);
      const index = state.runs.findIndex((candidate) => candidate.id === run.id);
      const current = state.runs[index];
      if (index === -1 || current === undefined) throw new RunConflict('run does not exist');
      if (current.status !== expected) throw new RunConflict(`expected ${expected}, found ${current.status}`);
      if (!sameRunIdentity(current, run)) throw new RunConflict('run identity cannot change');
      if (current.status !== run.status && !canTransition(current.status, run.status)) {
        throw new InvalidRunTransition(`${current.status} cannot transition to ${run.status}`);
      }
      if (current.status === run.status && TERMINAL_RUN_STATUSES.has(current.status)) {
        throw new InvalidRunTransition(`terminal run ${current.status} is immutable`);
      }
      const runs = [...state.runs];
      runs[index] = run;
      await this.#write({ ...state, runs });
      return run;
    });
  }

  async getRun(workspace: string, id: string): Promise<AgentRun | null> {
    assertScopedId(workspace, id, 'run');
    return this.#locked(workspace, async () => (await this.#read(workspace)).runs.find((run) => run.id === id) ?? null);
  }

  async listRuns(workspace: string): Promise<readonly AgentRun[]> {
    return this.#locked(workspace, async () => [...(await this.#read(workspace)).runs]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
}
