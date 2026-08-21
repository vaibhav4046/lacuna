import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  VOICE_CONFIRMATION_WINDOW_MS,
  VoiceAssistantController,
  type VoiceAssistantContext,
  type VoiceAssistantExecutor,
} from '../../web/src/voice/assistant-controller.js';
import {
  VoiceController,
  VoiceRuntimeError,
  type MicrophoneSession,
  type PlannedVoiceAnswer,
  type PlaybackHandlers,
  type SignalFrame,
  type TranscriptHandlers,
  type TranscriptSession,
  type VoiceRuntime,
} from '../../web/src/voice/controller.js';
import type {
  VoiceOperationPlan,
  VoiceOperationResult,
} from '../../web/src/voice/operations.js';
import type { VoiceOperation } from '../../src/voice/operations.js';

const REQUEST_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const;

function directAnswer(): PlannedVoiceAnswer {
  return {
    reading: {
      subject: 'Atlas', predicate: 'owner', via: null,
      matched: { subject: 'Atlas', predicate: 'owner' },
    },
    unread: null,
    knownSubjects: ['Atlas'],
    available: ['owner'],
    answer: {
      status: 'ANSWERED', answer: 'Priya owns Atlas.',
      evidence: [{ source: 'meeting-7', meta: 'turn 4', standing: 'current' }],
      revisions: [], conflicts: [], abstain_reason: null,
      trace_id: 'trace-1', source_state: 'current', took_ms: 3,
    },
    ms: 4,
  };
}

function plan(
  operation: VoiceOperation,
  requestId: string,
  display: string,
): VoiceOperationPlan {
  const write = operation.kind === 'remember'
    || operation.kind === 'start_researcher'
    || operation.kind === 'cancel_selected_run'
    || operation.kind === 'retry_selected_run'
    || operation.kind === 'run_selected_schedule';
  return {
    version: 1,
    requestId,
    operation,
    effect: write ? 'write' : operation.kind === 'navigate' ? 'navigation' : 'read',
    requiresConfirmation: write,
    available: true,
    reason: null,
    display,
  };
}

function succeeded(
  planned: VoiceOperationPlan,
  summary: string,
  observedCount = 0,
  answer: string | null = null,
): VoiceOperationResult {
  return {
    requestId: planned.requestId,
    operationKind: planned.operation?.kind ?? null,
    status: 'succeeded',
    failure: null,
    summary,
    observedCount,
    answer,
    answerStatus: answer === null ? null : 'ANSWERED',
  };
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('test condition was not reached');
}

class FakeRuntime implements VoiceRuntime {
  readonly microphone: MicrophoneSession = { live: true, stop: () => undefined };
  queryResult = directAnswer();
  queryPromise: Promise<PlannedVoiceAnswer> | null = null;
  queryCalls: string[] = [];
  spoken: string[] = [];
  speechFailure: VoiceRuntimeError | null = null;
  holdSpeech = false;
  disposed = false;

  preparePlayback(): void {}
  dispose(): void { this.disposed = true; }
  async openMicrophone(_signal: AbortSignal, _onSignal: (frame: SignalFrame) => void): Promise<MicrophoneSession> {
    return this.microphone;
  }
  async singleUseToken(_signal: AbortSignal): Promise<string> { return 'sutkn_voice'; }
  async openTranscript(
    _token: string,
    _microphone: MicrophoneSession,
    _handlers: TranscriptHandlers,
    _signal: AbortSignal,
  ): Promise<TranscriptSession> {
    return { commit: () => undefined, close: () => undefined };
  }
  async query(text: string, _signal: AbortSignal): Promise<PlannedVoiceAnswer> {
    this.queryCalls.push(text);
    return this.queryPromise ?? this.queryResult;
  }
  async speak(text: string, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
    this.spoken.push(text);
    if (this.speechFailure !== null) throw this.speechFailure;
    handlers.started('unavailable');
    if (!this.holdSpeech) return;
    await new Promise<void>((_resolve, reject) => {
      signal.addEventListener(
        'abort',
        () => reject(new VoiceRuntimeError('interrupted')),
        { once: true },
      );
    });
  }
}

class FakeExecutor implements VoiceAssistantExecutor {
  readonly plans = new Map<string, VoiceOperationPlan>();
  readonly results = new WeakMap<VoiceOperationPlan, VoiceOperationResult | Promise<VoiceOperationResult>>();
  readonly planCalls: Array<{ readonly text: string; readonly route: string }> = [];
  readonly executed: VoiceOperationPlan[] = [];
  deferredPlans = new Map<string, Promise<VoiceOperationPlan>>();

  async plan(text: string, currentRoute: string): Promise<VoiceOperationPlan> {
    this.planCalls.push({ text, route: currentRoute });
    const held = this.deferredPlans.get(text);
    if (held !== undefined) return held;
    const planned = this.plans.get(text);
    if (planned === undefined) throw new Error(`missing test plan for ${text}`);
    return planned;
  }

  async execute(value: unknown): Promise<VoiceOperationResult> {
    if (typeof value !== 'object' || value === null || !this.results.has(value as VoiceOperationPlan)) {
      return {
        requestId: null, operationKind: null, status: 'refused', failure: 'invalid_plan',
        summary: 'The voice plan was refused.', observedCount: 0, answer: null, answerStatus: null,
      };
    }
    const planned = value as VoiceOperationPlan;
    this.executed.push(planned);
    return await this.results.get(planned)!;
  }
}

const PRIVATE_CONTEXT: VoiceAssistantContext = {
  currentRoute: '/app/dash',
  scope: 'private',
  sessionKey: 'session-a',
  workspaceKey: 'workspace-a',
};

function harness(context: VoiceAssistantContext = PRIVATE_CONTEXT): {
  readonly runtime: FakeRuntime;
  readonly executor: FakeExecutor;
  readonly voice: VoiceController;
  readonly assistant: VoiceAssistantController;
} {
  const runtime = new FakeRuntime();
  const executor = new FakeExecutor();
  const voice = new VoiceController(runtime);
  const assistant = new VoiceAssistantController(voice, executor, context);
  return { runtime, executor, voice, assistant };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('immediate voice operations', () => {
  it('executes navigation and reads immediately with the exact trusted plans', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const navigation = plan(
      { version: 1, kind: 'navigate', route: 'graph' },
      REQUEST_IDS[0],
      'Open Graph.',
    );
    const summary = plan(
      { version: 1, kind: 'summarize', resource: 'memory' },
      REQUEST_IDS[1],
      'Read the memory summary.',
    );
    executor.plans.set('open graph', navigation);
    executor.plans.set('summarize memory', summary);
    executor.results.set(navigation, succeeded(navigation, 'Opened Graph.'));
    executor.results.set(summary, succeeded(summary, 'Memory summary ready with 2 items.', 2));

    await voice.submitTyped('open graph');
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded', pendingPreview: null,
      result: { operationKind: 'navigate', summary: 'Opened Graph.' },
    });
    await voice.submitTyped('summarize memory');

    expect(executor.executed).toEqual([navigation, summary]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded',
      result: { operationKind: 'summarize', observedCount: 2 },
    });
    expect(runtime.spoken).toEqual(['Opened Graph.', 'Memory summary ready with 2 items.']);
  });

  it('speaks only the fixed observed summary while retaining the bounded Ask result', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const ask = plan(
      { version: 1, kind: 'ask', question: 'Who owns Atlas?' },
      REQUEST_IDS[0],
      'Ask: “Who owns Atlas?”',
    );
    executor.plans.set('Who owns Atlas?', ask);
    executor.results.set(ask, succeeded(ask, 'Answer ready with 1 evidence item.', 1, 'Priya owns Atlas.'));

    await voice.submitTyped('Who owns Atlas?');

    expect(assistant.snapshot.result?.answer).toBe('Priya owns Atlas.');
    expect(runtime.spoken).toEqual(['Answer ready with 1 evidence item.']);
  });
});

describe('one-shot mutation confirmation', () => {
  it('shows an exact mutation preview without executing or speaking remembered text', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' },
      REQUEST_IDS[0],
      'Remember this text: “Atlas is owned by Priya.”',
    );
    executor.plans.set('remember Atlas is owned by Priya.', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));

    await voice.submitTyped('remember Atlas is owned by Priya.');

    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'awaiting_confirmation',
      pendingPreview: 'Remember this text: “Atlas is owned by Priya.”',
      result: null,
    });
    expect(executor.executed).toEqual([]);
    expect(runtime.spoken).toEqual(['Confirmation required.']);
    expect(runtime.spoken.join(' ')).not.toContain('Atlas is owned by Priya');
  });

  it('executes the exact pending plan after a separate exact spoken or typed confirm', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Atlas is owned by Priya.' },
      REQUEST_IDS[0],
      'Remember this text: “Atlas is owned by Priya.”',
    );
    executor.plans.set('remember Atlas is owned by Priya.', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    await voice.submitTyped('remember Atlas is owned by Priya.');

    await voice.submitTyped('confirm');

    expect(executor.planCalls).toHaveLength(1);
    expect(executor.executed).toEqual([remember]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded', pendingPreview: null,
      result: { operationKind: 'remember', summary: 'Stored 1 claim.' },
    });
    expect(runtime.spoken.at(-1)).toBe('Stored 1 claim.');
  });

  it('uses the same one-shot confirmation path for the visible confirm method', async () => {
    const { assistant, executor, voice } = harness();
    const work = plan(
      { version: 1, kind: 'start_researcher', task: 'Prepare the bounded brief.' },
      REQUEST_IDS[0],
      'Start Researcher work: “Prepare the bounded brief.”',
    );
    executor.plans.set('start researcher on the brief', work);
    executor.results.set(work, succeeded(work, 'Researcher work started.', 1));
    await voice.submitTyped('start researcher on the brief');

    await assistant.confirm();

    expect(executor.executed).toEqual([work]);
    expect(assistant.snapshot.result?.summary).toBe('Researcher work started.');
  });

  it('discards a pending plan on exact cancel or the visible cancel method', async () => {
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Do not repeat this source.' },
      REQUEST_IDS[0],
      'Remember this text: “Do not repeat this source.”',
    );
    executor.plans.set('remember private source', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    await voice.submitTyped('remember private source');

    await voice.submitTyped('cancel');
    await assistant.confirm();
    expect(executor.executed).toEqual([]);
    expect(assistant.snapshot.pendingPreview).toBeNull();
    expect(assistant.snapshot.operationPhase).toBe('refused');

    await voice.submitTyped('remember private source');
    assistant.cancelPending();
    await assistant.confirm();
    expect(executor.executed).toEqual([]);
    expect(assistant.snapshot.pendingPreview).toBeNull();
  });

  it('expires at exactly 30 seconds and cannot be confirmed afterwards', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T12:00:00.000Z'));
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Bounded text.' },
      REQUEST_IDS[0],
      'Remember this text: “Bounded text.”',
    );
    executor.plans.set('remember bounded text', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));

    await voice.submitTyped('remember bounded text');
    expect(assistant.snapshot.pendingExpiresAt).toBe(Date.now() + VOICE_CONFIRMATION_WINDOW_MS);
    await vi.advanceTimersByTimeAsync(VOICE_CONFIRMATION_WINDOW_MS - 1);
    expect(assistant.snapshot.operationPhase).toBe('awaiting_confirmation');
    await vi.advanceTimersByTimeAsync(1);

    expect(assistant.snapshot.pendingPreview).toBeNull();
    expect(assistant.snapshot.operationPhase).toBe('refused');
    await assistant.confirm();
    expect(executor.executed).toEqual([]);
  });

  it('does not retain mutation authority without explicit session and workspace bindings', async () => {
    const { assistant, executor, voice } = harness({
      ...PRIVATE_CONTEXT,
      sessionKey: null,
      workspaceKey: null,
    });
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Unbound text.' },
      REQUEST_IDS[0],
      'Remember this text: “Unbound text.”',
    );
    executor.plans.set('remember unbound text', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));

    await voice.submitTyped('remember unbound text');

    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'unavailable', pendingPreview: null,
      result: { status: 'unavailable', summary: 'The operation could not be completed.' },
    });
    await assistant.confirm();
    expect(executor.executed).toEqual([]);
  });

  it('invalidates an old mutation when a new non-control command is committed', async () => {
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Old pending text.' },
      REQUEST_IDS[0],
      'Remember this text: “Old pending text.”',
    );
    const health = plan(
      { version: 1, kind: 'summarize', resource: 'health' },
      REQUEST_IDS[1],
      'Read the health summary.',
    );
    executor.plans.set('remember old text', remember);
    executor.plans.set('summarize health', health);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    executor.results.set(health, succeeded(health, 'Health summary ready with 3 items.', 3));
    await voice.submitTyped('remember old text');

    await voice.submitTyped('summarize health');
    await assistant.confirm();

    expect(executor.executed).toEqual([health]);
    expect(assistant.snapshot.operationPhase).toBe('refused');
  });

  it.each([
    ['session', { ...PRIVATE_CONTEXT, sessionKey: 'session-b' }],
    ['workspace', { ...PRIVATE_CONTEXT, workspaceKey: 'workspace-b' }],
    ['scope', {
      ...PRIVATE_CONTEXT,
      currentRoute: '/explore/dash',
      scope: 'public' as const,
      sessionKey: null,
      workspaceKey: 'public-workspace',
    }],
  ])('invalidates a pending plan on %s change', async (_label, nextContext) => {
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Bound to one workspace.' },
      REQUEST_IDS[0],
      'Remember this text: “Bound to one workspace.”',
    );
    executor.plans.set('remember bound text', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    await voice.submitTyped('remember bound text');

    assistant.setContext(nextContext);
    await assistant.confirm();

    expect(assistant.snapshot.pendingPreview).toBeNull();
    expect(executor.executed).toEqual([]);
  });
});

describe('public compatibility and adversarial lifecycle', () => {
  it('preserves direct Ask in public explore without calling the authenticated planner', async () => {
    const { assistant, executor, runtime, voice } = harness({
      currentRoute: '/explore/dash', scope: 'public', sessionKey: null, workspaceKey: 'public-workspace',
    });

    await voice.submitTyped('Who owns Atlas?');

    expect(executor.planCalls).toEqual([]);
    expect(runtime.queryCalls).toEqual(['Who owns Atlas?']);
    expect(runtime.spoken).toEqual(['Priya owns Atlas.']);
    expect(assistant.snapshot.operationPhase).toBe('idle');
    expect(assistant.snapshot.speech.planned?.answer?.answer).toBe('Priya owns Atlas.');
  });

  it('drops a public Ask result after its session binding changes', async () => {
    const { assistant, executor, runtime, voice } = harness({
      currentRoute: '/explore/dash', scope: 'public', sessionKey: 'session-a', workspaceKey: 'public-workspace',
    });
    const held = deferred<PlannedVoiceAnswer>();
    runtime.queryPromise = held.promise;
    const command = voice.submitTyped('Who owns Atlas?');
    await flush();

    assistant.setContext({
      currentRoute: '/explore/dash', scope: 'public', sessionKey: 'session-b', workspaceKey: 'public-workspace',
    });
    held.resolve(directAnswer());
    await command;

    expect(executor.planCalls).toEqual([]);
    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', result: null,
      speech: { planned: null, state: 'INTERRUPTED' },
    });
  });

  it('drops a public Ask result after a route ABA transition', async () => {
    const context: VoiceAssistantContext = {
      currentRoute: '/explore/dash',
      scope: 'public',
      sessionKey: 'session-a',
      workspaceKey: 'public-workspace',
    };
    const { assistant, executor, runtime, voice } = harness(context);
    const held = deferred<PlannedVoiceAnswer>();
    runtime.queryPromise = held.promise;
    const command = voice.submitTyped('Who owns Atlas?');
    await flush();

    assistant.setContext({ ...context, currentRoute: '/explore/memory' });
    assistant.setContext(context);
    held.resolve(directAnswer());
    await command;

    expect(executor.planCalls).toEqual([]);
    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', result: null,
      speech: { planned: null, state: 'INTERRUPTED' },
    });
  });

  it('drops a public Ask result after disposal', async () => {
    const { assistant, executor, runtime, voice } = harness({
      currentRoute: '/explore/dash', scope: 'public', sessionKey: null, workspaceKey: 'public-workspace',
    });
    const held = deferred<PlannedVoiceAnswer>();
    runtime.queryPromise = held.promise;
    const command = voice.submitTyped('Who owns Atlas?');
    await flush();

    assistant.dispose();
    held.resolve(directAnswer());
    await command;

    expect(executor.planCalls).toEqual([]);
    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', result: null,
      speech: { planned: null },
    });
  });

  it('settles interpreting when media is interrupted and ignores the late plan', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const held = deferred<VoiceOperationPlan>();
    const summary = plan(
      { version: 1, kind: 'summarize', resource: 'memory' },
      REQUEST_IDS[0],
      'Read the memory summary.',
    );
    executor.deferredPlans.set('summarize until interrupted', held.promise);
    executor.results.set(summary, succeeded(summary, 'Memory summary ready with 2 items.', 2));
    const command = voice.submitTyped('summarize until interrupted');
    await flush();
    expect(assistant.snapshot.operationPhase).toBe('interpreting');

    voice.cancel();
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'refused',
      result: { status: 'refused', summary: 'Operation interrupted.' },
    });
    held.resolve(summary);
    await command;

    expect(executor.executed).toEqual([]);
    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot.operationPhase).toBe('refused');
  });

  it('settles executing when media is interrupted and ignores the late result', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const summary = plan(
      { version: 1, kind: 'summarize', resource: 'memory' },
      REQUEST_IDS[0],
      'Read the memory summary.',
    );
    const held = deferred<VoiceOperationResult>();
    executor.plans.set('execute until interrupted', summary);
    executor.results.set(summary, held.promise);
    const command = voice.submitTyped('execute until interrupted');
    await flush();
    expect(assistant.snapshot.operationPhase).toBe('executing');

    voice.cancel();
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'refused',
      result: { status: 'refused', summary: 'Operation interrupted.' },
    });
    held.resolve(succeeded(summary, 'Memory summary ready with 2 items.', 2));
    await command;

    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot.operationPhase).toBe('refused');
    expect(assistant.snapshot.result?.summary).toBe('Operation interrupted.');
  });

  it('preserves committed success when its result playback is stopped', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const navigation = plan(
      { version: 1, kind: 'navigate', route: 'graph' },
      REQUEST_IDS[0],
      'Open Graph.',
    );
    executor.plans.set('open graph and stop speech', navigation);
    executor.results.set(navigation, succeeded(navigation, 'Opened Graph.'));
    runtime.holdSpeech = true;
    const command = voice.submitTyped('open graph and stop speech');
    await waitFor(() => assistant.snapshot.speech.state === 'SPEAKING');
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded', result: { summary: 'Opened Graph.' },
      speech: { state: 'SPEAKING' },
    });

    voice.cancel();
    await command;

    expect(executor.executed).toEqual([navigation]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded', result: { summary: 'Opened Graph.' },
      speech: { state: 'INTERRUPTED' },
    });
  });

  it('drops a stale planning callback after disposal', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const held = deferred<VoiceOperationPlan>();
    const navigation = plan(
      { version: 1, kind: 'navigate', route: 'graph' },
      REQUEST_IDS[0],
      'Open Graph.',
    );
    executor.deferredPlans.set('open graph slowly', held.promise);
    executor.results.set(navigation, succeeded(navigation, 'Opened Graph.'));
    const command = voice.submitTyped('open graph slowly');
    await flush();

    assistant.dispose();
    held.resolve(navigation);
    await command;

    expect(executor.executed).toEqual([]);
    expect(runtime.spoken).toEqual([]);
    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', pendingPreview: null, result: null,
    });
  });

  it('drops a planning callback from a route left during interpretation', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const held = deferred<VoiceOperationPlan>();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Route-bound preview.' },
      REQUEST_IDS[0],
      'Remember this text: “Route-bound preview.”',
    );
    executor.deferredPlans.set('remember after navigation', held.promise);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    const command = voice.submitTyped('remember after navigation');
    await flush();

    assistant.setContext({ ...PRIVATE_CONTEXT, currentRoute: '/app/memory' });
    held.resolve(remember);
    await command;

    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', pendingPreview: null, result: null,
    });
    expect(executor.executed).toEqual([]);
    expect(runtime.spoken).toEqual([]);
  });

  it('revokes an already pending plan on disposal', async () => {
    vi.useFakeTimers();
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Dispose this preview.' },
      REQUEST_IDS[0],
      'Remember this text: “Dispose this preview.”',
    );
    executor.plans.set('remember before disposal', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    await voice.submitTyped('remember before disposal');
    expect(assistant.snapshot.pendingPreview).not.toBeNull();

    assistant.dispose();
    await vi.advanceTimersByTimeAsync(VOICE_CONFIRMATION_WINDOW_MS);
    await assistant.confirm();

    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'idle', pendingPreview: null, pendingExpiresAt: null, result: null,
    });
    expect(executor.executed).toEqual([]);
  });

  it('drops stale execution results after the authenticated binding changes', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const summary = plan(
      { version: 1, kind: 'summarize', resource: 'memory' },
      REQUEST_IDS[0],
      'Read the memory summary.',
    );
    const held = deferred<VoiceOperationResult>();
    executor.plans.set('summarize slowly', summary);
    executor.results.set(summary, held.promise);
    const command = voice.submitTyped('summarize slowly');
    await flush();
    expect(executor.executed).toEqual([summary]);

    assistant.setContext({ ...PRIVATE_CONTEXT, sessionKey: 'session-b' });
    held.resolve(succeeded(summary, 'Memory summary ready with 2 items.', 2));
    await command;

    expect(assistant.snapshot.result).toBeNull();
    expect(runtime.spoken).toEqual([]);
  });

  it('claims a pending plan before awaiting execution so double confirm executes once', async () => {
    const { assistant, executor, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'One shot.' },
      REQUEST_IDS[0],
      'Remember this text: “One shot.”',
    );
    const held = deferred<VoiceOperationResult>();
    executor.plans.set('remember one shot', remember);
    executor.results.set(remember, held.promise);
    await voice.submitTyped('remember one shot');

    const first = assistant.confirm();
    await flush();
    const second = assistant.confirm();
    await flush();
    expect(executor.executed).toEqual([remember]);
    held.resolve(succeeded(remember, 'Stored 1 claim.', 1));
    await Promise.all([first, second]);

    expect(executor.executed).toEqual([remember]);
  });

  it('keeps observed success visible when playback fails and replay never re-executes', async () => {
    const { assistant, executor, runtime, voice } = harness();
    const remember = plan(
      { version: 1, kind: 'remember', text: 'Never speak the full source.' },
      REQUEST_IDS[0],
      'Remember this text: “Never speak the full source.”',
    );
    executor.plans.set('remember the private source', remember);
    executor.results.set(remember, succeeded(remember, 'Stored 1 claim.', 1));
    await voice.submitTyped('remember the private source');
    runtime.speechFailure = new VoiceRuntimeError('playback_blocked');

    await assistant.confirm();

    expect(assistant.snapshot).toMatchObject({
      operationPhase: 'succeeded',
      result: { operationKind: 'remember', summary: 'Stored 1 claim.' },
      speech: { state: 'ERROR', failure: 'playback_blocked', canReplay: true },
    });
    expect(executor.executed).toEqual([remember]);
    runtime.speechFailure = null;
    await voice.retry();
    expect(executor.executed).toEqual([remember]);
    expect(runtime.spoken.at(-1)).toBe('Stored 1 claim.');
    expect(runtime.spoken.join(' ')).not.toContain('Never speak the full source');
  });
});
