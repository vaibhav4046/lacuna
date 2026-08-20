import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { workspaceFingerprint } from '../agent/registry.js';
import type { HydraCloud } from '../hydra/cloud.js';
import type { DailySchedule, DispatchClaim, ScheduleDispatch } from './types.js';

interface SchedulerState {
  readonly version: 1;
  readonly workspace: string;
  readonly schedules: readonly DailySchedule[];
  readonly dispatches: readonly ScheduleDispatch[];
}

interface SchedulerWorkspaceIndex {
  readonly version: 1;
  readonly workspaces: readonly string[];
}

export interface ScheduleStore {
  putSchedule(schedule: DailySchedule): Promise<DailySchedule>;
  /** Workspaces holding schedules, for an authenticated dispatcher tick. */
  listWorkspaces(): Promise<readonly string[]>;
  getSchedule(workspace: string, scheduleId: string): Promise<DailySchedule | null>;
  listSchedules(workspace: string): Promise<readonly DailySchedule[]>;
  claimDispatch(
    workspace: string,
    scheduleId: string,
    dispatchKey: string,
    at: string,
    leaseMs: number,
    maxAttempts: number,
    leaseId: string,
  ): Promise<DispatchClaim>;
  completeDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    runId: string,
    at: string,
    nextEligibleAt: string | null,
  ): Promise<ScheduleDispatch>;
  failDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    at: string,
    exhausted: boolean,
  ): Promise<ScheduleDispatch>;
}

export class SchedulerStoreError extends Error {
  override readonly name: string = 'SchedulerStoreError';
}

export class ScheduleAccessDenied extends SchedulerStoreError {
  override readonly name: string = 'ScheduleAccessDenied';
}

export class ScheduleConflict extends SchedulerStoreError {
  override readonly name: string = 'ScheduleConflict';
}

const MAX_SCHEDULES = 100;
const MAX_DISPATCH_HISTORY = 400;
const MAX_SCHEDULE_WORKSPACES = 5_000;
const WORKSPACE_INDEX_ID = 'lacuna:schedule-workspaces:v1';

function validWorkspace(workspace: string): boolean {
  return workspace.trim() !== '' && workspace.length <= 256 && !workspace.includes('\0');
}

function dispatchHash(key: string): string {
  if (key === '' || key.length > 320 || key.includes('\0')) throw new SchedulerStoreError('invalid dispatch key');
  return createHash('sha256').update(key).digest('hex');
}

function assertScheduleScope(workspace: string, scheduleId: string): void {
  const prefix = `schedule-${workspaceFingerprint(workspace)}-`;
  if (scheduleId.startsWith('schedule-') && !scheduleId.startsWith(prefix)) {
    throw new ScheduleAccessDenied('schedule belongs to another workspace');
  }
}

function parseState(text: string, workspace: string): SchedulerState {
  const parsed = JSON.parse(text) as Partial<SchedulerState>;
  if (parsed.version !== 1 || parsed.workspace !== workspace
    || !Array.isArray(parsed.schedules) || !Array.isArray(parsed.dispatches)) {
    throw new SchedulerStoreError('scheduler state is unreadable');
  }
  return parsed as SchedulerState;
}

/** File-backed schedule and dispatch claims, partitioned by workspace hash. */
export class FileScheduleStore implements ScheduleStore {
  readonly #root: string;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(root: string) {
    if (root.trim() === '') throw new SchedulerStoreError('scheduler root is required');
    this.#root = root;
  }

  async #locked<T>(workspace: string, action: () => Promise<T>): Promise<T> {
    if (!validWorkspace(workspace)) {
      throw new SchedulerStoreError('invalid workspace');
    }
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
    return join(this.#directory(workspace), 'scheduler.json');
  }

  async #read(workspace: string): Promise<SchedulerState> {
    try {
      return parseState(await readFile(this.#path(workspace), 'utf8'), workspace);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { version: 1, workspace, schedules: [], dispatches: [] };
    }
  }

  async #write(state: SchedulerState): Promise<void> {
    const directory = this.#directory(state.workspace);
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `scheduler-${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, this.#path(state.workspace));
  }

  async putSchedule(schedule: DailySchedule): Promise<DailySchedule> {
    assertScheduleScope(schedule.workspace, schedule.id);
    return this.#locked(schedule.workspace, async () => {
      const state = await this.#read(schedule.workspace);
      const existing = state.schedules.find((candidate) => candidate.id === schedule.id);
      if (existing !== undefined) return existing;
      if (state.schedules.length >= MAX_SCHEDULES) throw new SchedulerStoreError('workspace schedule limit reached');
      await this.#write({ ...state, schedules: [...state.schedules, schedule] });
      return schedule;
    });
  }

  async listWorkspaces(): Promise<readonly string[]> {
    let entries;
    try {
      entries = await readdir(this.#root, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const workspaces: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[0-9a-f]{12}$/u.test(entry.name)) continue;
      try {
        const raw = JSON.parse(await readFile(join(this.#root, entry.name, 'scheduler.json'), 'utf8')) as Partial<SchedulerState>;
        if (raw.version === 1 && typeof raw.workspace === 'string' && validWorkspace(raw.workspace)
          && Array.isArray(raw.schedules) && raw.schedules.length > 0) {
          workspaces.push(raw.workspace);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new SchedulerStoreError('scheduler workspace index is unreadable');
      }
    }
    return [...new Set(workspaces)].sort();
  }

  async getSchedule(workspace: string, scheduleId: string): Promise<DailySchedule | null> {
    assertScheduleScope(workspace, scheduleId);
    return this.#locked(workspace, async () => (await this.#read(workspace)).schedules
      .find((schedule) => schedule.id === scheduleId) ?? null);
  }

  async listSchedules(workspace: string): Promise<readonly DailySchedule[]> {
    return this.#locked(workspace, async () => [...(await this.#read(workspace)).schedules]
      .sort((a, b) => a.nextEligibleAt.localeCompare(b.nextEligibleAt)));
  }

  async claimDispatch(
    workspace: string,
    scheduleId: string,
    dispatchKey: string,
    at: string,
    leaseMs: number,
    maxAttempts: number,
    leaseId: string,
  ): Promise<DispatchClaim> {
    assertScheduleScope(workspace, scheduleId);
    if (leaseMs < 1 || maxAttempts < 1) throw new SchedulerStoreError('invalid dispatch bounds');
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      if (!state.schedules.some((schedule) => schedule.id === scheduleId)) {
        throw new ScheduleConflict('schedule does not exist');
      }
      const atMs = Date.parse(at);
      const active = state.dispatches.find((dispatch) => dispatch.scheduleId === scheduleId
        && dispatch.status === 'CLAIMED' && Date.parse(dispatch.leaseExpiresAt) > atMs);
      const existingIndex = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const existing = state.dispatches[existingIndex];
      if (existing?.status === 'COMPLETED') return { outcome: 'DUPLICATE', dispatch: existing };
      if (active !== undefined) return { outcome: 'BUSY', dispatch: active };
      if (existing !== undefined && existing.attempt >= maxAttempts) {
        return { outcome: 'EXHAUSTED', dispatch: existing };
      }

      const dispatch: ScheduleDispatch = {
        key,
        leaseId,
        scheduleId,
        workspace,
        status: 'CLAIMED',
        attempt: (existing?.attempt ?? 0) + 1,
        claimedAt: at,
        leaseExpiresAt: new Date(atMs + leaseMs).toISOString(),
        finishedAt: null,
        runId: null,
        error: null,
      };
      const dispatches = [...state.dispatches];
      if (existingIndex === -1) dispatches.push(dispatch);
      else dispatches[existingIndex] = dispatch;
      await this.#write({ ...state, dispatches: dispatches.slice(-MAX_DISPATCH_HISTORY) });
      return { outcome: 'CLAIMED', dispatch };
    });
  }

  async completeDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    runId: string,
    at: string,
    nextEligibleAt: string | null,
  ): Promise<ScheduleDispatch> {
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      const index = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const current = state.dispatches[index];
      if (current === undefined || current.status !== 'CLAIMED' || current.leaseId !== leaseId) {
        throw new ScheduleConflict('dispatch lease is no longer active');
      }
      const completed: ScheduleDispatch = {
        ...current,
        status: 'COMPLETED',
        finishedAt: at,
        runId,
        error: null,
      };
      const dispatches = [...state.dispatches];
      dispatches[index] = completed;
      const schedules = state.schedules.map((schedule) => schedule.id !== current.scheduleId ? schedule : {
        ...schedule,
        lastRunAt: at,
        lastRunId: runId,
        retry: { state: 'IDLE' as const, attempts: 0, lastError: null },
        updatedAt: at,
        ...(nextEligibleAt === null ? {} : { nextEligibleAt }),
      });
      await this.#write({ ...state, schedules, dispatches });
      return completed;
    });
  }

  async failDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    at: string,
    exhausted: boolean,
  ): Promise<ScheduleDispatch> {
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      const index = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const current = state.dispatches[index];
      if (current === undefined || current.status !== 'CLAIMED' || current.leaseId !== leaseId) {
        throw new ScheduleConflict('dispatch lease is no longer active');
      }
      const failed: ScheduleDispatch = {
        ...current,
        status: 'FAILED',
        finishedAt: at,
        error: 'dispatch_failed',
      };
      const dispatches = [...state.dispatches];
      dispatches[index] = failed;
      const schedules = state.schedules.map((schedule) => schedule.id !== current.scheduleId ? schedule : {
        ...schedule,
        retry: {
          state: exhausted ? 'EXHAUSTED' as const : 'PENDING' as const,
          attempts: current.attempt,
          lastError: 'dispatch_failed',
        },
        updatedAt: at,
      });
      await this.#write({ ...state, schedules, dispatches });
      return failed;
    });
  }
}

/** HydraDB-backed schedule state for hosted cold-start durability. */
export class CloudScheduleStore implements ScheduleStore {
  readonly #cloud: HydraCloud;
  readonly #collection: string;
  readonly #locks = new Map<string, Promise<void>>();
  readonly #state = new Map<string, SchedulerState>();
  #indexLock: Promise<void> = Promise.resolve();

  constructor(cloud: HydraCloud, collection = 'lacuna-schedules') {
    this.#cloud = cloud;
    this.#collection = collection;
  }

  async #locked<T>(workspace: string, action: () => Promise<T>): Promise<T> {
    if (!validWorkspace(workspace)) {
      throw new SchedulerStoreError('invalid workspace');
    }
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

  #id(workspace: string): string {
    return `lacuna:schedules:${workspaceFingerprint(workspace)}`;
  }

  async #read(workspace: string): Promise<SchedulerState> {
    const cached = this.#state.get(workspace);
    if (cached !== undefined) return cached;
    const source = await this.#cloud.inspect(this.#id(workspace), 10_000, this.#collection);
    if (source === null) return { version: 1, workspace, schedules: [], dispatches: [] };
    try {
      const envelope = JSON.parse(source.envelope) as { content?: { text?: unknown } };
      const text = envelope.content?.text;
      if (typeof text !== 'string' || text === '') throw new SchedulerStoreError('scheduler state is unreadable');
      const state = parseState(text, workspace);
      this.#state.set(workspace, state);
      return state;
    } catch (error) {
      if (error instanceof SchedulerStoreError) throw error;
      throw new SchedulerStoreError('scheduler state is unreadable');
    }
  }

  async #write(state: SchedulerState): Promise<void> {
    const results = await this.#cloud.ingestApp([{
      id: this.#id(state.workspace),
      title: 'Lacuna daily schedules',
      type: 'custom',
      timestamp: new Date().toISOString(),
      text: JSON.stringify(state),
      metadata: { lacuna_record: 'schedules', workspace: workspaceFingerprint(state.workspace) },
    }], this.#collection);
    if (results.length === 0 || results.some((result) => result.error !== null && result.error !== '')) {
      throw new SchedulerStoreError('scheduler state write was refused');
    }
    this.#state.set(state.workspace, state);
  }

  async #readWorkspaceIndex(): Promise<SchedulerWorkspaceIndex> {
    const source = await this.#cloud.inspect(WORKSPACE_INDEX_ID, 10_000, this.#collection);
    if (source === null) return { version: 1, workspaces: [] };
    try {
      const envelope = JSON.parse(source.envelope) as { content?: { text?: unknown } };
      const text = envelope.content?.text;
      if (typeof text !== 'string' || text === '') throw new Error('missing text');
      const parsed = JSON.parse(text) as Partial<SchedulerWorkspaceIndex>;
      if (parsed.version !== 1 || !Array.isArray(parsed.workspaces)
        || parsed.workspaces.some((workspace) => typeof workspace !== 'string' || !validWorkspace(workspace))) {
        throw new Error('invalid index');
      }
      return parsed as SchedulerWorkspaceIndex;
    } catch {
      throw new SchedulerStoreError('scheduler workspace index is unreadable');
    }
  }

  async #registerWorkspace(workspace: string): Promise<void> {
    const previous = this.#indexLock;
    let release = (): void => undefined;
    const current = new Promise<void>((resolve) => { release = resolve; });
    this.#indexLock = current;
    await previous;
    try {
      const held = await this.#readWorkspaceIndex();
      if (held.workspaces.includes(workspace)) return;
      if (held.workspaces.length >= MAX_SCHEDULE_WORKSPACES) {
        throw new SchedulerStoreError('scheduler workspace limit reached');
      }
      const next: SchedulerWorkspaceIndex = {
        version: 1,
        workspaces: [...held.workspaces, workspace].sort(),
      };
      const results = await this.#cloud.ingestApp([{
        id: WORKSPACE_INDEX_ID,
        title: 'Lacuna schedule workspace registry',
        type: 'custom',
        timestamp: new Date().toISOString(),
        text: JSON.stringify(next),
        metadata: { lacuna_record: 'schedule_workspace_index' },
      }], this.#collection);
      if (results.length === 0 || results.some((result) => result.error !== null && result.error !== '')) {
        throw new SchedulerStoreError('scheduler workspace registration was refused');
      }
    } finally {
      release();
      if (this.#indexLock === current) this.#indexLock = Promise.resolve();
    }
  }

  async putSchedule(schedule: DailySchedule): Promise<DailySchedule> {
    assertScheduleScope(schedule.workspace, schedule.id);
    const stored = await this.#locked(schedule.workspace, async () => {
      const state = await this.#read(schedule.workspace);
      const existing = state.schedules.find((candidate) => candidate.id === schedule.id);
      if (existing !== undefined) return existing;
      if (state.schedules.length >= MAX_SCHEDULES) throw new SchedulerStoreError('workspace schedule limit reached');
      await this.#write({ ...state, schedules: [...state.schedules, schedule] });
      return schedule;
    });
    await this.#registerWorkspace(schedule.workspace);
    return stored;
  }

  async listWorkspaces(): Promise<readonly string[]> {
    return [...(await this.#readWorkspaceIndex()).workspaces].sort();
  }

  async getSchedule(workspace: string, scheduleId: string): Promise<DailySchedule | null> {
    assertScheduleScope(workspace, scheduleId);
    return this.#locked(workspace, async () => (await this.#read(workspace)).schedules
      .find((schedule) => schedule.id === scheduleId) ?? null);
  }

  async listSchedules(workspace: string): Promise<readonly DailySchedule[]> {
    return this.#locked(workspace, async () => [...(await this.#read(workspace)).schedules]
      .sort((a, b) => a.nextEligibleAt.localeCompare(b.nextEligibleAt)));
  }

  async claimDispatch(
    workspace: string,
    scheduleId: string,
    dispatchKey: string,
    at: string,
    leaseMs: number,
    maxAttempts: number,
    leaseId: string,
  ): Promise<DispatchClaim> {
    assertScheduleScope(workspace, scheduleId);
    if (leaseMs < 1 || maxAttempts < 1) throw new SchedulerStoreError('invalid dispatch bounds');
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      if (!state.schedules.some((schedule) => schedule.id === scheduleId)) throw new ScheduleConflict('schedule does not exist');
      const atMs = Date.parse(at);
      const active = state.dispatches.find((dispatch) => dispatch.scheduleId === scheduleId
        && dispatch.status === 'CLAIMED' && Date.parse(dispatch.leaseExpiresAt) > atMs);
      const existingIndex = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const existing = state.dispatches[existingIndex];
      if (existing?.status === 'COMPLETED') return { outcome: 'DUPLICATE', dispatch: existing };
      if (active !== undefined) return { outcome: 'BUSY', dispatch: active };
      if (existing !== undefined && existing.attempt >= maxAttempts) return { outcome: 'EXHAUSTED', dispatch: existing };
      const dispatch: ScheduleDispatch = {
        key, leaseId, scheduleId, workspace, status: 'CLAIMED', attempt: (existing?.attempt ?? 0) + 1,
        claimedAt: at, leaseExpiresAt: new Date(atMs + leaseMs).toISOString(), finishedAt: null,
        runId: null, error: null,
      };
      const dispatches = [...state.dispatches];
      if (existingIndex === -1) dispatches.push(dispatch); else dispatches[existingIndex] = dispatch;
      await this.#write({ ...state, dispatches: dispatches.slice(-MAX_DISPATCH_HISTORY) });
      return { outcome: 'CLAIMED', dispatch };
    });
  }

  async completeDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    runId: string,
    at: string,
    nextEligibleAt: string | null,
  ): Promise<ScheduleDispatch> {
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      const index = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const current = state.dispatches[index];
      if (current === undefined || current.status !== 'CLAIMED' || current.leaseId !== leaseId) throw new ScheduleConflict('dispatch lease is no longer active');
      const completed: ScheduleDispatch = { ...current, status: 'COMPLETED', finishedAt: at, runId, error: null };
      const dispatches = [...state.dispatches];
      dispatches[index] = completed;
      const schedules = state.schedules.map((schedule) => schedule.id !== current.scheduleId ? schedule : {
        ...schedule,
        lastRunAt: at,
        lastRunId: runId,
        retry: { state: 'IDLE' as const, attempts: 0, lastError: null },
        ...(nextEligibleAt === null ? {} : { nextEligibleAt }),
        updatedAt: at,
      });
      await this.#write({ ...state, dispatches, schedules });
      return completed;
    });
  }

  async failDispatch(
    workspace: string,
    dispatchKey: string,
    leaseId: string,
    at: string,
    exhausted: boolean,
  ): Promise<ScheduleDispatch> {
    const key = dispatchHash(dispatchKey);
    return this.#locked(workspace, async () => {
      const state = await this.#read(workspace);
      const index = state.dispatches.findIndex((dispatch) => dispatch.key === key);
      const current = state.dispatches[index];
      if (current === undefined || current.status !== 'CLAIMED' || current.leaseId !== leaseId) throw new ScheduleConflict('dispatch lease is no longer active');
      const failed: ScheduleDispatch = { ...current, status: 'FAILED', finishedAt: at, error: 'dispatch_failed' };
      const dispatches = [...state.dispatches];
      dispatches[index] = failed;
      const schedules = state.schedules.map((schedule) => schedule.id !== current.scheduleId ? schedule : {
        ...schedule,
        retry: {
          state: exhausted ? 'EXHAUSTED' as const : 'PENDING' as const,
          attempts: current.attempt,
          lastError: 'dispatch_failed',
        },
        updatedAt: at,
      });
      await this.#write({ ...state, dispatches, schedules });
      return failed;
    });
  }
}
