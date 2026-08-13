import { ABSTENTION_REASONS, explainAbstention } from '../model/abstention';
import { grouped, sentence } from './format';
import { html, type Html } from './html';
import { masthead, page, panel, PROMISE, separator } from './layout';

/**
 * The page a reader arrives at, which has one job: get them to a real answer.
 *
 * The form is first and the explanation is second, because a judge with four
 * minutes should be able to click one line and be looking at evidence, and a
 * reader who wants the argument can find it directly underneath. Everything
 * here is a GET: a question is a place, so it has a URL, and a URL can be
 * pasted into a report and clicked by somebody else.
 *
 * The example questions are corpus facts rather than a curated highlight reel.
 * Each one is the first gold question of its kind, so the set covers every
 * shape the system claims to tell apart, including the three that produce no
 * answer at all. Putting the failures on the front page is the point.
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

function examples(questions: readonly Example[]): Html {
  if (questions.length === 0) return html`<p class="nothing">No example questions were loaded.</p>`;
  return html`<ul class="examples">${questions.map((example) => html`<li>
<span class="kind">${example.kind.replace(/_/g, ' ')}</span>
<a href="${askHref(example)}">${example.text}</a>
</li>`)}</ul>`;
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
<td class="mono">${reason}</td>
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

function corpus(facts: CorpusFacts): Html {
  return html`<p class="prose">${WHY_IT_MATTERS}</p>
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

export function homePage(questions: readonly Example[], facts: CorpusFacts): string {
  return page({
    title: `Lacuna | ${PROMISE}`,
    description: 'Ask a graph of past sessions what it knows, and get the shape of '
      + 'the absence when it does not know.',
    body: [
      masthead(),
      panel({
        index: 1,
        label: 'Ask',
        heading: 'Put a question to the sessions',
        body: [html`<p class="prose">${OPENING}</p>`, form(questions[0]), examples(questions)],
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
        body: corpus(facts),
      }),
    ],
  });
}
