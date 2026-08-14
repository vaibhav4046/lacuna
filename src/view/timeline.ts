import type { Answer, ClaimRecord } from '../retrieval/types.js';
import { count, shortDate, words } from './format.js';
import { html, type Html } from './html.js';
import { panel } from './layout.js';

/**
 * The thread of a fact through time, and the place where it stops.
 *
 * The drawing is ordinal, not proportional: each claim gets a column in the
 * order it was stated, and its date is printed under it. A proportional axis
 * would be a stronger claim than the data supports here, because three or four
 * points across a few months mostly produce a clump and a gap that mean nothing.
 * Order and transition are what a revision chain is about, and those are drawn
 * exactly.
 *
 * The grammar is four marks. A solid rule is a thread that continues. A filled
 * tick is a claim that still stands. A hollow tick is one that was replaced. A
 * bar with a dashed red line running off the end is a withdrawal, and the dashes
 * are the product's whole subject: a thread that stops without a successor.
 *
 * When nothing was ever stated there is no thread at all, and the row is drawn
 * empty rather than omitted. An empty row is a fact about the graph. A missing
 * row would just look like a missing feature.
 */

const WIDTH = 1000;
const PAD = 26;
const ROW_H = 80;
const TOP = 40;
const TICK_R = 4.5;
const STUB = 34;
/** Room at the right for the dashes after a withdrawal to be worth drawing. */
const GAP_RESERVE = 150;
/** Long enough for a date or a short name, short enough not to collide. */
const LABEL_CAP = 26;

interface Column {
  readonly claim: ClaimRecord;
  readonly x: number;
}

function clip(text: string): string {
  return text.length <= LABEL_CAP ? text : `${text.slice(0, LABEL_CAP - 1)}…`;
}

/**
 * Threads, found by walking the supersession edges that stay inside the set.
 *
 * A revision chain is one thread. A contradiction is two, because neither claim
 * supersedes the other, and drawing them on separate rules is the difference
 * between "this changed" and "these disagree" being visible at a glance.
 */
function threads(claims: readonly ClaimRecord[]): ClaimRecord[][] {
  const at = new Map<number, number>();
  claims.forEach((claim, index) => at.set(claim.id, index));

  const parent = claims.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root]!;
    return root;
  };
  const union = (a: number, b: number): void => {
    const [ra, rb] = [find(a), find(b)];
    if (ra !== rb) parent[rb] = ra;
  };

  claims.forEach((claim, index) => {
    for (const newer of claim.supersededBy) {
      const other = at.get(newer);
      if (other !== undefined) union(index, other);
    }
  });

  const grouped = new Map<number, ClaimRecord[]>();
  claims.forEach((claim, index) => {
    const root = find(index);
    const held = grouped.get(root);
    if (held === undefined) grouped.set(root, [claim]);
    else held.push(claim);
  });
  return [...grouped.values()];
}

function isWithdrawal(claim: ClaimRecord): boolean {
  return claim.polarity === 'negative';
}

/** A claim that withdraws and was never itself replaced: where a thread stops. */
function stops(claim: ClaimRecord): boolean {
  return claim.supersededBy.length === 0 && isWithdrawal(claim);
}

function tick(column: Column, y: number): Html {
  const { claim, x } = column;

  if (stops(claim)) {
    // The dashes run to the edge and the note is set against that edge, so the
    // label lands under the dashes wherever in the row the stop happens to be.
    return html`<line class="tick-stop" x1="${x}" y1="${y - 9}" x2="${x}" y2="${y + 9}"/>
<line class="thread-gap" x1="${x + 6}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}"/>
<text class="svg-note" x="${WIDTH - PAD}" y="${y + 21}" text-anchor="end">NOTHING AFTER IT</text>`;
  }

  const live = claim.supersededBy.length === 0;
  return html`<circle class="${live ? 'tick-live' : 'tick-gone'}" cx="${x}" cy="${y}"
r="${TICK_R}"/>`;
}

function labels(column: Column, y: number, anchor: string): Html {
  const { claim, x } = column;
  const faded = claim.supersededBy.length > 0 ? ' gone' : '';
  const value = isWithdrawal(claim) ? 'withdrawn' : claim.objectText;
  return html`<text class="svg-value${faded}" x="${x}" y="${y - 16}"
text-anchor="${anchor}">${clip(value)}</text>
<text class="svg-date" x="${x}" y="${y + 22}" text-anchor="${anchor}">${
  shortDate(claim.validFrom)}</text>`;
}

function drawThread(claims: readonly ClaimRecord[], columns: Map<number, number>, y: number): Html {
  const placed: Column[] = claims.map((claim) => ({ claim, x: columns.get(claim.id)! }));
  placed.sort((a, b) => a.x - b.x);
  const first = placed[0]!;
  const last = placed[placed.length - 1]!;
  const from = placed.length === 1 ? first.x - STUB : first.x;
  const to = placed.length === 1 ? last.x + STUB : last.x;

  return html`<line class="thread" x1="${from}" y1="${y}" x2="${to}" y2="${y}"/>
${placed.map((column) => tick(column, y))}
${placed.map((column, index) => labels(
  column,
  y,
  index === placed.length - 1 && placed.length > 1 ? 'end' : 'start',
))}`;
}

const EMPTY_LABEL = 'NOTHING WAS EVER STATED HERE';

function drawEmpty(y: number): Html {
  return html`<line class="thread-gap" x1="${PAD}" y1="${y}" x2="${WIDTH - PAD}" y2="${y}"/>
<text class="svg-note" x="${WIDTH / 2}" y="${y - 16}" text-anchor="middle">${EMPTY_LABEL}</text>`;
}

function drawing(considered: readonly ClaimRecord[], label: string): Html {
  if (considered.length === 0) {
    const height = TOP + ROW_H;
    return html`<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}">
${drawEmpty(TOP + ROW_H / 2)}
</svg>`;
  }

  const rows = threads(considered);
  const height = TOP + rows.length * ROW_H;

  // One column per claim, in stated order, shared by every row so that two
  // threads read against each other rather than each against itself.
  const ordered = [...considered].sort(
    (a, b) => a.validFrom.localeCompare(b.validFrom) || a.id - b.id,
  );
  const right = WIDTH - PAD - (considered.some(stops) ? GAP_RESERVE : 0);
  const span = right - PAD;
  const step = ordered.length > 1 ? span / (ordered.length - 1) : 0;
  const columns = new Map<number, number>(
    ordered.map((claim, index) => [
      claim.id,
      ordered.length > 1 ? PAD + index * step : PAD + span / 2,
    ]),
  );

  return html`<svg viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="${label}">
${rows.map((thread, row) => drawThread(thread, columns, TOP + ROW_H / 2 + row * ROW_H))}
</svg>`;
}

function state(claim: ClaimRecord): Html {
  if (claim.supersededBy.length > 0) {
    return html`<span class="state gone">superseded by ${claim.supersededBy.join(', ')}</span>`;
  }
  if (isWithdrawal(claim)) return html`<span class="state gone">withdrawal</span>`;
  return html`<span class="state">current</span>`;
}

/** The drawing said again in words, because a picture is not a reading of the data. */
function table(considered: readonly ClaimRecord[]): Html {
  return html`<table>
<thead><tr>
<th>Value</th><th>Stated for</th><th>Recorded</th><th>State</th><th class="num">Claim</th>
</tr></thead>
<tbody>${considered.map((claim) => html`<tr>
<td class="value">${claim.objectText}</td>
<td class="mono">${shortDate(claim.validFrom)}</td>
<td class="mono">${shortDate(claim.txTime)}</td>
<td>${state(claim)}</td>
<td class="num mono">${claim.id}</td>
</tr>`)}</tbody>
</table>`;
}

const CAPTION = 'Columns are the order the claims were stated, not the interval '
  + 'between them; every date is printed. A filled tick is a claim that still stands, '
  + 'a hollow one has been superseded, and a dashed red line is a thread that stops '
  + 'with nothing after it.';

export function timelinePanel(answer: Answer): Html {
  const { considered } = answer.resolution;
  const about = answer.bridge?.name ?? answer.subject.name;
  const predicate = words(answer.question.predicate);
  const label = considered.length === 0
    ? `No claims about the ${predicate} of ${about}.`
    : `${count(considered.length, 'claim')} about the ${predicate} of ${about}, `
      + `drawn in the order they were stated.`;

  const body = [
    html`<p class="prose">Every claim on this pair, current and replaced alike. The
replaced ones are why this is a record rather than a value.</p>`,
    html`<figure class="figure">${drawing(considered, label)}
<figcaption class="caption">${CAPTION}</figcaption></figure>`,
    considered.length === 0
      ? html`<p class="nothing">The graph holds no claim about the ${predicate} of
${about}. That is not a gap in the drawing, it is the drawing.</p>`
      : table(considered),
  ];

  return panel({ index: 2, label: 'Timeline', heading: 'The thread of this fact', body });
}
