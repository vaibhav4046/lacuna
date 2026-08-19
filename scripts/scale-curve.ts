import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

import { lacunaSystem } from '../src/bench/systems.js';
import { generateCorpus, validateCorpus } from '../src/corpus/index.js';
import type { GoldQuestion } from '../src/corpus/types.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { HydraClient } from '../src/hydra/client.js';
import { detachDeleteVertex, verticesByLabel } from '../src/hydra/queries.js';
import { NODE_LABELS } from '../src/ingest/index.js';
import { buildPlan } from '../src/ingest/plan.js';
import { runIngest } from '../src/ingest/run.js';
import { judge, scoreAll } from '../src/bench/score.js';

/**
 * Does the cost of answering grow with the history it answers over?
 *
 * The project claims it does not, and until now that was argued from the design
 * and from a single measurement at one size. This measures it as a curve.
 *
 * The experiment is controlled on the thing that matters. `generateCorpus` is
 * given a session count, and the thread planner spreads the same threads over
 * however many sessions it is given, so every size has the **same 64 gold
 * questions, the same 174 claims and the same 86 entities**. What changes is
 * only the volume of unrelated conversation around them: 17k estimated tokens
 * at ten sessions, 117k at seventy-two. Any growth in what Lacuna hands the
 * answering step is therefore growth caused by history alone.
 *
 * It runs against the real self-hosted node, because a measurement of the
 * resolver against an in-memory structure would be measuring this repository
 * against itself.
 *
 * It reuses the one graph the node's token is scoped to, clearing it between
 * sizes. That means **it destroys whatever the local node currently holds**.
 * The last size run is the shipped one, so a completed run leaves the node
 * holding the same corpus it started with; an interrupted run leaves it holding
 * a smaller one, and `npm run ingest` puts it back. Nothing here touches
 * HydraDB Cloud, which is what the deployed site reads.
 *
 *   npx tsx scripts/scale-curve.ts
 */

const SIZES = [10, 20, 30, 40, 72] as const;
const CHARS_PER_TOKEN = 4;
const OUT_DIR = 'artifacts/scale';
const ENV_PATH = '.env.local';

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[index]!;
}

interface Point {
  readonly sessions: number;
  readonly messages: number;
  readonly estimatedTokens: number;
  readonly goldQuestions: number;
  readonly claims: number;
  readonly entities: number;
  readonly correct: number;
  readonly falseAnswers: number;
  readonly meanContextTokens: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly ingestMs: number;
}

if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. This runs against the self-hosted node.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

const base = loadHydraConfig();
if (base.baseUrl.includes('hydradb') || base.baseUrl.startsWith('https://')) {
  process.stderr.write(
    `refusing to run against ${base.baseUrl}: this writes ${SIZES.length} graphs and is for the local node.\n`,
  );
  process.exit(1);
}

const client = new HydraClient(base);

/** Every vertex Lacuna owns, and by detaching, every edge attached to one. */
async function clear(target: HydraClient): Promise<void> {
  for (const label of NODE_LABELS) {
    const ids: number[] = [];
    // One query id for the whole pagination. A cursor belongs to the request
    // that produced it, and minting per page makes the engine reject the second.
    const queryId = HydraClient.mintQueryId();
    let cursor: number | undefined;
    for (let page = 0; page < 1000; page += 1) {
      const got = await target.queryPage(
        { ...verticesByLabel(label), pageSize: 500, timeoutMs: 30_000 },
        cursor === undefined ? { queryId } : { queryId, cursor },
      );
      for (const row of got.rows) if (typeof row[0] === 'number') ids.push(row[0]);
      if (got.nextCursor === null) break;
      cursor = got.nextCursor;
    }

    // Deleting one at a time over ~5,500 vertices is minutes of round trips, so
    // this runs a small pool the way `scripts/reset.ts` does.
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < ids.length) {
        const id = ids[next];
        next += 1;
        if (id === undefined) continue;
        await target.write({ ...detachDeleteVertex(id), timeoutMs: 30_000 });
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  }
}

const points: Point[] = [];

for (const sessions of SIZES) {
  const corpus = generateCorpus(undefined, sessions);
  validateCorpus(corpus);
  const plan = buildPlan(corpus);

  process.stdout.write(
    `\n${sessions} sessions  ${corpus.stats.messages} messages  `
    + `~${corpus.stats.estimatedTokens.toLocaleString('en-GB')} tokens  `
    + `${plan.counts.vertices.Claim} claims\n`,
  );

  await clear(client);

  const ingestStarted = performance.now();
  await runIngest(client, plan, { verifyKeys: false });
  const ingestMs = performance.now() - ingestStarted;
  process.stdout.write(`  ingested in ${(ingestMs / 1000).toFixed(1)}s\n`);

  const system = lacunaSystem(client);
  const contextChars: number[] = [];
  const latencies: number[] = [];
  const scored = [];

  for (const question of corpus.questions as readonly GoldQuestion[]) {
    const result = await system.answer(question);
    scored.push({ question, outcome: result.outcome, verdict: judge(question.expected, result.outcome) });
    contextChars.push(result.contextChars);
    latencies.push(result.ms);
  }

  const metrics = scoreAll(scored);
  const point: Point = {
    sessions: corpus.stats.sessions,
    messages: corpus.stats.messages,
    estimatedTokens: corpus.stats.estimatedTokens,
    goldQuestions: corpus.questions.length,
    claims: plan.counts.vertices.Claim,
    entities: plan.counts.vertices.Entity,
    correct: metrics.correct,
    falseAnswers: metrics.byVerdict.get('false_answer') ?? 0,
    meanContextTokens: Number((mean(contextChars) / CHARS_PER_TOKEN).toFixed(2)),
    p50Ms: Number(quantile(latencies, 0.5).toFixed(1)),
    p95Ms: Number(quantile(latencies, 0.95).toFixed(1)),
    ingestMs: Number(ingestMs.toFixed(0)),
  };
  points.push(point);

  process.stdout.write(
    `  ${point.correct}/${point.goldQuestions} correct, `
    + `${point.falseAnswers} false answers, `
    + `${point.meanContextTokens} mean context tokens, p50 ${point.p50Ms}ms\n`,
  );
}

const first = points[0]!;
const last = points[points.length - 1]!;
const historyGrowth = last.estimatedTokens / first.estimatedTokens;
const contextGrowth = last.meanContextTokens / Math.max(first.meanContextTokens, 1e-9);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  `${OUT_DIR}/curve.json`,
  `${JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      store: base.baseUrl,
      note:
        'Same gold questions, claims and entities at every size. Only the surrounding '
        + 'history changes.',
      historyGrowth: Number(historyGrowth.toFixed(2)),
      contextGrowth: Number(contextGrowth.toFixed(2)),
      points,
    },
    null,
    2,
  )}\n`,
);

process.stdout.write('\nsessions  tokens of history  correct  mean ctx tokens   p50\n');
for (const point of points) {
  process.stdout.write(
    `${String(point.sessions).padStart(8)}  ${String(point.estimatedTokens).padStart(17)}  `
    + `${String(point.correct).padStart(4)}/64  ${String(point.meanContextTokens).padStart(15)}  `
    + `${String(point.p50Ms).padStart(5)}\n`,
  );
}
process.stdout.write(
  `\nhistory grew ${historyGrowth.toFixed(2)}x, context handed to the answering step `
  + `grew ${contextGrowth.toFixed(2)}x.\n${OUT_DIR}/curve.json written.\n`,
);
