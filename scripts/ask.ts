import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describeExpected } from '../src/bench/score.js';
import { generateCorpus } from '../src/corpus/index.js';
import { NodeSource } from '../src/hydra/node-source.js';
import { HydraClient } from '../src/hydra/client.js';
import { loadHydraConfig } from '../src/hydra/config.js';
import { ask, buildQuestion, parseVia } from '../src/retrieval/index.js';
import type { Answer } from '../src/retrieval/index.js';

/**
 * Asks one question and prints what came back, with the reasoning and the
 * citations.
 *
 * Two modes. Given a gold question id it uses that question and prints what the
 * corpus expected alongside what the graph produced, which is the honest way to
 * look at a single case. Given a subject and predicate it just asks.
 *
 *   npx tsx scripts/ask.ts q-multi_hop-01
 *   npx tsx scripts/ask.ts --subject Meridian --predicate vendor
 *   npx tsx scripts/ask.ts --subject Meridian --predicate contact --via vendor
 */

const ENV_PATH = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!existsSync(ENV_PATH)) {
  process.stderr.write(`${ENV_PATH} is missing. Copy .env.example to .env.local and fill it in.\n`);
  process.exit(1);
}
process.loadEnvFile(ENV_PATH);

function flag(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  if (at === -1) return null;
  const value = process.argv[at + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`--${name} needs a value`);
  }
  return value;
}

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function show(answer: Answer, text: string | null): void {
  const { resolution, evidence, queries } = answer;

  print('');
  if (text !== null) print(`Q  ${text}`);
  print(
    `   subject "${answer.question.subject}" predicate "${answer.question.predicate}"`
    + `${answer.question.via === null ? '' : ` via "${answer.question.via}"`}`,
  );
  print('');

  if (resolution.outcome.type === 'answer') {
    print(`A  ${resolution.outcome.text}`);
  } else {
    print(`A  No answer. ${resolution.outcome.reason}`);
  }
  print(`   ${resolution.explanation}`);

  print('');
  print('   How it got there');
  for (const step of resolution.trace) {
    print(`     - ${step}`);
  }

  if (resolution.considered.length > 0) {
    print('');
    print('   Claims on this pair, oldest first');
    for (const claim of resolution.considered) {
      const state = claim.supersededBy.length > 0 ? 'superseded' : 'current';
      // A withdrawal stores no object text, so the label is the whole value
      // rather than a prefix to one. Joining skips the gap that would leave.
      const value = [claim.polarity === 'negative' ? '(withdrawn)' : '', claim.objectText]
        .filter((part) => part !== '')
        .join(' ');
      print(`     ${claim.validFrom.slice(0, 10)}  ${value}  [${state}]`);
    }
  }

  if (evidence.length > 0) {
    print('');
    print('   Cited from');
    for (const span of evidence) {
      print(`     ${span.sessionTitle}, ${span.ts.slice(0, 10)}, ${span.role}`);
      print(`       "${span.quote}"`);
    }
  }

  print('');
  print('   What it asked HydraDB');
  for (const [at, trip] of queries.entries()) {
    // One line each. The statements are long, and a reader who wants them in
    // full has the same values on the proof screen and in the source.
    const epoch = trip.readEpoch === null ? '' : `, epoch ${trip.readEpoch}`;
    print(
      `     ${String(at + 1).padStart(2)}. ${first(trip.cypher ?? trip.request).padEnd(46)}`
      + `${String(trip.rows).padStart(4)} row${trip.rows === 1 ? ' ' : 's'}`
      + `${String(trip.ms).padStart(8)}ms${epoch}`,
    );
  }

  print('');
  print(
    `   ${queries.length} quer${queries.length === 1 ? 'y' : 'ies'}, ${answer.ms}ms`,
  );
  print('');
}

/** The first clause of a statement, which is enough to tell one from another. */
function first(cypher: string): string {
  const line = cypher.trim().split('\n')[0]!.trim();
  return line.length > 44 ? `${line.slice(0, 43)}…` : line;
}

const client = new HydraClient(loadHydraConfig());
const source = new NodeSource(client);
const positional = process.argv[2];

if (positional !== undefined && !positional.startsWith('--')) {
  const corpus = generateCorpus();
  const gold = corpus.questions.find((q) => q.id === positional);
  if (gold === undefined) {
    throw new Error(`no gold question with id ${positional}`);
  }
  const question = buildQuestion(gold.subject, gold.predicate, parseVia(gold.text));
  const answer = await ask(source, question);
  show(answer, gold.text);
  print(`   expected: ${describeExpected(gold)} (thread kind: ${gold.kind})`);
  print('');
} else {
  const subject = flag('subject');
  const predicate = flag('predicate');
  if (subject === null || predicate === null) {
    throw new Error('pass a gold question id, or --subject and --predicate');
  }
  const answer = await ask(source, buildQuestion(subject, predicate, flag('via')));
  show(answer, null);
}
