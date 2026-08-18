import type { Inventory } from '../report/inventory.js';
import { count, grouped } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

/**
 * The health of the memory, without a health score.
 *
 * The design was emphatic about this and it is the right call, so it survives
 * the port intact: there is no single number on this page. A score would have
 * to weigh a contradiction against a retraction against a claim nobody has
 * quoted, and the weights would be invented, and the number they produced
 * would be the most quotable thing on the site and the least defensible. What
 * replaces it is the composition: how many claims are in each state, and what
 * the structure of the graph is underneath them.
 *
 * The design drew that composition as a spiral on a canvas. Here it is a bar,
 * for the same reason the rail is anchors: the page ships no JavaScript, and a
 * bar drawn from four counts says the one thing the spiral was there to say,
 * which is that the memory is mostly current and the rest of it is not noise.
 * Amber marks the contradicted share because amber already means look here on
 * this site, and a live disagreement is the one thing on this page worth
 * looking at.
 *
 * Every number comes out of `buildInventory`, which counts the ingest plan.
 * None of it is a health metric in the sense of something tuned until it looked
 * good; they are all counts of rows and edges that either exist or do not.
 *
 * See DECISIONS.md D-086.
 */

const OPENING = 'There is no score on this page. A memory is not healthy or '
  + 'unhealthy in one number, and any product that gives you one has chosen the '
  + 'weights for you and then hidden them. What a memory has instead is a shape: '
  + 'how much of it still holds, how much of it has been replaced, how much of it '
  + 'is in open disagreement, and how much of it was taken back.';

const STRUCTURE = 'Underneath the states there are questions with only structural '
  + 'answers, and they are the ones worth asking because they cannot be fudged. A '
  + 'claim with no evidence span behind it would be a claim this product could '
  + 'state and not prove. An entity nothing is ever said about is why abstention '
  + 'has a reason code for a subject that exists but is unconnected. Both are '
  + 'counted here whether the answer is interesting or zero.';

const TOTALS = 'The graph itself, as the node holds it. These are the counts the '
  + 'census checks against the plan before every deploy, which is what makes them '
  + 'safe to print: if this page and the database ever disagreed, the census would '
  + 'fail first.';

/** Bar colours, in the order the states are counted. */
const FILLS: readonly string[] = [
  'var(--ink)',
  'var(--ink-dim)',
  'var(--spark)',
  'var(--rule-strong)',
];

const BAR_W = 1000;
const BAR_H = 26;

/** Coordinates, to a thousandth of the bar, which is a tenth of a claim. */
function round(value: number): string {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

/**
 * The composition, drawn to scale.
 *
 * Widths are the counts, so a state with two claims in it is two claims wide
 * and does not get rounded up to something visible. The alternative, a minimum
 * segment width, would make the smallest states look larger than they are,
 * which on a page about honesty is the wrong trade even though it draws better.
 */
function bar(inventory: Inventory): Html {
  const total = inventory.states.reduce((sum, entry) => sum + entry.count, 0);
  if (total === 0) return html`<p class="nothing">The graph holds no claims.</p>`;

  let x = 0;
  const segments = inventory.states.map((entry, index) => {
    const width = (entry.count / total) * BAR_W;
    const rect = html`<rect x="${round(x)}" y="0" width="${round(width)}"
height="${String(BAR_H)}" fill="${FILLS[index] ?? 'var(--ink-dim)'}"></rect>`;
    x += width;
    return rect;
  });

  return html`<figure class="figure">
<svg viewBox="0 0 ${String(BAR_W)} ${String(BAR_H)}" role="img"
aria-label="${inventory.states.map((entry) => `${entry.label} ${String(entry.count)}`).join(', ')}">
${segments}
</svg>
<figcaption class="caption">All ${count(total, 'claim')}, to scale, in the four
states a claim can be in.</figcaption>
</figure>`;
}

function states(inventory: Inventory): Html {
  return html`<div class="tally">${inventory.states.map((entry) => html`<div${entry.state === 'contradicted' ? html` class="mark"` : null}>
<b>${grouped(entry.count)}</b>
<span>${entry.label}. ${entry.meaning}</span>
</div>`)}</div>`;
}

function structure(inventory: Inventory): Html {
  const { structural } = inventory;
  return html`<div class="tally">
<div><b>${grouped(structural.claimsWithoutEvidence)}</b>
<span>Claims with no evidence span. Every claim on this page can be quoted back
to the message it came from.</span></div>
<div><b>${grouped(structural.entitiesWithoutClaims)}</b>
<span>Entities nothing is said about. A question about one of these abstains
with the unconnected reason rather than guessing.</span></div>
<div><b>${grouped(structural.claimsNamingAnEntity)}</b>
<span>Claims that name a second entity. These are the hops, and they are what
makes a two step question answerable at all.</span></div>
<div><b>${grouped(structural.supersedesEdges)}</b>
<span>Supersedes edges. Each one is a value that changed and both halves
kept.</span></div>
<div><b>${grouped(structural.contradictsEdges)}</b>
<span>Contradicts edges. Each one is a disagreement nobody in the transcripts
ever resolved.</span></div>
</div>`;
}

function totals(inventory: Inventory): Html {
  const { totals: t } = inventory;
  return html`<div class="scroll">
<table>
<thead><tr><th>Label</th><th class="num">Count</th><th>What it is</th></tr></thead>
<tbody>
<tr><td class="mono">Session</td><td class="num">${grouped(t.sessions)}</td>
<td>One conversation, start to finish.</td></tr>
<tr><td class="mono">Message</td><td class="num">${grouped(t.messages)}</td>
<td>One turn inside a session, stored whole.</td></tr>
<tr><td class="mono">EvidenceSpan</td><td class="num">${grouped(t.spans)}</td>
<td>The exact characters a claim was read out of.</td></tr>
<tr><td class="mono">Claim</td><td class="num">${grouped(t.claims)}</td>
<td>One thing asserted about one entity.</td></tr>
<tr><td class="mono">Entity</td><td class="num">${grouped(t.entities)}</td>
<td>Something the transcripts talk about by name.</td></tr>
</tbody>
</table>
</div>
<p class="params">vertices <b>${grouped(t.vertices)}</b>
· edges <b>${grouped(t.edges)}</b>
· seed <b>${inventory.seed}</b></p>`;
}

export function healthPage(inventory: Inventory): string {
  return page({
    title: 'Lacuna | Health',
    description: 'The composition of the memory: what still holds, what was '
      + 'replaced, what disagrees, and what was taken back. No single score.',
    current: '/health',
    body: [
      mastheadCompact('Context health'),
      panel({
        index: 1,
        label: 'Shape',
        heading: 'No single score',
        body: html`<p class="prose">${OPENING}</p>
${bar(inventory)}
${states(inventory)}`,
      }),
      separator(),
      panel({
        index: 2,
        label: 'Structure',
        heading: 'The questions with structural answers',
        body: html`<p class="prose">${STRUCTURE}</p>
${structure(inventory)}`,
      }),
      separator(),
      panel({
        index: 3,
        label: 'Totals',
        heading: 'What is in the graph',
        body: html`<p class="prose">${TOTALS}</p>
${totals(inventory)}`,
      }),
    ],
    note: html`Counted from the ingest plan for seed <b>${inventory.seed}</b>.
No figure on this page is a rating.`,
  });
}
