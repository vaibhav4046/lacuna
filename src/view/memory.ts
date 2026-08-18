import type { ClaimRow, ClaimState, Inventory } from '../report/inventory.js';
import { STATE_MEANINGS } from '../report/inventory.js';
import { count, grouped, shortDate, words } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

/**
 * Everything the graph holds, in the order it was written, with its state.
 *
 * The design draws this as six columns, a row of filter chips and a search
 * field. Five of the six columns are here unchanged. The search field is not,
 * and the reason is worth stating rather than hiding: this page renders all one
 * hundred and seventy four claims at once, so the browser's own find already
 * searches every one of them, and a server round trip to do the same thing
 * worse would be the only JavaScript on the site. The chips stayed because they
 * do something the browser cannot, which is to count.
 *
 * The chips are links and the filter is a query parameter, so a filtered view
 * is a URL somebody can send to somebody else. That is also why there is no
 * client state to lose: arriving at `/memory?filter=contradicted` and clicking
 * through to it from `/memory` land on the same bytes.
 *
 * The mark in the first column is the same vocabulary the rest of the site
 * uses for absence, not a new one invented for this table. A retraction is
 * marked with the sign an abstention gets when the answer was retracted, and a
 * contradiction with the sign it gets when two claims disagree, because they
 * are the same two facts seen from opposite ends: this page is looking at the
 * claim, the answer page is looking at the question the claim failed to
 * settle.
 *
 * See DECISIONS.md D-086.
 */

const OPENING = 'This is the whole of it. Every claim the ingest drew out of the '
  + 'transcripts is on this page, in the state the graph holds it in, with the '
  + 'session it was said in and the date it began to hold. Nothing is summarised '
  + 'away and nothing is paged, because a memory you can only sample is a memory '
  + 'you have to trust rather than check.';

const STATES = 'A claim is in exactly one state, and which one is decided by the '
  + 'edges around it rather than by a flag written beside it. That is the whole '
  + 'reason superseding is a relationship in this product and not a column: an '
  + 'edge can be walked back to the claim it replaced, and a column can only be '
  + 'overwritten.';

/** One shape per state, taken from the marks the abstention pages already use. */
const MARKS: Readonly<Record<ClaimState, string>> = Object.freeze({
  current: '●',
  historical: '○',
  contradicted: '≠',
  withdrawn: '⊘',
});

/** Which badge treatment each state wears: the two dimmer ones are the past. */
function past(state: ClaimState): boolean {
  return state === 'historical' || state === 'withdrawn';
}

function label(state: ClaimState): string {
  return state.toUpperCase();
}

/**
 * The claim as a line of English.
 *
 * A retraction has no object text, because there is nothing left to say it is,
 * so the sentence has to come from somewhere and the only honest somewhere is
 * the polarity itself. It reads as what it is: the value was taken away.
 */
function statement(claim: ClaimRow): Html {
  if (claim.objectText === '') {
    return html`<b>${words(claim.predicate)}</b> no longer holds`;
  }
  return html`<b>${words(claim.predicate)}</b> ${claim.objectText}`;
}

function row(claim: ClaimRow): Html {
  return html`<tr>
<td class="mark-cell${past(claim.state) ? ' past' : ''}"><span
class="glyph" aria-hidden="true">${MARKS[claim.state]}</span></td>
<td class="value">${statement(claim)}</td>
<td class="mono">${claim.subject}</td>
<td>${claim.source === null ? 'no span' : claim.source}</td>
<td class="mono">${shortDate(claim.observed)}</td>
<td><span class="state${past(claim.state) ? ' gone' : ''}">${label(claim.state)}</span></td>
</tr>`;
}

/** The chips, each carrying the count it would show, so none of them lies. */
function chips(inventory: Inventory, filter: ClaimState | null): Html {
  return html`<nav class="states" aria-label="Filter by state">
<a href="/memory"${filter === null ? html` aria-current="page"` : null}>All
${grouped(inventory.totals.claims)}</a>
${inventory.states.map((entry) => html`<a
href="/memory?filter=${entry.state}"${entry.state === filter ? html` aria-current="page"` : null}>${entry.label}
${grouped(entry.count)}</a>`)}</nav>`;
}

function table(claims: readonly ClaimRow[]): Html {
  if (claims.length === 0) {
    return html`<p class="nothing">No claim in the graph is in that state. The
count beside the filter says so too, and this is the same fact arrived at from
the other direction.</p>`;
  }
  return html`<div class="scroll">
<table>
<thead>
<tr><th></th><th>Claim</th><th>Scope</th><th>Source</th><th>Observed</th><th>State</th></tr>
</thead>
<tbody>
${claims.map(row)}
</tbody>
</table>
</div>`;
}

/** What every state means, written out once rather than guessed from a colour. */
function key(inventory: Inventory): Html {
  return html`<div class="tally">${inventory.states.map((entry) => html`<div>
<b>${grouped(entry.count)}</b>
<span><span class="glyph" aria-hidden="true">${MARKS[entry.state]}</span>
${entry.label}. ${STATE_MEANINGS[entry.state]}</span>
</div>`)}</div>`;
}

export function memoryPage(inventory: Inventory, filter: ClaimState | null): string {
  const shown = filter === null
    ? inventory.claims
    : inventory.claims.filter((claim) => claim.state === filter);

  return page({
    title: 'Lacuna | Memory',
    description: 'Every claim the graph holds, the state it is in, and the '
      + 'session it came out of.',
    current: '/memory',
    body: [
      mastheadCompact('Memory'),
      panel({
        index: 1,
        label: 'Contents',
        heading: 'Every claim in the graph',
        body: html`<p class="prose">${OPENING}</p>
${chips(inventory, filter)}
${table(shown)}
<p class="params">showing <b>${grouped(shown.length)}</b>
of <b>${count(inventory.totals.claims, 'claim')}</b>
· drawn from <b>${count(inventory.totals.sessions, 'session')}</b>
· seed <b>${inventory.seed}</b></p>`,
      }),
      separator(),
      panel({
        index: 2,
        label: 'States',
        heading: 'What each state means',
        body: html`<p class="prose">${STATES}</p>
${key(inventory)}`,
      }),
    ],
    note: html`Counted from the ingest plan for seed <b>${inventory.seed}</b>,
which is the same plan the node is loaded from.`,
  });
}
