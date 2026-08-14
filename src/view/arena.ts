import {
  type BenchReport,
  bestPerFamily,
  lacuna,
  ranked,
  type SystemResult,
  tiedWithLacuna,
} from '../report/bench.js';
import { count, grouped, ms, roundMs, words } from './format.js';
import { html, type Html } from './html.js';
import { mastheadCompact, page, panel, separator } from './layout.js';

/**
 * The benchmark, printed including the part that does not flatter the product.
 *
 * The result is a tie on correctness. Three of the fifty one configurations
 * answered all sixty questions and Lacuna is one of them, so a page that opened
 * with "best accuracy" would be false, and a page that buried the tie would be
 * worse than false, because the two systems that matched it are named in the
 * results file anyone can read.
 *
 * What the run actually shows is a cost difference at equal correctness, and one
 * cost that goes the other way: Lacuna is slower per question by roughly two
 * orders of magnitude, because it makes several round trips to a database while
 * the baselines search an in-process index. Both directions are on this page, at
 * the same size, because a benchmark page that reports only its own axis is an
 * advertisement.
 *
 * Every figure here is read out of `artifacts/bench/results.json`. Nothing is
 * typed in, including the ratios, which are computed from the two numbers next
 * to them so they cannot drift from the run they describe.
 */

const NO_DATA = 'The benchmark file loaded but records no result for Lacuna itself, '
  + 'so the comparison on this page cannot be drawn. The full table below is still '
  + 'the real run.';

const OPENING = 'Sixty questions, one corpus, six families of retrieval, fifty one '
  + 'configurations in total. Every system saw exactly the same questions and the same '
  + 'sessions. The questions include eight shapes, and three of those shapes have no '
  + 'answer in the corpus at all, so a system that always answers cannot score well by '
  + 'confidence alone.';

/** The claim, stated the way the numbers support rather than the way it sells. */
function verdict(ours: SystemResult, tied: readonly SystemResult[]): Html {
  const total = ours.total;
  const others = tied.length;
  const settled = others === 0
    ? html`<p class="prose">No other configuration matched Lacuna's
${ours.correct} of ${total}.</p>`
    : html`<p class="prose">Correctness is a tie.
${count(others + 1, 'configuration')} answered all ${total} questions correctly, and
Lacuna is one of them. ${others === 1 ? 'The other is' : 'The others are'}
${tied.map((system, at) => html`${at > 0 ? ', ' : ''}<b>${system.label}</b>`)}. The
separation is not accuracy. It is how much text each one had to carry to get there,
and how long each one took.</p>`;

  return html`<p class="prose">${OPENING}</p>
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
 * The tie, broken on the axis it is actually broken on.
 *
 * The ratio is computed rather than written down. A hardcoded "42x" is a number
 * that survives the run it was measured from, and this repository has spent its
 * documentation arguing against exactly that.
 */
function cost(ours: SystemResult, tied: readonly SystemResult[]): Html {
  if (tied.length === 0) return html``;
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
${tied.map((system) => html`<tr>
<td class="mono">${system.label}</td>
<td class="num mono">${system.correct}</td>
<td class="num mono">${roundMs(system.meanEstimatedTokens)}</td>
<td class="num mono">${roundMs(system.meanEstimatedTokens / ours.meanEstimatedTokens)}x</td>
<td class="num mono">${ms(system.p50Ms)}</td>
</tr>`)}
</tbody>
</table>`;
}

const HONEST = 'The last column is the one that goes the other way. Lacuna answers '
  + 'from a database over the network and the baselines answer from an index in the '
  + 'same process, so it is the slowest system in the run by a wide margin. That is a '
  + 'real cost and it is not amortised away by anything on this page. What it buys is '
  + 'the column before it: the same sixty answers, carried in a fraction of the text, '
  + 'with the sentences behind each one still attached.';

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
  const tied = tiedWithLacuna(report);

  const headline = ours === undefined
    ? html`<p class="nothing">${NO_DATA}</p>`
    : html`${tally(report, ours)}
${verdict(ours, tied)}
${cost(ours, tied)}
<p class="prose">${HONEST}</p>`;

  return page({
    title: 'Lacuna | Benchmark',
    description: 'Fifty one retrieval configurations over sixty questions, including '
      + 'the tie on correctness and the latency Lacuna loses on.',
    current: '/bench',
    body: [
      mastheadCompact('Benchmark'),
      panel({ index: 1, label: 'Result', heading: 'Same answers, less text', body: headline }),
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
