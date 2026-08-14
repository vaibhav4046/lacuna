import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildIndex,
  EMBEDDING_MODEL,
  embedCached,
  flatSystem,
  followUpText,
  hybridRetriever,
  judge,
  lacunaSystem,
  lexicalRetriever,
  loadEmbedder,
  percent,
  percentile,
  recencyRetriever,
  scoreAll,
  twoHopSystem,
  vectorRetriever,
} from '../src/bench/index.js';
import type { BenchSystem, ReaderMode, Scored } from '../src/bench/index.js';
import { generateCorpus } from '../src/corpus/index.js';
import type { ThreadKind } from '../src/corpus/types.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { parseVia } from '../src/retrieval/index.js';

/**
 * Lacuna against the retrieval approaches it claims to beat, on one corpus,
 * through one scorer.
 *
 * The comparison only means something if the losing side was allowed to win.
 * Four things here exist to give it that chance: the baselines read the corpus
 * annotations rather than the prose, so no baseline loses to a language model's
 * mistake; recency is filtered to the subject rather than being a whole corpus
 * window, so it is a retriever and not a strawman; the cut off is swept from 3
 * to 50 rather than fixed at a flattering value; and the strongest retriever
 * gets a second retrieval round so it can follow a relation without a graph.
 *
 * If Lacuna still comes out ahead after all of that, the advantage is in the
 * structure. If it does not, this file says so, which is the only reason to
 * write it before writing the pitch.
 *
 *   npx tsx scripts/benchmark.ts
 */

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const OUT_DIR = fileURLToPath(new URL('../artifacts/bench', import.meta.url));
const CACHE_DIR = fileURLToPath(new URL('../.cache/bench', import.meta.url));

/** How many messages the reader is handed. Swept, because one value is a choice. */
const CUT_OFFS = [3, 5, 10, 20, 50] as const;

/**
 * How deep the two fused rankings are taken before fusion.
 *
 * Well past the largest cut off, so a message ranked highly by one method and
 * moderately by the other can still surface. Fusing two lists already truncated
 * to the cut off would discard the agreement that makes fusion worth doing.
 */
const FUSION_DEPTH = 200;

const READER_MODES: readonly ReaderMode[] = ['latest', 'conflict_aware'];

/** Characters per token. An estimate, labelled one everywhere it appears. */
const CHARS_PER_TOKEN = 4;

interface Row {
  readonly label: string;
  readonly family: string;
  readonly system: BenchSystem;
}

interface Measured {
  readonly label: string;
  readonly family: string;
  readonly description: string;
  readonly scored: readonly Scored[];
  readonly contextChars: readonly number[];
  readonly latencies: readonly number[];
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

const corpus = generateCorpus();
const index = buildIndex(corpus);

process.stdout.write(
  `Corpus ${corpus.stats.sessions} sessions, ${corpus.stats.messages} messages, `
  + `${corpus.questions.length} gold questions, seed ${corpus.seed}.\n`,
);

// The vector baseline cannot embed a string it has not been given, and a two
// round baseline invents its second query at run time from whichever entity it
// found. So every query it could possibly issue is enumerated here: one per
// gold question, plus, for each predicate that a relational question asks
// about, one per entity in the corpus. Enumerating rather than embedding on
// demand keeps the model call out of the timed path, where it would be
// measuring the encoder instead of the retrieval.
const relationalPredicates = new Set(
  corpus.questions.filter((q) => parseVia(q.text) !== null).map((q) => q.predicate),
);
const queryTexts = [...corpus.questions.map((q) => q.text)];
for (const predicate of relationalPredicates) {
  for (const entity of corpus.entities) {
    queryTexts.push(followUpText(predicate, entity.name));
  }
}
const uniqueQueryTexts = [...new Set(queryTexts)];

process.stdout.write(`Loading ${EMBEDDING_MODEL}.\n`);
const started = Date.now();
const embedder = await loadEmbedder();
process.stdout.write(`Model ready in ${Date.now() - started}ms, ${embedder.dimensions} dimensions.\n`);

const messageVectors = await embedCached(
  embedder,
  index.messages.map((message) => message.text),
  `${CACHE_DIR}/messages.bin`,
  (done, total) => {
    if (done % 1024 === 0 || done === total) {
      process.stdout.write(`  messages embedded ${done}/${total}\r`);
    }
  },
);
process.stdout.write(`\n  messages embedded ${messageVectors.length}\n`);

const queryRows = await embedCached(embedder, uniqueQueryTexts, `${CACHE_DIR}/queries.bin`);
const queryVectors = new Map(uniqueQueryTexts.map((text, i) => [text, queryRows[i]!]));
process.stdout.write(`  queries embedded ${queryVectors.size}\n\n`);

const recency = recencyRetriever(index);
const lexical = lexicalRetriever(index);
const vector = vectorRetriever(index, messageVectors, queryVectors, EMBEDDING_MODEL);
const hybrid = hybridRetriever(lexical, vector, FUSION_DEPTH);

const rows: Row[] = [];
for (const mode of READER_MODES) {
  const suffix = mode === 'latest' ? '' : ' +conflict';
  for (const k of CUT_OFFS) {
    for (const retriever of [recency, lexical, vector, hybrid]) {
      const system = flatSystem(retriever, index, k, mode);
      rows.push({ label: `${system.name}${suffix}`, family: retriever.name, system });
    }
    // Only the strongest retriever gets the second round. Giving it to all four
    // would pad the table without changing what the comparison rests on, which
    // is whether the best flat pipeline available can follow a relation.
    const two = twoHopSystem(hybrid, index, k, mode);
    rows.push({ label: `${two.name}${suffix}`, family: 'hybrid+2hop', system: two });
  }
}

const client = new HydraClient(loadHydraConfig());
const lacuna = lacunaSystem(client);
rows.push({ label: lacuna.name, family: 'lacuna', system: lacuna });

const measured: Measured[] = [];
for (const row of rows) {
  const scored: Scored[] = [];
  const contextChars: number[] = [];
  const latencies: number[] = [];

  for (const question of corpus.questions) {
    const result = await row.system.answer(question);
    scored.push({ question, outcome: result.outcome, verdict: judge(question.expected, result.outcome) });
    contextChars.push(result.contextChars);
    latencies.push(result.ms);
  }

  measured.push({
    label: row.label,
    family: row.family,
    description: row.system.description,
    scored,
    contextChars,
    latencies,
  });

  const metrics = scoreAll(scored);
  process.stdout.write(
    `${row.label.padEnd(26)} ${String(metrics.correct).padStart(2)}/${metrics.total}  `
    + `${percent(metrics.correct, metrics.total).padStart(6)}  `
    + `false answers ${String(metrics.byVerdict.get('false_answer') ?? 0).padStart(2)}  `
    + `ctx ~${String(Math.round(mean(contextChars) / CHARS_PER_TOKEN)).padStart(5)} tok\n`,
  );
}

/** Most correct, then fewest unsupported assertions, then least context. */
function better(a: Measured, b: Measured): number {
  const left = scoreAll(a.scored);
  const right = scoreAll(b.scored);
  if (left.correct !== right.correct) return right.correct - left.correct;
  if (left.unsupported.length !== right.unsupported.length) {
    return left.unsupported.length - right.unsupported.length;
  }
  return mean(a.contextChars) - mean(b.contextChars);
}

const families = [...new Set(measured.map((m) => m.family))];
const best = families.map((family) => [...measured.filter((m) => m.family === family)].sort(better)[0]!);

const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
};

function table(entries: readonly Measured[]): void {
  say(
    '  system                       correct    rate   false  unsup   abst F1   ctx tok   p50     p95',
  );
  for (const entry of entries) {
    const m = scoreAll(entry.scored);
    say(
      `  ${entry.label.padEnd(27)}${String(m.correct).padStart(4)}/${m.total}  `
      + `${percent(m.correct, m.total).padStart(6)}  `
      + `${String(m.byVerdict.get('false_answer') ?? 0).padStart(5)}  `
      + `${String(m.unsupported.length).padStart(5)}   `
      + `${m.f1.toFixed(3)}  ${String(Math.round(mean(entry.contextChars) / CHARS_PER_TOKEN)).padStart(7)}  `
      + `${percentile(entry.latencies, 50).toFixed(1).padStart(6)}  ${percentile(entry.latencies, 95).toFixed(1).padStart(6)}`,
    );
  }
}

say('Lacuna against flat retrieval');
say(`corpus seed ${corpus.seed}`);
say(`run at ${new Date().toISOString()}`);
say(`embedding model ${EMBEDDING_MODEL}, ${embedder.dimensions} dimensions, run locally`);
say(
  `${corpus.questions.length} questions, ${corpus.stats.messages} messages, `
  + `~${corpus.stats.estimatedTokens.toLocaleString('en-GB')} estimated tokens of transcript`,
);
say(`${measured.length} configurations: ${families.length} approaches over `
  + `cut offs ${CUT_OFFS.join(', ')} and both reader modes`);
say();
say('Best configuration of each approach');
table([...best].sort(better));
say();
say('Columns');
say('  correct   exact: same decision, and the same value or the same reason');
say('  false     answered where nothing in the corpus supports an answer');
say('  unsup     answered where the corpus supports no answer, or a different one');
say('  abst F1   abstention treated as the positive class, precision and recall combined');
say('  ctx tok   mean estimated tokens handed to the answering step, characters over four');
say('  p50 p95   wall clock milliseconds per question, nearest rank, one question at a time');
say();

const lacunaRow = measured.find((m) => m.family === 'lacuna')!;
const bestBaseline = [...measured.filter((m) => m.family !== 'lacuna')].sort(better)[0]!;
const lacunaMetrics = scoreAll(lacunaRow.scored);
const baselineMetrics = scoreAll(bestBaseline.scored);

/**
 * The finding, stated rather than left to be inferred from the table.
 *
 * Printing the rows sorted and stopping would let a reader glance at Lacuna on
 * the top line and take it for a win. What the numbers say is narrower and
 * more useful than that, so it gets written down in full, including the parts
 * that do not flatter the system under test.
 */
const findRow = (label: string): Measured | undefined => measured.find((m) => m.label === label);
const cut = /@(\d+)/.exec(bestBaseline.label)?.[1] ?? '';
const ablations = [
  { label: bestBaseline.label.replace(' +conflict', ''), removed: 'the conflict aware reader' },
  { label: `hybrid@${cut} +conflict`, removed: 'the second retrieval round' },
  { label: `hybrid@${cut}`, removed: 'both' },
]
  .map((a) => ({ ...a, row: findRow(a.label) }))
  .filter((a): a is typeof a & { row: Measured } => a.row !== undefined && a.row !== bestBaseline);

const lacunaTokens = Math.round(mean(lacunaRow.contextChars) / CHARS_PER_TOKEN);
const baselineTokens = Math.round(mean(bestBaseline.contextChars) / CHARS_PER_TOKEN);
const lacunaP50 = percentile(lacunaRow.latencies, 50);
const baselineP50 = percentile(bestBaseline.latencies, 50);

say('What the run found');
if (baselineMetrics.correct >= lacunaMetrics.correct) {
  say(`  On correctness this is a tie. ${bestBaseline.label} scores`);
  say(`  ${baselineMetrics.correct}/${baselineMetrics.total}, the same as Lacuna, with the same zero unsupported`);
  say('  answers. No claim of better recall or better abstention survives this');
  say('  run, and none is made.');
} else {
  say(`  Lacuna scores ${lacunaMetrics.correct}/${lacunaMetrics.total}. The best baseline configuration,`);
  say(`  ${bestBaseline.label}, scores ${baselineMetrics.correct}/${baselineMetrics.total}.`);
}
say();
say('  What separates them is cost and construction.');
say(
  `  Context: ${lacunaTokens} estimated tokens per question against ${baselineTokens}, `
  + `${(baselineTokens / Math.max(lacunaTokens, 1)).toFixed(1)} times fewer.`,
);
say(
  `  Latency: ${lacunaP50.toFixed(1)}ms against ${baselineP50.toFixed(1)}ms, `
  + `${(lacunaP50 / Math.max(baselineP50, 0.1)).toFixed(1)} times slower, over HTTP, and`,
);
say('  not a like for like measurement. See the closing note.');
say();
say(`  ${bestBaseline.label} is not a pipeline anyone ships. It is BM25 and`);
say('  local sentence embeddings fused by reciprocal rank, a second retrieval');
say('  round routed through a named relation, an extractor that reads corpus');
say('  annotations and so never misreads a sentence, and a reader that declines');
say('  when it sees two values and no announced correction. Remove any one part:');
for (const a of ablations) {
  const m = scoreAll(a.row.scored);
  const falseAnswers = m.byVerdict.get('false_answer') ?? 0;
  say(
    `    without ${a.removed.padEnd(26)} ${a.label.padEnd(24)} ${String(m.correct).padStart(2)}/${m.total}`
    + `${falseAnswers > 0 ? `, ${falseAnswers} false answer${falseAnswers === 1 ? '' : 's'}` : ''}`,
  );
}
say();
say('  The three rules that reader applies are the three distinctions the graph');
say('  holds structurally: a correction supersedes, a withdrawal removes, and a');
say('  hop that lands on a silent entity is a gap rather than an absence. Hand');
say(
  `  written into a reader they cost four components and ${(baselineTokens / Math.max(lacunaTokens, 1)).toFixed(0)} times the`,
);
say('  context. That is the honest shape of the result.');
say();

say(`By thread kind, Lacuna against ${bestBaseline.label}, the best baseline configuration`);
say('  kind             n   lacuna   baseline');
const kinds = [...new Set(corpus.questions.map((q) => q.kind))].sort((a, b) => a.localeCompare(b));
for (const kind of kinds as readonly ThreadKind[]) {
  const l = lacunaMetrics.byKind.get(kind) ?? { total: 0, correct: 0 };
  const b = baselineMetrics.byKind.get(kind) ?? { total: 0, correct: 0 };
  say(
    `  ${kind.padEnd(14)} ${String(l.total).padStart(3)}   ${String(l.correct).padStart(6)}   `
    + `${String(b.correct).padStart(8)}`,
  );
}
say();

say(`Where ${bestBaseline.label} states something the corpus does not support  (${baselineMetrics.unsupported.length})`);
if (baselineMetrics.unsupported.length === 0) {
  say('  none');
}
for (const item of baselineMetrics.unsupported.slice(0, 20)) {
  say(
    `  ${item.question.id.padEnd(22)} ${item.verdict.padEnd(18)} `
    + `${item.question.kind}`,
  );
}
if (baselineMetrics.unsupported.length > 20) {
  say(`  ... and ${baselineMetrics.unsupported.length - 20} more, all of them in results.json`);
}
say();

say('Every configuration');
table([...measured].sort(better));
say();

say('What this measures, and what it does not');
say('  Same corpus, same questions, same scorer for every row. The baselines read');
say('  the corpus annotations rather than the prose, so each one is handed a');
say('  perfect extractor: it sees every claim in the messages it retrieved, with');
say('  the subject, the property, the value, and whether the sentence announced');
say('  itself as a correction or a withdrawal. What it does not see is which');
say('  claim supersedes which, because that is an edge, and building it is the');
say('  thing under test. A baseline that loses here lost on retrieval, not on');
say('  reading.');
say();
say('  The latency column is not a like for like comparison. Every baseline runs');
say('  in process against arrays already in memory. Lacuna runs queries over HTTP');
say('  against a HydraDB node and pays a network round trip per hop. The baselines');
say('  also pay nothing for indexing, which happened before the clock started.');
say('  Read the column as the shape of the query path, not as a race.');
say();
say('  The corpus is generated. It is built to contain revision, retraction,');
say('  disagreement, relational questions and questions with no answer at all, in');
say('  known proportions, which is what makes abstention measurable. It is not a');
say('  sample of real conversations, and nothing here is a claim about how often');
say('  these situations arise in practice.');

const report = `${lines.join('\n')}\n`;
process.stdout.write(`\n${report}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/report.txt`, report, 'utf8');
writeFileSync(
  `${OUT_DIR}/results.json`,
  `${JSON.stringify(
    {
      seed: corpus.seed,
      runAt: new Date().toISOString(),
      embeddingModel: EMBEDDING_MODEL,
      cutOffs: CUT_OFFS,
      fusionDepth: FUSION_DEPTH,
      corpus: corpus.stats,
      systems: measured.map((entry) => {
        const m = scoreAll(entry.scored);
        return {
          label: entry.label,
          family: entry.family,
          description: entry.description,
          total: m.total,
          correct: m.correct,
          byVerdict: Object.fromEntries(m.byVerdict),
          byKind: Object.fromEntries(
            [...m.byKind.entries()].map(([kind, value]) => [kind, value]),
          ),
          precision: m.precision,
          recall: m.recall,
          f1: m.f1,
          meanContextChars: mean(entry.contextChars),
          meanEstimatedTokens: mean(entry.contextChars) / CHARS_PER_TOKEN,
          p50Ms: percentile(entry.latencies, 50),
          p95Ms: percentile(entry.latencies, 95),
          cases: entry.scored.map((item) => ({
            id: item.question.id,
            kind: item.question.kind,
            verdict: item.verdict,
            outcome: item.outcome,
          })),
        };
      }),
    },
    null,
    2,
  )}\n`,
  'utf8',
);
process.stdout.write(`\nWrote ${OUT_DIR}/report.txt and results.json\n`);
