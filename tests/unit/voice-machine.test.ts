import { describe, expect, it } from 'vitest';

import {
  acceptedFrom, advance, readState, RUNNING_STATE, stageOf, STAGE_FACTS,
  STATE_FACTS, VOICE_EVENTS, VOICE_STATES, type VoiceEvent, type VoiceState,
} from '../../src/voice/states.js';
import {
  advanceVoice, WEB_VOICE_EVENTS, WEB_VOICE_STATES,
} from '../../web/src/voice/states.js';

function reachableFrom(start: VoiceState): ReadonlySet<VoiceState> {
  const seen = new Set<VoiceState>([start]);
  const queue: VoiceState[] = [start];
  while (queue.length > 0) {
    const state = queue.shift()!;
    for (const event of VOICE_EVENTS) {
      const next = advance(state, event);
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

describe('voice states', () => {
  it('is exactly the required fifteen-state product lifecycle', () => {
    expect(VOICE_STATES).toEqual([
      'READY', 'REQUESTING_PERMISSION', 'LISTENING', 'PARTIAL_TRANSCRIPT',
      'COMMITTED', 'CHECKING_CONTEXT', 'ANSWERED', 'ABSTAINED', 'CONTRADICTED',
      'SPEAKING', 'INTERRUPTED', 'RATE_LIMITED', 'PERMISSION_DENIED',
      'PROVIDER_UNAVAILABLE', 'ERROR',
    ]);
    expect(new Set(VOICE_STATES).size).toBe(15);
  });

  it('defaults to static READY', () => {
    expect(RUNNING_STATE).toBe('READY');
    expect(STATE_FACTS[RUNNING_STATE].signal).toBeNull();
  });

  it('permits audio signal only in microphone and playback states', () => {
    const signalled = VOICE_STATES.filter((state) => STATE_FACTS[state].signal !== null);
    expect(signalled).toEqual(['LISTENING', 'PARTIAL_TRANSCRIPT', 'SPEAKING']);
    expect(STATE_FACTS.LISTENING.signal).toBe('microphone');
    expect(STATE_FACTS.PARTIAL_TRANSCRIPT.signal).toBe('microphone');
    expect(STATE_FACTS.SPEAKING.signal).toBe('playback');
  });

  it('keeps the browser lifecycle copy identical without importing the server source tree', () => {
    expect(WEB_VOICE_STATES).toEqual(VOICE_STATES);
    expect(WEB_VOICE_EVENTS).toEqual(VOICE_EVENTS);
    for (const state of VOICE_STATES) {
      for (const event of VOICE_EVENTS) expect(advanceVoice(state, event)).toBe(advance(state, event));
    }
    expect(advanceVoice('SPEAKING', 'fail')).toBe('ERROR');
  });

  it('has facts and a stage decision for every state', () => {
    for (const state of VOICE_STATES) {
      expect(STATE_FACTS[state].detail.length).toBeGreaterThan(0);
      expect(stageOf(state) === null || STAGE_FACTS.some((stage) => stage.stage === stageOf(state))).toBe(true);
    }
  });
});

describe('voice transitions', () => {
  it('walks answer, abstention and contradiction through one committed query path', () => {
    const prefix: readonly VoiceEvent[] = [
      'request_permission', 'permission_granted', 'partial', 'commit', 'check_context',
    ];
    const atContext = prefix.reduce<VoiceState>((state, event) => advance(state, event), 'READY');
    expect(atContext).toBe('CHECKING_CONTEXT');
    expect(advance(atContext, 'answer')).toBe('ANSWERED');
    expect(advance(atContext, 'abstain')).toBe('ABSTAINED');
    expect(advance(atContext, 'contradict')).toBe('CONTRADICTED');
  });

  it('enters SPEAKING only on playback_started and exits on real playback completion', () => {
    expect(advance('ANSWERED', 'playback_started')).toBe('SPEAKING');
    expect(advance('ANSWERED', 'check_context')).toBe('ANSWERED');
    expect(advance('SPEAKING', 'playback_finished')).toBe('READY');
  });

  it('maps permission, rate, provider, interruption and local failures', () => {
    expect(advance('REQUESTING_PERMISSION', 'deny')).toBe('PERMISSION_DENIED');
    expect(advance('LISTENING', 'throttle')).toBe('RATE_LIMITED');
    expect(advance('PARTIAL_TRANSCRIPT', 'provider_fail')).toBe('PROVIDER_UNAVAILABLE');
    expect(advance('CHECKING_CONTEXT', 'interrupt')).toBe('INTERRUPTED');
    expect(advance('CHECKING_CONTEXT', 'fail')).toBe('ERROR');
  });

  it('supports typed fallback without permission or listening states', () => {
    expect(advance('READY', 'typed_commit')).toBe('COMMITTED');
    expect(advance('COMMITTED', 'check_context')).toBe('CHECKING_CONTEXT');
  });

  it('reaches every state and every terminal state can retry', () => {
    expect([...reachableFrom('READY')].sort()).toEqual([...VOICE_STATES].sort());
    for (const state of ['INTERRUPTED', 'RATE_LIMITED', 'PERMISSION_DENIED', 'PROVIDER_UNAVAILABLE', 'ERROR'] as const) {
      expect(advance(state, 'retry')).toBe('READY');
    }
  });

  it('ignores stale or invalid events and lists every moving edge', () => {
    expect(advance('READY', 'playback_started')).toBe('READY');
    for (const state of VOICE_STATES) {
      const moving = VOICE_EVENTS.filter((event) => advance(state, event) !== state);
      expect(acceptedFrom(state)).toEqual(moving);
    }
  });
});

describe('voice state input and pipeline', () => {
  it('accepts only exact state values', () => {
    for (const state of VOICE_STATES) expect(readState(state)).toBe(state);
    for (const value of ['', 'ready', ' READY', '__proto__', '<script>']) expect(readState(value)).toBeNull();
    expect(readState(null)).toBeNull();
  });

  it('marks all four implemented boundaries verified', () => {
    expect(STAGE_FACTS.map((stage) => [stage.stage, stage.capability])).toEqual([
      ['STT', 'VERIFIED'], ['HydraDB', 'VERIFIED'], ['Resolver', 'VERIFIED'], ['TTS', 'VERIFIED'],
    ]);
  });
});
