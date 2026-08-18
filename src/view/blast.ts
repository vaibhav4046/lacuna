import { affectedText, type AffectedService, type BlastAnswer } from '../retrieval/blast.js';
import { citations, trace } from './answer.js';
import { ABSENCE_MARKS, count } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, PROMISE, separator } from './layout.js';
import { proofPanel, type AnswerSource, type NodeIdentity } from './proof.js';

/**
 * One package, and everything a change to it could reach.
 *
 * This is the page the answer page cannot be. An answer resolves one predicate
 * against one subject; a blast radius is a walk whose length nobody declared in
 * advance, and whose result is a set rather than a value. What the two share is
 * the part that matters: every hop printed here came out of a stated claim, and
 * the claim id is carried through to a quotation, so a reader can follow the
 * route back to the sentence somebody typed in a session.
 *
 * The set is not stored anywhere. It is what the traversal reached this time,
 * on this graph, and a revision that withdraws one dependency changes it.
 */

/** The one absence this page can produce: a name with no node behind it. */
const NOT_HERE = 'Not in these sessions.';

const NOTHING_TO_QUOTE = 'There is no quotation, because no claim was walked through. '
  + 'The absence is the finding.';

function asked(answer: BlastAnswer): Html {
  return html`<p class="asked">Asked what a change to <b>${answer.packageName}</b> would
reach.</p>`;
}

/**
 * The finding, in one sentence, said the same way the page's title says it.
 *
 * Written as a plain string rather than markup because the description meta tag
 * and the paragraph want the identical wording, and two spellings of one
 * sentence is one spelling too many.
 */
function summary(answer: BlastAnswer): string {
  const { radius } = answer;
  if (radius === null) {
    return `No entity in these sessions is named "${answer.packageName}", so there is no `
      + 'dependency to walk. That is a shape of absence, not a failed read.';
  }

  const reached = radius.affected.length === 0
    ? 'Nothing that reaches a service depends on it, at any depth the walk was allowed'
    : `${count(radius.affected.length, 'service')} depend on it, directly or through `
      + `${count(radius.packagesTouched.length, 'intermediate package')}`;

  const refused = radius.ignored === 0
    ? 'Every dependency claim the walk met was live.'
    : `${count(radius.ignored, 'dependency claim')} on the way `
      + `${radius.ignored === 1 ? 'was' : 'were'} refused as superseded or withdrawn, so `
      + `the route through ${radius.ignored === 1 ? 'it' : 'them'} is history rather than `
      + 'structure.';

  return `${reached}. ${refused}`;
}

function verdict(answer: BlastAnswer): Html {
  const { radius } = answer;
  if (radius === null) {
    return html`<p class="verdict absent">${NOT_HERE}</p>
<p class="reason"><span class="glyph">${ABSENCE_MARKS.out_of_scope}</span>out_of_scope</p>`;
  }
  // An empty radius is an answer, not an abstention: the package is here, the
  // graph was walked, and what it reached was nothing. That is a measurement,
  // so it is printed in the colour of a measurement.
  return html`<p class="verdict">${radius.affected.length === 0
    ? 'No service depends on it.'
    : affectedText(radius)}</p>`;
}

/**
 * One service, and the route the walk took to it, hop by hop.
 *
 * The path is stored from the changed package outward, so the name each hop
 * depends on is the previous hop's name, and the root's name starts the chain.
 * Said in sentences rather than arrows: an arrow between two names leaves the
 * direction of a dependency to the reader's guess, and half of them guess the
 * other way.
 */
function route(service: AffectedService, rootName: string): Html {
  let from = rootName;
  const hops = service.path.map((step) => {
    const line = `${step.entityName} depends on ${from}, stated in claim ${step.claimId}.`;
    from = step.entityName;
    return line;
  });

  return html`<div class="citation">
<p class="source"><em>${service.entityName}</em> &middot; ${count(service.depth, 'hop')}</p>
<ol class="trace">${hops.map((hop) => html`<li>${hop}</li>`)}</ol>
</div>`;
}

const NO_ROUTES = 'No route to print. Nothing in these sessions was stated to depend on '
  + 'this package, so the walk ended where it started.';

export function blastPage(
  answer: BlastAnswer,
  node: NodeIdentity,
  source: AnswerSource = 'live',
): string {
  const { radius } = answer;
  const explanation = summary(answer);
  const routes = radius === null || radius.affected.length === 0
    ? html`<p class="nothing">${NO_ROUTES}</p>`
    : radius.affected.map((service) => route(service, answer.packageName));

  const found = radius !== null && radius.affected.length > 0;

  return page({
    title: `blast radius of ${answer.packageName}: ${
      radius === null
        ? NOT_HERE
        : `${count(radius.affected.length, 'service')} affected`
    } | Lacuna`,
    description: explanation,
    // The blast radius is asked from the question form's page and answered
    // here, so the bar keeps that page marked rather than growing an entry for
    // a page nobody navigates to directly.
    current: '/',
    body: [
      mastheadCompact(PROMISE),
      panel({
        index: 1,
        label: 'Blast radius',
        heading: found ? 'What a change would reach' : 'What a change would not reach',
        body: [
          asked(answer),
          verdict(answer),
          html`<p class="explain">${explanation}</p>`,
          html`<div class="duo">
<div>${radius === null ? null : trace(radius.trace)}</div>
<div>${answer.evidence.length > 0
    ? citations(answer.evidence)
    : html`<p class="nothing">${NOTHING_TO_QUOTE}</p>`}</div>
</div>`,
        ],
      }),
      separator(),
      panel({
        index: 2,
        label: 'Paths',
        heading: 'How each service was reached',
        body: routes,
      }),
      separator(),
      proofPanel(answer, node, source, 3),
    ],
  });
}
