import { ABSTENTION_REASONS, explainAbstention } from '../model/abstention.js';
import { type BenchReport, lacuna, tiedWithLacuna } from '../report/bench.js';
import { ABSENCE_MARKS, absenceMark, grouped, ms, roundMs, sentence } from './format.js';
import { html, type Html } from './html.js';
import { masthead, page, panel, PROMISE, separator } from './layout.js';
import type { AnswerSource } from './proof.js';

/**
 * The page a reader arrives at, which has one job: get them to a real answer.
 *
 * The example questions come first and the form second, because a judge with
 * four minutes should be one click from evidence, not one form away from it.
 * The raw subject/predicate/via triple is how the graph stores a question, not
 * how a person arrives holding one, so the typed path sits underneath for
 * whoever already knows what they want to ask. Everything here is a GET: a
 * question is a place, so it has a URL, and a URL can be pasted into a report
 * and clicked by somebody else.
 *
 * The example questions are corpus facts rather than a curated highlight reel.
 * Each one is the first gold question of its kind, so the set covers every
 * shape the system claims to tell apart, including the three that produce no
 * answer at all. Putting the failures on the front page is the point. The
 * first three follow the demo journey (docs/DEMO_JOURNEY.md) — revised,
 * multi-hop, never stated — so the page, the video and the submission walk the
 * same path.
 */

/**
 * One question worth clicking, and the thread kind it exercises.
 *
 * `kind` is a plain string rather than the corpus union, because this module
 * prints it and never switches on it, and the view layer knowing the corpus
 * would be a coupling with nothing to buy it.
 */
export interface Example {
  readonly kind: string;
  readonly text: string;
  readonly subject: string;
  readonly predicate: string;
  readonly via: string | null;
}

/** What the graph holds, as counted rather than as claimed. */
export interface CorpusFacts {
  readonly sessions: number;
  readonly messages: number;
  readonly claims: number;
  readonly entities: number;
  /** Characters over four. An estimate, and labelled as one wherever it is shown. */
  readonly estimatedTokens: number;
  readonly seed: string;
}

/** The same shape the form produces, so a link and a submission are one route. */
export function askHref(example: Example): string {
  const parts = [
    `subject=${encodeURIComponent(example.subject)}`,
    `predicate=${encodeURIComponent(example.predicate)}`,
  ];
  if (example.via !== null) parts.push(`via=${encodeURIComponent(example.via)}`);
  return `/ask?${parts.join('&')}`;
}

/** 200 characters, which is the cap the query layer enforces on a name. */
const NAME_CAP = 200;

function field(name: string, label: string, hint: string, required: boolean): Html {
  return html`<div class="field">
<label for="${name}">${label}</label>
<input id="${name}" name="${name}" type="text" maxlength="${NAME_CAP}"
autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${hint}"
${required ? html`required` : null}>
</div>`;
}

function form(first: Example | undefined): Html {
  return html`<form class="ask" method="get" action="/ask">
${field('subject', 'Subject', first?.subject ?? 'an entity', true)}
${field('predicate', 'Predicate', first?.predicate ?? 'a property', true)}
${field('via', 'Via, optional', 'a relation to follow first', false)}
<button type="submit">Ask</button>
</form>`;
}

/**
 * The demo journey's three questions lead, in the journey's order; the other
 * kinds keep their given order behind them. The reorder happens here in the
 * view because it is presentation: the corpus module owes nobody a marketing
 * sequence.
 */
const JOURNEY_KINDS: readonly string[] = ['revised', 'multi_hop', 'never_stated'];

function journeyFirst(questions: readonly Example[]): readonly Example[] {
  const lead = JOURNEY_KINDS
    .map((kind) => questions.find((example) => example.kind === kind))
    .filter((example): example is Example => example !== undefined);
  const rest = questions.filter((example) => !JOURNEY_KINDS.includes(example.kind));
  return [...lead, ...rest];
}

function examples(questions: readonly Example[]): Html {
  if (questions.length === 0) return html`<p class="nothing">No example questions were loaded.</p>`;
  return html`<ul class="examples">${questions.map((example) => {
    const mark = absenceMark(example.kind);
    return html`<li>
<span class="kind">${mark === null ? null : html`<span class="glyph">${mark}</span>`}${example.kind.replace(/_/g, ' ')}</span>
<a href="${askHref(example)}">${example.text}</a>
</li>`;
  })}</ul>`;
}

const ARGUMENT = 'A retriever that ranks passages by similarity has one way of '
  + 'failing and one way of saying so: it returns its best guess. These are five '
  + 'different situations, they are told apart by the shape of the graph rather than '
  + 'by a threshold, and the difference between them is what a person actually needs '
  + 'to know before acting.';

function shapes(): Html {
  return html`<p class="prose">${ARGUMENT}</p>
<table>
<thead><tr><th>Reason</th><th>What it means</th></tr></thead>
<tbody>${ABSTENTION_REASONS.map((reason) => html`<tr>
<td class="mono"><span class="glyph">${ABSENCE_MARKS[reason]}</span>${reason}</td>
<td>${sentence(explainAbstention(reason))}</td>
</tr>`)}</tbody>
</table>`;
}

const PROVENANCE = 'The sessions are generated from a seed, not collected from anyone. '
  + 'No private conversation is in this graph and none ever was, which is why the whole '
  + 'corpus can be rebuilt from one command and checked line by line. The token figure '
  + 'is characters divided by four; no tokenizer was run over this text.';

const WHY_IT_MATTERS = 'Every question above runs against this graph live. Nothing on '
  + 'an answer page is cached, pre-rendered or written by hand, and the reads that '
  + 'produced it are printed at the bottom of it in full.';

/**
 * The same paragraph for the public deployment, which must not say "live".
 *
 * The replies were produced by a live HydraDB node at export time and are
 * replayed byte for byte through the same client code; saying anything
 * stronger than that would be the one lie this repository has organised
 * itself around not telling.
 */
const WHY_IT_MATTERS_SNAPSHOT = 'This deployment answers from a recorded snapshot: every '
  + 'reply was produced by a live HydraDB node at export time, stored byte for byte, '
  + 'and decoded here through the same client code the live server uses. Nothing on an '
  + 'answer page is written by hand, and the reads that produced it are printed at the '
  + 'bottom of it in full, marked as replayed.';

function corpus(facts: CorpusFacts, source: AnswerSource): Html {
  return html`<p class="prose">${source === 'snapshot' ? WHY_IT_MATTERS_SNAPSHOT : WHY_IT_MATTERS}</p>
<p class="params">sessions <b>${grouped(facts.sessions)}</b>
· messages <b>${grouped(facts.messages)}</b> · claims <b>${grouped(facts.claims)}</b>
· entities <b>${grouped(facts.entities)}</b>
· estimated tokens <b>${grouped(facts.estimatedTokens)}</b> · seed <b>${facts.seed}</b></p>
<p class="prose">${PROVENANCE}</p>`;
}

const OPENING = 'Ask for a property of something the sessions talked about. If the '
  + 'sessions settled it, you get the value, the date it was stated, and the '
  + 'sentences it came from. If they did not, you get the reason they did not, which '
  + 'is a different answer for each of the five ways a fact can be missing.';

/**
 * The four figures that decide whether the rest of this page is worth reading.
 *
 * Three of them are the argument and the fourth is the price. Correctness is a
 * tie in the committed run, so the first cell states the score rather than a
 * rank; the separation is context, so the ratio sits beside it; and the median
 * is the axis this product loses on, printed at the same size as the rest
 * instead of in a footnote further down.
 *
 * Every number here is derived from `artifacts/bench/results.json` when the
 * page is built, including the ratio, which is taken against the closest system
 * that matched the score rather than the most flattering one. A figure typed
 * into this file would be a figure that outlives the run it came from, and this
 * repository has spent its documentation arguing against exactly that.
 */
function strip(report: BenchReport): Html {
  const ours = lacuna(report);
  if (ours === undefined) return html``;
  const tied = tiedWithLacuna(report);
  const nearest = tied.length === 0
    ? null
    : Math.min(...tied.map((system) => system.meanEstimatedTokens / ours.meanEstimatedTokens));

  return html`<div class="strip full">
<a class="cell" href="/bench"><b>${ours.correct}/${ours.total}</b>
<span>questions answered correctly</span></a>
${nearest === null ? null : html`<a class="cell mark" href="/bench"><b>${roundMs(nearest)}x</b>
<span>less context than the closest system that tied</span></a>`}
<a class="cell" href="/bench"><b>${grouped(report.systems.length)}</b>
<span>retrieval configurations in the run</span></a>
<a class="cell" href="/bench"><b>${ms(ours.p50Ms)}</b>
<span>median question, and the slowest in the run</span></a>
</div>`;
}

export function homePage(
  questions: readonly Example[],
  facts: CorpusFacts,
  report: BenchReport,
  source: AnswerSource = 'live',
): string {
  const ordered = journeyFirst(questions);
  return page({
    title: `Lacuna | ${PROMISE}`,
    description: 'Ask a graph of past sessions what it knows, and get the shape of '
      + 'the absence when it does not know.',
    current: '/',
    body: [
      masthead(),
      strip(report),
      panel({
        index: 1,
        label: 'Ask',
        heading: 'Put a question to the sessions',
        body: [
          html`<p class="prose">${OPENING}</p>`,
          examples(ordered),
          html`<p class="formlead">Or type your own. The graph stores a question as a
subject, a property, and optionally a relation to follow first.</p>`,
          form(ordered[0]),
        ],
      }),
      separator(),
      panel({
        index: 2,
        label: 'Absence',
        heading: 'Five ways a fact can be missing',
        body: shapes(),
      }),
      separator(),
      panel({
        index: 3,
        label: 'Corpus',
        heading: 'What is in the graph',
        body: corpus(facts, source),
      }),
    ],
  });
}
