import { describe, expect, it } from 'vitest';

import {
  VoiceController, VoiceRuntimeError, voiceCaptureControls, type MicrophoneSession, type PlannedVoiceAnswer,
  type PlaybackHandlers, type RuntimeFailure, type SignalFrame, type TranscriptHandlers,
  type TranscriptSession, type VoiceRuntime,
} from '../../web/src/voice/controller.js';

function planned(
  status: NonNullable<PlannedVoiceAnswer['answer']>['status'] = 'ANSWERED',
  answer: string | null = 'Postgres',
  revisions: readonly number[] = [],
): PlannedVoiceAnswer {
  return {
    reading: {
      subject: 'session state', predicate: 'storage', via: null,
      matched: { subject: 'session state', predicate: 'storage' },
    },
    unread: null, knownSubjects: ['session state'], available: ['storage'], ms: 4,
    answer: {
      status, answer,
      evidence: [{ source: 'meeting-7', meta: 'turn 4', standing: 'current' }],
      revisions, conflicts: status === 'CONFLICT' ? ['Redis', 'Postgres'] : [],
      abstain_reason: status === 'NO_EVIDENCE' ? 'No supported storage claim.' : null,
      trace_id: 'trace-1', source_state: 'current', took_ms: 3,
    },
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeRuntime implements VoiceRuntime {
  readonly microphone: MicrophoneSession = {
    get live() { return true; },
    stop: () => { this.stopped += 1; },
  };
  handlers: TranscriptHandlers | null = null;
  queryResult: PlannedVoiceAnswer = planned();
  microphoneFailure: RuntimeFailure | null = null;
  tokenFailure: RuntimeFailure | null = null;
  transcriptFailure: RuntimeFailure | null = null;
  speechFailure: RuntimeFailure | null = null;
  holdSpeech = false;
  microphoneCalls = 0;
  queryCalls: string[] = [];
  spoken: string[] = [];
  stopped = 0;
  transcriptClosed = 0;
  transcriptCommits = 0;
  calls: string[] = [];

  async openMicrophone(_signal: AbortSignal, _onSignal: (frame: SignalFrame) => void): Promise<MicrophoneSession> {
    this.calls.push('microphone');
    this.microphoneCalls += 1;
    if (this.microphoneFailure !== null) throw new VoiceRuntimeError(this.microphoneFailure);
    return this.microphone;
  }

  async singleUseToken(_signal: AbortSignal): Promise<string> {
    this.calls.push('token');
    if (this.tokenFailure !== null) throw new VoiceRuntimeError(this.tokenFailure);
    return 'sutkn_test_token';
  }

  async openTranscript(
    _token: string,
    _microphone: MicrophoneSession,
    handlers: TranscriptHandlers,
    _signal: AbortSignal,
  ): Promise<TranscriptSession> {
    this.calls.push('transcript');
    if (this.transcriptFailure !== null) throw new VoiceRuntimeError(this.transcriptFailure);
    this.handlers = handlers;
    return {
      commit: () => { this.transcriptCommits += 1; },
      close: () => { this.transcriptClosed += 1; },
    };
  }

  async query(committedTranscript: string, _signal: AbortSignal): Promise<PlannedVoiceAnswer> {
    this.queryCalls.push(committedTranscript);
    return this.queryResult;
  }

  async speak(spokenAnswer: string, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
    this.spoken.push(spokenAnswer);
    if (this.speechFailure !== null) throw new VoiceRuntimeError(this.speechFailure);
    handlers.started();
    handlers.signal({ rms: 0.2, waveform: [0, 0.4, -0.2] });
    if (!this.holdSpeech) return;
    await new Promise<void>((resolve, reject) => {
      signal.addEventListener('abort', () => reject(new VoiceRuntimeError('interrupted')), { once: true });
      void resolve;
    });
  }
}

describe('VoiceController successful context outcomes', () => {
  it('runs current answer through committed transcript, same query result, evidence and real playback', async () => {
    const runtime = new FakeRuntime();
    const controller = new VoiceController(runtime);
    const states: string[] = [];
    controller.subscribe((snapshot) => states.push(snapshot.state));

    await controller.start();
    expect(controller.snapshot.state).toBe('LISTENING');
    expect(runtime.calls.slice(0, 3)).toEqual(['token', 'microphone', 'transcript']);
    runtime.handlers?.partial('Where does session state live');
    expect(controller.snapshot.state).toBe('PARTIAL_TRANSCRIPT');
    expect(runtime.queryCalls).toEqual([]);
    runtime.handlers?.committed('Where does session state live now?');
    await flush();

    expect(runtime.queryCalls).toEqual(['Where does session state live now?']);
    expect(runtime.spoken).toEqual(['Postgres']);
    expect(controller.snapshot.planned?.answer?.evidence).toHaveLength(1);
    expect(states).toEqual(expect.arrayContaining([
      'REQUESTING_PERMISSION', 'LISTENING', 'PARTIAL_TRANSCRIPT', 'COMMITTED',
      'CHECKING_CONTEXT', 'ANSWERED', 'SPEAKING', 'READY',
    ]));
  });

  it('preserves historical revisions on an answered result', async () => {
    const runtime = new FakeRuntime();
    runtime.queryResult = planned('ANSWERED', 'Postgres', [17, 22]);
    const controller = new VoiceController(runtime);
    await controller.submitTyped('Where does session state live now?');
    expect(controller.snapshot.planned?.answer?.revisions).toEqual([17, 22]);
    expect(runtime.queryCalls).toHaveLength(1);
  });

  it('maps contradiction and speaks a refusal rather than selecting a claim', async () => {
    const runtime = new FakeRuntime();
    runtime.queryResult = planned('CONFLICT', null);
    const controller = new VoiceController(runtime);
    const states: string[] = [];
    controller.subscribe((snapshot) => states.push(snapshot.state));
    await controller.submitTyped('Where does session state live?');
    expect(states).toContain('CONTRADICTED');
    expect(runtime.spoken[0]).toContain('contradictory evidence');
    expect(controller.snapshot.planned?.answer?.conflicts).toEqual(['Redis', 'Postgres']);
  });

  it('maps no evidence to ABSTAINED and preserves the reason', async () => {
    const runtime = new FakeRuntime();
    runtime.queryResult = planned('NO_EVIDENCE', null);
    const controller = new VoiceController(runtime);
    const states: string[] = [];
    controller.subscribe((snapshot) => states.push(snapshot.state));
    await controller.submitTyped('What is the unknown policy?');
    expect(states).toContain('ABSTAINED');
    expect(runtime.spoken).toEqual(['No supported storage claim.']);
  });

  it('keeps the spoken fallback replayable when the planner has no answer object', async () => {
    const runtime = new FakeRuntime();
    runtime.queryResult = {
      reading: null,
      unread: 'No matching workspace fact.',
      knownSubjects: [],
      available: [],
      answer: null,
      ms: 4,
    };
    runtime.speechFailure = 'error';
    const controller = new VoiceController(runtime);

    await controller.submitTyped('What is unrecognised?');

    expect(controller.snapshot.state).toBe('ERROR');
    expect(controller.snapshot.planned?.answer).toBeNull();
    expect(controller.snapshot.canReplay).toBe(true);
    expect(runtime.spoken).toEqual(['I could not read that as a question for this workspace.']);
  });
});

describe('VoiceController failures and adversarial lifecycle', () => {
  it('keeps recovery controls available after a transient speech-provider failure', () => {
    expect(voiceCaptureControls('provider_unavailable')).toEqual({ startListening: true, retry: true, replay: true });
    expect(voiceCaptureControls('permission_denied')).toEqual({ startListening: true, retry: true, replay: true });
  });

  it('maps denied microphone permission without opening STT or querying', async () => {
    const runtime = new FakeRuntime();
    runtime.microphoneFailure = 'permission_denied';
    const controller = new VoiceController(runtime);
    await controller.start();
    expect(controller.snapshot.state).toBe('PERMISSION_DENIED');
    expect(runtime.handlers).toBeNull();
    expect(runtime.queryCalls).toEqual([]);
  });

  it('maps token and STT failures to a redacted provider state', async () => {
    const token = new FakeRuntime();
    token.tokenFailure = 'provider_unavailable';
    const tokenController = new VoiceController(token);
    await tokenController.start();
    expect(tokenController.snapshot.state).toBe('PROVIDER_UNAVAILABLE');
    expect(token.calls).toEqual(['token']);
    expect(token.microphoneCalls).toBe(0);

    const stt = new FakeRuntime();
    stt.transcriptFailure = 'provider_unavailable';
    const sttController = new VoiceController(stt);
    await sttController.start();
    expect(sttController.snapshot.state).toBe('PROVIDER_UNAVAILABLE');
  });

  it('maps TTS failure while keeping the text answer and evidence visible', async () => {
    const runtime = new FakeRuntime();
    runtime.speechFailure = 'provider_unavailable';
    const controller = new VoiceController(runtime);
    await controller.submitTyped('Where does session state live?');
    expect(controller.snapshot.state).toBe('PROVIDER_UNAVAILABLE');
    expect(controller.snapshot.planned?.answer?.answer).toBe('Postgres');
    expect(controller.snapshot.planned?.answer?.evidence).toHaveLength(1);
  });

  it('interrupts active real playback and can barge into a new capture', async () => {
    const runtime = new FakeRuntime();
    runtime.holdSpeech = true;
    const controller = new VoiceController(runtime);
    const run = controller.submitTyped('Where does session state live?');
    await flush();
    expect(controller.snapshot.state).toBe('SPEAKING');
    const barge = controller.bargeIn();
    await flush();
    expect(controller.snapshot.state).toBe('LISTENING');
    expect(runtime.microphoneCalls).toBe(1);
    controller.cancel();
    await Promise.allSettled([run, barge]);
  });

  it('does not query or retain a partial transcript after cancel', async () => {
    const runtime = new FakeRuntime();
    const controller = new VoiceController(runtime);
    await controller.start();
    const stale = runtime.handlers;
    stale?.partial('unfinished private words');
    controller.cancel();
    stale?.committed('late callback from an expired session');
    await flush();
    expect(controller.snapshot.state).toBe('INTERRUPTED');
    expect(controller.snapshot.partialTranscript).toBe('');
    expect(runtime.queryCalls).toEqual([]);
  });

  it('ignores double start and stale provider callbacks', async () => {
    const runtime = new FakeRuntime();
    const controller = new VoiceController(runtime);
    await Promise.all([controller.start(), controller.start()]);
    expect(runtime.microphoneCalls).toBe(1);
    const stale = runtime.handlers;
    controller.cancel();
    stale?.partial('late');
    expect(controller.snapshot.partialTranscript).toBe('');
  });

  it('manual stop commits once, stops microphone samples and waits for provider commit', async () => {
    const runtime = new FakeRuntime();
    const controller = new VoiceController(runtime);
    await controller.start();
    controller.stop();
    controller.stop();
    expect(runtime.transcriptCommits).toBe(1);
    expect(runtime.stopped).toBe(1);
    expect(runtime.queryCalls).toEqual([]);
  });
});
