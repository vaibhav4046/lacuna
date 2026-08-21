/// <reference lib="dom" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readScribeEvent } from '../../web/src/voice/scribe-events.js';
import { hasMp3Prefix } from '../../web/src/voice/audio.js';
import { voiceOrbFrame } from '../../web/src/voice/orb.js';
import { BrowserVoiceRuntime } from '../../web/src/voice/browser.js';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Scribe realtime event guard', () => {
  it('accepts official session, partial and committed event shapes', () => {
    expect(readScribeEvent({ message_type: 'session_started', session_id: 'sess_1' }))
      .toEqual({ kind: 'started' });
    expect(readScribeEvent({ message_type: 'partial_transcript', text: 'hello wor' }))
      .toEqual({ kind: 'partial', text: 'hello wor' });
    expect(readScribeEvent({ message_type: 'committed_transcript', text: 'hello world' }))
      .toEqual({ kind: 'committed', text: 'hello world' });
  });

  it('does not treat final or timestamp events as committed query input', () => {
    expect(readScribeEvent({ message_type: 'final_transcript', text: 'not committed' })).toBeNull();
    expect(readScribeEvent({
      message_type: 'committed_transcript_with_timestamps', text: 'already handled', words: [],
    })).toBeNull();
  });

  it('maps rate and auth errors without exposing provider messages', () => {
    expect(readScribeEvent({ message_type: 'rate_limited', error: 'account quota detail' }))
      .toEqual({ kind: 'failure', failure: 'rate_limited' });
    expect(readScribeEvent({ message_type: 'auth_error', error: 'expired bearer detail' }))
      .toEqual({ kind: 'failure', failure: 'provider_unavailable' });
    expect(readScribeEvent('{"message_type":"partial_transcript"}')).toBeNull();
  });
});

describe('honest analyser rendering guard', () => {
  it('moves only for a matching live analyser state and obeys reduced motion', () => {
    expect(voiceOrbFrame('READY', 'microphone', 0.5, false))
      .toEqual({ active: false, measured: 0 });
    expect(voiceOrbFrame('LISTENING', 'microphone', 0.05, false))
      .toEqual({ active: true, measured: 0.6000000000000001 });
    expect(voiceOrbFrame('SPEAKING', 'playback', 4, false))
      .toEqual({ active: true, measured: 1 });
    expect(voiceOrbFrame('SPEAKING', 'playback', 0.5, true))
      .toEqual({ active: false, measured: 0 });
  });

  it('contains no timer or random source in the orb component', () => {
    const source = readFileSync(join(process.cwd(), 'web/src/canvas/VoiceOrb.tsx'), 'utf8');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('requestAnimationFrame');
    expect(source).not.toContain('#8052FF');
    expect(source).toContain('#FFB829');
    expect(source).toContain("prefers-reduced-motion: reduce");
    expect(source).toContain("signal === 'microphone'");
    expect(source).toContain("signal === 'playback'");
  });
});

describe('playback audio guard', () => {
  it('accepts MP3 ID3 or frame prefixes and rejects mislabeled JSON bytes', () => {
    expect(hasMp3Prefix(new Uint8Array([0x49, 0x44, 0x33, 4]))).toBe(true);
    expect(hasMp3Prefix(new Uint8Array([0xff, 0xfb, 0x90]))).toBe(true);
    expect(hasMp3Prefix(new TextEncoder().encode('{"error":"not audio"}'))).toBe(false);
  });

  it('reports a local audio element failure as a local error after a valid speech response', async () => {
    class FailingAudio {
      static readonly instances: FailingAudio[] = [];
      paused = true;
      ended = false;
      readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

      constructor(_url: string) {
        FailingAudio.instances.push(this);
      }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        listeners.add(listener);
        this.#listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.#listeners.get(type)?.delete(listener);
      }

      play(): Promise<void> {
        this.paused = false;
        queueMicrotask(() => {
          for (const listener of this.#listeners.get('error') ?? []) {
            if (typeof listener === 'function') listener(new Event('error'));
            else listener.handleEvent(new Event('error'));
          }
        });
        return Promise.resolve();
      }

      pause(): void { this.paused = true; }
      removeAttribute(_name: string): void {}
      load(): void {}
    }

    class PlaybackAudioContext {
      readonly destination = {} as AudioDestinationNode;

      createMediaElementSource(_audio: HTMLMediaElement): MediaElementAudioSourceNode {
        return { connect: () => undefined, disconnect: () => undefined } as unknown as MediaElementAudioSourceNode;
      }

      createAnalyser(): AnalyserNode {
        return {
          fftSize: 0,
          connect: () => undefined,
          disconnect: () => undefined,
          getFloatTimeDomainData: () => undefined,
        } as unknown as AnalyserNode;
      }

      resume(): Promise<void> { return Promise.resolve(); }
      close(): Promise<void> { return Promise.resolve(); }
    }

    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x49, 0x44, 0x33, 4]),
      { headers: { 'content-type': 'audio/mpeg' } },
    )));
    vi.stubGlobal('Audio', FailingAudio);
    vi.stubGlobal('AudioContext', PlaybackAudioContext);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:voice-test',
      revokeObjectURL: () => undefined,
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const runtime = new BrowserVoiceRuntime('/api/workspace');
    await expect(runtime.speak('A supported answer.', {
      started: () => undefined,
      signal: () => undefined,
    }, new AbortController().signal)).rejects.toMatchObject({ failure: 'error' });
    expect(FailingAudio.instances).toHaveLength(1);
  });

  it('cancels during audio-context startup without beginning playback', async () => {
    let releaseResume!: () => void;
    const resumeGate = new Promise<void>((resolve) => { releaseResume = resolve; });

    class DeferredAudio {
      static readonly instances: DeferredAudio[] = [];
      paused = true;
      ended = false;
      playCalls = 0;
      readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

      constructor(_url: string) { DeferredAudio.instances.push(this); }

      addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
        listeners.add(listener);
        this.#listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        this.#listeners.get(type)?.delete(listener);
      }

      play(): Promise<void> {
        this.playCalls += 1;
        this.paused = false;
        queueMicrotask(() => {
          this.ended = true;
          for (const listener of this.#listeners.get('ended') ?? []) {
            if (typeof listener === 'function') listener(new Event('ended'));
            else listener.handleEvent(new Event('ended'));
          }
        });
        return Promise.resolve();
      }

      pause(): void { this.paused = true; }
      removeAttribute(_name: string): void {}
      load(): void {}
    }

    class DeferredAudioContext {
      static readonly instances: DeferredAudioContext[] = [];
      readonly destination = {} as AudioDestinationNode;

      constructor() { DeferredAudioContext.instances.push(this); }

      createMediaElementSource(_audio: HTMLMediaElement): MediaElementAudioSourceNode {
        return { connect: () => undefined, disconnect: () => undefined } as unknown as MediaElementAudioSourceNode;
      }

      createAnalyser(): AnalyserNode {
        return {
          fftSize: 0,
          connect: () => undefined,
          disconnect: () => undefined,
          getFloatTimeDomainData: () => undefined,
        } as unknown as AnalyserNode;
      }

      resume(): Promise<void> { return resumeGate; }
      close(): Promise<void> { return Promise.resolve(); }
    }

    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      new Uint8Array([0x49, 0x44, 0x33, 4]),
      { headers: { 'content-type': 'audio/mpeg' } },
    )));
    vi.stubGlobal('Audio', DeferredAudio);
    vi.stubGlobal('AudioContext', DeferredAudioContext);
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:voice-cancel-test',
      revokeObjectURL: () => undefined,
    });
    vi.stubGlobal('cancelAnimationFrame', () => undefined);

    const caller = new AbortController();
    const runtime = new BrowserVoiceRuntime('/api/workspace');
    const pending = runtime.speak('A supported answer.', {
      started: () => undefined,
      signal: () => undefined,
    }, caller.signal);

    await vi.waitFor(() => expect(DeferredAudioContext.instances).toHaveLength(1));
    caller.abort();
    releaseResume();

    await expect(pending).rejects.toMatchObject({ failure: 'interrupted' });
    expect(DeferredAudio.instances[0]?.playCalls).toBe(0);
  });

  it('bounds a stalled JSON request instead of leaving the voice controller busy indefinitely', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('request aborted', 'AbortError'));
      }, { once: true });
    })));

    const runtime = new BrowserVoiceRuntime('/api/workspace');
    let failure: unknown = null;
    const pending = runtime.query('Where does session state live?', new AbortController().signal)
      .catch((error: unknown) => { failure = error; });

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(failure).toMatchObject({ failure: 'error' });
    await pending;
  });

  it('preserves caller cancellation through the bounded request signal', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('request aborted', 'AbortError'));
      }, { once: true });
    })));

    const caller = new AbortController();
    const runtime = new BrowserVoiceRuntime('/api/workspace');
    const pending = runtime.query('Where does session state live?', caller.signal);
    caller.abort();

    await expect(pending).rejects.toMatchObject({ failure: 'interrupted' });
  });

  it('keeps query and speech 503 failures in their truthful boundaries', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 503 })));

    const runtime = new BrowserVoiceRuntime('/api/workspace');
    await expect(runtime.query('Where does session state live?', new AbortController().signal))
      .rejects.toMatchObject({ failure: 'error' });
    await expect(runtime.speak('A supported answer.', {
      started: () => undefined,
      signal: () => undefined,
    }, new AbortController().signal)).rejects.toMatchObject({ failure: 'provider_unavailable' });
  });

  it('does not label application auth or origin denials as speech-provider failures', async () => {
    vi.stubGlobal('document', { cookie: '' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 403 })));

    const runtime = new BrowserVoiceRuntime('/api/workspace');
    for (const spokenAnswer of ['A supported answer.', 'Another supported answer.']) {
      await expect(runtime.speak(spokenAnswer, {
        started: () => undefined,
        signal: () => undefined,
      }, new AbortController().signal)).rejects.toMatchObject({ failure: 'error' });
    }
  });

  it('bounds stalled speech-body acquisition before playback without timing the audio element', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('document', { cookie: '' });
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    });
    vi.stubGlobal('fetch', vi.fn((_path: string, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => {
        streamController?.error(new DOMException('request aborted', 'AbortError'));
      }, { once: true });
      return Promise.resolve(new Response(body, { headers: { 'content-type': 'audio/mpeg' } }));
    }));

    const runtime = new BrowserVoiceRuntime('/api/workspace');
    let failure: unknown = null;
    const pending = runtime.speak('A supported answer.', {
      started: () => undefined,
      signal: () => undefined,
    }, new AbortController().signal).catch((error: unknown) => { failure = error; });

    await vi.advanceTimersByTimeAsync(15_000);
    await Promise.resolve();

    expect(failure).toMatchObject({ failure: 'provider_unavailable' });
    await pending;
  });
});

describe('realtime socket lifecycle', () => {
  it('closes a connecting Scribe socket when capture is interrupted', async () => {
    class PendingSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly instances: PendingSocket[] = [];
      readonly readyState = PendingSocket.CONNECTING;
      readonly closeCalls: Array<{ code?: number; reason?: string }> = [];

      constructor(_url: string | URL) {
        PendingSocket.instances.push(this);
      }

      addEventListener(_type: string, _listener: (event: never) => void): void {}

      close(code?: number, reason?: string): void {
        const call: { code?: number; reason?: string } = {};
        if (code !== undefined) call.code = code;
        if (reason !== undefined) call.reason = reason;
        this.closeCalls.push(call);
      }
    }

    vi.stubGlobal('WebSocket', PendingSocket);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const controller = new AbortController();
    const microphone = {
      live: true,
      stop: () => undefined,
      onPcm: (_listener: (chunk: string) => void) => () => undefined,
    };
    const runtime = new BrowserVoiceRuntime('/api/explore');
    const pending = runtime.openTranscript('sutkn_test_token', microphone, {
      partial: () => undefined,
      committed: () => undefined,
      failure: () => undefined,
    }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ failure: 'interrupted' });
    expect(PendingSocket.instances).toHaveLength(1);
    expect(PendingSocket.instances[0]?.closeCalls).toEqual([
      { code: 1000, reason: 'client cancelled' },
    ]);
  });

  it('reports a provider-initiated normal close after the session started', async () => {
    type SocketListener = (event: { readonly data?: string; readonly code?: number }) => void;

    class ClosingSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      static readonly instances: ClosingSocket[] = [];
      readyState = ClosingSocket.OPEN;
      readonly #listeners = new Map<string, Set<SocketListener>>();

      constructor(_url: string | URL) { ClosingSocket.instances.push(this); }

      addEventListener(type: string, listener: SocketListener): void {
        const listeners = this.#listeners.get(type) ?? new Set<SocketListener>();
        listeners.add(listener);
        this.#listeners.set(type, listeners);
      }

      send(_body: string): void {}

      close(_code?: number, _reason?: string): void { this.readyState = ClosingSocket.CLOSED; }

      emit(type: string, event: { readonly data?: string; readonly code?: number }): void {
        if (type === 'close') this.readyState = ClosingSocket.CLOSED;
        for (const listener of this.#listeners.get(type) ?? []) listener(event);
      }
    }

    vi.stubGlobal('WebSocket', ClosingSocket);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const failures: string[] = [];
    const microphone = {
      live: true,
      stop: () => undefined,
      onPcm: (_listener: (chunk: string) => void) => () => undefined,
    };
    const runtime = new BrowserVoiceRuntime('/api/explore');
    const pending = runtime.openTranscript('sutkn_test_token', microphone, {
      partial: () => undefined,
      committed: () => undefined,
      failure: (failure) => failures.push(failure),
    }, new AbortController().signal);
    const socket = ClosingSocket.instances[0];
    expect(socket).toBeDefined();
    socket?.emit('message', { data: JSON.stringify({ message_type: 'session_started', session_id: 'sess_1' }) });
    await pending;

    socket?.emit('close', { code: 1000 });

    expect(failures).toEqual(['provider_unavailable']);
  });
});
