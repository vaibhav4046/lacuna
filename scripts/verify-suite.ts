export {};

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Runs the test suite and refuses to call a partial run green.
 *
 *   npm run test:verified
 *   npm run test:verified -- tests/contract
 *
 * Vitest can lose a worker — a heap ceiling, a native crash — and when it does
 * it reports an unhandled error, counts the file it was partway through as
 * neither passed nor failed, and exits zero. That is how this suite reported
 * "118 passed" for a hundred and nineteen files while sixty tests never ran,
 * and every count quoted in the documentation was true only when the run got
 * lucky.
 *
 * So the exit code is not the evidence. This compares the files vitest
 * actually reported against the files on disk, and fails when any of them is
 * missing, whatever vitest itself concluded.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const dir = (process.argv[2] ?? 'tests/unit').replace(/\/+$/, '');
const report = `${ROOT}.vitest-report.json`;

function testFilesOnDisk(relative: string): readonly string[] {
  const absolute = `${ROOT}${relative}`;
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory()
      ? testFilesOnDisk(`${relative}/${entry.name}`)
      : entry.name.endsWith('.test.ts') ? [`${relative}/${entry.name}`] : []))
    .sort();
}

const expected = testFilesOnDisk(dir);
if (expected.length === 0) {
  process.stderr.write(`no test files under ${dir}\n`);
  process.exit(2);
}

process.stdout.write(`${expected.length} test files under ${dir}\n\n`);

rmSync(report, { force: true });
const run = spawnSync(
  process.execPath,
  [`${ROOT}node_modules/vitest/vitest.mjs`, 'run', dir, '--reporter=json', `--outputFile=${report}`],
  {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    // Headroom, because without it the run lies rather than fails.
    //
    // One fork reuses a heap across every file in the directory, and this
    // suite is large enough to reach the default ceiling. Vitest reports the
    // kill as an unhandled worker error, counts the file it was partway
    // through as neither passed nor failed, and exits zero. Measured: the
    // default loses a file on most runs; at 4 GB the suite reports every one.
    // The check below is what catches it if this ever stops being enough.
    env: { ...process.env, NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --max-old-space-size=4096`.trim() },
  },
);

if (!existsSync(report)) {
  process.stderr.write('\nvitest wrote no report, so nothing here can be verified\n');
  process.exit(3);
}

interface Assertion { readonly status: string }
interface Suite { readonly name: string; readonly assertionResults: readonly Assertion[] }
const parsed = JSON.parse(readFileSync(report, 'utf8')) as {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: readonly Suite[];
};
rmSync(report, { force: true });

// The report names files by absolute path; compare on the repository-relative
// tail so the check does not depend on where the checkout lives.
const reported = new Set(
  parsed.testResults.map((suite) => suite.name.split(String.fromCharCode(92)).join('/').split('/').pop() ?? suite.name),
);
const missing = expected.filter((file) => !reported.has(file.split('/').pop() ?? file));

process.stdout.write(
  `\n${parsed.numPassedTests} passed, ${parsed.numFailedTests} failed, `
  + `${parsed.testResults.length} of ${expected.length} files reported\n`,
);

if (missing.length > 0) {
  process.stderr.write(`\n${missing.length} file(s) produced no result:\n`);
  for (const file of missing) process.stderr.write(`  ${file}\n`);
  process.stderr.write('\nA file that reported nothing did not pass. Refusing to call this green.\n');
  process.exit(1);
}

if (parsed.numFailedTests > 0 || run.status !== 0) {
  process.stderr.write('\nthe suite failed\n');
  process.exit(1);
}

process.stdout.write('SUITE_COMPLETE: every file reported and every test passed\n');
