import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

/**
 * The CLI as a process, which is the only way some of its promises can be
 * checked at all.
 *
 * Everything else under tests/unit calls the parser, the report builders and the
 * renderers directly, and none of that can see the two things a script wrapping
 * this command actually depends on: the number the shell reads, and which of the
 * two streams each byte went to. `main()` returning 2 is not the same claim as
 * the process exiting 2, and a renderer returning clean text is not the same
 * claim as stdout carrying nothing else.
 *
 * So these spawn the real entry point. They are slower than the rest of the
 * suite and there are not many of them, one per promise worth breaking:
 *
 *  - the exit code table in docs/CLI.md is what the process really returns
 *  - a failure never writes to stdout, so `lacuna ask ... --json | jq` either
 *    gets one parseable document or gets nothing
 *  - `--json` is one document, with no banner, no warning and no escape byte
 *  - the version is the manifest's version rather than a second copy of it
 *
 * No node is required. The unreachable cases point at a closed port on
 * localhost, and the configuration cases hand the process a blank setting.
 */

const run = promisify(execFile);

const ROOT = new URL('../../', import.meta.url);
const BIN = fileURLToPath(new URL('bin/lacuna.js', ROOT));

/** Nothing listens here. Reaching for it is the "node is down" case. */
const DEAD_PORT = 'http://127.0.0.1:9';

const BASE_ENV = {
  HYDRA_HTTP_URL: DEAD_PORT,
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: 'zzz-not-a-real-token-zzz',
  // Colour is off in a pipe anyway. Asking for it makes the assertion mean
  // something: the escape bytes are absent because the code checked, not
  // because nothing in the environment ever suggested them.
  TERM: 'xterm-256color',
  FORCE_COLOR: '3',
};

interface Result {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs the CLI and returns what the shell would see. A non-zero exit is an
 * expected outcome here rather than a thrown error, so it is unwrapped.
 */
async function cli(
  args: readonly string[],
  overrides: Record<string, string> = {},
): Promise<Result> {
  // This suite deliberately forces colour so it can prove that a pipe still
  // suppresses escape bytes. Some hosts set NO_COLOR for their own terminal;
  // passing both variables makes Node print a warning before Lacuna starts and
  // turns a host preference into stderr from the process under test.
  const { NO_COLOR: _hostNoColor, ...hostEnv } = process.env;
  const env = { ...hostEnv, ...BASE_ENV, ...overrides };
  try {
    const { stdout, stderr } = await run(process.execPath, [BIN, ...args], {
      env,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

const ESCAPE = String.fromCharCode(27);

function manifestVersion(): string {
  const text = readFileSync(new URL('package.json', ROOT), 'utf8');
  return (JSON.parse(text) as { version: string }).version;
}

describe('lacuna, as a process', () => {
  it('reports the version the manifest declares, and nothing else', async () => {
    const result = await cli(['--version']);

    // Not a literal. A second copy of the version in a test is a second place
    // to forget, and the promise being made is that they agree.
    expect(result.stdout.trim()).toBe(manifestVersion());
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('answers --help on stdout with every command named', async () => {
    const result = await cli(['--help']);

    expect(result.code).toBe(0);
    for (const command of ['doctor', 'status', 'ask', 'explain', 'timeline', 'bench']) {
      expect(result.stdout).toContain(command);
    }
    expect(result.stderr).toBe('');
  });

  it('puts a usage failure on stderr and leaves stdout empty', async () => {
    const result = await cli(['frobnicate']);

    // The whole point of the split. A script doing `lacuna ... | jq` sees an
    // empty input and fails cleanly, rather than being handed prose to parse.
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('unknown command "frobnicate"');
    expect(result.stderr).toContain('try "lacuna --help"');
    expect(result.code).toBe(2);
  });

  it('exits 2 on a missing argument, an unknown flag and a malformed timeout', async () => {
    const missing = await cli(['ask', 'Bellwether']);
    const unknown = await cli(['doctor', '--wat']);
    const timeout = await cli(['doctor', '--timeout=soon']);

    for (const result of [missing, unknown, timeout]) {
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
    }
    expect(missing.stderr).toContain('needs a subject and a predicate');
    expect(unknown.stderr).toContain('unknown flag "--wat"');
    expect(timeout.stderr).toContain('--timeout must be a positive whole number');
  });

  it('exits 4 when the node is not there, in both output modes', async () => {
    const human = await cli(['doctor']);
    const machine = await cli(['doctor', '--json']);

    expect(human.code).toBe(4);
    expect(human.stdout).toContain('FAIL');
    // A pipe is not a terminal, so the accent is off and the verdict is a word.
    expect(human.stdout).not.toContain(ESCAPE);

    expect(machine.code).toBe(4);
    const payload = JSON.parse(machine.stdout) as { ok: boolean; exitCode: number };
    expect(payload.ok).toBe(false);
    expect(payload.exitCode).toBe(4);
  });

  it('writes exactly one JSON document under --json, with no escape bytes', async () => {
    const result = await cli(['doctor', '--json']);

    expect(result.stdout).not.toContain(ESCAPE);
    // Parsing is the whole proof. JSON.parse rejects trailing content, so a
    // banner before the document or a warning after it fails here, which is the
    // thing that would otherwise be found by `jq` in someone's pipeline.
    const parsed = JSON.parse(result.stdout) as { command: string };
    expect(parsed.command).toBe('doctor');
  });

  it('writes nothing to stdout when a --json run fails outright', async () => {
    // Configuration that does not load, asked for machine output. The tempting
    // shape is a JSON error object; the shape that keeps a pipeline honest is
    // silence on stdout and the reason on stderr, because half a document is
    // worse than none.
    // Pinned to the node profile as well as blanked, so the case is the same
    // case on a machine that also has a cloud database configured. Without the
    // pin this test asks whichever store the developer happens to have.
    const result = await cli(['ask', 'Bellwether', 'beta_partner', '--json'], {
      LACUNA_PROFILE: 'node',
      HYDRA_HTTP_URL: '',
    });

    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('lacuna:');
    expect(result.code).toBe(3);
  });

  it('never prints the token, on any path', async () => {
    const results = await Promise.all([
      cli(['doctor']),
      cli(['doctor', '--json']),
      cli(['ask', 'Bellwether', 'beta_partner']),
    ]);

    for (const result of results) {
      expect(result.stdout).not.toContain(BASE_ENV.HYDRA_TOKEN);
      expect(result.stderr).not.toContain(BASE_ENV.HYDRA_TOKEN);
    }
  });
});
