import type { HydraConfig } from '../hydra/config';
import type { Answer, QueryTrace } from '../retrieval/types';
import { count, ms, roundMs } from './format';
import { html, join, type Html } from './html';
import { panel } from './layout';

/**
 * The reads themselves, printed in full.
 *
 * Every other panel is this product's account of what the graph said. This one
 * is the graph's, and it is here so a reader does not have to take the other
 * three on trust: the statement, the parameters it was given, the rows it came
 * back with, and what it cost. A judge with the repository checked out can run
 * any line on this page against their own node and get the same rows.
 *
 * Two things are deliberately absent. The base URL is not printed, because it
 * is the one piece of the connection that is a deployment detail rather than a
 * property of the answer. The bearer token is not merely unprinted, it cannot
 * reach here: the panel takes a `NodeIdentity`, and the only way to make one is
 * `describeNode`, which drops both.
 */

/**
 * What can be said about the node in public.
 *
 * `HydraConfig` carries a bearer token. A page is a thing that gets screenshot,
 * saved, pasted into an issue and put in a demo video, so the type that reaches
 * a page is a different type from the one that reaches the transport, and the
 * narrowing is a named function rather than a habit of spreading carefully.
 */
export interface NodeIdentity {
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
}

export function describeNode(config: HydraConfig): NodeIdentity {
  return { namespace: config.namespace, graph: config.graph, cell: config.cell };
}

/**
 * The build target, recorded in docs/SOURCE_LOG.md.
 *
 * This is what Lacuna was written and tested against. It is not read from the
 * running node, because the node exposes no version endpoint, so the page says
 * "tested against" and not "running". A number this page cannot verify is a
 * number this page does not get to assert.
 */
const TESTED_AGAINST = Object.freeze({
  tag: 'v0.1.1',
  commit: '02a40025d2d57e97ab2754c8256219cdbfeab379',
});

/** Long enough for a name or an id list, short enough to stay on one line. */
const VALUE_CAP = 120;

function clip(text: string): string {
  return text.length <= VALUE_CAP ? text : `${text.slice(0, VALUE_CAP - 1)}…`;
}

/**
 * A parameter value as it went over the wire.
 *
 * Parameters are entity names, predicates and integer ids, so this is a short
 * function on purpose. It still refuses to throw: a proof panel that takes the
 * page down with it is worse than one that prints that it could not read a
 * value.
 */
function show(value: unknown): string {
  if (typeof value === 'string') return clip(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return clip(JSON.stringify(value) ?? String(value));
  } catch {
    return 'unprintable';
  }
}

function parameters(given: Readonly<Record<string, unknown>>): Html {
  const pairs = Object.entries(given);
  if (pairs.length === 0) return html`<p class="params">no parameters</p>`;
  return html`<p class="params">${join(
    pairs.map(([name, value]) => html`${name} <b>${show(value)}</b>`),
    ' · ',
  )}</p>`;
}

function read(trace: QueryTrace, index: number): Html {
  return html`<div class="query">
<p class="query-head">
<span class="n">${String(index + 1).padStart(2, '0')}</span>
<span>${count(trace.rows, 'row')}</span>
<span>${ms(trace.ms)}</span>
<span>${trace.readEpoch === null ? 'no epoch reported' : `epoch ${trace.readEpoch}`}</span>
</p>
<pre>${trace.cypher}</pre>
${parameters(trace.parameters)}
</div>`;
}

/** "128", "128 and 129", "128, 129 and 130". */
function series(values: readonly number[]): string {
  if (values.length <= 1) return values.join('');
  return `${values.slice(0, -1).join(', ')} and ${values[values.length - 1]}`;
}

/**
 * What the reads reported about the version of the store they saw.
 *
 * Said as an observation and never as a guarantee. One epoch across every read
 * is what this page happens to have measured, on a node nothing else was
 * writing to. It is not snapshot isolation, and calling it that would be the
 * cheapest sentence on the page.
 */
function epochs(queries: readonly QueryTrace[]): string {
  const seen = [...new Set(
    queries.map((trace) => trace.readEpoch).filter((epoch): epoch is number => epoch !== null),
  )].sort((a, b) => a - b);

  if (seen.length === 0) {
    return 'None of these reads reported a read epoch, so this page cannot say which '
      + 'version of the store they saw.';
  }

  const reporting = queries.filter((trace) => trace.readEpoch !== null).length;
  const scope = reporting === queries.length
    ? `All ${count(queries.length, 'read')}`
    : `${reporting} of the ${count(queries.length, 'read')}`;

  const observed = seen.length === 1
    ? `${scope} observed epoch ${seen[0]}.`
    : `${scope} observed epochs ${series(seen)}.`;

  return `${observed} That is what they reported, not a guarantee the store `
    + 'makes: nothing was writing while this page was assembled. A page built from '
    + 'several round trips can straddle a write, and this line is where that would show.';
}

const NO_READS = 'This answer took no round trips, which should not be possible and is '
  + 'printed rather than hidden.';

/**
 * Why the round trips add up to more than the answer took.
 *
 * Reads that do not depend on each other are issued together, so on any question
 * with a fan out the sum of the reads is larger than the wall clock. A reader
 * adds two numbers on this panel before reading a word of it, and an arithmetic
 * result that looks like a mistake is worth one sentence.
 */
const OVERLAP = 'The reads add up to more than the wall clock because the ones that do '
  + 'not depend on each other are issued together.';

function cost(answer: Answer, rows: number, total: number): Html {
  // Compared at the resolution both numbers are printed to. Two figures that
  // land on the same tenth must not carry a sentence between them saying one
  // is larger than the other.
  const overlapped = roundMs(total) > roundMs(answer.ms);
  return html`<p class="prose">${count(answer.queries.length, 'read')}, ${count(rows, 'row')},
${ms(total)} inside the client and ${ms(answer.ms)} end to end.
${overlapped ? OVERLAP : null} ${epochs(answer.queries)}</p>`;
}

export function proofPanel(answer: Answer, node: NodeIdentity): Html {
  const { queries } = answer;
  const total = queries.reduce((sum, trace) => sum + trace.ms, 0);
  const rows = queries.reduce((sum, trace) => sum + trace.rows, 0);

  const body = [
    html`<p class="prose">Everything above came out of these reads. They are printed
whole, parameters and all, so the cost of this page is a measurement you can
repeat rather than a number it asks you to believe.</p>`,
    html`<p class="params">namespace <b>${node.namespace}</b> · graph <b>${node.graph}</b>
· cell <b>${node.cell}</b></p>`,
    html`<p class="params">tested against HydraDB <b>${TESTED_AGAINST.tag}</b> at commit
<b>${TESTED_AGAINST.commit}</b>, which is the build this was written against rather
than a version read from the node</p>`,
    queries.length === 0
      ? html`<p class="nothing">${NO_READS}</p>`
      : queries.map((trace, index) => read(trace, index)),
    queries.length === 0 ? null : cost(answer, rows, total),
  ];

  return panel({ index: 4, label: 'Proof', heading: 'What was actually run', body });
}
