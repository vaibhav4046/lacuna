/**
 * Proves the recorded snapshot answers exactly like the live node.
 *
 * Runs all sixty gold questions twice — once against the live HydraDB node,
 * once through the snapshot transport — and compares the full Answer objects
 * field by field: resolution, trace, evidence, subgraph, query log. The only
 * fields excluded are the wall-clock ms figures, which measure network versus
 * replay and cannot be equal. Any other difference is a failure.
 *
 *   npx tsx scripts/verify-snapshot.ts
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describeExpected, describeOutcome, judge } from '../src/bench/score.js';
import { generateCorpus } from '../src/corpus/index.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig, type HydraConfig } from '../src/hydra/config.js';
import { ask, buildQuestion, parseVia } from '../src/retrieval/index.js';
import type { Answer } from '../src/retrieval/index.js';
import { loadSnapshot, snapshotTransport } from '../src/snapshot/replay.js';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

/**
 * Everything except wall-clock timing, which replay is expected to change.
 * The query log is sorted before comparison: the claims and mentions reads
 * run in parallel and land in completion order, which races over the network
 * on the live path and is stable on replay. Two consecutive live runs can
 * disagree on that order too — it is scheduling, not content.
 */
function comparable(answer: Answer): string {
  const queries = answer.queries
    .map((trace) => ({ ...trace, ms: null }))
    .sort((a, b) => {
      const left = `${a.cypher} ${JSON.stringify(a.parameters)}`;
      const right = `${b.cypher} ${JSON.stringify(b.parameters)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return JSON.stringify({ ...answer, ms: null, queries }, null, 2);
}

const corpus = generateCorpus();
const live = new HydraClient(loadHydraConfig());

const snapshot = loadSnapshot();
const replayConfig: HydraConfig = {
  // Loopback and unroutable: the snapshot transport never opens a socket,
  // and if it ever did, this address refuses immediately.
  baseUrl: 'http://127.0.0.1:1',
  namespace: snapshot.node.namespace,
  graph: snapshot.node.graph,
  cell: snapshot.node.cell,
  token: 'snapshot-replay-unused',
};
const replay = new HydraClient(replayConfig, { fetch: snapshotTransport(snapshot) });

process.stdout.write(
  `Comparing ${corpus.questions.length} gold questions, live node versus `
  + `snapshot (${snapshot.counts.entries} recorded replies).\n\n`,
);

let mismatches = 0;
let wrongVerdicts = 0;

for (const question of corpus.questions) {
  const built = buildQuestion(question.subject, question.predicate, parseVia(question.text));
  const liveAnswer = await ask(live, built);
  const replayAnswer = await ask(replay, built);

  const same = comparable(liveAnswer) === comparable(replayAnswer);
  const verdict = judge(question.expected, replayAnswer.resolution.outcome);
  if (!same) mismatches += 1;
  if (verdict !== 'correct') wrongVerdicts += 1;

  process.stdout.write(
    `${same && verdict === 'correct' ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(22)}`
    + `${describeOutcome(replayAnswer.resolution.outcome)}`
    + `${same ? '' : '  [differs from live]'}`
    + `${verdict === 'correct' ? '' : `  [wanted ${describeExpected(question)}]`}\n`,
  );

  if (!same) {
    const liveText = comparable(liveAnswer);
    const replayText = comparable(replayAnswer);
    const liveLines = liveText.split('\n');
    const replayLines = replayText.split('\n');
    for (let i = 0; i < Math.max(liveLines.length, replayLines.length); i += 1) {
      if (liveLines[i] !== replayLines[i]) {
        process.stdout.write(`      live:   ${liveLines[i] ?? '<missing>'}\n`);
        process.stdout.write(`      replay: ${replayLines[i] ?? '<missing>'}\n`);
        break;
      }
    }
  }
}

process.stdout.write(
  `\n${corpus.questions.length} questions, ${mismatches} answer mismatches, `
  + `${wrongVerdicts} wrong verdicts on replay.\n`,
);

process.exit(mismatches === 0 && wrongVerdicts === 0 ? 0 : 1);
