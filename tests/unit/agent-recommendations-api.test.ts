import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRouter } from '../../src/api/router.js';
import { AccountStore } from '../../src/auth/store.js';
import { FileAccounts } from '../../src/auth/accounts.js';
import { workspaceCollection } from '../../src/api/ingest.js';
import type { HydraSource } from '../../src/hydra/source.js';
import { FileScheduleStore } from '../../src/scheduler/store.js';
import type { AgentRecommendation, AgentRun } from '../../src/agent/types.js';

const PASSWORD = 'correct horse battery';
let clock = Date.UTC(2026, 7, 20, 12);

function source(): HydraSource {
  return {
    kind: 'cloud',
    subjects: async () => ({ value: ['Billing Gate'], traces: [] }),
    entity: async () => ({ value: { id: 1, kind: 'service' }, traces: [] }),
    subject: async () => ({
      value: {
        name: 'Billing Gate', id: 1, kind: 'service', mentions: [],
        claims: [
          { id: 1, predicate: 'owner', objectText: 'Priya Raman', polarity: 'positive', validFrom: '2026-08-01T00:00:00.000Z', txTime: '2026-08-01T00:00:00.000Z', supersededBy: [] },
          { id: 2, predicate: 'owner', objectText: 'Rasmus Berg', polarity: 'positive', validFrom: '2026-08-02T00:00:00.000Z', txTime: '2026-08-02T00:00:00.000Z', supersededBy: [] },
        ],
      },
      traces: [],
    }),
    evidence: async () => ({ value: [], traces: [] }),
    dependents: async () => ({ value: [], traces: [] }),
  };
}

class Jar {
  readonly #values = new Map<string, string>();

  absorb(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const pair = line.split(';')[0];
      const at = pair?.indexOf('=') ?? -1;
      if (pair === undefined || at < 0) continue;
      const name = pair.slice(0, at);
      const value = pair.slice(at + 1);
      if (value === '') this.#values.delete(name); else this.#values.set(name, value);
    }
  }

  header(): string { return [...this.#values].map(([name, value]) => `${name}=${value}`).join('; '); }
  csrf(): string { return decodeURIComponent(this.#values.get('lacuna_csrf') ?? ''); }
}

let server: Server;
let base: string;
let directory: string;
let schedules: FileScheduleStore;
let agentCalls = 0;
let ingestCalls = 0;

async function request(jar: Jar, path: string, method = 'GET', body?: unknown, csrf = true): Promise<Response> {
  const headers: Record<string, string> = { cookie: jar.header(), accept: 'application/json' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (csrf) headers['x-csrf-token'] = jar.csrf();
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  jar.absorb(response);
  return response;
}

async function account(email: string): Promise<Jar> {
  clock += 61_000;
  const jar = new Jar();
  await request(jar, '/api/session');
  const response = await request(jar, '/api/auth/signup', 'POST', { email, password: PASSWORD });
  if (response.status !== 201) throw new Error(`signup failed: ${response.status}`);
  return jar;
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lacuna-agent-recommendations-'));
  schedules = new FileScheduleStore(directory);
  const router = new ApiRouter({
    store: new FileAccounts(new AccountStore(directory)),
    secure: false,
    health: null,
    source: () => source(),
    scheduleStore: schedules,
    agent: async (workspace, task) => {
      agentCalls += 1;
      return { id: `run-${agentCalls}`, workspace: workspace ?? 'public', task, status: 'COMPLETED' } as AgentRun;
    },
    ingest: async () => {
      ingestCalls += 1;
      return 'nothing_extracted';
    },
    cronSecret: 'cron-secret',
    now: () => clock,
  });
  server = createServer((incoming, response) => {
    const path = new URL(incoming.url ?? '/', 'http://test.invalid').pathname;
    void router.handle(incoming, response, path).then((handled) => {
      if (!handled.handled) response.writeHead(404).end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe('agent recommendation API', () => {
  it('requires a session and reading it creates neither a run nor a schedule', async () => {
    expect((await fetch(`${base}/api/workspace/recommendations`)).status).toBe(401);
    const alice = await account('alice@example.com');
    const runsBefore = agentCalls;
    const response = await request(alice, '/api/workspace/recommendations');
    const recommendations = (await response.json()) as readonly AgentRecommendation[];

    expect(response.status).toBe(200);
    expect(recommendations[0]).toMatchObject({ kind: 'CONFLICT_TRIAGE', writeback: 'NO_WRITE' });
    expect(agentCalls).toBe(runsBefore);
    expect(await schedules.listSchedules(workspaceCollection('alice@example.com'))).toEqual([]);
  });

  it('checks CSRF, validates the supported controls, and creates idempotently', async () => {
    const alice = await account('alice2@example.com');
    const recommendation = ((await (await request(alice, '/api/workspace/recommendations')).json()) as readonly AgentRecommendation[])[0];
    if (recommendation === undefined) throw new Error('missing recommendation');
    const path = `/api/workspace/agent/recommendations/${encodeURIComponent(recommendation.id)}/schedule`;
    const valid = { cadence: 'DAILY', localTime: '09:30', timezone: 'Europe/London' };

    expect((await request(alice, path, 'POST', valid, false)).status).toBe(403);
    expect((await request(alice, path, 'POST', { ...valid, cadence: 'HOURLY' })).status).toBe(422);
    expect((await request(alice, path, 'POST', { ...valid, localTime: '25:00' })).status).toBe(422);
    expect((await request(alice, path, 'POST', { ...valid, timezone: 'UTC', task: 'replace the bounded task' })).status).toBe(422);

    const first = await request(alice, path, 'POST', valid);
    const second = await request(alice, path, 'POST', valid);
    expect(first.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const held = await schedules.listSchedules(workspaceCollection('alice2@example.com'));
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ cadence: 'DAILY', agentId: expect.stringContaining('researcher') });
    expect(held[0]?.task).toBe(recommendation.task);
  });

  it('cannot materialise another workspace recommendation id', async () => {
    const alice = await account('alice3@example.com');
    const bob = await account('bob@example.com');
    const bobRecommendation = ((await (await request(bob, '/api/workspace/recommendations')).json()) as readonly AgentRecommendation[])[0];
    if (bobRecommendation === undefined) throw new Error('missing recommendation');
    const response = await request(
      alice,
      `/api/workspace/agent/recommendations/${encodeURIComponent(bobRecommendation.id)}/schedule`,
      'POST',
      { cadence: 'DAILY', localTime: '06:00', timezone: 'UTC' },
    );
    expect(response.status).toBe(404);
    expect(await schedules.listSchedules(workspaceCollection('alice3@example.com'))).toEqual([]);
  });

  it('discovers a private scheduled workspace on a later authenticated cron tick', async () => {
    const jar = await account('cron-user@example.com');
    const recommendation = ((await (await request(jar, '/api/workspace/recommendations')).json()) as readonly AgentRecommendation[])[0];
    if (recommendation === undefined) throw new Error('missing recommendation');
    const created = await request(
      jar,
      `/api/workspace/agent/recommendations/${encodeURIComponent(recommendation.id)}/schedule`,
      'POST',
      { cadence: 'DAILY', localTime: '06:00', timezone: 'UTC' },
    );
    const schedule = (await created.json()) as { readonly id: string; readonly nextEligibleAt: string };
    clock = Date.parse(schedule.nextEligibleAt) + 1_000;

    const dispatched = await fetch(`${base}/api/cron/agents/daily`, {
      headers: { authorization: 'Bearer cron-secret' },
    });
    const results = (await dispatched.json()) as readonly { readonly scheduleId: string; readonly outcome: string }[];
    expect(dispatched.status).toBe(200);
    expect(results).toContainEqual(expect.objectContaining({ scheduleId: schedule.id, outcome: 'DISPATCHED' }));
    expect((await schedules.getSchedule(workspaceCollection('cron-user@example.com'), schedule.id))?.lastRunId).not.toBeNull();
  });

  it('bounds private agent spend per workspace and returns Retry-After', async () => {
    const jar = await account('bounded-runs@example.com');
    const separateWorkspace = await account('bounded-runs-other@example.com');
    const before = agentCalls;
    expect((await request(jar, '/api/workspace/agent/run', 'POST', {
      task: 'Review Billing Gate owner evidence.',
      agentId: 'agent-from-another-workspace',
    })).status).toBe(403);
    for (let index = 0; index < 6; index += 1) {
      expect((await request(jar, '/api/workspace/agent/run', 'POST', { task: 'Review Billing Gate owner evidence.' })).status).toBe(200);
    }
    const limited = await request(jar, '/api/workspace/agent/run', 'POST', { task: 'Review Billing Gate owner evidence.' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await request(separateWorkspace, '/api/workspace/agent/run', 'POST', { task: 'Review Billing Gate owner evidence.' })).status).toBe(200);
    expect(agentCalls - before).toBe(7);
  });

  it('does not charge a manual run replay as new workspace spend', async () => {
    const jar = await account('idempotent-run-budget@example.com');
    const recommendation = ((await (await request(jar, '/api/workspace/recommendations')).json()) as readonly AgentRecommendation[])[0];
    if (recommendation === undefined) throw new Error('missing recommendation');
    const created = await request(
      jar,
      `/api/workspace/agent/recommendations/${encodeURIComponent(recommendation.id)}/schedule`,
      'POST',
      { cadence: 'DAILY', localTime: '06:00', timezone: 'UTC' },
    );
    const schedule = (await created.json()) as { readonly id: string };
    const path = `/api/workspace/schedules/${encodeURIComponent(schedule.id)}/run`;
    const first = await request(jar, path, 'POST', { requestId: 'stable-click' });
    const replay = await request(jar, path, 'POST', { requestId: 'stable-click' });
    expect((await first.json()) as { readonly outcome: string }).toMatchObject({ outcome: 'DISPATCHED' });
    expect((await replay.json()) as { readonly outcome: string }).toMatchObject({ outcome: 'DUPLICATE' });

    for (let index = 0; index < 5; index += 1) {
      expect((await request(jar, '/api/workspace/agent/run', 'POST', { task: `Review Billing Gate evidence ${index}.` })).status).toBe(200);
    }
    expect((await request(jar, '/api/workspace/agent/run', 'POST', { task: 'One run beyond the budget.' })).status).toBe(429);
  });

  it('bounds private ingest spend per workspace and returns Retry-After', async () => {
    const jar = await account('bounded-ingest@example.com');
    const before = ingestCalls;
    for (let index = 0; index < 4; index += 1) {
      expect((await request(jar, '/api/workspace/ingest', 'POST', {
        title: `Source ${index}`,
        text: 'Billing Gate is owned by Priya Raman.',
      })).status).toBe(200);
    }
    const limited = await request(jar, '/api/workspace/ingest', 'POST', {
      title: 'Source five',
      text: 'Billing Gate is owned by Priya Raman.',
    });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('300');
    expect(ingestCalls - before).toBe(4);
  });
});
