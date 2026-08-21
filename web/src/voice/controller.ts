import { advanceVoice, type AudioSignal, type VoiceEvent, type VoiceState } from './states';

export type RuntimeFailure = 'permission_denied' | 'rate_limited' | 'provider_unavailable' | 'playback_blocked' | 'interrupted' | 'error';
export type PlaybackAnalysis = 'live' | 'unavailable';

/**
 * Keep recovery controls available after a speech or local playback failure;
 * a valid typed answer may still be safe to replay.
 */
export function voiceCaptureControls(failure: RuntimeFailure | null): {
  readonly startListening: boolean;
  readonly retry: boolean;
  readonly replay: boolean;
} {
  void failure;
  return { startListening: true, retry: true, replay: true };
}

export class VoiceRuntimeError extends Error {
  readonly failure: RuntimeFailure;

  constructor(failure: RuntimeFailure) {
    super(failure);
    this.name = 'VoiceRuntimeError';
    this.failure = failure;
  }
}

export interface SignalFrame {
  readonly rms: number;
  readonly waveform: readonly number[];
}

export interface VoiceEvidence {
  readonly source: string;
  readonly meta: string;
  readonly standing: string;
}

export interface VoiceAnswer {
  readonly status: 'ANSWERED' | 'PARTIAL' | 'CONFLICT' | 'NO_EVIDENCE' | 'SYSTEM_ERROR';
  readonly answer: string | null;
  readonly evidence: readonly VoiceEvidence[];
  readonly revisions: readonly number[];
  readonly conflicts: readonly string[];
  readonly abstain_reason: string | null;
  readonly trace_id: string;
  readonly source_state: string;
  readonly took_ms: number;
}

export interface PlannedVoiceAnswer {
  readonly reading: {
    readonly subject: string;
    readonly predicate: string;
    readonly via: string | null;
    readonly matched: { readonly subject: string; readonly predicate: string };
  } | null;
  readonly unread: string | null;
  readonly knownSubjects: readonly string[];
  readonly available: readonly string[];
  readonly answer: VoiceAnswer | null;
  readonly ms: number;
}

export interface VoiceCommittedTextResult {
  readonly event: 'answer' | 'abstain' | 'contradict';
  readonly spoken: string;
  readonly planned: PlannedVoiceAnswer | null;
}

export type VoiceDirectAsk = () => Promise<VoiceCommittedTextResult>;

export type VoiceCommittedTextDelegate = (
  committedText: string,
  signal: AbortSignal,
  directAsk: VoiceDirectAsk,
) => Promise<VoiceCommittedTextResult>;

export interface MicrophoneSession {
  readonly live: boolean;
  stop(): void;
}

export interface TranscriptSession {
  commit(): void;
  close(): void;
}

export interface TranscriptHandlers {
  readonly partial: (text: string) => void;
  readonly committed: (text: string) => void;
  readonly failure: (failure: RuntimeFailure) => void;
}

export interface PlaybackHandlers {
  readonly started: (analysis: PlaybackAnalysis) => void;
  readonly signal: (frame: SignalFrame) => void;
}

export interface VoiceRuntime {
  preparePlayback(): void;
  dispose(): void;
  openMicrophone(signal: AbortSignal, onSignal: (frame: SignalFrame) => void): Promise<MicrophoneSession>;
  singleUseToken(signal: AbortSignal): Promise<string>;
  openTranscript(
    token: string,
    microphone: MicrophoneSession,
    handlers: TranscriptHandlers,
    signal: AbortSignal,
  ): Promise<TranscriptSession>;
  query(committedTranscript: string, signal: AbortSignal): Promise<PlannedVoiceAnswer>;
  speak(spokenAnswer: string, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void>;
}

export interface VoiceSnapshot {
  readonly state: VoiceState;
  readonly partialTranscript: string;
  readonly transcript: string;
  readonly planned: PlannedVoiceAnswer | null;
  readonly signal: AudioSignal;
  readonly playbackAnalysis: PlaybackAnalysis | null;
  readonly rms: number;
  readonly waveform: readonly number[];
  readonly failure: RuntimeFailure | null;
  /** A real answer or explicit spoken fallback is buffered for a new playback attempt. */
  readonly canReplay: boolean;
}

type Listener = (snapshot: VoiceSnapshot) => void;

const EMPTY_WAVEFORM: readonly number[] = Object.freeze([]);

function spokenResult(planned: PlannedVoiceAnswer): {
  event: VoiceCommittedTextResult['event'];
  text: string;
} | null {
  const answer = planned.answer;
  if (answer === null || planned.reading === null) {
    return { event: 'abstain', text: 'I could not read that as a question for this workspace.' };
  }
  if (answer.status === 'ANSWERED' || answer.status === 'PARTIAL') {
    if (answer.answer === null || answer.answer.trim() === '') return null;
    return { event: 'answer', text: answer.answer.trim() };
  }
  if (answer.status === 'CONFLICT') {
    return {
      event: 'contradict',
      text: answer.answer?.trim() || 'The current memory contains contradictory evidence, so I will not choose one claim.',
    };
  }
  if (answer.status === 'NO_EVIDENCE') {
    return {
      event: 'abstain',
      text: answer.abstain_reason?.trim() || 'I do not have enough evidence in this workspace to answer that.',
    };
  }
  return null;
}

/**
 * One controller for speech and typed fallback. It sends only committed text to
 * its explicit delegate and rejects callbacks from an older run. The default
 * delegate preserves the direct Ask behavior used by existing and public views.
 */
export class VoiceController {
  readonly #runtime: VoiceRuntime;
  readonly #listeners = new Set<Listener>();
  #committedTextDelegate: VoiceCommittedTextDelegate | null;
  #snapshot: VoiceSnapshot = {
    state: 'READY', partialTranscript: '', transcript: '', planned: null,
    signal: null, playbackAnalysis: null, rms: 0, waveform: EMPTY_WAVEFORM, failure: null, canReplay: false,
  };
  #generation = 0;
  #abort: AbortController | null = null;
  #microphone: MicrophoneSession | null = null;
  #transcriptSession: TranscriptSession | null = null;
  #committing = false;
  #spokenAnswer: string | null = null;
  #outcome: 'ANSWERED' | 'ABSTAINED' | 'CONTRADICTED' = 'ANSWERED';

  constructor(runtime: VoiceRuntime, committedTextDelegate: VoiceCommittedTextDelegate | null = null) {
    this.#runtime = runtime;
    this.#committedTextDelegate = committedTextDelegate;
  }

  get snapshot(): VoiceSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  setCommittedTextDelegate(delegate: VoiceCommittedTextDelegate | null): void {
    this.#committedTextDelegate = delegate;
  }

  async start(): Promise<void> {
    if (this.#busy()) return;
    if (this.#snapshot.state === 'SPEAKING') {
      await this.bargeIn();
      return;
    }
    this.#runtime.preparePlayback();
    if (this.#snapshot.state !== 'READY' && this.#snapshot.state !== 'INTERRUPTED') this.#move('retry');
    const generation = this.#begin('request_permission');
    const signal = this.#abort!.signal;
    try {
      // Establish the server-side/provider boundary before asking for the
      // microphone. An unavailable provider must not make the browser capture
      // audio or show a permission prompt it cannot use.
      const token = await this.#runtime.singleUseToken(signal);
      if (generation !== this.#generation || signal.aborted) return;

      let openedMicrophone: MicrophoneSession | null = null;
      const microphone = await this.#runtime.openMicrophone(signal, (frame) => {
        if (generation !== this.#generation || openedMicrophone?.live !== true) return;
        if (this.#snapshot.state !== 'LISTENING' && this.#snapshot.state !== 'PARTIAL_TRANSCRIPT') return;
        this.#update({ signal: 'microphone', rms: frame.rms, waveform: frame.waveform });
      });
      openedMicrophone = microphone;
      if (generation !== this.#generation || signal.aborted) {
        microphone.stop();
        return;
      }
      if (!microphone.live) throw new VoiceRuntimeError('permission_denied');
      this.#microphone = microphone;

      const transcriptSession = await this.#runtime.openTranscript(token, microphone, {
        partial: (text) => this.#onPartial(generation, text),
        committed: (text) => { void this.#onCommitted(generation, text); },
        failure: (failure) => this.#onRuntimeFailure(generation, failure),
      }, signal);
      if (generation !== this.#generation || signal.aborted) {
        transcriptSession.close();
        return;
      }
      if (!microphone.live) {
        transcriptSession.close();
        throw new VoiceRuntimeError('permission_denied');
      }
      this.#transcriptSession = transcriptSession;
      this.#move('permission_granted');
      this.#update({ signal: 'microphone' });
    } catch (error) {
      if (generation === this.#generation) this.#fail(this.#failureFor(error));
    }
  }

  /** Request a manual Scribe commit and stop adding microphone chunks. */
  stop(): void {
    if (this.#snapshot.state !== 'LISTENING' && this.#snapshot.state !== 'PARTIAL_TRANSCRIPT') return;
    if (this.#microphone === null) return;
    this.#transcriptSession?.commit();
    this.#microphone?.stop();
    this.#microphone = null;
    this.#update({ signal: null, rms: 0, waveform: EMPTY_WAVEFORM });
  }

  cancel(): void {
    if (this.#snapshot.state === 'READY') return;
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#closeAudio();
    this.#committing = false;
    this.#move('interrupt');
    this.#update({
      partialTranscript: '', signal: null, rms: 0,
      waveform: EMPTY_WAVEFORM, playbackAnalysis: null, failure: 'interrupted',
    });
  }

  async bargeIn(): Promise<void> {
    this.cancel();
    await this.start();
  }

  async retry(): Promise<void> {
    if (this.#busy()) return;
    if (this.#spokenAnswer !== null) {
      await this.replay();
      return;
    }
    this.#move('retry');
    this.#update({ failure: null });
    await this.start();
  }

  async replay(): Promise<void> {
    if (this.#busy() || this.#snapshot.state === 'SPEAKING' || this.#spokenAnswer === null) return;
    this.#runtime.preparePlayback();
    const generation = this.#beginFromReady();
    await this.#play(generation, this.#spokenAnswer);
  }

  async submitTyped(text: string): Promise<void> {
    if (this.#busy()) return;
    const committed = text.trim();
    if (committed === '') return;
    this.#runtime.preparePlayback();
    if (this.#snapshot.state !== 'READY') this.#move('retry');
    const generation = this.#begin('typed_commit');
    this.#update({ transcript: committed, partialTranscript: '', signal: null });
    await this.#query(generation, committed);
  }

  dispose(): void {
    this.#generation += 1;
    this.#abort?.abort();
    this.#abort = null;
    this.#closeAudio();
    this.#listeners.clear();
    this.#runtime.dispose();
  }

  #busy(): boolean {
    return this.#snapshot.state === 'REQUESTING_PERMISSION'
      || this.#snapshot.state === 'LISTENING'
      || this.#snapshot.state === 'PARTIAL_TRANSCRIPT'
      || this.#snapshot.state === 'COMMITTED'
      || this.#snapshot.state === 'CHECKING_CONTEXT';
  }

  #begin(event: VoiceEvent): number {
    this.#generation += 1;
    this.#abort?.abort();
    this.#closeAudio();
    this.#abort = new AbortController();
    this.#committing = false;
    this.#spokenAnswer = null;
    this.#snapshot = {
      ...this.#snapshot,
      state: advanceVoice(this.#snapshot.state, event),
      partialTranscript: '', transcript: '', planned: null, signal: null,
      playbackAnalysis: null, rms: 0, waveform: EMPTY_WAVEFORM, failure: null, canReplay: false,
    };
    this.#emit();
    return this.#generation;
  }

  #beginFromReady(): number {
    this.#generation += 1;
    this.#abort?.abort();
    this.#closeAudio();
    this.#abort = new AbortController();
    this.#snapshot = {
      ...this.#snapshot, state: this.#outcome, signal: null, playbackAnalysis: null,
      rms: 0, waveform: EMPTY_WAVEFORM, failure: null,
    };
    this.#emit();
    return this.#generation;
  }

  #onPartial(generation: number, raw: string): void {
    if (generation !== this.#generation || this.#microphone?.live !== true || this.#committing) return;
    const text = raw.trim();
    if (text === '') return;
    this.#move('partial');
    this.#update({ partialTranscript: text, signal: 'microphone' });
  }

  async #onCommitted(generation: number, raw: string): Promise<void> {
    if (generation !== this.#generation || this.#committing) return;
    const text = raw.trim();
    if (text === '') return;
    this.#committing = true;
    this.#move('commit');
    this.#closeCapture();
    this.#update({ transcript: text, partialTranscript: '', signal: null, rms: 0, waveform: EMPTY_WAVEFORM });
    await this.#query(generation, text);
  }

  async #query(generation: number, text: string): Promise<void> {
    if (generation !== this.#generation || this.#abort === null) return;
    this.#move('check_context');
    try {
      const signal = this.#abort.signal;
      const directAsk = (): Promise<VoiceCommittedTextResult> => this.#directAsk(text, signal);
      const committed = this.#committedTextDelegate === null
        ? await directAsk()
        : await this.#committedTextDelegate(text, signal, directAsk);
      if (generation !== this.#generation || this.#abort.signal.aborted) return;
      this.#update({ planned: committed.planned });
      this.#spokenAnswer = committed.spoken;
      this.#update({ canReplay: true });
      this.#move(committed.event);
      if (this.#snapshot.state === 'ANSWERED' || this.#snapshot.state === 'ABSTAINED'
        || this.#snapshot.state === 'CONTRADICTED') this.#outcome = this.#snapshot.state;
      await this.#play(generation, committed.spoken);
    } catch (error) {
      if (generation === this.#generation) this.#fail(this.#failureFor(error));
    }
  }

  async #directAsk(text: string, signal: AbortSignal): Promise<VoiceCommittedTextResult> {
    const planned = await this.#runtime.query(text, signal);
    const spoken = spokenResult(planned);
    if (spoken === null) throw new VoiceRuntimeError('error');
    return { event: spoken.event, spoken: spoken.text, planned };
  }

  async #play(generation: number, spokenAnswer: string): Promise<void> {
    if (this.#abort === null) return;
    try {
      await this.#runtime.speak(spokenAnswer, {
        started: (analysis) => {
          if (generation !== this.#generation) return;
          this.#move('playback_started');
          this.#update({
            playbackAnalysis: analysis,
            signal: analysis === 'live' ? 'playback' : null,
          });
        },
        signal: (frame) => {
          if (generation !== this.#generation || this.#snapshot.state !== 'SPEAKING'
            || this.#snapshot.playbackAnalysis !== 'live') return;
          this.#update({ signal: 'playback', rms: frame.rms, waveform: frame.waveform });
        },
      }, this.#abort.signal);
      if (generation !== this.#generation || this.#abort.signal.aborted) return;
      if (this.#snapshot.state === 'SPEAKING') this.#move('playback_finished');
      this.#update({ signal: null, playbackAnalysis: null, rms: 0, waveform: EMPTY_WAVEFORM });
    } catch (error) {
      if (generation === this.#generation) this.#fail(this.#failureFor(error));
    }
  }

  #onRuntimeFailure(generation: number, failure: RuntimeFailure): void {
    if (generation === this.#generation) this.#fail(failure);
  }

  #failureFor(error: unknown): RuntimeFailure {
    if (error instanceof VoiceRuntimeError) return error.failure;
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'permission_denied';
    if (this.#abort?.signal.aborted === true) return 'interrupted';
    return 'error';
  }

  #fail(failure: RuntimeFailure): void {
    this.#closeAudio();
    const event: VoiceEvent = failure === 'permission_denied' ? 'deny'
      : failure === 'rate_limited' ? 'throttle'
        : failure === 'provider_unavailable' ? 'provider_fail'
          : failure === 'interrupted' ? 'interrupt'
            : 'fail';
    this.#move(event);
    this.#update({ failure, signal: null, playbackAnalysis: null, rms: 0, waveform: EMPTY_WAVEFORM });
  }

  #move(event: VoiceEvent): void {
    const next = advanceVoice(this.#snapshot.state, event);
    if (next === this.#snapshot.state) return;
    this.#snapshot = { ...this.#snapshot, state: next };
    this.#emit();
  }

  #update(change: Partial<Omit<VoiceSnapshot, 'state'>>): void {
    this.#snapshot = { ...this.#snapshot, ...change };
    this.#emit();
  }

  #closeCapture(): void {
    this.#transcriptSession?.close();
    this.#transcriptSession = null;
    this.#microphone?.stop();
    this.#microphone = null;
  }

  #closeAudio(): void {
    this.#closeCapture();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }
}
