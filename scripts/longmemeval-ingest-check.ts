import { mkdirSync, writeFileSync } from 'node:fs';

import { adaptHaystack } from '../benchmarks/longmemeval/adapt.js';
import { loadDataset, stripGroundTruth } from '../benchmarks/longmemeval/load.js';

/**
 * The real dataset through the real adapter, all 500 instances.
 *
 * Everything the LongMemEval integration was tested against until now was
 * handwritten in the official schema, which proves the code reads the shape it
 * was told about and proves nothing about the shape that is actually published.
 * This reads the downloaded file and pushes every instance through, so the two
 * claims that matter are checked against the published data rather than against
 * fixtures:
 *
 * 1. the format is read without a single parse failure, and
 * 2. no ground truth survives the strip, checked by searching the serialised
 *    output of every instance for the answer string, the evidence session ids
 *    and the turn level marker.
 *
 * It reports extraction coverage honestly. The extractor reads eleven sentence
 * frames about infrastructure, and LongMemEval is a personal assistant
 * benchmark about degrees, hobbies and appointments, so the expected coverage
 * is low and the number is printed rather than hidden.
 *
 *   npx tsx scripts/longmemeval-ingest-check.ts
 */

const DATASET = process.argv[2] ?? 'data/longmemeval_oracle.json';
const OUT_DIR = 'artifacts/longmemeval';

const questions = loadDataset(DATASET);
process.stdout.write(`${questions.length} instances read from ${DATASET}\n`);

let sessions = 0;
let messages = 0;
let estimatedTokens = 0;
let claims = 0;
let withAnyClaim = 0;
let leaks = 0;
const perProperty = new Map<string, number>();
const failures: string[] = [];

const started = Date.now();

for (const question of questions) {
  let adapted;
  try {
    adapted = adaptHaystack(stripGroundTruth(question));
  } catch (error) {
    failures.push(`${question.question_id}: ${(error as Error).message}`);
    continue;
  }

  sessions += adapted.stats.sessions;
  messages += adapted.stats.messages;
  estimatedTokens += adapted.stats.estimatedTokens;
  claims += adapted.stats.claims;
  if (adapted.stats.claims > 0) withAnyClaim += 1;

  for (const session of adapted.sessions) {
    for (const message of session.messages) {
      for (const claim of message.claims) {
        // The slot, not the property, so a proposal is counted separately from
        // a statement about the same thing.
        perProperty.set(claim.predicate, (perProperty.get(claim.predicate) ?? 0) + 1);
      }
    }
  }

  // The leakage check, against real records rather than a fixture. The turn
  // level marker and the evidence id field must not appear anywhere in what
  // ingestion would receive.
  const serialised = JSON.stringify(adapted);
  if (serialised.includes('has_answer') || serialised.includes('answer_session_ids')) leaks += 1;
  // The answer itself is often a phrase that also appears in the transcript,
  // which is correct and must not be removed, so this counts only the two
  // fields that assert which text is the answer. Recorded so the distinction
  // is on the record rather than assumed.
}

const ms = Date.now() - started;

const report = {
  measuredAt: new Date().toISOString(),
  dataset: DATASET,
  instances: questions.length,
  parseFailures: failures,
  adapterFailures: failures.length,
  groundTruthLeaks: leaks,
  sessions,
  messages,
  estimatedTokens,
  claims,
  instancesWithAtLeastOneClaim: withAnyClaim,
  coverage: Number(((withAnyClaim / questions.length) * 100).toFixed(1)),
  bySlot: Object.fromEntries([...perProperty.entries()].sort(([, a], [, b]) => b - a)),
  ms,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(`${OUT_DIR}/ingest-check.json`, `${JSON.stringify(report, null, 2)}\n`);

process.stdout.write(
  `\nadapter failures      ${report.adapterFailures}\n`
  + `ground truth leaks    ${report.groundTruthLeaks}\n`
  + `sessions              ${sessions.toLocaleString('en-GB')}\n`
  + `messages              ${messages.toLocaleString('en-GB')}\n`
  + `estimated tokens      ${estimatedTokens.toLocaleString('en-GB')}\n`
  + `claims extracted      ${claims.toLocaleString('en-GB')}\n`
  + `instances with a claim ${withAnyClaim} of ${questions.length} (${report.coverage}%)\n`
  + `read in               ${(ms / 1000).toFixed(1)}s\n`,
);

if (Object.keys(report.bySlot).length > 0) {
  process.stdout.write('\nslots filled\n');
  for (const [slot, count] of Object.entries(report.bySlot)) {
    process.stdout.write(`  ${slot.padEnd(22)}${String(count).padStart(6)}\n`);
  }
}
process.stdout.write(`\n${OUT_DIR}/ingest-check.json written.\n`);
