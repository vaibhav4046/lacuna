import type { BenchReport } from './bench.js';

/**
 * The recorded benchmark, as three columns.
 *
 * The Evaluations screen said "no recorded runs" while a measured run sat in
 * artifacts/bench/results.json. That is a worse failure than an empty screen:
 * the evidence existed and the product could not show it, so a reader had to
 * take the number on faith or go and read a JSON file.
 *
 * One row per retrieval family, at the cutoff where that family did best.
 * Showing every cutoff would be thirty-one rows of the same five ideas, and
 * showing one arbitrary cutoff would be picking the comparison. Best of each
 * is the reading least favourable to this product, which is the right one to
 * publish.
 */

export interface EvalRow {
  readonly method: string;
  readonly cases: string;
  readonly result: string;
}

function round(value: number, places = 0): string {
  return value.toFixed(places);
}

export function evaluationRows(bench: BenchReport): readonly EvalRow[] {
  const best = new Map<string, BenchReport['systems'][number]>();
  for (const system of bench.systems) {
    const held = best.get(system.family);
    if (held === undefined || system.correct > held.correct) best.set(system.family, system);
  }

  // Baselines first, weakest to strongest, and this product last, so the table
  // reads as a comparison rather than as an announcement.
  const ordered = [...best.values()].sort((a, b) => {
    if (a.family === 'lacuna') return 1;
    if (b.family === 'lacuna') return -1;
    return a.correct - b.correct;
  });

  return ordered.map((system) => ({
    method: system.label,
    cases: `${system.total} gold questions`,
    result: `${system.correct} correct · ${round(system.meanEstimatedTokens)} context tokens · p50 ${round(system.p50Ms)} ms`,
  }));
}
