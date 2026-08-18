import { bestPerFamily } from '../report/bench.js';
import type { BenchResult } from './bench.js';
import type { Palette } from './color.js';
import type { DoctorReport } from './doctor.js';
import type { StatusReport } from './status.js';
import { columns } from './table.js';

/**
 * Terminal rendering for the three commands that do not answer a question.
 *
 * PASS, WARN and FAIL are words. They are not a green tick and a red cross, and
 * they are not colour alone, because this output gets piped into files and read
 * over SSH sessions that strip escapes. Colour is added on top of the word when
 * the terminal wants it and removed when it does not, and the meaning survives
 * either way. All three are four characters, which is what keeps the column
 * aligned once the escapes are in.
 *
 * A warning does not change the exit code and the verdict line says so, because
 * a warning that quietly failed the command would be a failure with a friendly
 * name.
 */

const WORDS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;

export function renderDoctor(report: DoctorReport, palette: Palette): string {
  const paint = { pass: palette.good, warn: palette.warn, fail: palette.bad };
  const rows = report.checks.map((check) => [
    check.name,
    paint[check.state](WORDS[check.state]),
    check.detail,
  ]);

  const failed = report.checks.filter((check) => check.state === 'fail').length;
  const warned = report.warnings === 0
    ? ''
    : ` ${report.warnings} warning(s), which do not affect the exit code.`;
  const verdict = report.ok
    ? `All checks passed.${warned}`
    : `${failed} check(s) failed, exit code ${report.code}.${warned}`;

  // The status column is padded from the coloured string, so its width is the
  // escape sequence plus four rather than four. Both values are the same length
  // in every row, which is why that does not misalign anything here.
  return [...columns(rows, '  '), '', `  ${verdict}`].join('\n');
}

export function renderStatus(report: StatusReport, palette: Palette): string {
  const identity = columns(
    [
      ['node', report.baseUrl],
      ['namespace', report.namespace],
      ['graph', report.graph],
      ['cell', report.cell],
      ['read epoch', report.readEpoch === null ? 'not reported' : String(report.readEpoch)],
    ],
    '  ',
  );

  const counts = columns(
    report.counts.map((entry) => [entry.label, String(entry.count)]),
    '  ',
  );

  return [
    ...identity,
    '',
    `  ${palette.heading('Nodes in the graph')}`,
    ...counts,
  ].join('\n');
}

export function renderBench(result: BenchResult, palette: Palette): string {
  const { report } = result;
  const rows = bestPerFamily(report).map((system) => [
    system.label,
    `${system.correct}/${system.total}`,
    String(system.verdicts.falseAnswer),
    String(system.verdicts.missedAnswer),
    system.f1.toFixed(2),
    String(Math.round(system.meanEstimatedTokens)),
    `${Math.round(system.p50Ms)}ms`,
    `${Math.round(system.p95Ms)}ms`,
  ]);

  const table = columns(
    [
      ['system', 'correct', 'false', 'missed', 'abstain f1', 'tokens', 'p50', 'p95'],
      ...rows,
    ],
    '  ',
  );

  const corpus = `  ${report.corpus.sessions} sessions, ${report.corpus.messages} messages, `
    + `${report.corpus.claims} claims`;

  return [
    `  ${palette.heading('Benchmark')}, best configuration per family`,
    `  run ${report.runAt}, seed ${report.seed}, embeddings ${report.embeddingModel}`,
    corpus,
    '',
    ...table,
    '',
    palette.dim(`  read from ${result.path}, not rerun`),
  ].join('\n');
}
