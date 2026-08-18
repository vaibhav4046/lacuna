/**
 * Proves the recorded snapshot answers exactly like the live node.
 *
 * Runs every gold question twice — once against the live HydraDB node, once
 * through the snapshot transport — and compares the full answers field by
 * field: resolution, trace, evidence, subgraph, query log. The only fields
 * excluded are the wall-clock ms figures and the read epoch, which measure the
 * run rather than the answer (src/snapshot/compare.ts says why). Any other
 * difference is a failure.
 *
 * Blast questions go through the walk rather than the resolver, on both sides.
 * That is the point of running them here: the deployed page replays recorded
 * replies, so if the walk over the recording reached a different set of
 * services than the walk over the node, the deployment would be showing a
 * traversal that never happened.
 *
 *   npx tsx scripts/verify-snapshot.ts
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describeExpected, describeOutcome, judge } from '../src/bench/score.js';
import type { BenchOutcome } from '../src/bench/types.js';
import { generateCorpus } from '../src/corpus/index.js';
import type { GoldQuestion } from '../src/corpus/types.js';
import { NodeSource } from '../src/hydra/node-source.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig, type HydraConfig } from '../src/hydra/config.js';
import {
  affectedText,
  ask,
  blastRadius,
  buildPackageName,
  buildQuestion,
  parseBlast,
  parseVia,
} from '../src/retrieval/index.js';
import { comparableAnswer, comparableBlast } from '../src/snapshot/compare.js';
import { loadSnapshot, snapshotTransport } from '../src/snapshot/replay.js';

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

const corpus = generateCorpus();
const live = new NodeSource(new HydraClient(loadHydraConfig()));

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
const replay = new NodeSource(new HydraClient(replayConfig, { fetch: snapshotTransport(snapshot) }));

process.stdout.write(
  `Comparing ${corpus.questions.length} gold questions, live node versus `
  + `snapshot (${snapshot.counts.entries} recorded replies).\n\n`,
);

let mismatches = 0;
let wrongVerdicts = 0;

/** The two serialisations to compare, and the verdict the replay side earned. */
interface Compared {
  readonly live: string;
  readonly replay: string;
  readonly outcome: BenchOutcome;
}

async function compareAsk(question: GoldQuestion): Promise<Compared> {
  const built = buildQuestion(question.subject, question.predicate, parseVia(question.text));
  const liveAnswer = await ask(live, built);
  const replayAnswer = await ask(replay, built);
  return {
    live: comparableAnswer(liveAnswer),
    replay: comparableAnswer(replayAnswer),
    outcome: replayAnswer.resolution.outcome,
  };
}

async function compareBlast(name: string): Promise<Compared> {
  const packageName = buildPackageName(name);
  const liveWalk = await blastRadius(live, packageName);
  const replayWalk = await blastRadius(replay, packageName);
  const radius = replayWalk.radius;
  return {
    live: comparableBlast(liveWalk),
    replay: comparableBlast(replayWalk),
    outcome:
      radius === null
        ? { type: 'abstain', reason: 'out_of_scope' }
        : { type: 'answer', text: affectedText(radius) },
  };
}

for (const question of corpus.questions) {
  const name = parseBlast(question.text);
  const compared = name === null ? await compareAsk(question) : await compareBlast(name);

  const same = compared.live === compared.replay;
  const verdict = judge(question.expected, compared.outcome);
  if (!same) mismatches += 1;
  if (verdict !== 'correct') wrongVerdicts += 1;

  process.stdout.write(
    `${same && verdict === 'correct' ? 'ok  ' : 'FAIL'}  ${question.id.padEnd(22)}`
    + `${describeOutcome(compared.outcome)}`
    + `${same ? '' : '  [differs from live]'}`
    + `${verdict === 'correct' ? '' : `  [wanted ${describeExpected(question)}]`}\n`,
  );

  if (!same) {
    const liveLines = compared.live.split('\n');
    const replayLines = compared.replay.split('\n');
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
