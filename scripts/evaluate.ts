import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus } from '../src/corpus/index';
import type { GoldQuestion, ThreadKind } from '../src/corpus/types';
import { HydraClient } from '../src/hydra/client';
import { loadHydraConfig } from '../src/hydra/config';
import { ask, buildQuestion, parseVia } from '../src/retrieval/index';
import type { Answer } from '../src/retrieval/index';

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
 * Questions run one at a time. Running them concurrently would finish sooner
 * and would make every latency number a measurement of contention instead of
 * of the query path.
 *
 *   npx tsx scripts/evaluate.ts
 */

process.loadEnvFile(fileURLToPath(new URL('../.env.local', import.meta.url)));

const OUT_DIR = fileURLToPath(new URL('../artifacts/eval', import.meta.url));

/**
 * `correct` is exact: same decision, and for an answer the same text, and for
 * an abstention the same reason. The rest name how it went wrong, because
 * "wrong" covers four failures with very different costs.
 */
type Verdict =
  | 'correct'
  /** Answered, and the corpus agrees an answer exists, but not that one. */
  | 'wrong_answer_text'
  /** Answered where the corpus says nothing supports an answer. The bad one. */
  | 'false_answer'
  /** Abstained where an answer was available. Cautious, and still a miss. */
  | 'missed_answer'
  /** Abstained correctly, for the wrong reason. */
  | 'wrong_reason';

interface Case {
  readonly question: GoldQuestion;
  readonly answer: Answer;
  readonly verdict: Verdict;
  readonly expected: string;
  readonly actual: string;
}

function describeExpected(question: GoldQuestion): string {
  return question.expected.type === 'answer'
    ? `answer "${question.expected.text}"`
    : `abstain ${question.expected.reason}`;
}

function describeActual(answer: Answer): string {
  const { outcome } = answer.resolution;
  return outcome.type === 'answer'
    ? `answer "${outcome.text}"`
    : `abstain ${outcome.reason}`;
}

function judge(question: GoldQuestion, answer: Answer): Verdict {
  const expected = question.expected;
  const actual = answer.resolution.outcome;

  if (expected.type === 'answer') {
    if (actual.type === 'abstain') return 'missed_answer';
    return actual.text === expected.text ? 'correct' : 'wrong_answer_text';
  }
  if (actual.type === 'answer') return 'false_answer';
  return actual.reason === expected.reason ? 'correct' : 'wrong_reason';
}

function percent(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

/** Nearest-rank percentile. No interpolation, so every printed number is a real observation. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

const corpus = generateCorpus();
const client = new HydraClient(loadHydraConfig());
const cases: Case[] = [];

process.stdout.write(`Running ${corpus.questions.length} gold questions.\n\n`);

for (const question of corpus.questions) {
  const built = buildQuestion(question.subject, question.predicate, parseVia(question.text));
  const answer = await ask(client, built);
  const verdict = judge(question, answer);
  cases.push({
    question,
    answer,
    verdict,
    expected: describeExpected(question),
    actual: describeActual(answer),
  });
  process.stdout.write(
    `${verdict === 'correct' ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(22)}`
    + `${String(answer.timing.ms).padStart(7)}ms  ${String(answer.timing.queries).padStart(2)}q  `
    + `${verdict === 'correct' ? describeActual(answer) : `${verdict}: got ${describeActual(answer)}, wanted ${describeExpected(question)}`}\n`,
  );
}

const total = cases.length;
const correct = cases.filter((c) => c.verdict === 'correct').length;

// Binary decision, abstention as the positive class. This is the question the
// product actually poses: did it know when to keep quiet.
const expectedAbstain = cases.filter((c) => c.question.expected.type === 'abstain');
const truePositive = expectedAbstain.filter(
  (c) => c.answer.resolution.outcome.type === 'abstain',
).length;
const falseNegative = expectedAbstain.length - truePositive;
const falsePositive = cases.filter(
  (c) => c.question.expected.type === 'answer' && c.answer.resolution.outcome.type === 'abstain',
).length;
const precision = truePositive + falsePositive === 0 ? 0 : truePositive / (truePositive + falsePositive);
const recall = truePositive + falseNegative === 0 ? 0 : truePositive / (truePositive + falseNegative);
const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

// Every case where the system asserted something the corpus does not support,
// whether it invented an answer or picked the wrong one.
const unsupported = cases.filter(
  (c) => c.verdict === 'false_answer' || c.verdict === 'wrong_answer_text',
);

const latencies = [...cases.map((c) => c.answer.timing.ms)].sort((a, b) => a - b);
const queries = cases.map((c) => c.answer.timing.queries);

const byKind = new Map<ThreadKind, Case[]>();
for (const item of cases) {
  const list = byKind.get(item.question.kind) ?? [];
  list.push(item);
  byKind.set(item.question.kind, list);
}

const lines: string[] = [];
const say = (line = ''): void => {
  lines.push(line);
};

say('Lacuna retrieval evaluation');
say(`corpus seed ${corpus.seed}`);
say(`run at ${new Date().toISOString()}`);
say();
say(`Questions        ${total}`);
say(`Exact correct    ${correct}  (${percent(correct, total)})`);
say();
say('By thread kind');
say('  kind            n   correct   rate');
for (const [kind, group] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const hits = group.filter((c) => c.verdict === 'correct').length;
  say(
    `  ${kind.padEnd(14)} ${String(group.length).padStart(2)}   ${String(hits).padStart(7)}   `
    + percent(hits, group.length),
  );
}
say();
say('Failure shape');
for (const verdict of ['wrong_answer_text', 'false_answer', 'missed_answer', 'wrong_reason'] as const) {
  say(`  ${verdict.padEnd(20)} ${cases.filter((c) => c.verdict === verdict).length}`);
}
say();
say('Abstention as a decision (positive class: abstained)');
say(`  true positive   ${truePositive}   abstained, and nothing supported an answer`);
say(`  false positive  ${falsePositive}   abstained, but an answer was there`);
say(`  false negative  ${falseNegative}   answered, but nothing supported one`);
say(`  precision       ${precision.toFixed(3)}`);
say(`  recall          ${recall.toFixed(3)}`);
say(`  f1              ${f1.toFixed(3)}`);
say();
say(`Unsupported answers  ${unsupported.length}  (${percent(unsupported.length, total)} of all questions)`);
for (const item of unsupported) {
  say(`  ${item.question.id}  got ${item.actual}, wanted ${item.expected}`);
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
say('  lexical, vector and hybrid retrieval runs on this same corpus and is');
say('  reported separately. That is where a claim of advantage has to be earned.');

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
      subject: c.answer.question.subject,
      predicate: c.answer.question.predicate,
      via: c.answer.question.via,
      expected: c.expected,
      actual: c.actual,
      verdict: c.verdict,
      explanation: c.answer.resolution.explanation,
      trace: c.answer.resolution.trace,
      citations: c.answer.evidence.length,
      ms: c.answer.timing.ms,
      queries: c.answer.timing.queries,
    })),
    null,
    2,
  )}\n`,
  'utf8',
);
process.stdout.write(`\nWrote ${OUT_DIR}/report.txt and cases.json\n`);

// A non-zero exit when anything is wrong, so this can gate a build later.
process.exit(correct === total ? 0 : 1);
