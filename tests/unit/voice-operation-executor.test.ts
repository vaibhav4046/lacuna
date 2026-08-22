import { describe, expect, it, vi } from 'vitest';

import {
  formatVoicePreview,
  type VoiceEffect,
  type VoiceOperation,
} from '../../src/voice/operations.js';
import type { VoiceIntentReason } from '../../src/voice/intent.js';
import {
  createVoiceRequestId,
  VoiceOperationExecutor,
  type VoiceOperationPlan,
} from '../../web/src/voice/operations.js';

const REQUEST_ID = '123e4567-e89b-42d3-a456-426614174000';
const CSRF = 'voice-csrf-token';
const SESSION_BINDING_A = 'a'.repeat(64);
const SESSION_BINDING_B = 'b'.repeat(64);

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
  const reason = options.reason ?? null;
  const preview = formatVoicePreview(operation);
  return {
    version: 1,
    requestId: REQUEST_ID,
    operation,
    effect: EFFECTS[operation.kind],
    requiresConfirmation: CONFIRMATION.has(operation.kind),
    available: options.available ?? true,
    reason,
    display: reason === 'public_read_only'
      ? 'Public explore mode is read-only. This action was not planned for execution.'
      : reason === 'already_on_route'
        ? `Already here. ${preview}`
        : preview,
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
    display: 'That command is not supported. Try navigation, a summary, a question, remember, or Researcher work.',
  };
}

interface FetchCall {
  readonly path: string;
  readonly init: RequestInit;
}

function harness(responder: (path: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const navigate = vi.fn<(path: string) => void>();
  let queuedPlan: VoiceOperationPlan | null = null;
  let currentBinding: string | null = SESSION_BINDING_A;
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    calls.push({ path, init });
    if (path === '/api/workspace/voice/intent' && queuedPlan !== null) {
      const response = queuedPlan;
      queuedPlan = null;
      return json(response);
    }
    return responder(path, init);
  }) as unknown as typeof fetch;
  const executor = new VoiceOperationExecutor({
    fetchImpl,
    navigate,
    randomUUID: () => REQUEST_ID,
    csrfToken: () => CSRF,
    sessionBinding: () => currentBinding,
  });
  const trust = async (
    plan: VoiceOperationPlan,
    currentRoute = '/app/dash',
  ): Promise<VoiceOperationPlan> => {
    queuedPlan = plan;
    try {
      return await executor.plan('bounded command', currentRoute);
    } finally {
      queuedPlan = null;
    }
  };
  return {
    calls,
    executor,
    navigate,
    trust,
    setSessionBinding: (binding: string | null) => { currentBinding = binding; },
  };
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

function expectVoiceBinding(call: FetchCall, binding = SESSION_BINDING_A): void {
  expect(new Headers(call.init.headers).get('x-lacuna-voice-binding')).toBe(binding);
}

describe('voice operation planning boundary', () => {
  it('creates a v4 request id without requiring randomUUID', () => {
    expect(createVoiceRequestId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  });

  it('generates a canonical request id and validates the authenticated network plan again', async () => {
    const operation = { version: 1, kind: 'ask', question: 'Who owns Atlas?' } as const;
    const expected = planned(operation);
    const { calls, executor } = harness(() => json(expected));

    await expect(executor.plan('Who owns Atlas?', '/app/dash')).resolves.toEqual(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe('/api/workspace/voice/intent');
    expectAuthenticatedPost(calls[0]!);
    expectVoiceBinding(calls[0]!);
    expect(body(calls[0]!)).toEqual({
      version: 1,
      requestId: REQUEST_ID,
      transcript: 'Who owns Atlas?',
      currentRoute: '/app/dash',
    });
  });

  it('refuses private planning without one exact opaque session binding', async () => {
    const valid = planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' });
    for (const binding of [null, '', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
      const test = harness(() => json(valid));
      test.setSessionBinding(binding);
      await expect(test.executor.plan('Who owns Atlas?', '/app/dash'))
        .rejects.toMatchObject({ failure: 'session_required' });
      expect(test.calls).toHaveLength(0);
    }
  });

  it('keeps the planning-session binding on the actual mutation after the browser session changes', async () => {
    const test = harness(() => json({ ok: true, claims: 1 }));
    const plan = await test.trust(planned({
      version: 1, kind: 'remember', text: 'Atlas is owned by Priya.',
    }));

    test.setSessionBinding(SESSION_BINDING_B);
    await expect(test.executor.execute(plan)).resolves.toMatchObject({
      status: 'succeeded', observedCount: 1,
    });

    expectVoiceBinding(test.calls[0]!, SESSION_BINDING_A);
    expectVoiceBinding(test.calls[1]!, SESSION_BINDING_A);
  });

  it('keeps the planning-session binding on every target preflight after the browser session changes', async () => {
    const cases = [
      {
        operation: { version: 1, kind: 'cancel_selected_run' } as const,
        preflight: '/api/workspace/runs',
        target: [{ id: 'active-run', status: 'RUNNING' }],
        mutation: { id: 'active-run', status: 'CANCELLED' },
      },
      {
        operation: { version: 1, kind: 'retry_selected_run' } as const,
        preflight: '/api/workspace/runs',
        target: [{ id: 'failed-run', status: 'FAILED' }],
        mutation: { id: 'retried-run', status: 'COMPLETED' },
      },
      {
        operation: { version: 1, kind: 'run_selected_schedule' } as const,
        preflight: '/api/workspace/schedules',
        target: [{ id: 'enabled-schedule', enabled: true }],
        mutation: { outcome: 'DISPATCHED' },
      },
    ];

    for (const sample of cases) {
      const test = harness((path) => json(path === sample.preflight ? sample.target : sample.mutation));
      const plan = await test.trust(planned(sample.operation));
      test.setSessionBinding(SESSION_BINDING_B);

      await expect(test.executor.execute(plan)).resolves.toMatchObject({ status: 'succeeded' });
      expect(test.calls[1]).toMatchObject({ path: sample.preflight, init: { method: 'GET' } });
      expectVoiceBinding(test.calls[1]!, SESSION_BINDING_A);
      expectVoiceBinding(test.calls[2]!, SESSION_BINDING_A);
    }
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

  it('rejects misleading actionable display text instead of confirming server copy', async () => {
    const poisoned = {
      ...planned({ version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' }),
      display: 'Read the Atlas ownership summary. Nothing will be changed.',
    };
    const { calls, executor } = harness(() => json(poisoned));

    await expect(executor.plan('remember Atlas is owned by Priya.', '/app/dash'))
      .rejects.toMatchObject({ failure: 'invalid_plan' });
    expect(calls).toHaveLength(1);
  });

  it('rejects impossible availability reasons and accepts only route-correlated refusals', async () => {
    const impossible = [
      {
        route: '/app/work',
        plan: planned({ version: 1, kind: 'navigate', route: 'graph' }, {
          available: false, reason: 'already_on_route',
        }),
      },
      {
        route: '/app/ask',
        plan: planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }, {
          available: false, reason: 'already_on_route',
        }),
      },
      {
        route: '/app/dash',
        plan: planned({ version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' }, {
          available: false, reason: 'public_read_only',
        }),
      },
      {
        route: '/explore/dash',
        plan: planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }, {
          available: false, reason: 'public_read_only',
        }),
      },
      {
        route: '/app/dash',
        plan: {
          ...planned({ version: 1, kind: 'start_researcher', task: 'Prepare the brief.' }, {
            available: false, reason: 'public_read_only',
          }),
          reason: 'connector_catalogue_unavailable',
          display: 'Start Researcher work: “Prepare the brief.”',
        },
      },
      {
        route: '/explore/dash',
        plan: planned({ version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' }),
      },
      {
        route: '/app/graph',
        plan: planned({ version: 1, kind: 'navigate', route: 'graph' }),
      },
    ] as const;

    for (const entry of impossible) {
      const { calls, executor } = harness(() => json(entry.plan));
      await expect(executor.plan('bounded command', entry.route))
        .rejects.toMatchObject({ failure: 'invalid_plan' });
      expect(calls).toHaveLength(1);
    }

    const already = harness(() => json(planned({ version: 1, kind: 'navigate', route: 'graph' }, {
      available: false, reason: 'already_on_route',
    })));
    const alreadyPlan = await already.executor.plan('go to graph', '/app/graph');
    await expect(already.executor.execute(alreadyPlan)).resolves.toMatchObject({
      status: 'refused', failure: 'operation_refused',
    });
    expect(already.calls).toHaveLength(1);
    expect(already.navigate).not.toHaveBeenCalled();

    const publicWrite = harness(() => json(planned({
      version: 1, kind: 'remember', text: 'Atlas is owned by Priya.',
    }, { available: false, reason: 'public_read_only' })));
    const publicPlan = await publicWrite.executor.plan(
      'remember Atlas is owned by Priya.',
      '/explore/dash',
    );
    await expect(publicWrite.executor.execute(publicPlan)).resolves.toMatchObject({
      status: 'refused', failure: 'operation_refused',
    });
    expect(publicWrite.calls).toHaveLength(1);
  });

  it('fails closed when contextual plans are copied but executes the exact validated object', async () => {
    const publicOperation = {
      version: 1, kind: 'remember', text: 'Atlas is owned by Priya.',
    } as const;
    const publicWrite = harness((path) => path.endsWith('/voice/intent')
      ? json(planned(publicOperation, { available: false, reason: 'public_read_only' }))
      : json({ ok: true, claims: 1 }));
    const publicPlan = await publicWrite.executor.plan(
      'remember Atlas is owned by Priya.',
      '/explore/dash',
    );
    const copiedPublicPlan = {
      ...publicPlan,
      available: true,
      reason: null,
      display: formatVoicePreview(publicOperation),
    };
    await expect(publicWrite.executor.execute(copiedPublicPlan)).resolves.toMatchObject({
      status: 'refused', failure: 'invalid_plan',
    });
    expect(publicWrite.calls).toHaveLength(1);

    const navigationOperation = { version: 1, kind: 'navigate', route: 'graph' } as const;
    const sameRoute = harness(() => json(planned(navigationOperation, {
      available: false, reason: 'already_on_route',
    })));
    const navigationPlan = await sameRoute.executor.plan('go to graph', '/app/graph');
    const copiedNavigationPlan = {
      ...navigationPlan,
      available: true,
      reason: null,
      display: formatVoicePreview(navigationOperation),
    };
    await expect(sameRoute.executor.execute(copiedNavigationPlan)).resolves.toMatchObject({
      status: 'refused', failure: 'invalid_plan',
    });
    expect(sameRoute.calls).toHaveLength(1);
    expect(sameRoute.navigate).not.toHaveBeenCalled();

    const privateWrite = harness((path) => path.endsWith('/voice/intent')
      ? json(planned(publicOperation))
      : json({ ok: true, claims: 1 }));
    const exactPlan = await privateWrite.executor.plan(
      'remember Atlas is owned by Priya.',
      '/app/dash',
    );
    await expect(privateWrite.executor.execute(exactPlan)).resolves.toMatchObject({
      status: 'succeeded', observedCount: 1,
    });
    expect(privateWrite.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/ingest',
    ]);
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
      const { calls, executor, trust } = harness(() => json([{}, {}]));
      const plan = await trust(planned({ version: 1, kind: 'summarize', resource }));
      const result = await executor.execute(plan);
      expect(result).toMatchObject({ status: 'succeeded', observedCount: 2 });
      expect(calls.map((call) => call.path)).toEqual(['/api/workspace/voice/intent', path]);
      expect(calls[1]?.init.credentials).toBe('same-origin');
    }

    const navigation = harness(() => { throw new Error('navigation must stay local'); });
    const navigationPlan = await navigation.trust(planned({ version: 1, kind: 'navigate', route: 'graph' }));
    await expect(navigation.executor.execute(navigationPlan))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 0 });
    expect(navigation.navigate).toHaveBeenCalledWith('/app/graph');
    expect(navigation.calls.map((call) => call.path)).toEqual(['/api/workspace/voice/intent']);

    const ask = harness(() => json({
      reading: { subject: 'Atlas' },
      answer: { status: 'ANSWERED', answer: 'Priya owns Atlas.', evidence: [{}, {}] },
    }));
    const askPlan = await ask.trust(planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }));
    await expect(ask.executor.execute(askPlan))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 2, answer: 'Priya owns Atlas.' });
    expect(ask.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/query',
    ]);
    expect(body(ask.calls[1]!)).toEqual({ question: 'Who owns Atlas?' });

    const remember = harness(() => json({ ok: true, claims: 1, providerDetail: 'must not escape' }));
    const rememberPlan = await remember.trust(planned({
      version: 1, kind: 'remember', text: 'Atlas is owned by Priya.',
    }));
    const remembered = await remember.executor.execute(rememberPlan);
    expect(remember.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/ingest',
    ]);
    expect(body(remember.calls[1]!)).toEqual({ title: 'Voice memory', text: 'Atlas is owned by Priya.' });
    expect(remembered).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(remembered)).not.toContain('providerDetail');

    const researcher = harness(() => json({ id: 'secret-run-id', result: 'provider output' }));
    const researcherPlan = await researcher.trust(planned({
      version: 1, kind: 'start_researcher', task: 'Prepare an Atlas brief.',
    }));
    const researched = await researcher.executor.execute(researcherPlan);
    expect(researcher.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/agent/run',
    ]);
    expect(body(researcher.calls[1]!)).toEqual({ task: 'Prepare an Atlas brief.', requestId: REQUEST_ID });
    expect(researched).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(researched)).not.toMatch(/secret-run-id|provider output/u);

    const cancel = harness((path) => path.endsWith('/runs')
      ? json([{ id: 'run/one', status: 'RUNNING' }, { id: 'done', status: 'COMPLETED' }])
      : json({ id: 'run/one', status: 'CANCELLED', provider: 'secret' }));
    const cancelPlan = await cancel.trust(planned({ version: 1, kind: 'cancel_selected_run' }));
    await expect(cancel.executor.execute(cancelPlan))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(cancel.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/runs',
      '/api/workspace/agent/runs/run%2Fone/cancel',
    ]);

    const retry = harness((path) => path.endsWith('/runs')
      ? json([{ id: 'failed run', status: 'FAILED' }, { id: 'done', status: 'COMPLETED' }])
      : json({ id: 'retry', status: 'COMPLETED', provider: 'secret' }));
    const retryPlan = await retry.trust(planned({ version: 1, kind: 'retry_selected_run' }));
    await expect(retry.executor.execute(retryPlan))
      .resolves.toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(retry.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/runs',
      '/api/workspace/agent/runs/failed%20run/retry',
    ]);

    const schedule = harness((path) => path.endsWith('/schedules')
      ? json([{ id: 'daily/one', enabled: true }, { id: 'paused', enabled: false }])
      : json({ outcome: 'DISPATCHED', runId: 'secret-run' }));
    const schedulePlan = await schedule.trust(planned({ version: 1, kind: 'run_selected_schedule' }));
    const scheduled = await schedule.executor.execute(schedulePlan);
    expect(schedule.calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/schedules',
      '/api/workspace/schedules/daily%2Fone/run',
    ]);
    expect(body(schedule.calls[2]!)).toEqual({ requestId: REQUEST_ID });
    expect(scheduled).toMatchObject({ status: 'succeeded', observedCount: 1 });
    expect(JSON.stringify(scheduled)).not.toContain('secret-run');

    for (const calls of [ask.calls, remember.calls, researcher.calls, cancel.calls, retry.calls, schedule.calls]) {
      for (const call of calls.filter((entry) => entry.init.method === 'POST')) expectAuthenticatedPost(call);
    }
    for (const calls of [remember.calls, researcher.calls, cancel.calls, retry.calls, schedule.calls]) {
      const mutation = calls.at(-1);
      expect(mutation).toBeDefined();
      expectVoiceBinding(mutation!);
    }
  });

  it('executes connector summaries and setup navigation after planning', async () => {
    const { calls, executor, trust, navigate } = harness((path) => path.endsWith('/connectors')
      ? json({ connectors: [{ id: 'text' }, { id: 'github' }] })
      : (() => { throw new Error(`unexpected execution request: ${path}`); })());
    const operations = [
      refused(),
      planned({ version: 1, kind: 'confirm' }),
      planned({ version: 1, kind: 'cancel' }),
      planned({ version: 1, kind: 'summarize', resource: 'connectors' }),
      planned({ version: 1, kind: 'open_connector_setup' }),
      planned({ version: 1, kind: 'open_file_setup' }),
    ] as const;

    for (const [index, operation] of operations.entries()) {
      const plan = await trust(operation);
      const before = calls.length;
      const result = await executor.execute(plan);
      if (index === 3 || index === 4 || index === 5) expect(result.status).toBe('succeeded');
      else expect(result.status).toBe('refused');
      if (index === 3) expect(calls.slice(before).map((call) => call.path)).toEqual(['/api/workspace/connectors']);
      else expect(calls).toHaveLength(before);
    }
    expect(calls.map((call) => call.path)).toEqual([
      '/api/workspace/voice/intent', '/api/workspace/voice/intent', '/api/workspace/voice/intent',
      '/api/workspace/voice/intent', '/api/workspace/connectors',
      '/api/workspace/voice/intent', '/api/workspace/voice/intent',
    ]);
    expect(navigate).toHaveBeenNthCalledWith(1, '/app/conn');
    expect(navigate).toHaveBeenNthCalledWith(2, '/app/conn#file');
  });
});

describe('execution identity and target revalidation', () => {
  it('single-flights one request id and reuses that id on a later retry', async () => {
    let release = (_response: Response): void => undefined;
    const paused = new Promise<Response>((resolve) => { release = resolve; });
    let attempts = 0;
    const { calls, executor, trust } = harness(() => {
      attempts += 1;
      return attempts === 1 ? paused : json({ id: 'retry-run' });
    });
    const plan = await trust(planned({ version: 1, kind: 'start_researcher', task: 'Prepare the brief.' }));

    const first = executor.execute(plan);
    const joined = executor.execute(plan);
    expect(calls).toHaveLength(2);
    release(json({ id: 'first-run' }));
    await expect(Promise.all([first, joined])).resolves.toHaveLength(2);
    expect(calls).toHaveLength(2);

    await expect(executor.execute(plan)).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(3);
    expect(calls.filter((call) => call.path === '/api/workspace/agent/run').map(body)).toEqual([
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
      const { calls, executor, trust } = harness(() => json(entry.rows));
      const plan = await trust(entry.plan);
      await expect(executor.execute(plan)).resolves.toMatchObject({
        status: 'refused', failure: 'target_not_unique',
      });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.init.method).toBe('GET');
    }
  });
});

describe('redacted execution failures', () => {
  it('maps 401 to a fixed session failure without exposing its body', async () => {
    const { executor, trust } = harness(() => json({ error: 'private session diagnostic' }, 401));
    const plan = await trust(planned({ version: 1, kind: 'ask', question: 'Who owns Atlas?' }));
    const result = await executor.execute(plan);
    expect(result).toMatchObject({ status: 'unavailable', failure: 'session_required' });
    expect(JSON.stringify(result)).not.toContain('private session diagnostic');
  });

  it('collapses provider and parser details into a fixed request failure', async () => {
    const { executor, trust } = harness(() => new Response('provider api key and stack trace', { status: 502 }));
    const plan = await trust(planned({
      version: 1, kind: 'start_researcher', task: 'Prepare the brief.',
    }));
    const result = await executor.execute(plan);
    expect(result).toMatchObject({ status: 'unavailable', failure: 'request_failed' });
    expect(JSON.stringify(result)).not.toMatch(/provider|api key|stack trace/u);
  });
});
