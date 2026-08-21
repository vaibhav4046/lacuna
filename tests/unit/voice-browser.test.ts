/// <reference lib="dom" />

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readScribeEvent } from '../../web/src/voice/scribe-events.js';
import { hasMp3Prefix } from '../../web/src/voice/audio.js';
import { voiceOrbFrame } from '../../web/src/voice/orb.js';
import { BrowserVoiceRuntime } from '../../web/src/voice/browser.js';

afterEach(() => vi.unstubAllGlobals());

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
});
