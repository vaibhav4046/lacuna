import {
  VoiceRuntimeError,
  type PlaybackHandlers,
  type SignalFrame,
} from './controller';

function frameFrom(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): SignalFrame {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const sample = buffer[index] ?? 0;
    sum += sample * sample;
  }
  const step = Math.max(1, Math.floor(buffer.length / 64));
  const waveform: number[] = [];
  for (let index = 0; index < buffer.length && waveform.length < 64; index += step) {
    waveform.push(buffer[index] ?? 0);
  }
  return { rms: Math.sqrt(sum / buffer.length), waveform };
}

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

interface ActivePlayback {
  readonly generation: number;
  cancel(): void;
}

function createContext(): AudioContext | null {
  const constructors = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Context = constructors.AudioContext ?? constructors.webkitAudioContext;
  if (Context === undefined) return null;
  try {
    return new Context({ latencyHint: 'interactive' });
  } catch {
    return null;
  }
}

function isAutoplayRejection(error: unknown): boolean {
  // DOMException objects can cross an iframe/worker boundary and lose their
  // realm identity. Browser autoplay contracts are defined by the error name,
  // so use the structural signal instead of `instanceof`.
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && (error as { readonly name?: unknown }).name === 'NotAllowedError';
}

/** Native audio is the playback contract; metering is an optional enhancement. */
export class PlaybackSession {
  #context: AudioContext | null = null;
  #resume: Promise<void> | null = null;
  #active: ActivePlayback | null = null;
  #generation = 0;
  #disposed = false;

  prepare(): void {
    if (this.#disposed || this.#context !== null) return;
    this.#context = createContext();
    if (this.#context !== null) {
      this.#resume = this.#context.resume().catch(() => undefined);
    }
  }

  async play(blob: Blob, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
    this.#active?.cancel();
    const generation = ++this.#generation;
    const url = URL.createObjectURL(blob);
    const element = new Audio(url);
    // iOS Safari otherwise promotes a blob-backed element into a full-screen
    // player and can discard the user-gesture relationship needed for play().
    // These properties are harmless on desktop browsers and keep playback
    // inline wherever the platform supports it.
    // The DOM lib exposes `playsInline` on video but not audio even though
    // WebKit honors it for both. Keep the narrow runtime extension local.
    (element as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
    element.setAttribute?.('playsinline', '');
    element.preload = 'auto';

    // A context prepared before an async provider round trip may still be
    // suspended (notably on Safari). Retry the resume immediately before
    // attaching the optional analyser; native element playback remains the
    // contract if the context is unavailable or refuses to resume.
    if (this.#context !== null && this.#context.state !== 'running') {
      try { await this.#context.resume(); } catch { /* native playback still proceeds */ }
    }

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      let raf = 0;
      let source: MediaElementAudioSourceNode | null = null;
      let analyser: AnalyserNode | null = null;
      let samples: Float32Array<ArrayBuffer> | null = null;
      let metering = false;
      let started = false;
      let active: ActivePlayback;

      const current = () => this.#active === active && active.generation === generation
        && this.#generation === generation;
      const cleanup = () => {
        if (raf !== 0) cancelAnimationFrame(raf);
        element.removeEventListener('playing', playing);
        element.removeEventListener('ended', ended);
        element.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
        source?.disconnect();
        analyser?.disconnect();
        element.pause();
        element.removeAttribute('src');
        element.load();
        URL.revokeObjectURL(url);
        if (this.#active === active) this.#active = null;
      };
      const finish = (error?: VoiceRuntimeError) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error === undefined) resolve();
        else reject(error);
      };
      const measure = () => {
        if (!current() || element.paused || element.ended || analyser === null || samples === null) return;
        handlers.signal(frameFrom(analyser, samples));
        raf = requestAnimationFrame(measure);
      };
      const playing = () => {
        if (!current() || finished || started) return;
        started = true;
        handlers.started(metering ? 'live' : 'unavailable');
        if (metering) raf = requestAnimationFrame(measure);
      };
      const ended = () => finish();
      const failed = () => finish(new VoiceRuntimeError('error'));
      const aborted = () => finish(new VoiceRuntimeError('interrupted'));
      active = {
        generation,
        cancel: aborted,
      };
      this.#active = active;

      element.addEventListener('playing', playing);
      element.addEventListener('ended', ended, { once: true });
      element.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true });
      if (signal.aborted) {
        aborted();
        return;
      }

      if (this.#resume !== null && this.#context?.state === 'running') {
        try {
          source = this.#context.createMediaElementSource(element);
          analyser = this.#context.createAnalyser();
          analyser.fftSize = 1024;
          source.connect(analyser);
          analyser.connect(this.#context.destination);
          samples = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
          metering = true;
        } catch {
          source?.disconnect();
          analyser?.disconnect();
          source = null;
          analyser = null;
          samples = null;
        }
      }

      try {
        // HTMLMediaElement.play() resolves once playback has begun, but a few
        // WebKit/WebView combinations do not emit `playing` for a blob-backed
        // element. Treat the fulfilled promise as the equivalent lifecycle
        // boundary so the controller cannot remain stuck in CHECKING_CONTEXT
        // or leave the answer marked as not yet speaking. The event handler
        // remains authoritative where it is delivered and `started` is
        // idempotent through the local guard. Older WebKit implementations
        // return `undefined` from play(); in that case the native lifecycle
        // events remain the only start signal and must not be treated as an
        // exception.
        const playResult = element.play() as unknown as PromiseLike<void> | undefined;
        if (playResult === undefined) return;
        void Promise.resolve(playResult).then(() => {
          if (!current() || finished || started) return;
          playing();
        }).catch((error: unknown) => {
          if (!current() || finished) return;
          if (signal.aborted) aborted();
          else if (isAutoplayRejection(error)) finish(new VoiceRuntimeError('playback_blocked'));
          else finish(new VoiceRuntimeError('error'));
        });
      } catch (error) {
        if (signal.aborted) aborted();
        else if (isAutoplayRejection(error)) finish(new VoiceRuntimeError('playback_blocked'));
        else finish(new VoiceRuntimeError('error'));
      }
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#active?.cancel();
    const context = this.#context;
    this.#context = null;
    this.#resume = null;
    if (context !== null) void context.close().catch(() => undefined);
  }
}
