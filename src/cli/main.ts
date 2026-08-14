import type { Invocation } from './args';
import { parseArgs, resolveTimeoutMs } from './args';
import { runBench } from './bench';
import { paletteFor, type Palette } from './color';
import { runDoctor } from './doctor';
import { loadEnvFile } from './env';
import { EXIT_OK, EXIT_USAGE, exitCodeFor, messageFor } from './exit';
import { helpText } from './help';
import { renderAsk, renderExplain, renderTimeline } from './human';
import { renderBench, renderDoctor, renderStatus } from './human-report';
import { benchPayload, doctorPayload, questionPayload, render, statusPayload } from './json';
import { readRequiredNode, readVersion } from './manifest';
import { runQuestion } from './question';
import { runStatus } from './status';

/**
 * Dispatch, and the only place in this CLI that decides an exit code.
 *
 * Each command module returns a report and knows nothing about rendering. This
 * file picks the renderer, writes the bytes and returns the number. Keeping that
 * decision in one function is what makes the promise about `--json` checkable:
 * there is exactly one call that writes to stdout, and under `--json` it writes
 * one JSON document and nothing else. Errors and warnings go to stderr, where a
 * pipe into `jq` will not see them.
 *
 * The return value is a code rather than a `process.exit`, so the caller can let
 * the runtime flush stdout before the process ends.
 */

/** src/cli/main.ts sits two levels below the repository root. */
const ROOT = new URL('../../', import.meta.url);

/** Read when it exists. Never overwrites a variable the shell already set. */
const ENV_FILE = '.env.local';

export interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly isTTY: boolean;
}

const PROCESS_STREAMS: Streams = {
  out: (text) => { process.stdout.write(text); },
  err: (text) => { process.stderr.write(text); },
  isTTY: process.stdout.isTTY === true,
};

/** Human output is a block of lines; it is written with one trailing newline. */
function block(text: string): string {
  return `${text}\n`;
}

async function dispatch(
  invocation: Invocation,
  env: Record<string, string | undefined>,
  palette: Palette,
  streams: Streams,
): Promise<number> {
  const timeoutMs = resolveTimeoutMs(invocation.timeoutMs, env);
  const { command, json } = invocation;

  if (command === 'doctor') {
    const report = await runDoctor(env, timeoutMs, {
      root: ROOT,
      requiredNode: readRequiredNode(ROOT),
    });
    streams.out(json ? render(doctorPayload(report)) : block(renderDoctor(report, palette)));
    return report.code;
  }

  if (command === 'status') {
    const report = await runStatus(env, timeoutMs);
    streams.out(json ? render(statusPayload(report)) : block(renderStatus(report, palette)));
    return EXIT_OK;
  }

  if (command === 'bench') {
    const result = runBench(ROOT);
    streams.out(json ? render(benchPayload(result)) : block(renderBench(result, palette)));
    return EXIT_OK;
  }

  return question(command, invocation, env, timeoutMs, palette, streams);
}

const HUMAN_QUESTION_RENDERERS = {
  ask: renderAsk,
  explain: renderExplain,
  timeline: renderTimeline,
} as const;

type QuestionCommand = keyof typeof HUMAN_QUESTION_RENDERERS;

async function question(
  command: QuestionCommand,
  invocation: Invocation,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  palette: Palette,
  streams: Streams,
): Promise<number> {
  const { subject, predicate } = invocation;
  if (subject === null || predicate === null) {
    // The parser guarantees this cannot happen for these three commands. The
    // check is here because the types allow it, not because the case is real.
    throw new Error(`${command} reached dispatch without a subject and a predicate`);
  }

  const answer = await runQuestion(env, { subject, predicate, via: invocation.via }, timeoutMs);
  const renderHuman = HUMAN_QUESTION_RENDERERS[command];
  streams.out(
    invocation.json
      ? render(questionPayload(command, answer))
      : block(renderHuman(answer, palette)),
  );

  // An abstention is an outcome, not a failure. It exits 0 with its reason code
  // in the output, because "the sessions never settled this" is the answer.
  return EXIT_OK;
}

export async function main(
  argv: readonly string[],
  streams: Streams = PROCESS_STREAMS,
): Promise<number> {
  loadEnvFile(new URL(ENV_FILE, ROOT));
  const env = process.env;

  try {
    const parsed = parseArgs(argv);
    if (parsed.kind === 'help') {
      streams.out(block(helpText(parsed.command)));
      return EXIT_OK;
    }
    if (parsed.kind === 'version') {
      streams.out(block(readVersion(ROOT)));
      return EXIT_OK;
    }

    const palette = paletteFor({ isTTY: streams.isTTY }, env);
    return await dispatch(parsed.invocation, env, palette, streams);
  } catch (error) {
    const code = exitCodeFor(error);
    streams.err(`lacuna: ${messageFor(error)}\n`);
    if (code === EXIT_USAGE) streams.err('try "lacuna --help"\n');
    return code;
  }
}
