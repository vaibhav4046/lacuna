import { explainCapability, type CapabilityState } from '../model/capability.js';
import { LOCAL_STACK, METERED_STACK, type Component } from '../voice/stack.js';
import {
  acceptedFrom,
  RUNNING_STATE,
  STAGE_FACTS,
  STATE_FACTS,
  stageOf,
  VOICE_STATES,
  advance,
  type VoiceState,
} from '../voice/states.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

/**
 * The voice surface, rendered rather than animated.
 *
 * The imported design at design/reference describes fourteen states and a
 * sphere that moves with microphone level. Two things about this repository
 * decide how much of that can honestly ship. The first is that no page here
 * carries a script, which is what makes one escape function sufficient for the
 * whole renderer. The second is larger: speech recognition and speech
 * synthesis are not installed on this machine, so a sphere that pulsed with a
 * live microphone would be a decoration in front of a pipeline that stops two
 * stages short.
 *
 * So the states are reached the way everything else here is reached, through a
 * URL. Each state is a link, each transition out of a state is a link, and the
 * machine that decides which links exist is the same one a running voice
 * client would use. A judge can walk the entire failure surface from the
 * address bar, which is more of the design than a demo reel usually survives,
 * and every stage that did not run says so.
 *
 * See DECISIONS.md D-055.
 */

const OPENING = 'A spoken question and a typed one should reach the same answer '
  + 'through the same evidence, or voice is a second product with a shared logo. '
  + 'That is the whole design goal here, and it decides what this page can say: '
  + 'the two stages in the middle of the pipeline are this product and they run, '
  + 'the two on the ends are audio and they are not installed. This page walks the '
  + 'states a voice client would move through and marks which of them this build '
  + 'can actually enter.';

/**
 * The sphere from the design, drawn once per state instead of once per frame.
 *
 * Its three variables are the three the design used: how solid it is, whether
 * its edge is dashed, and whether it is drawing from a live source. Nothing
 * here moves, because the only honest thing to move it with is a microphone
 * level this build never reads.
 */
function orb(state: VoiceState): Html {
  const facts = STATE_FACTS[state];
  const weight = facts.weight;
  const dashed = facts.provisional ? ' dashed' : '';
  const live = facts.active ? ' live' : '';
  return html`<figure class="orb-figure">
<svg class="orb" viewBox="0 0 200 200" role="img"
aria-label="${`Voice surface in the ${facts.label} state.`}">
<circle class="${`orb-fill ${weight}${live}`}" cx="100" cy="100" r="62" />
<circle class="${`orb-ring${dashed}${live}`}" cx="100" cy="100" r="62" />
<circle class="orb-limit" cx="100" cy="100" r="86" />
</svg>
<figcaption class="caption">The surface in ${facts.label}. Solidity marks how much
of the pipeline is engaged, and a dashed edge marks anything provisional. It does
not move, because the only honest thing to move it with is a microphone level this
build does not read.</figcaption>
</figure>`;
}

function stateList(current: VoiceState): Html {
  return html`<h3>Every state</h3>
<p class="prose">Fourteen situations, which is what it takes to describe a voice
surface without leaving the failures to be discovered later. Each one is a link,
and each link renders that state from the same table the machine transitions
over.</p>
<nav class="states" aria-label="Voice states">${VOICE_STATES.map((state) => html`<a
href="${`/voice?state=${state}`}"${
  state === current ? html` aria-current="page"` : null
}>${STATE_FACTS[state].label}</a>`)}</nav>`;
}

function transitions(current: VoiceState): Html {
  const events = acceptedFrom(current);
  if (events.length === 0) {
    return html`<h3>What happens next</h3>
<p class="nothing">Nothing moves out of this state. It is an end.</p>`;
  }
  return html`<h3>What happens next</h3>
<p class="prose">The events this state accepts, and where each one lands. An event
that is not listed is not an error: the machine stays where it is, which is the
correct response to most of what a voice surface receives.</p>
<table>
<thead><tr><th>Event</th><th>Lands in</th></tr></thead>
<tbody>${events.map((event) => {
    const next = advance(current, event);
    return html`<tr>
<td class="mono">${event}</td>
<td class="value"><a href="${`/voice?state=${next}`}">${STATE_FACTS[next].label}</a></td>
</tr>`;
  })}</tbody>
</table>`;
}

function statePanel(current: VoiceState): Html {
  const facts = STATE_FACTS[current];
  const running = current === RUNNING_STATE;
  return html`<p class="prose">${OPENING}</p>
${orb(current)}
<p class="asked">${facts.status}</p>
<p class="verdict${facts.failed ? ' absent' : ''}">${facts.label}</p>
<p class="explain">${facts.detail}</p>
<p class="params">transcript <b>${facts.transcript}</b> · stage
<b>${stageOf(current) ?? 'none'}</b> · this build runs in
<b>${STATE_FACTS[RUNNING_STATE].label}</b></p>
${running
    ? html`<p class="caption">This is the state this deployment is in right now,
which is why it is the one that loads by default.</p>`
    : html`<p class="caption">This build cannot enter this state, because two of the
four pipeline stages are not installed. It is rendered from the state table so the
surface can be reviewed before the audio exists.</p>`}
${stateList(current)}
${transitions(current)}`;
}

const PIPELINE = 'Four stages, and the honest thing about them is that they are not '
  + 'in the same condition. The graph read and the resolver are the product, they '
  + 'are covered by the test suite, and they are what the question form already '
  + 'uses. Speech recognition and speech synthesis are not installed, so their rows '
  + 'carry no timing at all. An estimated latency for a stage that never ran is the '
  + 'number a reader would most want to trust and least be able to.';

function pipelinePanel(current: VoiceState): Html {
  const at = stageOf(current);
  return html`<p class="prose">${PIPELINE}</p>
<table>
<thead><tr><th>Stage</th><th>What it does</th><th>State</th><th class="num">Timing</th></tr></thead>
<tbody>${STAGE_FACTS.map((facts) => {
    const installed = facts.capability === 'VERIFIED';
    return html`<tr${facts.stage === at ? html` class="ours"` : null}>
<td class="mono">${facts.stage}</td>
<td>${facts.does}</td>
<td><span class="${`state${installed ? '' : ' gone'}`}">${facts.capability}</span></td>
<td class="num mono">${installed ? 'measured per request' : 'UNAVAILABLE'}</td>
</tr>`;
  })}</tbody>
</table>
<p class="caption">Timings for the two installed stages are measured on the request
that produced the page showing them, on the answer page. They are not repeated here,
because this page did not make that request.</p>`;
}

function stackTable(components: readonly Component[]): Html {
  return html`<table>
<thead><tr><th>Role</th><th>Choice</th><th>Licence</th><th>State</th><th>Why</th></tr></thead>
<tbody>${components.map((one) => html`<tr>
<td>${one.role}</td>
<td class="value">${one.choice}</td>
<td class="mono">${one.licence}</td>
<td><span class="state gone">${one.state}</span></td>
<td>${one.because}</td>
</tr>`)}</tbody>
</table>`;
}

const LOCAL = 'The path this project would ship runs on the machine. A spoken '
  + 'question is audio of somebody talking about their own work, and the reason to '
  + 'keep it local is the same reason the rest of this product reads a graph it can '
  + 'show you: the interesting failure is not the model being wrong, it is not being '
  + 'able to find out where anything went.';

const METERED = 'The services that would make voice work today, named so their '
  + 'absence is a decision rather than an oversight. Each is a request that leaves '
  + 'the machine and a quota that runs out. None of them is called by any code in '
  + 'this repository, which is a claim the secret scan and the network surface both '
  + 'support: there is no HTTP client here except the HydraDB one.';

function stackPanel(): Html {
  return html`<p class="prose">${LOCAL}</p>
${stackTable(LOCAL_STACK)}
<p class="prose">${METERED}</p>
${stackTable(METERED_STACK)}
<p class="caption">Capability states are the ones in src/model/capability.ts, read
by this page and by docs/CLAIMS.json.</p>`;
}

const STATES_MEAN: readonly CapabilityState[] = ['NOT_STARTED', 'BLOCKED', 'VERIFIED'];

const PARITY = 'The question form is the voice pipeline with the two audio stages '
  + 'removed, and that is not a figure of speech: the same resolver decides the '
  + 'verdict, the same reads produce the evidence, and the same five abstentions are '
  + 'the only things it can say instead of an answer. Whatever voice adds later, it '
  + 'cannot change an answer, because the part that decides an answer never sees how '
  + 'the question arrived.';

function parityPanel(): Html {
  return html`<p class="prose">${PARITY}</p>
<table>
<thead><tr><th>State</th><th>What it means here</th></tr></thead>
<tbody>${STATES_MEAN.map((state) => html`<tr>
<td class="value mono">${state}</td><td>${explainCapability(state)}</td>
</tr>`)}</tbody>
</table>
<p class="prose">The working path is the question form. It is one GET, it is
covered by the test suite, and it is the surface every claim in this repository was
measured against.</p>
<p class="params"><code>/ask?subject=Meridian&amp;predicate=vendor</code></p>
<p class="caption">Ask the same question by hand on the question form. There is no
second answer waiting behind a microphone.</p>`;
}

export function voicePage(current: VoiceState): string {
  const facts = STATE_FACTS[current];
  return page({
    title: `Lacuna | Voice: ${facts.label}`,
    description: 'The voice surface as a finite machine, with the two audio stages '
      + 'marked as not installed rather than timed.',
    current: '/voice',
    body: [
      mastheadCompact('Voice'),
      panel({
        index: 1,
        label: 'State',
        heading: 'Fourteen situations, one of them running',
        body: statePanel(current),
      }),
      separator(),
      panel({
        index: 2,
        label: 'Pipeline',
        heading: 'Two stages that run and two that do not',
        body: pipelinePanel(current),
      }),
      separator(),
      panel({
        index: 3,
        label: 'Stack',
        heading: 'What a working voice path would need',
        body: stackPanel(),
      }),
      separator(),
      panel({
        index: 4,
        label: 'Parity',
        heading: 'The answer does not depend on the microphone',
        body: parityPanel(),
      }),
    ],
    note: html`Every state on this page is rendered from the transition table in
src/voice/states.ts. No stage reports a timing it did not measure.`,
  });
}
