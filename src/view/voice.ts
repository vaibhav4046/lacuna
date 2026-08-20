import { explainCapability, type CapabilityState } from '../model/capability.js';
import { LOCAL_STACK, METERED_STACK, type Component } from '../voice/stack.js';
import {
  acceptedFrom, RUNNING_STATE, STAGE_FACTS, STATE_FACTS, stageOf,
  VOICE_STATES, advance, type VoiceState,
} from '../voice/states.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

const OPENING = 'Voice is an input and output boundary around the same question planner, '
  + 'context kernel and evidence gate used by typed questions. The browser receives a '
  + 'single-use Scribe token, never the permanent provider key. Only a committed '
  + 'transcript reaches the query endpoint, and only the spoken answer reaches TTS.';

/** This server-rendered reference is static. The interactive app uses measured analyser data. */
function orb(state: VoiceState): Html {
  const facts = STATE_FACTS[state];
  const dashed = facts.provisional ? ' dashed' : '';
  return html`<figure class="orb-figure">
<svg class="orb" viewBox="0 0 200 200" role="img"
aria-label="${`Voice surface in the ${facts.label} state.`}">
<circle class="${`orb-fill ${facts.weight}`}" cx="100" cy="100" r="62" />
<circle class="${`orb-ring${dashed}`}" cx="100" cy="100" r="62" />
<circle class="orb-limit" cx="100" cy="100" r="86" />
</svg>
<figcaption class="caption">Static state reference. The interactive orb moves only from
microphone RMS in LISTENING or PARTIAL TRANSCRIPT and playback analysis in SPEAKING.</figcaption>
</figure>`;
}

function stateList(current: VoiceState): Html {
  return html`<h3>Every state</h3>
<p class="prose">Fifteen situations cover permission, capture, commitment, context,
the three evidence outcomes, real playback, interruption and bounded failures.</p>
<nav class="states" aria-label="Voice states">${VOICE_STATES.map((state) => html`<a
href="${`/voice?state=${state}`}"${state === current ? html` aria-current="page"` : null}
>${STATE_FACTS[state].label}</a>`)}</nav>`;
}

function transitions(current: VoiceState): Html {
  const events = acceptedFrom(current);
  return html`<h3>Accepted transitions</h3>
<table><thead><tr><th>Event</th><th>Lands in</th></tr></thead>
<tbody>${events.map((event) => {
    const next = advance(current, event);
    return html`<tr><td class="mono">${event}</td>
<td class="value"><a href="${`/voice?state=${next}`}">${STATE_FACTS[next].label}</a></td></tr>`;
  })}</tbody></table>`;
}

function statePanel(current: VoiceState): Html {
  const facts = STATE_FACTS[current];
  return html`<p class="prose">${OPENING}</p>
${orb(current)}
<p class="asked">${facts.status}</p>
<p class="verdict${facts.failed ? ' absent' : ''}">${facts.label}</p>
<p class="explain">${facts.detail}</p>
<p class="params">transcript <b>${facts.transcript}</b> · stage
<b>${stageOf(current) ?? 'none'}</b> · audio signal <b>${facts.signal ?? 'none'}</b> · default
<b>${STATE_FACTS[RUNNING_STATE].label}</b></p>
${stateList(current)}${transitions(current)}`;
}

function pipelinePanel(current: VoiceState): Html {
  const at = stageOf(current);
  return html`<p class="prose">All four boundaries exist. Provider configuration is
deployment state, so an absent key or voice id maps to PROVIDER UNAVAILABLE rather
than a fake success.</p>
<table><thead><tr><th>Stage</th><th>What it does</th><th>Boundary</th></tr></thead>
<tbody>${STAGE_FACTS.map((facts) => html`<tr${facts.stage === at ? html` class="ours"` : null}>
<td class="mono">${facts.stage}</td><td>${facts.does}</td>
<td><span class="state">${facts.capability}</span></td></tr>`)}</tbody></table>`;
}

function stackTable(components: readonly Component[]): Html {
  return html`<table><thead><tr><th>Role</th><th>Choice</th><th>Licence</th><th>State</th><th>Why</th></tr></thead>
<tbody>${components.map((one) => html`<tr><td>${one.role}</td><td class="value">${one.choice}</td>
<td class="mono">${one.licence}</td><td><span class="state${one.state === 'VERIFIED' ? '' : ' gone'}">${one.state}</span></td>
<td>${one.because}</td></tr>`)}</tbody></table>`;
}

function stackPanel(): Html {
  return html`<p class="prose">The hosted ElevenLabs boundary is implemented. The local
alternatives remain uninstalled and are not presented as fallback behavior.</p>
${stackTable(METERED_STACK)}${stackTable(LOCAL_STACK)}`;
}

const STATES_MEAN: readonly CapabilityState[] = ['NOT_STARTED', 'BLOCKED', 'VERIFIED'];

function parityPanel(): Html {
  return html`<p class="prose">Speech changes transport, not policy. The committed
transcript is posted to the existing query route, whose planner and context kernel
also serve the typed Ask screen.</p>
<table><thead><tr><th>State</th><th>Meaning</th></tr></thead>
<tbody>${STATES_MEAN.map((state) => html`<tr><td class="value mono">${state}</td>
<td>${explainCapability(state)}</td></tr>`)}</tbody></table>`;
}

export function voicePage(current: VoiceState): string {
  const facts = STATE_FACTS[current];
  return page({
    title: `Lacuna | Voice: ${facts.label}`,
    description: 'The real voice state machine and its provider, query and playback boundaries.',
    current: '/voice',
    body: [
      mastheadCompact('Voice'),
      panel({ index: 1, label: 'State', heading: 'Fifteen real situations', body: statePanel(current) }),
      separator(),
      panel({ index: 2, label: 'Pipeline', heading: 'One query core between two audio boundaries', body: pipelinePanel(current) }),
      separator(),
      panel({ index: 3, label: 'Stack', heading: 'Implemented hosted path, explicit local gap', body: stackPanel() }),
      separator(),
      panel({ index: 4, label: 'Parity', heading: 'The microphone does not choose the answer', body: parityPanel() }),
    ],
    note: html`The interactive route enters LISTENING only with a live microphone track
and SPEAKING only after the audio element fires playing.`,
  });
}
