import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type BenchReport, parseBenchReport } from '../report/bench';
import { CliConfigError } from './exit';

/**
 * The committed benchmark, read back and printed.
 *
 * This command does not run the benchmark. Running it takes an embedding model,
 * 51 system configurations and several minutes, and a number that changes every
 * time someone types `lacuna bench` is not a number anyone can quote. So this
 * reads `artifacts/bench/results.json`, the file `npm run bench` wrote and the
 * repository committed, and prints what is in it.
 *
 * The parse is the one in `src/report/bench.ts`, which checks every field rather
 * than casting, so a drifted file is a named error here and not `undefined` in a
 * column.
 */

export const REPORT_PATH = 'artifacts/bench/results.json';

export interface BenchResult {
  readonly report: BenchReport;
  readonly path: string;
}

export function runBench(root: URL): BenchResult {
  const location = new URL(REPORT_PATH, root);
  const path = fileURLToPath(location);

  let source: string;
  try {
    source = readFileSync(location, 'utf8');
  } catch {
    throw new CliConfigError(
      `${path} is missing. It is written by "npm run bench" and committed to the repository.`,
    );
  }

  return { report: parseBenchReport(source), path };
}
