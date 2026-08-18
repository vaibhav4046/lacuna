import {
  type BenchReport,
  bestPerFamily,
  closestRivals,
  lacuna,
  ranked,
  type SystemResult,
} from '../report/bench.js';
import { count, grouped, ms, roundMs, words } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

/**
 * The benchmark, printed including the part that does not flatter the product.
 *
 * Which way the headline reads is decided by the file rather than by whoever
 * last edited this page. When the best baseline matches Lacuna's score the page
 * says so and argues on cost; when Lacuna is ahead it says by how many questions
 * and names the configuration it is ahead of. Both sentences are written here,
 * and the run picks between them, because the earlier version of this file had
 * the tie written into its prose as a fact and a re-measured corpus turned its
 * first paragraph into a lie.
 *
 * There is also one cost that goes the other way: Lacuna is slower per question
 * by roughly two orders of magnitude, because it makes several round trips to a
 * database while the baselines search an in-process index. Both directions are
 * on this page, at the same size, because a benchmark page that reports only its
 * own axis is an advertisement.
 *
 * Every figure here is read out of `artifacts/bench/results.json`. Nothing is
 * typed in, including the ratios, which are computed from the two numbers next
 * to them so they cannot drift from the run they describe.
 */

const NO_DATA = 'The benchmark file loaded but records no result for Lacuna itself, '
  + 'so the comparison on this page cannot be drawn. The full table below is still '
  + 'the real run.';

/**
 * The framing sentence, counted off the run rather than written down.
 *
 * Every number in it comes out of the file, including how many families were
 * tried, so the paragraph cannot outlive the sweep it describes. The shapes with
 * no answer are named as a group rather than counted, because their count is a
 * fact about the corpus and this page is only holding the benchmark.
 */
function opening(report: BenchReport, ours: SystemResult): string {
  const families = new Set(report.systems.map((system) => system.family)).size;
  return `${count(ours.total, 'question')}, one corpus, `
    + `${count(families, 'family', 'families')} of retrieval, `
    + `${count(report.systems.length, 'configuration')} in total. Every system saw `
    + 'exactly the same questions and the same sessions. The questions come in '
    + `${count(ours.kinds.length, 'shape')}, and the shapes that have no answer in the `
    + 'corpus at all mean a system which always answers cannot score well by confidence '
    + 'alone.';
}

/** The claim, stated the way the numbers support rather than the way it sells. */
function verdict(report: BenchReport, ours: SystemResult, rivals: readonly SystemResult[]): Html {
  const total = ours.total;
  const best = rivals[0];
  const named = rivals.map((system, at) => html`${at > 0 ? ', ' : ''}<b>${system.label}</b>`);

  let settled: Html;
  if (best === undefined) {
    settled = html`<p class="prose">Lacuna is the only system in this run, so there is
nothing here to compare it against.</p>`;
  } else if (best.correct === ours.correct) {
    settled = html`<p class="prose">Correctness is a tie.
${count(rivals.length + 1, 'configuration')} answered all ${total} questions correctly, and
Lacuna is one of them. ${rivals.length === 1 ? 'The other is' : 'The others are'}
${named}. The separation is not accuracy. It is how much text each one had to carry to
get there, and how long each one took.</p>`;
  } else {
    settled = html`<p class="prose">Lacuna answered ${ours.correct} of ${total}, and no
other configuration did. The best of the rest scored ${best.correct}:
${named}. ${count(ours.correct - best.correct, 'question')} is a narrow lead and it is not
the whole result. The rest is how much text each one had to carry to get there, and how
long each one took.</p>`;
  }

  return html`<p class="prose">${opening(report, ours)}</p>
${settled}`;
}

function tally(report: BenchReport, ours: SystemResult): Html {
  return html`<div class="tally">
<div><b>${ours.correct}/${ours.total}</b><span>Lacuna correct</span></div>
<div class="mark"><b>${roundMs(ours.meanEstimatedTokens)}</b><span>mean tokens of context</span></div>
<div><b>${grouped(report.systems.length)}</b><span>configurations run</span></div>
<div><b>${ms(ours.p50Ms)}</b><span>median, and the slowest here</span></div>
</div>`;
}

/**
 * The comparison, drawn on the axis it is actually decided on.
 *
 * The ratio is computed rather than written down. A hardcoded "42x" is a number
 * that survives the run it was measured from, and this repository has spent its
 * documentation arguing against exactly that.
 */
function cost(ours: SystemResult, rivals: readonly SystemResult[]): Html {
  if (rivals.length === 0) return html``;
  return html`<table>
<thead><tr>
<th>System</th><th class="num">Correct</th><th class="num">Mean tokens</th>
<th class="num">Against Lacuna</th><th class="num">Median</th>
</tr></thead>
<tbody>
<tr class="ours">
<td class="mono">${ours.label}</td>
<td class="num mono">${ours.correct}</td>
<td class="num mono">${roundMs(ours.meanEstimatedTokens)}</td>
<td class="num mono">1.0x</td>
<td class="num mono">${ms(ours.p50Ms)}</td>
</tr>
${rivals.map((system) => html`<tr>
<td class="mono">${system.label}</td>
<td class="num mono">${system.correct}</td>
<td class="num mono">${roundMs(system.meanEstimatedTokens)}</td>
<td class="num mono">${roundMs(system.meanEstimatedTokens / ours.meanEstimatedTokens)}x</td>
<td class="num mono">${ms(system.p50Ms)}</td>
</tr>`)}
</tbody>
</table>`;
}

/**
 * The cost that goes the other way, which stays on the page at the same size.
 *
 * The closing clause used to say "the same sixty answers", and a corpus that
 * grew to sixty-four made it false without touching this file. What the latency
 * buys is now whichever of the two things the run supports: the same score for
 * less text, or a better score for less text.
 */
function honest(ours: SystemResult, rivals: readonly SystemResult[]): string {
  const best = rivals[0];
  const bought = best !== undefined && best.correct === ours.correct
    ? `the same ${count(ours.correct, 'answer')}`
    : 'a score no other configuration in the run reached';
  return 'The last column is the one that goes the other way. Lacuna answers '
    + 'from a database over the network and the baselines answer from an index in the '
    + 'same process, so it is the slowest system in the run by a wide margin. That is a '
    + 'real cost and it is not amortised away by anything on this page. What it buys is '
    + `the column before it: ${bought}, carried in a fraction of the text, `
    + 'with the sentences behind each one still attached.';
}

/** Why an unconnected or never stated question is where the families separate. */
const KINDS = 'A per kind table is where a headline score stops hiding things. The '
  + 'three shapes with no answer in the corpus are the ones a similarity retriever '
  + 'cannot decline, because there is always a nearest passage and nothing in a '
  + 'distance says the fact was never settled.';

function kindMatrix(report: BenchReport): Html {
  const rows = bestPerFamily(report);
  const first = rows[0];
  if (first === undefined) return html`<p class="nothing">No systems to compare.</p>`;
  const kinds = first.kinds;

  return html`<p class="prose">${KINDS}</p>
<div class="scroll"><table>
<thead><tr>
<th>Best of family</th>${kinds.map((kind) => html`<th class="num">${words(kind.kind)}</th>`)}
</tr></thead>
<tbody>${rows.map((system) => html`<tr${system.family === 'lacuna' ? html` class="ours"` : null}>
<td class="mono">${system.label}</td>
${system.kinds.map((kind) => html`<td class="num mono">${kind.correct}/${kind.total}</td>`)}
</tr>`)}</tbody>
</table></div>
<p class="caption">One row per family, each family's best scoring configuration.
Cells are correct over asked.</p>`;
}

const FULL = 'Every configuration in the run, best first, and among equal scores the '
  + 'one that carried less text first. False answers are questions the corpus does not '
  + 'settle that the system answered anyway. Missed answers are the opposite, questions '
  + 'it declined that the corpus does settle.';

function fullTable(report: BenchReport): Html {
  return html`<p class="prose">${FULL}</p>
<div class="scroll"><table>
<thead><tr>
<th>System</th><th>Family</th><th class="num">Correct</th>
<th class="num">False</th><th class="num">Missed</th>
<th class="num">Tokens</th><th class="num">Median</th>
</tr></thead>
<tbody>${ranked(report).map((system) => html`<tr${system.family === 'lacuna' ? html` class="ours"` : null}>
<td class="mono">${system.label}</td>
<td class="mono">${system.family}</td>
<td class="num mono">${system.correct}</td>
<td class="num mono">${system.verdicts.falseAnswer}</td>
<td class="num mono">${system.verdicts.missedAnswer}</td>
<td class="num mono">${roundMs(system.meanEstimatedTokens)}</td>
<td class="num mono">${ms(system.p50Ms)}</td>
</tr>`)}</tbody>
</table></div>`;
}

const METHOD = 'The corpus is generated from a seed and the questions are generated '
  + 'with it, so the whole run rebuilds from one command on another machine. The token '
  + 'figures are characters divided by four throughout, for every system equally; no '
  + 'tokenizer was run. Latency was measured on one laptop against a database in WSL2, '
  + 'which makes it a comparison between these systems on that machine and not a '
  + 'published throughput number.';

function method(report: BenchReport): Html {
  return html`<p class="prose">${METHOD}</p>
<p class="params">seed <b>${report.seed}</b> · run at <b>${report.runAt}</b>
· embeddings <b>${report.embeddingModel}</b> · fusion depth <b>${report.fusionDepth}</b>
· cut-offs <b>${report.cutOffs.join(', ')}</b></p>
<p class="params">sessions <b>${grouped(report.corpus.sessions)}</b>
· messages <b>${grouped(report.corpus.messages)}</b>
· claims <b>${grouped(report.corpus.claims)}</b>
· characters <b>${grouped(report.corpus.characters)}</b>
· estimated tokens <b>${grouped(report.corpus.estimatedTokens)}</b></p>
<p class="prose">Reproduce it with <code>npm run bench</code>. The file this page reads
is <code>artifacts/bench/results.json</code>, committed, including the per question
record that this page does not show.</p>`;
}

export function arenaPage(report: BenchReport): string {
  const ours = lacuna(report);
  const rivals = closestRivals(report);
  const tie = ours !== undefined && rivals[0]?.correct === ours.correct;

  const headline = ours === undefined
    ? html`<p class="nothing">${NO_DATA}</p>`
    : html`${tally(report, ours)}
${verdict(report, ours, rivals)}
${cost(ours, rivals)}
<p class="prose">${honest(ours, rivals)}</p>`;

  return page({
    title: 'Lacuna | Benchmark',
    description: 'Every retrieval configuration in the run, the context each one '
      + 'carried, and the latency Lacuna loses on.',
    current: '/bench',
    body: [
      mastheadCompact('Benchmark'),
      panel({
        index: 1,
        label: 'Result',
        heading: tie ? 'Same answers, less text' : 'A better score on less text',
        body: headline,
      }),
      separator(),
      panel({ index: 2, label: 'Kinds', heading: 'Where the families come apart', body: kindMatrix(report) }),
      separator(),
      panel({ index: 3, label: 'Table', heading: 'Every configuration in the run', body: fullTable(report) }),
      separator(),
      panel({ index: 4, label: 'Method', heading: 'How the run was set up', body: method(report) }),
    ],
    note: html`Figures read from the committed run at <b>${report.runAt}</b>.`,
  });
}
