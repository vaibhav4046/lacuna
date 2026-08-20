import { createInterface } from 'node:readline';

import { openSource } from '../hydra/open.js';
import { ask } from '../retrieval/fetch.js';
import { buildQuestion } from '../retrieval/question.js';
import { askCore } from '../contract/result.js';
import type { Palette } from './color.js';
import { pixelMark, pixelWidth } from './pixel.js';
import { planFromStore, renderReading, renderUnread } from './sentence.js';

/**
 * The whole product, at a prompt.
 *
 * `lacuna read "..."` answers one question and exits, which is right for a
 * script and wrong for a person: the second question costs another process
 * start, another store connection, and re-reading the name list that has not
 * changed. This keeps all of that between questions, so the first answer takes
 * about a second and every one after it is immediate.
 *
 * What it deliberately does not do is invent a second way to answer. Every line
 * typed here goes through the same parser and the same resolver the web product
 * and the MCP server use. If this shell ever disagreed with the Ask screen, the
 * bug would be here, and there would be nowhere else for it to hide.
 */

const PROMPT = 'lacuna ❯ ';

/** Colours only when the terminal says it can, and never when piped. */
function canColour(): boolean {
  return process.stdout.isTTY === true && process.env['NO_COLOR'] === undefined;
}

/**
 * The splash, sized to the window.
 *
 * A logo wider than the terminal wraps and stops being a logo, so a narrow
 * window gets a smaller one and a very narrow window gets none. Dropping it is
 * the correct behaviour rather than a fallback: nobody needs decoration more
 * than they need the first line of output to be readable.
 */
function splash(columns: number, colour: boolean): readonly string[] {
  for (const [height, turns] of [[26, 3], [18, 3], [12, 2]] as const) {
    if (pixelWidth({ height, turns, colour: false }) + 4 <= columns) {
      return pixelMark({ height, turns, colour });
    }
  }
  return [];
}

function banner(palette: Palette, columns: number): readonly string[] {
  const art = splash(columns, canColour());
  const lines = [...art];
  if (art.length > 0) lines.push('');
  lines.push(palette.heading('  L A C U N A'));
  lines.push(palette.dim('  memory that knows what changed'));
  lines.push('');
  lines.push(palette.dim('  Ask in a sentence. "who owns billing-gate?"'));
  lines.push(palette.dim('  :subjects  what this workspace holds     :help  everything else'));
  lines.push('');
  return lines;
}

const HELP: readonly string[] = [
  'Type a question the way you would say it.',
  '',
  '  who is the runbook owner for billing-gate?',
  '  what does token-forge depend on?',
  '  when does Lowbank launch?',
  '  what is the connection pool size for Foxglove?',
  '',
  'Commands',
  '  :subjects            names this workspace holds',
  '  :store               which store is answering',
  '  :clear               clear the screen',
  '  :help                this',
  '  :quit                leave (Ctrl+D also works)',
  '',
  'Every answer comes back with the claim it rests on. An abstention is an',
  'answer here: contradicted means two sources disagree, retracted means it was',
  'taken back, and never stated means nothing ever said it.',
];

interface Deps {
  readonly env: Record<string, string | undefined>;
  readonly palette: Palette;
  readonly timeoutMs: number;
  readonly out: (text: string) => void;
}

/**
 * One typed line, answered.
 *
 * Split out from the loop so the interesting half can be tested without a
 * terminal: the loop is readline plumbing and this is the behaviour.
 */
export async function handleLine(line: string, deps: Deps): Promise<'continue' | 'quit'> {
  const text = line.trim();
  if (text === '') return 'continue';

  if (text === ':quit' || text === ':q' || text === ':exit') return 'quit';
  if (text === ':help' || text === ':h' || text === '?') {
    deps.out(HELP.map((row) => deps.palette.dim(`  ${row}`)).join('\n'));
    return 'continue';
  }
  if (text === ':clear') {
    deps.out('[2J[H');
    return 'continue';
  }
  if (text === ':store') {
    const { source, profile } = openSource(deps.env);
    const held = source.subjects === undefined ? [] : (await source.subjects(deps.timeoutMs)).value;
    deps.out(deps.palette.dim(`  ${profile}, ${held.length} subjects`));
    return 'continue';
  }
  if (text === ':subjects') {
    const { source } = openSource(deps.env);
    const held = source.subjects === undefined ? [] : (await source.subjects(deps.timeoutMs)).value;
    deps.out(deps.palette.dim(`  ${held.join(', ')}`));
    return 'continue';
  }
  if (text.startsWith(':')) {
    deps.out(deps.palette.warn(`  no command "${text}". :help lists them.`));
    return 'continue';
  }

  const plan = await planFromStore(deps.env, text, deps.timeoutMs);
  if (plan.kind === 'unread') {
    deps.out(renderUnread(plan, deps.palette));
    return 'continue';
  }

  deps.out(renderReading(plan, deps.palette));

  const { source } = openSource(deps.env);
  const answer = await ask(
    source,
    buildQuestion(plan.subject, plan.predicate, plan.via),
    { timeoutMs: deps.timeoutMs },
  );
  const core = askCore(answer);

  if (core.status === 'answered' && core.answer !== null) {
    deps.out(`  ${deps.palette.good(core.answer)}`);
  } else {
    deps.out(`  ${deps.palette.warn(`no answer (${core.reasonCode ?? 'none'})`)}`);
  }

  for (const item of core.evidence.slice(0, 3)) {
    // The standing rides with the quote. A quote shown without it is the one
    // way this shell could hand somebody a superseded value as the answer.
    deps.out(deps.palette.dim(`    "${item.quote}"`));
    deps.out(deps.palette.dim(
      `      ${item.sessionTitle}, ${item.ts.slice(0, 10)}, ${item.standing.replace(/_/g, ' ')}`,
    ));
  }
  deps.out(deps.palette.dim(`  ${core.queries.length} query, ${core.timingMs.toFixed(1)}ms`));
  return 'continue';
}

/**
 * The loop.
 *
 * `terminal: true` is what gives arrow key history and line editing; without it
 * a typo means retyping the line, which is unusable for a prompt whose whole
 * point is asking several things in a row.
 *
 * Lines are answered strictly in order through one promise chain. Pausing the
 * interface around the await was not enough: readline delivers every line of a
 * piped stdin before the first answer comes back, so `lacuna shell < questions`
 * printed its answers interleaved and out of order. A queue is the fix, and it
 * costs nothing at a real prompt where the lines arrive one at a time anyway.
 */
export async function runShell(deps: Deps): Promise<number> {
  const write = (text: string): void => deps.out(`${text}
`);
  for (const line of banner(deps.palette, process.stdout.columns ?? 80)) write(line);

  const inner: Deps = { ...deps, out: write };

  const io = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY === true,
    prompt: canColour() ? `[38;2;128;82;255m${PROMPT}[0m` : PROMPT,
    historySize: 200,
  });

  /**
   * Asked to leave, which is not the same as the input running out.
   *
   * Piped stdin ends the moment the last line is read, so `close` fires while
   * the queue is still full and treating that as "stop" answered the first
   * question and threw the rest away. Only `:quit` abandons pending work; the
   * end of input just means no more is coming, and everything already queued
   * still gets answered.
   */
  let quit = false;
  let ended = false;
  let chain: Promise<void> = Promise.resolve();
  io.prompt();

  await new Promise<void>((resolve) => {
    const settle = (): void => { if (ended) void chain.then(() => resolve()); };

    io.on('line', (line) => {
      chain = chain.then(async () => {
        if (quit) return;
        try {
          if (await handleLine(line, inner) === 'quit') {
            quit = true;
            io.close();
            return;
          }
        } catch (error: unknown) {
          write(deps.palette.bad(`  ${error instanceof Error ? error.message : 'that did not work'}`));
        }
        if (quit) return;
        write('');
        // Resuming or prompting a closed interface throws, and by here the
        // input may well have ended.
        if (!ended) io.prompt();
      }).then(settle);
    });

    io.on('close', () => {
      ended = true;
      settle();
    });
  });

  write(deps.palette.dim('  bye'));
  return 0;
}
