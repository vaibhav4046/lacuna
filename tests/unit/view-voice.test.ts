import { describe, expect, it } from 'vitest';

import { escape } from '../../src/view/html.js';
import { META_CONTENT_SECURITY_POLICY } from '../../src/view/layout.js';
import { voicePage } from '../../src/view/voice.js';
import { LOCAL_STACK, METERED_STACK } from '../../src/voice/stack.js';
import {
  acceptedFrom, advance, RUNNING_STATE, STAGE_FACTS, STATE_FACTS,
  stageOf, VOICE_STATES,
} from '../../src/voice/states.js';
import { markedPages } from '../support/markup.js';

describe('voicePage', () => {
  it('renders all fifteen exact states from the machine', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);
      expect(rendered).toContain(`Lacuna | Voice: ${STATE_FACTS[state].label}`);
      expect(rendered).toContain(STATE_FACTS[state].detail);
      expect(rendered).toContain(`Voice surface in the ${STATE_FACTS[state].label} state.`);
    }
  });

  it('is a static reference with no fake audio script or live class', () => {
    for (const state of VOICE_STATES) {
      expect(voicePage(state)).not.toContain('<script');
      expect(voicePage(state)).not.toMatch(/class="[^"]*\blive\b/u);
      expect(voicePage(state)).toContain('Static state reference');
    }
  });

  it('keeps the locked-down server-rendered CSP', () => {
    const rendered = voicePage(RUNNING_STATE);
    expect(rendered).toContain(
      `<meta http-equiv="Content-Security-Policy" content="${escape(META_CONTENT_SECURITY_POLICY)}">`,
    );
    expect(rendered).toContain(escape("script-src 'none'"));
  });

  it('links every state and marks the current one', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);
      for (const other of VOICE_STATES) expect(rendered).toContain(`href="/voice?state=${other}"`);
      expect(markedPages(rendered)).toContain(`/voice?state=${state}`);
    }
  });

  it('renders exactly the transition table and current stage', () => {
    for (const state of VOICE_STATES) {
      const rendered = voicePage(state);
      for (const event of acceptedFrom(state)) {
        expect(rendered).toContain(`<td class="mono">${event}</td>`);
        expect(rendered).toContain(`href="/voice?state=${advance(state, event)}"`);
      }
      expect(rendered).toContain(`<b>${stageOf(state) ?? 'none'}</b>`);
    }
  });

  it('states that permanent keys, partials and source text do not cross boundaries', () => {
    const rendered = voicePage('READY');
    expect(rendered).toContain('never the permanent provider key');
    expect(rendered).toContain('Only a committed');
    expect(rendered).toContain('only the spoken answer reaches TTS');
  });

  it('shows all four implemented pipeline boundaries', () => {
    const rendered = voicePage('READY');
    for (const stage of STAGE_FACTS) {
      expect(rendered).toContain(`<td class="mono">${stage.stage}</td>`);
      expect(rendered).toContain(stage.does);
      expect(stage.capability).toBe('VERIFIED');
    }
  });

  it('separates verified hosted components from uninstalled local alternatives', () => {
    const rendered = voicePage('READY');
    for (const component of METERED_STACK) {
      expect(component.state).toBe('VERIFIED');
      expect(rendered).toContain(component.choice);
    }
    for (const component of LOCAL_STACK) {
      expect(component.state).toBe('NOT_STARTED');
      expect(rendered).toContain(component.choice);
    }
  });
});
