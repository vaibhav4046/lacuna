import { csrfHeaders } from '../api/client';
import { hasMp3Prefix } from './audio';
import {
  VoiceRuntimeError,
  type MicrophoneSession,
  type PlannedVoiceAnswer,
  type PlaybackHandlers,
  type RuntimeFailure,
  type SignalFrame,
  type TranscriptHandlers,
  type TranscriptSession,
  type VoiceRuntime,
} from './controller';
import { PlaybackSession } from './playback';
import { readScribeEvent } from './scribe-events';

const SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const SCRIBE_MODEL = 'scribe_v2_realtime';
const TARGET_SAMPLE_RATE = 16_000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 1 * 1024 * 1024;
const REQUEST_ACQUISITION_TIMEOUT_MS = 15_000;

type AudioContextConstructor = new (options?: AudioContextOptions) => AudioContext;

function createAudioContext(): AudioContext {
  const constructors = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor;
  };
  const Context = constructors.AudioContext ?? constructors.webkitAudioContext;
  if (Context === undefined) throw new VoiceRuntimeError('error');
  try {
    return new Context({ latencyHint: 'interactive' });
  } catch {
    throw new VoiceRuntimeError('error');
  }
}

function hasErrorName(error: unknown, names: readonly string[]): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && names.includes((error as { readonly name?: unknown }).name as string);
}

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

function pcm16(input: Float32Array, inputRate: number): Uint8Array<ArrayBuffer> {
  const outputLength = Math.max(1, Math.floor(input.length * TARGET_SAMPLE_RATE / inputRate));
  const output = new Uint8Array(new ArrayBuffer(outputLength * 2));
  const view = new DataView(output.buffer);
  for (let index = 0; index < outputLength; index += 1) {
    const sourceAt = index * inputRate / TARGET_SAMPLE_RATE;
    const left = Math.min(input.length - 1, Math.floor(sourceAt));
    const right = Math.min(input.length - 1, left + 1);
    const mix = sourceAt - left;
    const sample = Math.max(-1, Math.min(1, (input[left] ?? 0) * (1 - mix) + (input[right] ?? 0) * mix));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return output;
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x2000) {
    binary += String.fromCharCode(...bytes.subarray(at, Math.min(bytes.length, at + 0x2000)));
  }
  return btoa(binary);
}

interface PcmMicrophone extends MicrophoneSession {
  onPcm(listener: (chunk: string) => void): () => void;
}

class LiveMicrophone implements PcmMicrophone {
  readonly #stream: MediaStream;
  readonly #audio: AudioContext;
  readonly #source: MediaStreamAudioSourceNode;
  readonly #analyser: AnalyserNode;
  readonly #processor: ScriptProcessorNode;
  readonly #silent: GainNode;
  readonly #pcmListeners = new Set<(chunk: string) => void>();
  #raf = 0;
  #stopped = false;

  constructor(stream: MediaStream, onSignal: (frame: SignalFrame) => void) {
    this.#stream = stream;
    this.#audio = createAudioContext();
    this.#source = this.#audio.createMediaStreamSource(stream);
    this.#analyser = this.#audio.createAnalyser();
    this.#analyser.fftSize = 1024;
    this.#analyser.smoothingTimeConstant = 0.68;
    // ScriptProcessor is the no-dependency PCM bridge supported by the target browsers.
    this.#processor = this.#audio.createScriptProcessor(4096, 1, 1);
    this.#silent = this.#audio.createGain();
    this.#silent.gain.value = 0;
    this.#source.connect(this.#analyser);
    this.#source.connect(this.#processor);
    this.#processor.connect(this.#silent);
    this.#silent.connect(this.#audio.destination);
    this.#processor.onaudioprocess = (event) => {
      if (this.#stopped) return;
      const chunk = base64(pcm16(event.inputBuffer.getChannelData(0), this.#audio.sampleRate));
      for (const listener of this.#pcmListeners) listener(chunk);
    };
    const samples = new Float32Array(new ArrayBuffer(this.#analyser.fftSize * 4));
    const measure = () => {
      if (this.#stopped || !this.live) return;
      onSignal(frameFrom(this.#analyser, samples));
      this.#raf = requestAnimationFrame(measure);
    };
    this.#raf = requestAnimationFrame(measure);
    void this.#audio.resume();
  }

  get live(): boolean {
    return !this.#stopped && this.#stream.getAudioTracks().some((track) => track.readyState === 'live');
  }

  onPcm(listener: (chunk: string) => void): () => void {
    this.#pcmListeners.add(listener);
    return () => this.#pcmListeners.delete(listener);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    cancelAnimationFrame(this.#raf);
    this.#processor.onaudioprocess = null;
    this.#source.disconnect();
    this.#analyser.disconnect();
    this.#processor.disconnect();
    this.#silent.disconnect();
    for (const track of this.#stream.getTracks()) track.stop();
    this.#pcmListeners.clear();
    void this.#audio.close();
  }
}

function providerFailureForStatus(status: number): RuntimeFailure {
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'provider_unavailable';
  return 'error';
}

function queryFailureForStatus(status: number): RuntimeFailure {
  return status === 429 ? 'rate_limited' : 'error';
}

interface RequestAcquisition {
  readonly signal: AbortSignal;
  dispose(): void;
}

/** Consume JSON through a bounded reader so headers without a body cannot strand voice. */
async function readJsonBody(response: Response, signal: AbortSignal): Promise<unknown> {
  if (response.body === null || typeof response.body?.getReader !== 'function') {
    return response.json() as Promise<unknown>;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let abortReject!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { abortReject = reject; });
  const onAbort = () => {
    abortReject(new Error('voice response body read cancelled'));
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > MAX_JSON_RESPONSE_BYTES) throw new Error('voice response body too large');
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

/** Bound response headers and body acquisition, but never real audio playback. */
function acquireRequest(signal: AbortSignal): RequestAcquisition {
  const control = new AbortController();
  const relayAbort = () => control.abort();
  if (signal.aborted) control.abort();
  else signal.addEventListener('abort', relayAbort, { once: true });
  const timeout = globalThis.setTimeout(() => control.abort(), REQUEST_ACQUISITION_TIMEOUT_MS);
  return {
    signal: control.signal,
    dispose: () => {
      globalThis.clearTimeout(timeout);
      signal.removeEventListener('abort', relayAbort);
    },
  };
}

async function jsonRequest<T>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  failureForStatus: (status: number) => RuntimeFailure,
): Promise<T> {
  const acquisition = acquireRequest(signal);
  try {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST', credentials: 'same-origin', signal: acquisition.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify(body),
      });
    } catch {
      throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'error');
    }
    if (!response.ok) throw new VoiceRuntimeError(failureForStatus(response.status));
    try {
      return await readJsonBody(response, acquisition.signal) as T;
    } catch {
      throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'error');
    }
  } finally {
    acquisition.dispose();
  }
}

class ScribeSession implements TranscriptSession {
  readonly #socket: WebSocket;
  readonly #removePcm: () => void;
  readonly #removeAbort: () => void;
  readonly #markClosedLocally: () => void;
  #closed = false;

  constructor(
    socket: WebSocket,
    microphone: PcmMicrophone,
    signal: AbortSignal,
    markClosedLocally: () => void,
  ) {
    this.#socket = socket;
    this.#markClosedLocally = markClosedLocally;
    this.#removePcm = microphone.onPcm((chunk) => {
      if (!this.#closed && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: chunk }));
      }
    });
    const abort = () => this.close();
    signal.addEventListener('abort', abort, { once: true });
    this.#removeAbort = () => signal.removeEventListener('abort', abort);
  }

  commit(): void {
    if (!this.#closed && this.#socket.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify({
        message_type: 'input_audio_chunk', audio_base_64: '', commit: true,
      }));
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#removePcm();
    this.#removeAbort();
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CONNECTING) {
      this.#markClosedLocally();
      this.#socket.close(1000, 'client complete');
    }
  }
}

async function acquireAudio(
  response: Response,
  readSignal: AbortSignal,
  callerSignal: AbortSignal,
): Promise<Blob> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (contentType !== 'audio/mpeg') {
    throw new VoiceRuntimeError('provider_unavailable');
  }
  if (response.body === null) throw new VoiceRuntimeError('provider_unavailable');
  const reader = response.body.getReader();
  const cancelReader = () => { void reader.cancel().catch(() => undefined); };
  readSignal.addEventListener('abort', cancelReader, { once: true });
  if (readSignal.aborted) cancelReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (readSignal.aborted) {
        throw new VoiceRuntimeError(callerSignal.aborted ? 'interrupted' : 'provider_unavailable');
      }
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new VoiceRuntimeError('provider_unavailable');
      }
      chunks.push(new Uint8Array(next.value));
    }
  } catch (error) {
    if (error instanceof VoiceRuntimeError) throw error;
    throw new VoiceRuntimeError(callerSignal.aborted ? 'interrupted' : 'provider_unavailable');
  } finally {
    readSignal.removeEventListener('abort', cancelReader);
  }
  const blob = new Blob(chunks, { type: contentType });
  if (blob.size === 0) throw new VoiceRuntimeError('provider_unavailable');
  const prefix = new Uint8Array(Math.min(3, bytes));
  let prefixAt = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, prefix.length - prefixAt);
    prefix.set(chunk.subarray(0, take), prefixAt);
    prefixAt += take;
    if (prefixAt === prefix.length) break;
  }
  if (!hasMp3Prefix(prefix)) {
    throw new VoiceRuntimeError('provider_unavailable');
  }
  return blob;
}

export class BrowserVoiceRuntime implements VoiceRuntime {
  readonly #base: string;
  readonly #playback = new PlaybackSession();

  constructor(base: string) {
    this.#base = base;
  }

  preparePlayback(): void {
    this.#playback.prepare();
  }

  dispose(): void {
    this.#playback.dispose();
  }

  async openMicrophone(signal: AbortSignal, onSignal: (frame: SignalFrame) => void): Promise<MicrophoneSession> {
    if (signal.aborted) throw new VoiceRuntimeError('interrupted');
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function') {
      throw new VoiceRuntimeError('error');
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (hasErrorName(error, ['NotAllowedError', 'SecurityError'])) {
        throw new VoiceRuntimeError('permission_denied');
      }
      throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'error');
    }
    if (signal.aborted) {
      for (const track of stream.getTracks()) track.stop();
      throw new VoiceRuntimeError('interrupted');
    }
    const microphone = new LiveMicrophone(stream, onSignal);
    signal.addEventListener('abort', () => microphone.stop(), { once: true });
    return microphone;
  }

  async singleUseToken(signal: AbortSignal): Promise<string> {
    const result = await jsonRequest<unknown>(
      `${this.#base}/voice/token`, {}, signal, providerFailureForStatus,
    );
    if (typeof result !== 'object' || result === null || Array.isArray(result)) {
      throw new VoiceRuntimeError('provider_unavailable');
    }
    const token = (result as Readonly<Record<string, unknown>>)['token'];
    if (typeof token !== 'string' || token.length < 8 || token.length > 2_048
      || !/^[A-Za-z0-9._~-]+$/u.test(token)) {
      throw new VoiceRuntimeError('provider_unavailable');
    }
    return token;
  }

  openTranscript(
    token: string,
    microphone: MicrophoneSession,
    handlers: TranscriptHandlers,
    signal: AbortSignal,
  ): Promise<TranscriptSession> {
    const pcm = microphone as PcmMicrophone;
    const url = new URL(SCRIBE_URL);
    url.searchParams.set('model_id', SCRIBE_MODEL);
    url.searchParams.set('token', token);
    url.searchParams.set('audio_format', 'pcm_16000');
    url.searchParams.set('commit_strategy', 'vad');
    url.searchParams.set('vad_silence_threshold_secs', '1.0');
    const socket = new WebSocket(url);

    return new Promise<TranscriptSession>((resolve, reject) => {
      let session: ScribeSession | null = null;
      let settled = false;
      let closedLocally = false;
      let timeout = 0;
      const closeHandshakeSocket = () => {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
          closedLocally = true;
          socket.close(1000, 'client cancelled');
        }
      };
      const rejectHandshake = (failure: RuntimeFailure) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        closeHandshakeSocket();
        reject(new VoiceRuntimeError(failure));
      };
      const abort = () => {
        if (session !== null) session.close();
        else rejectHandshake('interrupted');
      };
      timeout = window.setTimeout(() => rejectHandshake('provider_unavailable'), 10_000);
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          if (!settled) rejectHandshake('provider_unavailable');
          else handlers.failure('provider_unavailable');
          return;
        }
        const message = readScribeEvent(parsed);
        if (message === null) return;
        if (message.kind === 'started') {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          session = new ScribeSession(socket, pcm, signal, () => { closedLocally = true; });
          signal.removeEventListener('abort', abort);
          resolve(session);
        } else if (message.kind === 'partial') handlers.partial(message.text);
        else if (message.kind === 'committed') handlers.committed(message.text);
        else handlers.failure(message.failure);
      });
      socket.addEventListener('error', () => {
        if (!settled) rejectHandshake('provider_unavailable');
        else handlers.failure('provider_unavailable');
      });
      socket.addEventListener('close', () => {
        window.clearTimeout(timeout);
        if (!settled) rejectHandshake(signal.aborted ? 'interrupted' : 'provider_unavailable');
        else if (session !== null && !closedLocally && !signal.aborted) {
          handlers.failure('provider_unavailable');
        }
      });
    });
  }

  query(committedTranscript: string, signal: AbortSignal): Promise<PlannedVoiceAnswer> {
    return jsonRequest<PlannedVoiceAnswer>(
      `${this.#base}/query`, { question: committedTranscript }, signal, queryFailureForStatus,
    );
  }

  async speak(spokenAnswer: string, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
    const acquisition = acquireRequest(signal);
    let audio: Blob;
    try {
      let response: Response;
      try {
        response = await fetch(`${this.#base}/voice/speech`, {
          method: 'POST', credentials: 'same-origin', signal: acquisition.signal,
          headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', ...csrfHeaders() },
          body: JSON.stringify({ text: spokenAnswer }),
        });
      } catch {
        throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'provider_unavailable');
      }
      if (!response.ok) throw new VoiceRuntimeError(providerFailureForStatus(response.status));
      audio = await acquireAudio(response, acquisition.signal, signal);
    } finally {
      acquisition.dispose();
    }
    await this.#playback.play(audio, handlers, signal);
  }
}
