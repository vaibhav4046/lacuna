import { describe, expect, it } from 'vitest';

import { COMMANDS, TIMEOUT_ENV, parseArgs, resolveTimeoutMs } from '../../src/cli/args.js';
import {
  CliConfigError,
  EXIT_CONFIG,
  EXIT_INTERNAL,
  EXIT_UNAVAILABLE,
  EXIT_USAGE,
  UsageError,
  exitCodeFor,
} from '../../src/cli/exit.js';
import {
  HydraConfigError,
  HydraQueryError,
  HydraTransportError,
} from '../../src/hydra/errors.js';
import { ReportError } from '../../src/report/bench.js';
import { RetrievalDecodeError, RetrievalError } from '../../src/retrieval/errors.js';
import { DEFAULT_QUERY_TIMEOUT_MS } from '../../src/retrieval/fetch.js';

/**
 * The command line, checked without a node.
 *
 * `parseArgs` reads no environment, opens no socket and touches no file, so
 * every case here is a pure function call. That is deliberate: the parser is the
 * one part of the CLI where a wrong branch silently answers a question nobody
 * asked, and it should be possible to prove it right on a machine with no
 * HydraDB anywhere near it.
 */

function run(...argv: string[]) {
  return parseArgs(argv);
}

function invocation(...argv: string[]) {
  const parsed = run(...argv);
  if (parsed.kind !== 'run') throw new Error(`expected a run, got ${parsed.kind}`);
  return parsed.invocation;
}

describe('parseArgs, commands', () => {
  it('accepts every command it advertises', () => {
    for (const command of COMMANDS) {
      const argv = ['ask', 'explain', 'timeline'].includes(command)
        ? [command, 'Bellwether', 'beta_partner']
        : command === 'read'
          ? [command, 'who owns Bellwether?']
          : [command];
      expect(invocation(...argv).command).toBe(command);
    }
  });

  it('reads the subject and the predicate in order', () => {
    const parsed = invocation('ask', 'Bellwether', 'beta_partner');
    expect(parsed.subject).toBe('Bellwether');
    expect(parsed.predicate).toBe('beta_partner');
    expect(parsed.via).toBeNull();
  });

  it('rejects no command at all', () => {
    expect(() => run()).toThrow(UsageError);
  });

  it('rejects a command it does not have', () => {
    expect(() => run('summarise', 'Bellwether')).toThrow(/unknown command "summarise"/);
  });

  it('rejects a question command with no predicate', () => {
    expect(() => run('ask', 'Bellwether')).toThrow(/needs a subject and a predicate/);
  });

  it('rejects a question command with no positionals', () => {
    for (const command of ['ask', 'explain', 'timeline']) {
      expect(() => run(command)).toThrow(UsageError);
    }
  });

  it('rejects a fourth positional', () => {
    expect(() => run('ask', 'Bellwether', 'beta_partner', 'extra'))
      .toThrow(/unexpected argument "extra"/);
  });

  it('rejects arguments to a command that takes none', () => {
    expect(() => run('doctor', 'Bellwether')).toThrow(/doctor takes no arguments/);
    expect(() => run('bench', 'x')).toThrow(UsageError);
  });
});

describe('parseArgs, flags', () => {
  it('rejects an unknown flag rather than ignoring it', () => {
    expect(() => run('ask', 'A', 'b', '--jsn')).toThrow(/unknown flag "--jsn"/);
    expect(() => run('doctor', '-x')).toThrow(UsageError);
  });

  it('takes --json as a boolean and refuses a value', () => {
    expect(invocation('ask', 'A', 'b').json).toBe(false);
    expect(invocation('ask', 'A', 'b', '--json').json).toBe(true);
    expect(invocation('--json', 'ask', 'A', 'b').json).toBe(true);
    expect(() => run('ask', 'A', 'b', '--json=true')).toThrow(/--json takes no value/);
  });

  it('takes --via as a separate word or after an equals sign', () => {
    expect(invocation('ask', 'A', 'b', '--via', 'beta_partner').via).toBe('beta_partner');
    expect(invocation('ask', 'A', 'b', '--via=beta_partner').via).toBe('beta_partner');
  });

  it('rejects --via with no value, including a following flag', () => {
    expect(() => run('ask', 'A', 'b', '--via')).toThrow(/--via needs a value/);
    expect(() => run('ask', 'A', 'b', '--via', '--json')).toThrow(/--via needs a value/);
    expect(() => run('ask', 'A', 'b', '--via=')).toThrow(/--via needs a value/);
  });

  it('rejects --via on the commands it does not apply to', () => {
    expect(() => run('doctor', '--via', 'beta_partner'))
      .toThrow(/--via applies to ask, explain and timeline only/);
    expect(() => run('status', '--via=x')).toThrow(UsageError);
  });

  it('takes --timeout as a positive whole number of milliseconds', () => {
    expect(invocation('ask', 'A', 'b', '--timeout', '1500').timeoutMs).toBe(1500);
    expect(invocation('ask', 'A', 'b', '--timeout=250').timeoutMs).toBe(250);
    expect(invocation('ask', 'A', 'b').timeoutMs).toBeNull();
  });

  it('rejects a --timeout that is not a positive whole number', () => {
    for (const bad of ['0', '-5', 'soon', '1.5', '1e400', '']) {
      expect(() => run('ask', 'A', 'b', `--timeout=${bad}`)).toThrow(UsageError);
    }
    expect(() => run('ask', 'A', 'b', '--timeout')).toThrow(/--timeout needs a value/);
  });
});

describe('parseArgs, help and version', () => {
  it('answers --help and -h with the general text', () => {
    expect(run('--help')).toEqual({ kind: 'help', command: null });
    expect(run('-h')).toEqual({ kind: 'help', command: null });
  });

  it('answers help for a named command', () => {
    expect(run('ask', '--help')).toEqual({ kind: 'help', command: 'ask' });
    expect(run('--help', 'doctor')).toEqual({ kind: 'help', command: 'doctor' });
  });

  it('prefers help over complaining about the rest of the line', () => {
    expect(run('ask', '--help')).toEqual({ kind: 'help', command: 'ask' });
    expect(run('nonsense', '--help')).toEqual({ kind: 'help', command: null });
  });

  it('answers --version and -V', () => {
    expect(run('--version')).toEqual({ kind: 'version' });
    expect(run('-V')).toEqual({ kind: 'version' });
  });
});

/**
 * The five documented numbers, asserted against the error classes that actually
 * reach the top of the CLI. docs/CLI.md states this mapping; this is the copy
 * that fails when it drifts.
 */
describe('exitCodeFor', () => {
  it('calls a wrong command line a usage error', () => {
    expect(exitCodeFor(new UsageError('no'))).toBe(EXIT_USAGE);
    expect(exitCodeFor(new RetrievalError('subject is not a term'))).toBe(EXIT_USAGE);
  });

  it('calls missing or rejected configuration a configuration error', () => {
    expect(exitCodeFor(new CliConfigError('bad'))).toBe(EXIT_CONFIG);
    expect(exitCodeFor(new HydraConfigError('HYDRA_TOKEN is missing'))).toBe(EXIT_CONFIG);
    expect(exitCodeFor(new HydraQueryError(401, 'unauthorised'))).toBe(EXIT_CONFIG);
    expect(exitCodeFor(new HydraQueryError(403, 'forbidden'))).toBe(EXIT_CONFIG);
  });

  it('calls a node that did not answer unavailable', () => {
    expect(exitCodeFor(new HydraTransportError('connect ECONNREFUSED'))).toBe(EXIT_UNAVAILABLE);
    expect(exitCodeFor(new HydraQueryError(503, 'overloaded'))).toBe(EXIT_UNAVAILABLE);
    expect(exitCodeFor(new HydraQueryError(500, 'engine panic'))).toBe(EXIT_UNAVAILABLE);
  });

  it('calls everything it cannot place internal', () => {
    expect(exitCodeFor(new RetrievalDecodeError('row shape'))).toBe(EXIT_INTERNAL);
    expect(exitCodeFor(new ReportError('systems is not an array'))).toBe(EXIT_INTERNAL);
    expect(exitCodeFor(new HydraQueryError(418, 'teapot'))).toBe(EXIT_INTERNAL);
    expect(exitCodeFor('a string that is not an error')).toBe(EXIT_INTERNAL);
  });
});

describe('resolveTimeoutMs', () => {
  it('prefers the flag over the environment', () => {
    expect(resolveTimeoutMs(1234, { [TIMEOUT_ENV]: '9999' })).toBe(1234);
  });

  it('falls back to the environment, then to the default', () => {
    expect(resolveTimeoutMs(null, { [TIMEOUT_ENV]: '9999' })).toBe(9999);
    expect(resolveTimeoutMs(null, {})).toBe(DEFAULT_QUERY_TIMEOUT_MS);
    expect(resolveTimeoutMs(null, { [TIMEOUT_ENV]: '  ' })).toBe(DEFAULT_QUERY_TIMEOUT_MS);
  });

  it('treats a malformed environment value as a configuration error', () => {
    expect(() => resolveTimeoutMs(null, { [TIMEOUT_ENV]: 'later' })).toThrow(CliConfigError);
    expect(() => resolveTimeoutMs(null, { [TIMEOUT_ENV]: '-1' })).toThrow(CliConfigError);
  });
});

/**
 * A sentence is its own command, not a second arity for `ask`.
 *
 * The two arities would collide in exactly the case that matters. `lacuna ask
 * Bellwether` is a subject with a forgotten predicate, and it is also a
 * perfectly well formed one-word question, and a parser that guessed between
 * them would turn a usage error into a wrong answer. So `read` is separate and
 * takes one quoted argument.
 */
describe('parseArgs, read', () => {
  it('takes the question as one argument', () => {
    const parsed = invocation('read', 'who owns billing-gate?');
    expect(parsed.command).toBe('read');
    expect(parsed.subject).toBe('who owns billing-gate?');
    expect(parsed.predicate).toBeNull();
  });

  it('refuses an unquoted question by naming the actual mistake', () => {
    // The shell split it. Reporting "needs a subject and a predicate" here
    // would send somebody looking in entirely the wrong place.
    expect(() => run('read', 'who', 'owns', 'billing-gate')).toThrow(/one quoted question/);
  });

  it('refuses an empty question', () => {
    expect(() => run('read')).toThrow(/needs a question in quotes/);
    expect(() => run('read', '   ')).toThrow(/needs a question in quotes/);
  });

  it('refuses --via, which belongs to the commands that name their own terms', () => {
    expect(() => run('read', 'who owns billing-gate?', '--via', 'vendor')).toThrow(/--via applies to/);
  });

  it('carries --json and --timeout like every other command', () => {
    const parsed = invocation('read', 'who owns billing-gate?', '--json', '--timeout', '5000');
    expect(parsed.json).toBe(true);
    expect(parsed.timeoutMs).toBe(5_000);
  });
});
