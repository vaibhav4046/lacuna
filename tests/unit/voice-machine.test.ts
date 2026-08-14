import { describe, expect, it } from 'vitest';

import {
  acceptedFrom,
  advance,
  readState,
  RUNNING_STATE,
  stageOf,
  STAGE_FACTS,
  STATE_FACTS,
  VOICE_EVENTS,
  VOICE_STATES,
  type VoiceEvent,
  type VoiceState,
} from '../../src/voice/states.js';

/**
 * The voice machine, which is the whole voice implementation.
 *
 * There is no audio here and no microphone anywhere in this environment, so
 * what can be tested is exactly what was written down: which situations exist,
 * which events move between them, and that every one of them can be reached
 * from a cold start. A machine nobody can walk into is a diagram, and a
 * diagram is the thing this file exists to stop the voice page from being.
 */

/** Every state reachable from a starting point, by breadth first search. */
function reachableFrom(start: VoiceState): ReadonlySet<VoiceState> {
  const seen = new Set<VoiceState>([start]);
  const queue: VoiceState[] = [start];

  while (queue.length > 0) {
    const here = queue.shift()!;
    for (const event of VOICE_EVENTS) {
      const next = advance(here, event);
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return seen;
}

describe('the state set', () => {
  it('names fourteen situations and names each of them once', () => {
    expect(VOICE_STATES).toHaveLength(14);
    expect(new Set(VOICE_STATES).size).toBe(VOICE_STATES.length);
  });

  it('says what is true in every one of them', () => {
    // A state with no facts would render as a blank page rather than fail, so
    // the check is here rather than left to the renderer to survive.
    for (const state of VOICE_STATES) {
      const facts = STATE_FACTS[state];
      expect(facts.label.length).toBeGreaterThan(0);
      expect(facts.status.length).toBeGreaterThan(0);
      expect(facts.detail.length).toBeGreaterThan(0);
    }
  });

  it('gives every state a distinct label, because the labels are the links', () => {
    const labels = VOICE_STATES.map((state) => STATE_FACTS[state].label);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it('runs in a state that needs neither of the missing stages', () => {
    // The build claims to be in one state. That claim is only honest if the
    // state it names does not sit at a stage this machine cannot perform.
    expect(VOICE_STATES).toContain(RUNNING_STATE);
    expect(stageOf(RUNNING_STATE)).toBeNull();
  });
});

describe('advance', () => {
  it('stays put on an event the state does not accept', () => {
    // Not an error and not a crash. A voice surface is handed events it did not
    // ask for constantly, and doing nothing is the correct answer to most.
    expect(advance('ready', 'finish')).toBe('ready');
    expect(advance('offline', 'commit')).toBe('offline');
    expect(advance('rate_limited', 'hold')).toBe('rate_limited');
  });

  it('never leaves the state set, whatever it is given', () => {
    for (const state of VOICE_STATES) {
      for (const event of VOICE_EVENTS) {
        expect(VOICE_STATES).toContain(advance(state, event));
      }
    }
  });

  it('is the same answer every time it is asked', () => {
    for (const state of VOICE_STATES) {
      for (const event of VOICE_EVENTS) {
        expect(advance(state, event)).toBe(advance(state, event));
      }
    }
  });

  it('walks the whole happy path', () => {
    const path: readonly VoiceEvent[] = [
      'hold',
      'transcribing',
      'commit',
      'send',
      'retrieved',
      'grounded',
      'synthesised',
      'finish',
    ];
    const landed = path.reduce<VoiceState>((state, event) => advance(state, event), 'ready');

    expect(landed).toBe('ready');
  });
});

describe('the edges that exist everywhere', () => {
  it('lets the network go at any moment', () => {
    for (const state of VOICE_STATES) {
      expect(advance(state, 'disconnect')).toBe('offline');
    }
  });

  it('lets anyone give up on speech at any moment', () => {
    // This is the escape hatch the whole product depends on: the question form
    // works whatever the microphone is doing, so every state has a door to it.
    for (const state of VOICE_STATES) {
      expect(advance(state, 'useText')).toBe('text_only');
    }
  });
});

describe('reachability', () => {
  it('can reach every state from a cold start', () => {
    const reached = reachableFrom('ready');

    expect([...reached].sort()).toEqual([...VOICE_STATES].sort());
  });

  it('can get back to ready from every state', () => {
    // A dead end would be a state a reader could enter and never leave, which
    // on a page made of links is a page with a hole in it.
    for (const state of VOICE_STATES) {
      expect(reachableFrom(state).has('ready')).toBe(true);
    }
  });
});

describe('acceptedFrom', () => {
  it('lists only events that move the machine somewhere else', () => {
    for (const state of VOICE_STATES) {
      for (const event of acceptedFrom(state)) {
        expect(advance(state, event)).not.toBe(state);
      }
    }
  });

  it('lists every event that moves the machine somewhere else', () => {
    for (const state of VOICE_STATES) {
      const moving = VOICE_EVENTS.filter((event) => advance(state, event) !== state);

      expect([...acceptedFrom(state)]).toEqual([...moving]);
    }
  });

  it('drops the self edge in a state that already is where the event leads', () => {
    // Offline accepts disconnect and text_only accepts useText, since those two
    // edges are on every state. Printing them as ways out would be a lie about
    // where they go.
    expect(acceptedFrom('offline')).not.toContain('disconnect');
    expect(acceptedFrom('text_only')).not.toContain('useText');
  });

  it('leaves no state without a way out', () => {
    for (const state of VOICE_STATES) {
      expect(acceptedFrom(state).length).toBeGreaterThan(0);
    }
  });
});

describe('readState', () => {
  it('accepts exactly the states that exist', () => {
    for (const state of VOICE_STATES) {
      expect(readState(state)).toBe(state);
    }
  });

  it('refuses anything else, including the shapes a query string arrives in', () => {
    // This is the narrowing that keeps the query string away from the renderer.
    // Whatever arrives is one of fourteen keys or it is nothing at all.
    for (const junk of ['', ' ready', 'READY', 'ready ', '__proto__', 'constructor',
      'toString', '0', 'listening;drop', '<script>']) {
      expect(readState(junk)).toBeNull();
    }

    expect(readState(null)).toBeNull();
    expect(readState(undefined)).toBeNull();
  });
});

describe('the pipeline', () => {
  it('marks the two stages this machine cannot perform', () => {
    const missing = STAGE_FACTS
      .filter((facts) => facts.capability !== 'VERIFIED')
      .map((facts) => facts.stage);

    expect(missing).toEqual(['STT', 'TTS']);
  });

  it('marks the two that run as verified, which the rest of the suite covers', () => {
    const running = STAGE_FACTS
      .filter((facts) => facts.capability === 'VERIFIED')
      .map((facts) => facts.stage);

    expect(running).toEqual(['HydraDB', 'Resolver']);
  });

  it('puts every state at a stage that exists, or at none', () => {
    const stages = STAGE_FACTS.map((facts) => facts.stage);

    for (const state of VOICE_STATES) {
      const at = stageOf(state);
      if (at !== null) expect(stages).toContain(at);
    }
  });

  it('sits every failure outside the two stages that work', () => {
    // A failure parked on HydraDB or the resolver would be claiming this
    // product broke, when every failure the design describes is audio or
    // network. The page says as much, so the table has to agree.
    for (const state of VOICE_STATES) {
      if (!STATE_FACTS[state].failed) continue;
      expect(stageOf(state)).not.toBe('HydraDB');
      expect(stageOf(state)).not.toBe('Resolver');
    }
  });
});
