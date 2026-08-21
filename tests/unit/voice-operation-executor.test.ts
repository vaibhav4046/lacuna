import { describe, expect, it, vi } from 'vitest';

import type { VoiceEffect, VoiceOperation } from '../../src/voice/operations.js';
import type { VoiceIntentReason } from '../../src/voice/intent.js';
import {
  VoiceOperationExecutor,
  type VoiceOperationPlan,
} from '../../web/src/voice/operations.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const CSRF = 'voice-csrf-token';

const EFFECTS: Readonly<Record<VoiceOperation['kind'], VoiceEffect>> = {
  navigate: 'navigation',
  ask: 'read',
  summarize: 'read',
  open_connector_setup: 'navigation',
  open_file_setup: 'navigation',
  remember: 'write',
  start_researcher: 'write',
  cancel_selected_run: 'write',
  retry_selected_run: 'write',
  run_selected_schedule: 'write',
  confirm: 'read',
  cancel: 'read',
};

const CONFIRMATION = new Set<VoiceOperation['kind']>([
  'remember', 'start_researcher', 'cancel_selected_run', 'retry_selected_run', 'run_selected_schedule',
]);

function planned(
  operation: VoiceOperation,
  options: { readonly available?: boolean; readonly reason?: VoiceIntentReason | null } = {},
): VoiceOperationPlan {
  return {
    version: 1,
    requestId: REQUEST_ID,
    operation,
    effect: EFFECTS[operation.kind],
    requiresConfirmation: CONFIRMATION.has(operation.kind),
    available: options.available ?? true,
    reason: options.reason ?? null,
    display: 'Validated voice operation.',
  };
}

function refused(): VoiceOperationPlan {
  return {
    version: 1,
    requestId: REQUEST_ID,
    operation: null,
    effect: null,
    requiresConfirmation: false,
    available: false,
    reason: 'unsupported_command',
    display: 'That command is not supported.',
  };
}

interface FetchCall {
  readonly path: string;
  readonly init: RequestInit;
}

function harness(responder: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const navigate = vi.fn<(path: string) => void>();
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    calls.push({ path, init });
    return responder(path, init);
  }) as unknown as typeof fetch;
  const executor = new VoiceOperationExecutor({
    fetchImpl,
    navigate,
    randomUUID: () => REQUEST_ID,
    csrfToken: () => CSRF,
  });
  return { calls, executor, navigate };
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function body(call: FetchCall): unknown {
  return JSON.parse(String(call.init.body)) as unknown;
}

function expectAuthenticatedPost(call: FetchCall): void {
  expect(call.init.method).toBe('POST');
  expect(call.init.credentials).toBe('same-origin');
  expect(new Headers(call.init.headers).get('x-csrf-token')).toBe(CSRF);
}

describe('voice operation planning boundary', () => {
  it('generates a canonical request id and validates the authenticated network plan again', async () => {
    const operation = { version: 1, kind: 'ask', question: 'Who owns Atlas?' } as const;
    const expected = planned(operation);
    const { calls, executor } = harness(() => json(expected));

    await expect(executor.plan('Who owns Atlas?', '/app/dash')).resolves.toEqual(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/workspace/voice/intent');
    expectAuthenticatedPost(calls[0]!);
    expect(body(calls[0]!)).toEqual({
      version: 1,
      requestId: REQUEST_ID,
      transcript: 'Who owns Atlas?',
      currentRoute: '/app/dash',
    });
  });

  it('rejects planner-supplied authority and executes no follow-up request', async () => {
    const poisoned = {
      ...planned({ version: 1, kind: 'navigate', route: 'dash' }),
      operation: { version: 1, kind: 'navigate', route: 'dash', endpoint: 'https://evil.example', method: 'POST', id: 'target' },
    };
    const { calls, executor } = harness(() => json(poisoned));

    await expect(executor.plan('go to dashboard', '/app/work')).rejects.toMatchObject({ failure: 'invalid_plan' });
    expect(calls).toHaveLength(1);
  });
});

describe('exhaustive operation allowlist', () => {
  it('maps every union member only to local navigation or existing authenticated APIs', async () => {
    const summaries = [
      ['summary', '/api/workspace/summary'],
      ['memory', '/api/workspace/memory'],
      ['changes', '/api/workspace/changes'],
      ['conflicts', '/api/workspace/conflicts'],
      ['health', '/api/workspace/health'],
      ['graph', '/api/workspace/graph'],
      ['runs', '/api/workspace/runs'],
      ['agents', '/api/workspace/agents'],
      ['tools', '/api/workspace/tools'],
      ['schedules', '/api/workspace/schedules'],
      ['models', '/api/workspace/models'],
      ['evaluations', '/api/workspace/evaluations'],
    ] as const;

    for (const [resource, path] of summaries) {
      const { calls, executor } = harness(() => json([{}, {}]));
      const result = await executor.execute(planned({ version: 1, kind: 'summarize', resource }));
      expect(result).toMatchObject({ status: 'succeeded', observedCount: 2 });
      expect(calls.map((call) => call.path)).toEqual([path]);
      expect(calls[0]?.init.credentials).toBe('same-origin');
    }

    const navigation = harness(() => { throw new Error('navigation must stay local'); });
    await expect(navigation.executor.execute(planned({ version: 1, kind: 'navigate', route: 'graph' })))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith('/app/graph');
    expect(navigation.calls).toEqual([]);

    const ask = harness(() => json({
      reading: { subject: 'Atlas' },
      answer: { status: 'ANSWERED', answer: 'Priya owns Atlas.', evidence: [{}, {}] },
    }));
    await expect(ask.executor.execute(planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' })))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 2, answer: 'Priya owns Atlas.' });
    expect(ask.calls.map((call) => call.path)).toEqual(['/api/workspace/query']);
    expect(body(ask.calls[0]!)).toEqual({ question: 'Who owns Atlas?' });

    const remember = harness(() => json({ ok: true, claims: 1, providerDetail: 'must not escape' }));
    const remembered = await remember.executor.execute(planned({
      version: 1, kind: 'remember', text: 'Atlas is owned by Priya.',
    }));
    expect(remember.calls.map((call) => call.path)).toEqual(['/api/workspace/ingest']);
    expect(body(remember.calls[0]!)).toEqual({ title: 'Voice memory', text: 'Atlas is owned by Priya.' });
    expect(remembered).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(remembered)).not.toContain('providerDetail');

    const researcher = harness(() => json({ id: 'secret-run-id', result: 'provider output' }));
    const researched = await researcher.executor.execute(planned({
      version: 1, kind: 'start_researcher', task: 'Prepare an Atlas brief.',
    }));
    expect(researcher.calls.map((call) => call.path)).toEqual(['/api/workspace/agent/run']);
    expect(body(researcher.calls[0]!)).toEqual({ task: 'Prepare an Atlas brief.', requestId: REQUEST_ID });
    expect(researched).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(researched)).not.toMatch(/secret-run-id|provider output/u);

    const cancel = harness((path) => path.endsWith('/runs')
      ? json([{ id: 'run/one', status: 'RUNNING' }, { id: 'done', status: 'COMPLETED' }])
      : json({ id: 'run/one', status: 'CANCELLED', provider: 'secret' }));
    await expect(cancel.executor.execute(planned({ version: 1, kind: 'cancel_selected_run' })))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(cancel.calls.map((call) => call.path)).toEqual([
      '/api/workspace/runs', '/api/workspace/agent/runs/run%2Fone/cancel',
    ]);

    const retry = harness((path) => path.endsWith('/runs')
      ? json([{ id: 'failed run', status: 'FAILED' }, { id: 'done', status: 'COMPLETED' }])
      : json({ id: 'retry', status: 'COMPLETED', provider: 'secret' }));
    await expect(retry.executor.execute(planned({ version: 1, kind: 'retry_selected_run' })))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(retry.calls.map((call) => call.path)).toEqual([
      '/api/workspace/runs', '/api/workspace/agent/runs/failed%20run/retry',
    ]);

    const schedule = harness((path) => path.endsWith('/schedules')
      ? json([{ id: 'daily/one', enabled: true }, { id: 'paused', enabled: false }])
      : json({ outcome: 'DISPATCHED', runId: 'secret-run' }));
    const scheduled = await schedule.executor.execute(planned({ version: 1, kind: 'run_selected_schedule' }));
    expect(schedule.calls.map((call) => call.path)).toEqual([
      '/api/workspace/schedules', '/api/workspace/schedules/daily%2Fone/run',
    ]);
    expect(body(schedule.calls[1]!)).toEqual({ requestId: REQUEST_ID });
    expect(scheduled).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(scheduled)).not.toContain('secret-run');

    for (const calls of [ask.calls, remember.calls, researcher.calls, cancel.calls, retry.calls, schedule.calls]) {
      for (const call of calls.filter((entry) => entry.init.method === 'POST')) expectAuthenticatedPost(call);
    }
  });

  it('performs no fetch for refusal, controls, or unavailable connector operations', async () => {
    const { calls, executor } = harness(() => { throw new Error('no request allowed'); });
    const operations = [
      refused(),
      planned({ version: 1, kind: 'confirm' }),
      planned({ version: 1, kind: 'cancel' }),
      planned({ version: 1, kind: 'summarize', resource: 'connectors' }, {
        available: false, reason: 'connector_catalogue_unavailable',
      }),
      planned({ version: 1, kind: 'open_connector_setup' }, {
        available: false, reason: 'connector_catalogue_unavailable',
      }),
      planned({ version: 1, kind: 'open_file_setup' }, {
        available: false, reason: 'connector_catalogue_unavailable',
      }),
    ] as const;

    for (const operation of operations) {
      await expect(executor.execute(operation)).resolves.toMatchObject({
        status: operation.reason === 'connector_catalogue_unavailable' ? 'unavailable' : 'refused',
      });
    }
    expect(calls).toEqual([]);
  });
});

describe('execution identity and target revalidation', () => {
  it('single-flights one request id and reuses that id on a later retry', async () => {
    let release = (_response: Response): void => undefined;
    const paused = new Promise<Response>((resolve) => { release = resolve; });
    let attempts = 0;
    const { calls, executor } = harness(() => {
      attempts += 1;
      return attempts === 1 ? paused : json({ id: 'retry-run' });
    });
    const plan = planned({ version: 1, kind: 'start_researcher', task: 'Prepare the brief.' });

    const first = executor.execute(plan);
    const joined = executor.execute(plan);
    expect(calls).toHaveLength(1);
    release(json({ id: 'first-run' }));
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2);
    expect(calls).toHaveLength(1);

    await expect(executor.execute(plan)).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(2);
    expect(calls.map(body)).toEqual([
      { task: 'Prepare the brief.', requestId: REQUEST_ID },
      { task: 'Prepare the brief.', requestId: REQUEST_ID },
    ]);
  });

  it('refuses zero or multiple eligible freshly fetched targets without mutating', async () => {
    const cases = [
      {
        plan: planned({ version: 1, kind: 'cancel_selected_run' }),
        rows: [{ id: 'completed', status: 'COMPLETED' }],
      },
      {
        plan: planned({ version: 1, kind: 'retry_selected_run' }),
        rows: [{ id: 'a', status: 'FAILED' }, { id: 'b', status: 'CANCELLED' }],
      },
      {
        plan: planned({ version: 1, kind: 'run_selected_schedule' }),
        rows: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }],
      },
    ] as const;

    for (const entry of cases) {
      const { calls, executor } = harness(() => json(entry.rows));
      await expect(executor.execute(entry.plan)).resolves.toMatchObject({
        status: 'refused', failure: 'target_not_unique',
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]?.init.method).toBe('GET');
    }
  });
});

describe('redacted execution failures', () => {
  it('maps 401 to a fixed session failure without exposing its body', async () => {
    const { executor } = harness(() => json({ error: 'private session diagnostic' }, 401));
    const result = await executor.execute(planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }));
    expect(result).toMatchObject({ status: 'unavailable', failure: 'session_required' });
    expect(JSON.stringify(result)).not.toContain('private session diagnostic');
  });

  it('collapses provider and parser details into a fixed request failure', async () => {
    const { executor } = harness(() => new Response('provider api key and stack trace', { status: 502 }));
    const result = await executor.execute(planned({
      version: 1, kind: 'start_researcher', task: 'Prepare the brief.',
    }));
    expect(result).toMatchObject({ status: 'unavailable', failure: 'request_failed' });
    expect(JSON.stringify(result)).not.toMatch(/provider|api key|stack trace/u);
  });
});
