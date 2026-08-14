import { describe, expect, it } from 'vitest';

import { escape } from '../../src/view/html.js';
import { META_CONTENT_SECURITY_POLICY } from '../../src/view/layout.js';
import { voicePage } from '../../src/view/voice.js';
import { LOCAL_STACK, METERED_STACK } from '../../src/voice/stack.js';
import {
  acceptedFrom,
  advance,
  RUNNING_STATE,
  STAGE_FACTS,
  STATE_FACTS,
  stageOf,
  VOICE_STATES,
} from '../../src/voice/states.js';
import { markedPages } from '../support/markup.js';

/**
 * The voice page, which is fourteen pages.
 *
 * The machine itself is covered in voice-machine.test.ts. What is left here is
 * the part a reader sees: that every state renders, that the page says which
 * stages did not run rather than timing them anyway, and that a page built to
 * describe a microphone it does not have still carries every invariant the rest
 * of the site is checked against.
 */

/** Anything that looks like a duration. The point is that there are none. */
const A_TIMING = /[0-9][0-9.,]*\s*(ms|milliseconds|seconds|s\b)/i;

describe('voicePage', () => {
  for (const state of VOICE_STATES) {
    it(`renders the ${state} state`, () => {
      const rendered = voicePage(state);
      const facts = STATE_FACTS[state];

      expect(rendered).toContain(`Lacuna | Voice: ${facts.label}`);
      expect(rendered).toContain(facts.status);
      expect(rendered).toContain(facts.detail);
    });
  }

  it('ships no script, the same as every other page here', () => {
    for (const state of VOICE_STATES) {
      expect(voicePage(state)).not.toContain('<script');
    }
  });

  it('carries the same policy as the rest of the site', () => {
    const rendered = voicePage(RUNNING_STATE);

    // Escaped, because the policy is an attribute value and the renderer treats
    // it like any other. The quotes around none arrive as entities, which is
    // why the constant cannot be searched for raw.
    expect(rendered).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${escape(META_CONTENT_SECURITY_POLICY)}">`,
    );
    expect(rendered).toContain(escape("default-src 'none'"));
    expect(rendered).toContain(escape("script-src 'none'"));
  });
});

describe('the orb', () => {
  it('draws each state with the three variables the design gave it', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);
      const facts = STATE_FACTS[state];
      const live = facts.active ? ' live' : '';
      const dashed = facts.provisional ? ' dashed' : '';

      expect(rendered).toContain(`class="orb-fill ${facts.weight}${live}"`);
      expect(rendered).toContain(`class="orb-ring${dashed}${live}"`);
      expect(rendered).toContain(`Voice surface in the ${facts.label} state.`);
    }
  });

  it('is a picture with a name rather than a picture', () => {
    // Nothing here moves and nothing here is decorative, so it takes a label.
    // A reader with no eyes on the page should get the same fact as one who has.
    expect(voicePage(RUNNING_STATE)).toContain('role="img"');
  });
});

describe('the state list', () => {
  it('links every state from every state', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);

      for (const other of VOICE_STATES) {
        expect(rendered).toContain(`href="/voice?state=${other}"`);
      }
    }
  });

  it('marks the page you are on once, in the list and in the bar', () => {
    for (const state of VOICE_STATES) {
      const found = markedPages(voicePage(state));

      // The bar and the footer both mark /voice, and the list marks the state.
      expect(new Set(found)).toEqual(new Set(['/voice', `/voice?state=${state}`]));
      expect(found.filter((href) => href === `/voice?state=${state}`)).toHaveLength(1);
    }
  });
});

describe('the transitions table', () => {
  it('lists every event out of a state, and where it lands', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);
      const events = acceptedFrom(state);

      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        expect(rendered).toContain(`<td class="mono">${event}</td>`);
        expect(rendered).toContain(`href="/voice?state=${advance(state, event)}"`);
      }
    }
  });

  it('says what a state is doing and where it sits in the pipeline', () => {
    for (const state of VOICE_STATES) {
      expect(voicePage(state)).toContain(`<b>${stageOf(state) ?? 'none'}</b>`);
    }
  });

  it('marks a failure as an absence rather than as an answer', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);

      if (STATE_FACTS[state].failed) expect(rendered).toContain('class="verdict absent"');
      else expect(rendered).toContain('class="verdict"');
    }
  });
});

describe('the pipeline table', () => {
  const rendered = voicePage(RUNNING_STATE);

  it('prints each stage with the state it is actually in', () => {
    for (const facts of STAGE_FACTS) {
      expect(rendered).toContain(`<td class="mono">${facts.stage}</td>`);
      expect(rendered).toContain(`>${facts.capability}</span>`);
      expect(rendered).toContain(facts.does);
    }
  });

  it('leaves the timing column empty for the stages that never ran', () => {
    const missing = STAGE_FACTS.filter((facts) => facts.capability !== 'VERIFIED');

    expect(missing).toHaveLength(2);
    // Said as a count rather than as a search, because UNAVAILABLE appearing
    // once would pass a contains check while a stage quietly carried a number.
    expect(rendered.split('UNAVAILABLE').length - 1).toBe(missing.length);
  });

  it('prints no duration anywhere on the page', () => {
    // The imported design carries several. None of them was measured on this
    // machine, and a latency for a stage that is not installed is the number a
    // reader would most want to trust and least be able to.
    for (const state of VOICE_STATES) {
      expect(voicePage(state)).not.toMatch(A_TIMING);
    }
  });
});

describe('the stack tables', () => {
  const rendered = voicePage(RUNNING_STATE);

  it('names every component, its licence and its state', () => {
    for (const one of [...LOCAL_STACK, ...METERED_STACK]) {
      expect(rendered).toContain(one.choice);
      expect(rendered).toContain(`<td class="mono">${one.licence}</td>`);
      expect(rendered).toContain(one.because);
    }
  });

  it('marks nothing in the stack as installed, because nothing in it is', () => {
    for (const one of [...LOCAL_STACK, ...METERED_STACK]) {
      expect(one.state).not.toBe('VERIFIED');
    }
  });
});

describe('what the page claims about itself', () => {
  it('says which state this build is in, on every state', () => {
    for (const state of VOICE_STATES) {
      expect(voicePage(state))
        .toContain(`this build runs in\n<b>${STATE_FACTS[RUNNING_STATE].label}</b>`);
    }
  });

  it('separates the state that loads from the thirteen that cannot be entered', () => {
    expect(voicePage(RUNNING_STATE)).toContain('the state this deployment is in right now');

    for (const state of VOICE_STATES) {
      if (state === RUNNING_STATE) continue;
      expect(voicePage(state)).toContain('This build cannot enter this state');
    }
  });

  it('points at the file the whole page is rendered from', () => {
    // The page is a claim about a table. Naming the table is what makes the
    // claim checkable by someone who does not trust the page.
    expect(voicePage(RUNNING_STATE)).toContain('src/voice/states.ts');
  });
});
