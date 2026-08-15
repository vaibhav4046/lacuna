import { ABSTENTION_REASONS, explainAbstention } from '../model/abstention.js';
import { ABSENCE_MARKS } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';
import type { Notice } from './notice.js';

/**
 * The interface, written down so it can be used without reading the source.
 *
 * There is one route that answers questions, it takes three fields, and every
 * reply is either an answer page or one of a fixed set of refusals. That is
 * small enough to state completely, and stating it completely is the point: a
 * judge should be able to drive this product from a URL bar, and a reader
 * should be able to see the whole input surface at once rather than infer it
 * from a form.
 *
 * Every number on this page is passed in by the server that enforces it. None
 * of them is typed here, because a documented limit that disagrees with the
 * running one is worse than an undocumented limit.
 */

/**
 * The bounds the running server applies, handed to the page by the server.
 *
 * The alternative was importing the constants from `src/server/server.ts`,
 * which imports this module, and a cycle between the thing that enforces a
 * limit and the thing that prints it is a bad shape for exactly the reason
 * this interface exists.
 */
export interface ServiceLimits {
  readonly termChars: number;
  readonly urlChars: number;
  readonly queryTimeoutMs: number;
  readonly rateLimit: number;
  readonly rateWindowMs: number;
}

const OPENING = 'Everything this product does is a GET. There is no POST route, no '
  + 'request body, no cookie, no session and no account, so the complete input surface '
  + 'is a path and three query fields. That is a deliberate shape rather than a missing '
  + 'feature: a question that fits in a URL is a question that can be linked, logged '
  + 'without a body parser, and replayed by a judge who never opens the code.';

const FIELDS: readonly (readonly [string, string, string])[] = [
  ['subject', 'required', 'The named thing being asked about, exactly as the sessions '
    + 'wrote it. A name nothing carries is not an error; it is the out of scope '
    + 'abstention, which is a real answer.'],
  ['predicate', 'required', 'The property being asked for. Matching is on the stored '
    + 'predicate, so a property that was never recorded is never stated rather than a '
    + 'nearest neighbour.'],
  ['via', 'optional', 'A relation to follow before asking. It turns one question into '
    + 'two hops: resolve the subject, follow this relation to a second entity, then ask '
    + 'the predicate of that one. An empty value means no hop.'],
];

function request(limits: ServiceLimits): Html {
  return html`<p class="prose">${OPENING}</p>
<table>
<thead><tr><th>Field</th><th>Required</th><th>What it is</th></tr></thead>
<tbody>${FIELDS.map(([name, need, what]) => html`<tr>
<td class="mono">${name}</td><td>${need}</td><td>${what}</td>
</tr>`)}</tbody>
</table>
<p class="prose">A direct question, and the same question through one relation:</p>
<p class="params"><code>/ask?subject=Meridian&amp;predicate=vendor</code></p>
<p class="params"><code>/ask?subject=Meridian&amp;predicate=contact&amp;via=vendor</code></p>
<p class="caption">Each term is trimmed, capped at ${limits.termChars} characters and
rejected outright if it contains a control character. The whole request target is
capped at ${limits.urlChars} characters before anything parses it.</p>`;
}

const REPLIES = 'A reply is one of two things and never a third. Either the graph '
  + 'settles the question, in which case the page states the value and prints the '
  + 'sentences it came from, or it does not, in which case the page names which of five '
  + 'situations it ran into. There is no confidence score, no ranked list and no '
  + '"here is the closest thing we found", because the closest thing is what a system '
  + 'shows when it cannot tell the difference between these five.';

function replies(): Html {
  return html`<p class="prose">${REPLIES}</p>
<table>
<thead><tr><th>Abstention</th><th>What it means</th></tr></thead>
<tbody>${ABSTENTION_REASONS.map((reason) => html`<tr>
<td class="value mono"><span class="glyph">${ABSENCE_MARKS[reason]}</span>${reason}</td>
<td>${explainAbstention(reason)}</td>
</tr>`)}</tbody>
</table>
<p class="caption">These five are one union in
src/model/abstention.ts. The corpus generator, the retriever, the benchmark and this
interface all read it, so a sixth situation cannot appear in one of them alone.</p>`;
}

const REFUSALS = 'The refusals are worth listing because they are the whole of what '
  + 'this server can say when it is not answering. Each one is a fixed page chosen by '
  + 'the route. None of them repeats what was submitted, so a request cannot get its '
  + 'own text onto a page by being rejected.';

function refusals(limits: ServiceLimits, statuses: readonly Notice[]): Html {
  const seconds = Math.round(limits.rateWindowMs / 1000);
  return html`<p class="prose">${REFUSALS}</p>
<div class="scroll"><table>
<thead><tr><th class="num">Status</th><th>Page</th><th>When</th></tr></thead>
<tbody>
<tr class="ours"><td class="num mono">200</td><td class="value">Answer</td>
<td>The graph was read. The value is stated, or one of the five above is.</td></tr>
${statuses.map((notice) => html`<tr>
<td class="num mono">${notice.code}</td>
<td class="value">${notice.title}</td>
<td>${notice.heading}</td>
</tr>`)}
</tbody>
</table></div>
<p class="params">methods <b>GET, HEAD</b> · query timeout
<b>${limits.queryTimeoutMs} ms</b> · rate limit <b>${limits.rateLimit} per
${seconds} s per address</b></p>
<p class="caption">The rate limit is a fixed window on the source address the socket
reports. A forwarded-for header is a string the client chose, so it is not read.</p>`;
}

/**
 * The panel that a memory product has to have.
 *
 * Everything on this site is text somebody typed into a chat session at some
 * point, and this page reads it back out. That is the shape of a prompt
 * injection by construction, and the defence here is structural rather than a
 * filter: there is nothing on the path that takes text and decides what to do
 * from it.
 */
const INJECTION = 'Every string this product prints came out of a conversation, which '
  + 'means some of it can be written to look like an instruction. Nothing here acts on '
  + 'text. No model reads a stored claim and decides anything, the resolver is a pure '
  + 'function over claim structure, and the renderer escapes on the way out with no way '
  + 'to opt a value into markup. An instruction stored as a fact has nowhere to run.';

const DEFENCES: readonly (readonly [string, string])[] = [
  [
    'Nothing interprets stored text',
    'The verdict is decided by which edges exist: whether a claim is superseded, '
    + 'contradicted, retracted or absent. The words inside a claim are carried to the '
    + 'page and never consulted by the decision, so text that argues for a verdict is '
    + 'read by nobody who can grant it.',
  ],
  [
    'Values are parameters, never concatenation',
    'A query is a fixed statement plus bound parameters. A subject written to look '
    + 'like a Cypher fragment is a name that matches no entity, which is an out of '
    + 'scope abstention rather than a second statement.',
  ],
  [
    'The renderer has no raw escape hatch',
    'A template interpolates through one escape function, and the type that skips it '
    + 'is produced by the template alone. There is no exported way to mark a string as '
    + 'markup, which is also why no page on this site carries a script or style '
    + 'element: escaping is correct outside raw text elements, so those are not used.',
  ],
  [
    'Both halves are exercised, not asserted',
    'The payloads in tests/support/injection.ts are run twice each: once against the '
    + 'resolver to show the decision is unchanged, and once against the rendered page '
    + 'to show the text arrives escaped. Not changing the answer and not escaping into '
    + 'the markup are separate failures, so they are separate assertions.',
  ],
];

function injection(): Html {
  return html`<p class="prose">${INJECTION}</p>
<table>
<thead><tr><th>Defence</th><th>How it holds</th></tr></thead>
<tbody>${DEFENCES.map(([name, how]) => html`<tr>
<td class="value">${name}</td><td>${how}</td>
</tr>`)}</tbody>
</table>
<p class="caption">The threat this addresses is T1 in docs/THREAT_MODEL.md.</p>`;
}

export function integrationPage(
  limits: ServiceLimits,
  statuses: readonly Notice[],
): string {
  return page({
    title: 'Lacuna | Interface',
    description: 'One GET route, three fields, two shapes of reply, and the reason '
      + 'text stored in the graph cannot become an instruction.',
    current: '/interface',
    body: [
      mastheadCompact('Interface'),
      panel({
        index: 1,
        label: 'Request',
        heading: 'One route and three fields',
        body: request(limits),
      }),
      separator(),
      panel({
        index: 2,
        label: 'Replies',
        heading: 'An answer, or a named absence',
        body: replies(),
      }),
      separator(),
      panel({
        index: 3,
        label: 'Refusals',
        heading: 'Everything else this can say',
        body: refusals(limits, statuses),
      }),
      separator(),
      panel({
        index: 4,
        label: 'Injection',
        heading: 'Stored text is text',
        body: injection(),
      }),
    ],
    note: html`Limits, abstentions and refusal codes are read from the running
server rather than written on this page.`,
  });
}
