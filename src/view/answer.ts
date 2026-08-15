import type { AbstentionReason } from '../model/abstention.js';
import type { Answer, EvidenceRecord } from '../retrieval/types.js';
import { ABSENCE_MARKS, shortStamp, words } from './format.js';
import { html, type Html } from './html.js';
import { panel } from './layout.js';

/**
 * The verdict, and the sentences that got to it.
 *
 * The largest type on the page is either the value or the shape of its absence,
 * which is the entire argument of the product set in one line. "No answer" would
 * have been the safe wording and it would have thrown away the thing worth
 * saying: these five situations are not one situation, and the graph is what
 * tells them apart. So an abstention gets a headline of its own kind, with the
 * machine name printed underneath so the mapping between the two is checkable.
 *
 * Everything below the headline is drawn from `resolution` and `evidence`
 * without interpretation. The trace is the resolver's own sentences, in its own
 * order.
 */

/**
 * Each absence, said as a finding rather than as a failure.
 *
 * These are headlines, not explanations. `explainAbstention` writes the clause
 * that goes into a sentence; this writes the words that go across the top.
 */
const HEADLINES: Readonly<Record<AbstentionReason, string>> = {
  never_stated: 'Never stated.',
  retracted: 'Withdrawn, and not replaced.',
  contradicted: 'The sessions disagree.',
  unconnected: 'The link was never stated.',
  out_of_scope: 'Not in these sessions.',
};

function asked(answer: Answer): Html {
  const { subject, predicate, via } = answer.question;
  return via === null
    ? html`<p class="asked">Asked for the <b>${words(predicate)}</b> of <b>${subject}</b>.</p>`
    : html`<p class="asked">Asked for the <b>${words(predicate)}</b> of the
<b>${words(via)}</b> of <b>${subject}</b>.</p>`;
}

function verdict(answer: Answer): Html {
  const { outcome } = answer.resolution;
  if (outcome.type === 'answer') {
    return html`<p class="verdict">${outcome.text}</p>`;
  }
  return html`<p class="verdict absent">${HEADLINES[outcome.reason]}</p>
<p class="reason"><span class="glyph">${ABSENCE_MARKS[outcome.reason]}</span>${outcome.reason}</p>`;
}

function trace(steps: readonly string[]): Html {
  return html`<h3>How it got there</h3>
<ol class="trace">${steps.map((step) => html`<li>${step}</li>`)}</ol>`;
}

/**
 * Quotations, grouped by the claim they support and in the order the graph
 * returned them, so two spans backing one claim read as one citation.
 */
function citations(evidence: readonly EvidenceRecord[]): Html {
  const byClaim = new Map<number, EvidenceRecord[]>();
  for (const span of evidence) {
    const held = byClaim.get(span.claimId);
    if (held === undefined) byClaim.set(span.claimId, [span]);
    else held.push(span);
  }

  const blocks = [...byClaim.values()].map((spans) => {
    const first = spans[0]!;
    return html`<div class="citation">
<p class="source"><em>${first.sessionTitle}</em> &middot; ${first.role} &middot;
${shortStamp(first.ts)} &middot; claim ${first.claimId}</p>
${spans.map((span) => html`<blockquote>${span.quote}</blockquote>`)}
</div>`;
  });

  return html`<h3>Quoted from the sessions</h3>${blocks}`;
}

const NOTHING_TO_QUOTE = 'There is no quotation, because there is no statement to '
  + 'quote. The absence is the finding, and it is the same absence every time this '
  + 'question is asked.';

export function answerPanel(answer: Answer): Html {
  const answered = answer.resolution.outcome.type === 'answer';
  // The walk and its quotations are one unit: side by side where the sheet is
  // wide enough, stacked where it is not. The pairing lives in the stylesheet.
  const body = [
    asked(answer),
    verdict(answer),
    html`<p class="explain">${answer.resolution.explanation}</p>`,
    html`<div class="duo">
<div>${trace(answer.resolution.trace)}</div>
<div>${answer.evidence.length > 0
    ? citations(answer.evidence)
    : html`<p class="nothing">${NOTHING_TO_QUOTE}</p>`}</div>
</div>`,
  ];

  return panel({
    index: 1,
    label: 'Answer',
    heading: answered ? 'What the graph says' : 'What the graph does not say',
    body,
  });
}

/** The browser tab, a bookmark, and a shared link all read this. */
export function answerTitle(answer: Answer): string {
  const { outcome } = answer.resolution;
  const asking = `${words(answer.question.predicate)} of ${answer.question.subject}`;
  const verdictText = outcome.type === 'answer'
    ? outcome.text
    : HEADLINES[outcome.reason];
  return `${asking}: ${verdictText} | Lacuna`;
}
