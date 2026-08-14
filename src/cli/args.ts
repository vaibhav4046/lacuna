import { DEFAULT_QUERY_TIMEOUT_MS } from '../retrieval/fetch';
import { CliConfigError, UsageError } from './exit';

/**
 * Command line parsing, kept free of side effects.
 *
 * Nothing here reads the environment, opens a socket or writes a byte. It takes
 * an argv array and returns what was asked for, which is what makes every branch
 * of it testable without a HydraDB node. The environment is consulted only in
 * `resolveTimeoutMs`, which takes the environment as an argument for the same
 * reason.
 *
 * A flag that is wrong is a refusal, not a default. Silently ignoring an unknown
 * flag is how a typo becomes an answer to a question nobody asked.
 */

export const COMMANDS = ['doctor', 'status', 'ask', 'explain', 'timeline', 'bench'] as const;

export type Command = (typeof COMMANDS)[number];

/** The three commands that take a subject and a predicate. */
export const QUESTION_COMMANDS: readonly Command[] = ['ask', 'explain', 'timeline'];

/** Environment variable read when --timeout is absent. */
export const TIMEOUT_ENV = 'LACUNA_TIMEOUT_MS';

export interface Invocation {
  readonly command: Command;
  readonly subject: string | null;
  readonly predicate: string | null;
  readonly via: string | null;
  readonly json: boolean;
  /** Null means "not given on the command line", not "no timeout". */
  readonly timeoutMs: number | null;
}

export type Parsed =
  | { readonly kind: 'help'; readonly command: Command | null }
  | { readonly kind: 'version' }
  | { readonly kind: 'run'; readonly invocation: Invocation };

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

function takesQuestion(command: Command): boolean {
  return QUESTION_COMMANDS.includes(command);
}

export function parseArgs(argv: readonly string[]): Parsed {
  const positionals: string[] = [];
  let wantsHelp = false;
  let wantsVersion = false;
  let json = false;
  let via: string | null = null;
  let timeoutText: string | null = null;

  let at = 0;
  const take = (name: string, inline: string | null): string => {
    if (inline !== null) {
      if (inline === '') throw new UsageError(`${name} needs a value`);
      return inline;
    }
    at += 1;
    const next = argv[at];
    // A value that looks like a flag is almost always a forgotten argument, and
    // reading it as the value would hide the mistake one command deeper.
    if (next === undefined || next.startsWith('-')) {
      throw new UsageError(`${name} needs a value`);
    }
    return next;
  };

  for (; at < argv.length; at += 1) {
    const token = argv[at];
    if (token === undefined) break;

    if (token === '' || !token.startsWith('-')) {
      positionals.push(token);
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inline = equals === -1 ? null : token.slice(equals + 1);

    switch (name) {
      case '-h':
      case '--help':
        wantsHelp = true;
        break;
      case '-V':
      case '--version':
        wantsVersion = true;
        break;
      case '--json':
        if (inline !== null) throw new UsageError('--json takes no value');
        json = true;
        break;
      case '--via':
        via = take('--via', inline);
        break;
      case '--timeout':
        timeoutText = take('--timeout', inline);
        break;
      default:
        throw new UsageError(`unknown flag "${name}"`);
    }
  }

  // Help wins over everything, including a malformed command line. Someone
  // asking what the arguments are should not be told their arguments are wrong.
  if (wantsHelp) {
    const first = positionals[0];
    return { kind: 'help', command: first !== undefined && isCommand(first) ? first : null };
  }
  if (wantsVersion) return { kind: 'version' };

  const head = positionals[0];
  if (head === undefined) {
    throw new UsageError('no command given, try "lacuna --help"');
  }
  if (!isCommand(head)) {
    throw new UsageError(`unknown command "${head}", try "lacuna --help"`);
  }

  const timeoutMs = timeoutText === null ? null : parseTimeout(timeoutText);

  if (!takesQuestion(head)) {
    if (positionals.length > 1) {
      throw new UsageError(`${head} takes no arguments, got "${positionals[1] ?? ''}"`);
    }
    if (via !== null) {
      throw new UsageError('--via applies to ask, explain and timeline only');
    }
    return {
      kind: 'run',
      invocation: { command: head, subject: null, predicate: null, via: null, json, timeoutMs },
    };
  }

  const subject = positionals[1];
  const predicate = positionals[2];
  if (subject === undefined || predicate === undefined) {
    throw new UsageError(`${head} needs a subject and a predicate, for example `
      + `"lacuna ${head} Bellwether beta_partner"`);
  }
  if (positionals.length > 3) {
    throw new UsageError(`unexpected argument "${positionals[3] ?? ''}"`);
  }

  return {
    kind: 'run',
    invocation: { command: head, subject, predicate, via, json, timeoutMs },
  };
}

function parseTimeout(text: string): number {
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new UsageError(
      `--timeout must be a positive whole number of milliseconds, got "${text}"`,
    );
  }
  return value;
}

/**
 * Flags beat the environment, the environment beats the default. A malformed
 * environment value is a configuration error rather than a usage error, because
 * the person running the command did not type it.
 */
export function resolveTimeoutMs(
  flagMs: number | null,
  env: Record<string, string | undefined>,
): number {
  if (flagMs !== null) return flagMs;

  const raw = env[TIMEOUT_ENV];
  if (raw === undefined || raw.trim() === '') return DEFAULT_QUERY_TIMEOUT_MS;

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new CliConfigError(
      `${TIMEOUT_ENV} must be a positive whole number of milliseconds, got "${raw}"`,
    );
  }
  return value;
}
