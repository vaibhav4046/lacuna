import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readScribeEvent } from '../../web/src/voice/scribe-events.js';
import { hasMp3Prefix } from '../../web/src/voice/audio.js';

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
  it('contains no timer or random source in the orb component', () => {
    const source = readFileSync(join(process.cwd(), 'web/src/canvas/VoiceOrb.tsx'), 'utf8');
    expect(source).not.toContain('Math.random');
    expect(source).not.toContain('setInterval');
    expect(source).not.toContain('requestAnimationFrame');
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
