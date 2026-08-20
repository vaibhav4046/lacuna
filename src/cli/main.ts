import type { Invocation } from './args.js';
import { parseArgs, resolveTimeoutMs } from './args.js';
import { runBench } from './bench.js';
import { paletteFor, type Palette } from './color.js';
import { runDoctor } from './doctor.js';
import { loadEnvFile } from './env.js';
import { EXIT_OK, EXIT_USAGE, exitCodeFor, messageFor } from './exit.js';
import { helpText } from './help.js';
import { markHeader } from './mark.js';
import { renderAsk, renderExplain, renderTimeline } from './human.js';
import { renderBench, renderDoctor, renderStatus } from './human-report.js';
import { benchPayload, doctorPayload, questionPayload, render, statusPayload } from './json.js';
import { readRequiredNode, readVersion } from './manifest.js';
import { profilePayload } from './json.js';
import { renderProfile } from './human-report.js';
import { runProfile } from './profile.js';
import { runQuestion } from './question.js';
import { planFromStore, renderReading, renderUnread } from './sentence.js';
import { runStatus } from './status.js';

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

/**
 * Read when they exist, in this order, and neither overwrites a variable the
 * shell already set.
 *
 * Two files because there are two stores. `.env.local` configures the
 * self-hosted node; `.env.cloud` configures HydraDB Cloud under distinct
 * names, so a machine can hold both and `LACUNA_PROFILE` picks between them
 * rather than one file silently overwriting the other.
 */
const ENV_FILES = ['.env.local', '.env.cloud'] as const;

export interface Streams {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly isTTY: boolean;
  /** Terminal width, when there is a terminal. Only the mark reads it. */
  readonly columns?: number;
}

/** What a terminal that never told us its width is assumed to be. */
const ASSUMED_COLUMNS = 80;

const PROCESS_STREAMS: Streams = {
  out: (text) => { process.stdout.write(text); },
  err: (text) => { process.stderr.write(text); },
  isTTY: process.stdout.isTTY === true,
  columns: process.stdout.columns,
};

/** Human output is a block of lines; it is written with one trailing newline. */
function block(text: string): string {
  return `${text}\n`;
}

/**
 * The mark, above the three commands that answer "what am I pointed at".
 *
 * Not above `ask`, `explain` or `timeline`. Those get run in a loop and a logo
 * reprinted on every question is litter. `markHeader` returns nothing at all
 * when stdout is redirected or `--json` is set, so this adds no bytes to any
 * output something else is going to read.
 */
function markLines(palette: Palette, streams: Streams, json: boolean): string {
  const rows = markHeader(palette, {
    isTTY: streams.isTTY,
    json,
    columns: streams.columns ?? ASSUMED_COLUMNS,
  });
  return rows.length === 0 ? '' : `${rows.join('\n')}\n\n`;
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
    streams.out(
      json
        ? render(doctorPayload(report))
        : `${markLines(palette, streams, json)}${block(renderDoctor(report, palette))}`,
    );
    return report.code;
  }

  if (command === 'status') {
    const report = await runStatus(env, timeoutMs);
    streams.out(
      json
        ? render(statusPayload(report))
        : `${markLines(palette, streams, json)}${block(renderStatus(report, palette))}`,
    );
    return EXIT_OK;
  }

  if (command === 'profile') {
    const report = runProfile(env);
    streams.out(json ? render(profilePayload(report)) : block(renderProfile(report, palette)));
    return EXIT_OK;
  }

  if (command === 'bench') {
    const result = runBench(ROOT);
    streams.out(json ? render(benchPayload(result)) : block(renderBench(result, palette)));
    return EXIT_OK;
  }

  if (command === 'read') {
    return await sentence(invocation, env, timeoutMs, palette, streams);
  }

  return question(command, invocation, env, timeoutMs, palette, streams);
}

/**
 * A question in the words somebody typed, resolved the same way as `ask`.
 *
 * The parser runs against this store's own names and against the predicates the
 * matched subject records, so a refusal here means the workspace does not hold
 * that name or that property rather than that this file had not thought of a
 * word. What it prints first is the reading, because a parser in front of a
 * resolver can produce a correct and fully evidenced answer to a question
 * nobody asked, and the reading is where that is catchable.
 */
async function sentence(
  invocation: Invocation,
  env: Record<string, string | undefined>,
  timeoutMs: number,
  palette: Palette,
  streams: Streams,
): Promise<number> {
  const text = invocation.subject;
  if (text === null) throw new Error('read reached dispatch without a question');

  const plan = await planFromStore(env, text, timeoutMs);
  if (plan.kind === 'unread') {
    if (invocation.json) {
      streams.out(render({ read: null, unread: plan.reason, holds: plan.holds, records: plan.records, answer: null }));
    } else {
      streams.err(block(renderUnread(plan, palette)));
    }
    // Not a usage error: the command line was fine and the workspace simply
    // does not hold what was asked for. Exit 0 for the same reason an
    // abstention does.
    return EXIT_OK;
  }

  if (!invocation.json) {
    streams.out(block(renderReading(plan, palette)));
  }
  const answer = await runQuestion(env, { subject: plan.subject, predicate: plan.predicate, via: plan.via }, timeoutMs);
  streams.out(
    invocation.json
      ? render({
        read: { subject: plan.subject, predicate: plan.predicate, via: plan.via, fromWords: plan.fromWords },
        unread: null,
        holds: [],
        records: plan.records,
        answer: questionPayload('ask', answer),
      })
      : block(renderAsk(answer, palette)),
  );
  return EXIT_OK;
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
  for (const file of ENV_FILES) loadEnvFile(new URL(file, ROOT));
  const env = process.env;

  try {
    const parsed = parseArgs(argv);
    if (parsed.kind === 'help') {
      const palette = paletteFor({ isTTY: streams.isTTY }, env);
      streams.out(`${markLines(palette, streams, false)}${block(helpText(parsed.command))}`);
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
