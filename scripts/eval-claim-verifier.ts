import { readFileSync, writeFileSync } from 'node:fs';

import { loadEnvFile } from '../src/cli/env.js';
import { rerankerConfig, scorePairs } from '../src/agent/verifier.js';

/**
 * Before/after measurement for the optional claim verifier.
 *
 * (a) Lexical baseline: a pair counts as supported when the claim's value,
 *     normalised (case, whitespace, punctuation other than hyphens), appears
 *     verbatim in the passage. This is the check available without a model, and
 *     it is a fair stand-in here because every value in a Context Pack is
 *     copied from the stored claim rather than paraphrased. Its known blind
 *     spots are the point of the comparison: it cannot tell whose value it is,
 *     whether it was later replaced, or that a reformatted date is the same.
 * (b) The reranker sidecar at LACUNA_RERANKER_URL, at LACUNA_RERANKER_THRESHOLD.
 *     Skipped, and reported as skipped, when the flag is unset.
 *
 * Run: npm run eval:claim-verifier
 */

interface Row {
  readonly id: string;
  readonly claim: string;
  readonly value: string;
  readonly passage: string;
  readonly label: 'supported' | 'not_supported';
  readonly kind: string;
}

interface Metrics {
  readonly n: number;
  readonly accuracy: number;
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly confusion: { readonly tp: number; readonly fp: number; readonly tn: number; readonly fn: number };
  readonly accuracyByKind: Readonly<Record<string, string>>;
}

const normalise = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
const lexicalSupports = (row: Pick<Row, 'value' | 'passage'>) => normalise(row.passage).includes(normalise(row.value));

function metrics(rows: readonly Row[], predicted: readonly boolean[]): Metrics {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  const byKind = new Map<string, [number, number]>();
  rows.forEach((row, i) => {
    const truth = row.label === 'supported';
    const guess = predicted[i]!;
    if (guess && truth) tp += 1; else if (guess) fp += 1; else if (truth) fn += 1; else tn += 1;
    const [right, total] = byKind.get(row.kind) ?? [0, 0];
    byKind.set(row.kind, [right + (guess === truth ? 1 : 0), total + 1]);
  });
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const round = (x: number) => Math.round(x * 1000) / 1000;
  return {
    n: rows.length,
    accuracy: round((tp + tn) / rows.length),
    precision: round(precision),
    recall: round(recall),
    f1: round(precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)),
    confusion: { tp, fp, tn, fn },
    accuracyByKind: Object.fromEntries([...byKind].map(([kind, [right, total]]) => [kind, `${right}/${total}`])),
  };
}

function print(name: string, m: Metrics): void {
  console.log(`\n${name}  (positive class: supported, n=${m.n})`);
  console.log(`  accuracy ${m.accuracy}  precision ${m.precision}  recall ${m.recall}  F1 ${m.f1}`);
  console.log(`  tp ${m.confusion.tp}  fp ${m.confusion.fp}  tn ${m.confusion.tn}  fn ${m.confusion.fn}`);
  for (const [kind, score] of Object.entries(m.accuracyByKind)) console.log(`  ${kind.padEnd(26)} ${score}`);
}

async function main(): Promise<void> {
  loadEnvFile(new URL('../.env.local', import.meta.url));
  const set = JSON.parse(readFileSync(new URL('../artifacts/eval/claim-support-pairs.json', import.meta.url), 'utf8')) as { rows: Row[] };
  const rows = set.rows;

  const lexical = metrics(rows, rows.map(lexicalSupports));
  print('(a) lexical baseline: normalised value containment', lexical);

  const config = rerankerConfig(process.env);
  let reranker: (Metrics & { readonly url: string; readonly threshold: number }) | { readonly skipped: string };
  if (config === null) {
    reranker = { skipped: 'LACUNA_RERANKER_URL is not set' };
  } else if ('invalid' in config) {
    reranker = { skipped: config.invalid };
  } else {
    const scores = await scorePairs(config, rows.map((row) => ({ claim: row.claim, passage: row.passage })), { timeoutMs: 120_000 });
    reranker = { url: config.url, threshold: config.threshold, ...metrics(rows, scores.map((s) => s >= config.threshold)) };
    print(`(b) reranker sidecar at ${config.url}, threshold ${config.threshold}`, reranker);
  }
  if ('skipped' in reranker) console.log(`\n(b) reranker sidecar: skipped (${reranker.skipped})`);

  writeFileSync(new URL('../artifacts/eval/claim-verifier-results.json', import.meta.url), `${JSON.stringify({
    ranAt: new Date().toISOString(),
    set: 'artifacts/eval/claim-support-pairs.json',
    lexical,
    reranker,
  }, null, 2)}\n`);
  console.log('\nwrote artifacts/eval/claim-verifier-results.json');
}

await main();
