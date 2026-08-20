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
import { readScribeEvent } from './scribe-events';

const SCRIBE_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
const SCRIBE_MODEL = 'scribe_v2_realtime';
const TARGET_SAMPLE_RATE = 16_000;
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;

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
    this.#audio = new AudioContext({ latencyHint: 'interactive' });
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

function failureForStatus(status: number): RuntimeFailure {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403 || status === 503) return 'provider_unavailable';
  return 'error';
}

async function jsonRequest<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify(body),
    });
  } catch {
    throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'error');
  }
  if (!response.ok) throw new VoiceRuntimeError(failureForStatus(response.status));
  try {
    return await response.json() as T;
  } catch {
    throw new VoiceRuntimeError('error');
  }
}

class ScribeSession implements TranscriptSession {
  readonly #socket: WebSocket;
  readonly #removePcm: () => void;
  readonly #removeAbort: () => void;
  #closed = false;

  constructor(socket: WebSocket, microphone: PcmMicrophone, signal: AbortSignal) {
    this.#socket = socket;
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
      this.#socket.close(1000, 'client complete');
    }
  }
}

async function playAudio(response: Response, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase();
  if (contentType !== 'audio/mpeg') {
    throw new VoiceRuntimeError('provider_unavailable');
  }
  if (response.body === null) throw new VoiceRuntimeError('provider_unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
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
    throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'provider_unavailable');
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

  const url = URL.createObjectURL(blob);
  const audioElement = new Audio(url);
  const audioContext = new AudioContext({ latencyHint: 'interactive' });
  const source = audioContext.createMediaElementSource(audioElement);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  analyser.connect(audioContext.destination);
  const samples = new Float32Array(new ArrayBuffer(analyser.fftSize * 4));
  let raf = 0;
  let started = false;

  const measure = () => {
    if (audioElement.paused || audioElement.ended) return;
    handlers.signal(frameFrom(analyser, samples));
    raf = requestAnimationFrame(measure);
  };
  const onPlaying = () => {
    if (!started) {
      started = true;
      handlers.started();
    }
    raf = requestAnimationFrame(measure);
  };
  audioElement.addEventListener('playing', onPlaying);

  try {
    await audioContext.resume();
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audioElement.removeEventListener('ended', ended);
        audioElement.removeEventListener('error', failed);
        signal.removeEventListener('abort', aborted);
      };
      const ended = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new VoiceRuntimeError('provider_unavailable')); };
      const aborted = () => {
        audioElement.pause();
        cleanup();
        reject(new VoiceRuntimeError('interrupted'));
      };
      audioElement.addEventListener('ended', ended, { once: true });
      audioElement.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', aborted, { once: true });
      void audioElement.play().catch(() => {
        cleanup();
        reject(new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'error'));
      });
    });
  } finally {
    cancelAnimationFrame(raf);
    audioElement.pause();
    audioElement.removeEventListener('playing', onPlaying);
    source.disconnect();
    analyser.disconnect();
    audioElement.removeAttribute('src');
    audioElement.load();
    URL.revokeObjectURL(url);
    void audioContext.close();
  }
}

export class BrowserVoiceRuntime implements VoiceRuntime {
  readonly #base: string;

  constructor(base: string) {
    this.#base = base;
  }

  async openMicrophone(signal: AbortSignal, onSignal: (frame: SignalFrame) => void): Promise<MicrophoneSession> {
    if (signal.aborted) throw new VoiceRuntimeError('interrupted');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
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
    const result = await jsonRequest<unknown>(`${this.#base}/voice/token`, {}, signal);
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
      const timeout = window.setTimeout(() => {
        if (settled) return;
        socket.close();
        reject(new VoiceRuntimeError('provider_unavailable'));
      }, 10_000);
      const abort = () => {
        window.clearTimeout(timeout);
        session?.close();
        if (!settled) reject(new VoiceRuntimeError('interrupted'));
      };
      signal.addEventListener('abort', abort, { once: true });
      socket.addEventListener('message', (event) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(event.data));
        } catch {
          if (!settled) reject(new VoiceRuntimeError('provider_unavailable'));
          else handlers.failure('provider_unavailable');
          return;
        }
        const message = readScribeEvent(parsed);
        if (message === null) return;
        if (message.kind === 'started') {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          session = new ScribeSession(socket, pcm, signal);
          signal.removeEventListener('abort', abort);
          resolve(session);
        } else if (message.kind === 'partial') handlers.partial(message.text);
        else if (message.kind === 'committed') handlers.committed(message.text);
        else handlers.failure(message.failure);
      });
      socket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        if (!settled) reject(new VoiceRuntimeError('provider_unavailable'));
        else handlers.failure('provider_unavailable');
      });
      socket.addEventListener('close', (event) => {
        window.clearTimeout(timeout);
        if (!settled) reject(new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'provider_unavailable'));
        else if (event.code !== 1000 && !signal.aborted) handlers.failure('provider_unavailable');
      });
    });
  }

  query(committedTranscript: string, signal: AbortSignal): Promise<PlannedVoiceAnswer> {
    return jsonRequest<PlannedVoiceAnswer>(`${this.#base}/query`, { question: committedTranscript }, signal);
  }

  async speak(spokenAnswer: string, handlers: PlaybackHandlers, signal: AbortSignal): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.#base}/voice/speech`, {
        method: 'POST', credentials: 'same-origin', signal,
        headers: { Accept: 'audio/mpeg', 'Content-Type': 'application/json', ...csrfHeaders() },
        body: JSON.stringify({ text: spokenAnswer }),
      });
    } catch {
      throw new VoiceRuntimeError(signal.aborted ? 'interrupted' : 'provider_unavailable');
    }
    if (!response.ok) throw new VoiceRuntimeError(failureForStatus(response.status));
    await playAudio(response, handlers, signal);
  }
}
