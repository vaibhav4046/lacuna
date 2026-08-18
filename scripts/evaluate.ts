import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describeExpected, describeOutcome, judge, percent, percentile, scoreAll } from '../src/bench/score.js';
import type { Scored, Verdict } from '../src/bench/score.js';
import type { BenchOutcome } from '../src/bench/types.js';
import { generateCorpus } from '../src/corpus/index.js';
import type { GoldQuestion } from '../src/corpus/types.js';
import { NodeSource } from '../src/hydra/node-source.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import {
  affectedText,
  ask,
  blastRadius,
  buildPackageName,
  buildQuestion,
  parseBlast,
  parseVia,
} from '../src/retrieval/index.js';

/**
 * Runs every gold question against the live graph and reports what happened.
 *
 * The number that matters here is not accuracy. A system that answers
 * everything confidently can score well on the questions that have answers and
 * still be useless, because the cost of a confident wrong answer is not the
 * same as the cost of a missing one. So this reports the confusion in both
 * directions and names the false answer rate separately: how often the system
 * stated something the corpus does not support.
 *
 * What counts as correct is defined in src/bench/score.ts, and the comparison
 * against other retrieval approaches scores through the same file. A headline
 * number and a comparison judged by two different rules would be two numbers
 * nobody should put in the same sentence.
 *
 * Questions run one at a time. Running them concurrently would finish sooner
 * and would make every latency number a measurement of contention instead of
 * of the query path.
 *
 *   npx tsx scripts/evaluate.ts
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

const OUT_DIR = fileURLToPath(new URL('../artifacts/eval', import.meta.url));

interface Case {
  readonly question: GoldQuestion;
  readonly verdict: Verdict;
  readonly expected: string;
  readonly actual: string;
  /**
   * The bench shape rather than the resolver's, because a blast radius answers
   * with a set of names and has no single claim to point at.
   */
  readonly outcome: BenchOutcome;
  /** What was put to the graph, which is not always the prose that was asked. */
  readonly subject: string;
  readonly predicate: string;
  readonly via: string | null;
  readonly explanation: string;
  readonly trace: readonly string[];
  readonly citations: number;
  readonly ms: number;
  readonly queries: number;
}

/** A case before it has been judged: everything the run itself produced. */
type Run = Omit<Case, 'question' | 'verdict' | 'expected' | 'actual'>;

const corpus = generateCorpus();
const client = new HydraClient(loadHydraConfig());
const source = new NodeSource(client);
const cases: Case[] = [];

async function runAsk(question: GoldQuestion): Promise<Run> {
  const built = buildQuestion(question.subject, question.predicate, parseVia(question.text));
  const answer = await ask(source, built);
  return {
    outcome: answer.resolution.outcome,
    subject: built.subject,
    predicate: built.predicate,
    via: built.via,
    explanation: answer.resolution.explanation,
    trace: answer.resolution.trace,
    citations: answer.evidence.length,
    ms: answer.ms,
    queries: answer.queries.length,
  };
}

/**
 * A blast radius asks for a closure rather than a value, so it goes through the
 * same call the /blast page makes rather than through ask(). The two answers
 * have different shapes and are flattened here into the one record the report
 * prints from, which is the only reason this script knows there are two.
 *
 * Nothing is recomputed on the way past. The affected set is whatever the walk
 * reached, serialised by the same function the benchmark compares against, and
 * the closing line of the traversal's own trace stands in for the paragraph a
 * resolver would have written.
 */
async function runBlast(question: GoldQuestion, name: string): Promise<Run> {
  const walked = await blastRadius(source, buildPackageName(name));
  const radius = walked.radius;
  return {
    outcome: radius === null
      ? { type: 'abstain', reason: 'out_of_scope' }
      : { type: 'answer', text: affectedText(radius) },
    subject: name,
    predicate: question.predicate,
    via: null,
    explanation: radius === null
      ? `No answer given, because "${name}" is not a name the graph holds.`
      : radius.trace[radius.trace.length - 1]!,
    trace: radius?.trace ?? [],
    citations: walked.evidence.length,
    ms: walked.ms,
    queries: walked.queries.length,
  };
}

process.stdout.write(`Running ${corpus.questions.length} gold questions.\n\n`);

for (const question of corpus.questions) {
  const name = parseBlast(question.text);
  const run = name === null ? await runAsk(question) : await runBlast(question, name);
  const verdict = judge(question.expected, run.outcome);
  cases.push({
    question,
    ...run,
    verdict,
    expected: describeExpected(question),
    actual: describeOutcome(run.outcome),
  });
  process.stdout.write(
    `${verdict === 'correct' ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(22)}`
    + `${String(run.ms).padStart(7)}ms  ${String(run.queries).padStart(2)}q  `
    + `${verdict === 'correct' ? describeOutcome(run.outcome) : `${verdict}: got ${describeOutcome(run.outcome)}, wanted ${describeExpected(question)}`}\n`,
  );
}

const scored: Scored[] = cases.map((c) => ({
  question: c.question,
  outcome: c.outcome,
  verdict: c.verdict,
}));
const metrics = scoreAll(scored);

const latencies = [...cases.map((c) => c.ms)].sort((a, b) => a - b);
const queries = cases.map((c) => c.queries);

const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
};

say('Lacuna retrieval evaluation');
say(`corpus seed ${corpus.seed}`);
say(`run at ${new Date().toISOString()}`);
say();
say(`Questions        ${metrics.total}`);
say(`Exact correct    ${metrics.correct}  (${percent(metrics.correct, metrics.total)})`);
say();
say('By thread kind');
say('  kind            n   correct   rate');
for (const [kind, group] of [...metrics.byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  say(
    `  ${kind.padEnd(14)} ${String(group.total).padStart(2)}   ${String(group.correct).padStart(7)}   `
    + percent(group.correct, group.total),
  );
}
say();
say('Failure shape');
for (const verdict of ['wrong_answer_text', 'false_answer', 'missed_answer', 'wrong_reason'] as const) {
  say(`  ${verdict.padEnd(20)} ${metrics.byVerdict.get(verdict) ?? 0}`);
}
say();
say('Abstention as a decision (positive class: abstained)');
say(`  true positive   ${metrics.truePositive}   abstained, and nothing supported an answer`);
say(`  false positive  ${metrics.falsePositive}   abstained, but an answer was there`);
say(`  false negative  ${metrics.falseNegative}   answered, but nothing supported one`);
say(`  precision       ${metrics.precision.toFixed(3)}`);
say(`  recall          ${metrics.recall.toFixed(3)}`);
say(`  f1              ${metrics.f1.toFixed(3)}`);
say();
say(`Unsupported answers  ${metrics.unsupported.length}  (${percent(metrics.unsupported.length, metrics.total)} of all questions)`);
for (const item of metrics.unsupported) {
  say(`  ${item.question.id}  got ${describeOutcome(item.outcome)}, wanted ${describeExpected(item.question)}`);
}
say();
say('Latency, wall clock per question, one at a time');
say(`  p50   ${percentile(latencies, 50)}ms`);
say(`  p95   ${percentile(latencies, 95)}ms`);
say(`  max   ${latencies[latencies.length - 1]}ms`);
say();
say('Queries per question');
say(`  min   ${Math.min(...queries)}`);
say(`  max   ${Math.max(...queries)}`);
say(`  total ${queries.reduce((a, b) => a + b, 0)}`);
say();
say('What this measures, and what it does not');
say('  The corpus is generated, and the graph is built from the same annotations');
say('  the questions are scored against. A perfect score here says the structure');
say('  survives the round trip: revision, retraction and disagreement are still');
say('  distinguishable after ingestion, and the resolver reads them the way the');
say('  corpus wrote them. It is a correctness check on the pipeline.');
say('  It is not evidence that the approach beats anything, and it is not a');
say('  measurement on real conversations. The comparison against recency,');
say('  lexical, vector and hybrid retrieval runs on this same corpus through');
say('  this same scorer, in scripts/benchmark.ts, and lands in artifacts/bench.');
say('  That is where a claim of advantage has to be earned.');

const report = `${lines.join('\n')}\n`;
process.stdout.write(`\n${report}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/report.txt`, report, 'utf8');
writeFileSync(
  `${OUT_DIR}/cases.json`,
  `${JSON.stringify(
    cases.map((c) => ({
      id: c.question.id,
      kind: c.question.kind,
      text: c.question.text,
      subject: c.subject,
      predicate: c.predicate,
      via: c.via,
      expected: c.expected,
      actual: c.actual,
      verdict: c.verdict,
      explanation: c.explanation,
      trace: c.trace,
      citations: c.citations,
      ms: c.ms,
      queries: c.queries,
    })),
    null,
    2,
  )}\n`,
  'utf8',
);
process.stdout.write(`\nWrote ${OUT_DIR}/report.txt and cases.json\n`);

// A non-zero exit when anything is wrong, so this can gate a build later.
process.exit(metrics.correct === metrics.total ? 0 : 1);
