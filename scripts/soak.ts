import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { generateCorpus } from '../src/corpus/index.js';
import { parseVia } from '../src/retrieval/index.js';

/**
 * The deployed ask endpoint, under concurrency, for long enough to mean it.
 *
 *   npm run soak
 *   npm run soak -- https://lacuna-five.vercel.app 12 400
 *
 * Everything else in this repository measures correctness one question at a
 * time. `JUDGE_SCORECARD.md` names the gap this closes in its own words:
 * nothing here had been run under concurrency, so every latency figure was a
 * figure for a system with one user. That is the easiest kind of number to
 * publish and the least honest.
 *
 * Two things are checked, and they are different claims.
 *
 * The first is that the answers stay right. Every response is compared against
 * the outcome that question reached when it was asked alone, so a run that gets
 * fast by returning a stale record, an empty envelope or somebody else's answer
 * fails rather than posting a good p95. Correctness under load is the point;
 * latency under load is the reporting.
 *
 * The second is the latency distribution itself, reported as p50, p95 and p99
 * with the slowest request kept. A mean would hide exactly the tail this is
 * being run to find.
 *
 * The load is deliberately modest. This is a free tier in front of a managed
 * database, and the useful question is whether the thing degrades or misbehaves
 * when several agents share a workspace, not how hard it can be pushed before
 * somebody's quota runs out. A soak that gets the account rate limited on
 * submission day would be a self inflicted outage, not evidence.
 */

const target = (process.argv[2] ?? 'https://lacuna-five.vercel.app').replace(/\/+$/, '');
const concurrency = Number.parseInt(process.argv[3] ?? '10', 10);
const total = Number.parseInt(process.argv[4] ?? '300', 10);
const OUT_DIR = fileURLToPath(new URL('../artifacts/soak', import.meta.url));

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  process.stderr.write('concurrency must be a whole number between 1 and 32\n');
  process.exit(2);
}
if (!Number.isInteger(total) || total < concurrency) {
  process.stderr.write('total must be a whole number and at least the concurrency\n');
  process.exit(2);
}

const print = (line: string): void => void process.stdout.write(`${line}\n`);

/** One per outcome the resolver can reach, so the load is not one code path. */
const CHOSEN = [
  'q-stable-01',
  'q-revised-01',
  'q-retracted-01',
  'q-contradicted-01',
  'q-multi_hop-01',
  'q-out_of_scope-01',
] as const;

const corpus = generateCorpus();
const questions = CHOSEN
  .map((id) => corpus.questions.find((question) => question.id === id))
  .filter((question): question is NonNullable<typeof question> => question !== undefined);

interface Envelope {
  readonly status: string;
  readonly answer: string | null;
  readonly evidence: number;
  readonly reason: string | null;
}

interface Body {
  readonly status: string;
  readonly answer: string | null;
  readonly evidence: readonly unknown[];
  readonly abstain_reason: string | null;
}

function envelopeOf(body: Body): Envelope {
  return {
    status: body.status,
    answer: body.answer,
    evidence: body.evidence.length,
    reason: body.abstain_reason,
  };
}

async function csrf(): Promise<string> {
  const response = await fetch(`${target}/api/session`, { headers: { Accept: 'application/json' } });
  for (const line of response.headers.getSetCookie()) {
    const match = /lacuna_csrf=([^;]+)/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  throw new Error('the deployment issued no CSRF cookie');
}

const token = await csrf();

async function askOnce(index: number): Promise<{ ms: number; envelope: Envelope | null; error: string | null }> {
  const question = questions[index % questions.length]!;
  const via = parseVia(question.text);
  const started = performance.now();
  try {
    const response = await fetch(`${target}/api/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-csrf-token': token,
        Cookie: `lacuna_csrf=${token}`,
      },
      body: JSON.stringify({
        subject: question.subject,
        predicate: question.predicate,
        ...(via === null ? {} : { via }),
      }),
    });
    const ms = performance.now() - started;
    if (!response.ok) return { ms, envelope: null, error: `HTTP ${response.status}` };
    return { ms, envelope: envelopeOf(await response.json() as Body), error: null };
  } catch (error) {
    return {
      ms: performance.now() - started,
      envelope: null,
      error: error instanceof Error ? error.message : 'unknown transport failure',
    };
  }
}

print('One endpoint, several callers at once.\n');
print(`  target       ${target}`);
print(`  questions    ${questions.length}, one per outcome`);
print(`  concurrency  ${concurrency}`);
print(`  requests     ${total}\n`);

// The baseline each response is judged against: the same question asked alone,
// before any load. A soak that only compares responses to each other cannot
// tell a consistently wrong answer from a right one.
print('  taking the quiet baseline first');
const baseline = new Map<number, Envelope>();
for (let index = 0; index < questions.length; index += 1) {
  const first = await askOnce(index);
  if (first.envelope === null) {
    process.stderr.write(`the baseline request failed: ${first.error}\n`);
    process.exit(1);
  }
  baseline.set(index % questions.length, first.envelope);
}
print(`  baseline taken for ${baseline.size} questions\n`);

const durations: number[] = [];
const failures: { index: number; reason: string }[] = [];
let next = 0;
const startedAt = Date.now();

async function worker(): Promise<void> {
  for (;;) {
    const index = next;
    next += 1;
    if (index >= total) return;

    const result = await askOnce(index);
    durations.push(result.ms);

    if (result.envelope === null) {
      failures.push({ index, reason: result.error ?? 'no envelope' });
      continue;
    }
    const expected = baseline.get(index % questions.length)!;
    if (JSON.stringify(result.envelope) !== JSON.stringify(expected)) {
      failures.push({
        index,
        reason: `answer changed under load: ${JSON.stringify(result.envelope)} not ${JSON.stringify(expected)}`,
      });
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const elapsedMs = Date.now() - startedAt;
const sorted = [...durations].sort((a, b) => a - b);
const at = (fraction: number): number =>
  Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0);

const report = {
  recorded: new Date().toISOString().slice(0, 10),
  target,
  concurrency,
  requests: durations.length,
  elapsedMs,
  requestsPerSecond: Number(((durations.length / elapsedMs) * 1000).toFixed(2)),
  failures: failures.length,
  answersUnchangedUnderLoad: failures.length === 0,
  latencyMs: { p50: at(0.5), p90: at(0.9), p95: at(0.95), p99: at(0.99), max: Math.round(sorted.at(-1) ?? 0) },
};

print(`  ${report.requests} requests in ${(elapsedMs / 1000).toFixed(1)}s, ${report.requestsPerSecond}/s`);
print(`  p50 ${report.latencyMs.p50}ms   p95 ${report.latencyMs.p95}ms   p99 ${report.latencyMs.p99}ms   max ${report.latencyMs.max}ms`);
print(`  failures ${failures.length}`);
for (const failure of failures.slice(0, 5)) print(`    request ${failure.index}: ${failure.reason}`);
if (failures.length > 5) print(`    and ${failures.length - 5} more`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/soak.json`, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

print('');
print(`ANSWERS_UNCHANGED_UNDER_LOAD: ${report.answersUnchangedUnderLoad}`);
print('artifacts/soak/soak.json written.');

if (failures.length > 0) process.exit(1);
