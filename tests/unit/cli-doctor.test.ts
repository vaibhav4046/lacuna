import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { PLAIN } from '../../src/cli/color.js';
import { runDoctor, type Check, type DoctorReport } from '../../src/cli/doctor.js';
import { renderDoctor } from '../../src/cli/human-report.js';
import { doctorPayload } from '../../src/cli/json.js';

/**
 * The command someone runs when nothing works, tested for the thing that makes
 * it worth running: that it separates what is broken from what is merely worth
 * knowing.
 *
 * Two of these checks warn rather than fail, and both of them are states a real
 * checkout gets into. A read only clone cannot write under artifacts/ and
 * answers every question correctly anyway. A node that is up with an empty
 * graph is configured perfectly and abstains on everything. Reporting either as
 * a failure sends someone looking for a broken install they do not have, so the
 * exit code stays at zero and the line says what is missing.
 *
 * The node is a fake transport here. Nothing in this file opens a socket.
 */

const ENV = {
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'local',
  HYDRA_GRAPH: 'default',
  HYDRA_CELL: 'cell-0',
  HYDRA_TOKEN: 'zzz-not-a-real-token-zzz',
};

/** The repository root, which has an artifacts/ directory. */
const ROOT = new URL('../../', import.meta.url);

const temporary: string[] = [];

/** A root with no artifacts/ under it, which is what a read only clone looks like. */
function rootWithoutArtifacts(): URL {
  const directory = mkdtempSync(join(tmpdir(), 'lacuna-doctor-'));
  temporary.push(directory);
  return pathToFileURL(`${directory}/`);
}

afterAll(() => {
  for (const directory of temporary) rmSync(directory, { recursive: true, force: true });
});

/** One row of the wire shape the node really sends: values arrive tagged. */
function page(rows: readonly (readonly unknown[])[]): Response {
  return new Response(JSON.stringify({
    query_id: 'server-assigned',
    columns: ['n'],
    rows,
    read_epoch: 67,
    next_cursor: null,
    bookmark: null,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** A node that answers the probe with one row holding `count`. */
function counting(count: number) {
  return async (): Promise<Response> => page([[{ type: 'integer', value: count }]]);
}

/** A node that is not there. */
const refusing = async (): Promise<Response> => {
  throw new TypeError('fetch failed');
};

function find(report: DoctorReport, name: string): Check {
  const check = report.checks.find((entry) => entry.name === name);
  if (check === undefined) throw new Error(`no check named ${name}`);
  return check;
}

const options = { root: ROOT, requiredNode: '>=20.11.0' };

describe('runDoctor', () => {
  it('passes every check against a node holding a graph', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    expect(report.ok).toBe(true);
    expect(report.warnings).toBe(0);
    expect(report.code).toBe(0);
    expect(report.checks.map((check) => check.state))
      .toEqual(['pass', 'pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('warns rather than fails when the node is up and the graph is empty', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(0) });
    const trip = find(report, 'round trip');

    expect(trip.state).toBe('warn');
    expect(trip.detail).toContain('no entities');
    expect(trip.detail).toContain('unconnected');
    // The whole point of the third state: this is not a failure.
    expect(report.ok).toBe(true);
    expect(report.code).toBe(0);
    expect(report.warnings).toBe(1);
  });

  it('warns rather than fails when artifacts/ cannot be written', async () => {
    const report = await runDoctor(ENV, 1_000, {
      ...options,
      root: rootWithoutArtifacts(),
      fetch: counting(86),
    });
    const artifacts = find(report, 'artifacts');

    expect(artifacts.state).toBe('warn');
    expect(artifacts.detail).toContain('not writable');
    // Answering reads the graph. A clone that cannot record still answers.
    expect(report.ok).toBe(true);
    expect(report.code).toBe(0);
  });

  it('fails, with the unavailable code, when the node does not answer', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: refusing });

    expect(find(report, 'reachable').state).toBe('fail');
    expect(find(report, 'round trip').state).toBe('fail');
    expect(report.ok).toBe(false);
    expect(report.code).toBe(4);
  });

  it('fails on a missing token without printing it, set or unset', async () => {
    const withToken = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    expect(find(withToken, 'token').detail).toBe('set');

    const stripped = { ...ENV, HYDRA_TOKEN: '' };
    const without = await runDoctor(stripped, 1_000, { ...options, fetch: counting(86) });
    expect(find(without, 'token').state).toBe('fail');
    expect(find(without, 'token').detail).toBe('missing');
    expect(JSON.stringify(without)).not.toContain(ENV.HYDRA_TOKEN);
  });

  it('takes the code of the first failure, not the last', async () => {
    const broken = { ...ENV, HYDRA_HTTP_URL: '' };
    const report = await runDoctor(broken, 1_000, { ...options, fetch: counting(86) });

    // Configuration fails before reachability is even attempted, and the exit
    // code is the one that names the fix.
    expect(find(report, 'config').state).toBe('fail');
    expect(find(report, 'reachable').detail).toContain('not attempted');
    expect(report.code).toBe(3);
  });

  it('does not warn when the node answers a shape it did not ask for', async () => {
    const odd = async (): Promise<Response> => page([]);

    const report = await runDoctor(ENV, 1_000, { ...options, fetch: odd });
    // No rows is not evidence of an empty graph, so it is not a warning about
    // one. Guessing here would put a wrong diagnosis on the screen.
    expect(find(report, 'round trip').state).toBe('pass');
  });
});

describe('renderDoctor', () => {
  it('prints all three verdicts as words', async () => {
    const passing = renderDoctor(
      await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) }),
      PLAIN,
    );
    expect(passing).toContain('PASS');
    expect(passing).toContain('All checks passed.');

    const warning = renderDoctor(
      await runDoctor(ENV, 1_000, { ...options, fetch: counting(0) }),
      PLAIN,
    );
    expect(warning).toContain('WARN');

    const failing = renderDoctor(
      await runDoctor(ENV, 1_000, { ...options, fetch: refusing }),
      PLAIN,
    );
    expect(failing).toContain('FAIL');
  });

  it('says a warning did not change the exit code', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(0) });
    const text = renderDoctor(report, PLAIN);

    expect(text).toContain('All checks passed.');
    expect(text).toContain('1 warning(s), which do not affect the exit code.');
  });

  it('counts the failures and names the exit code', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: refusing });
    expect(renderDoctor(report, PLAIN)).toContain('2 check(s) failed, exit code 4.');
  });

  it('names every check on its own line', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    const text = renderDoctor(report, PLAIN);

    for (const check of report.checks) {
      expect(text).toContain(check.name);
    }
  });

  it('carries no escape sequences under the plain palette', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(0) });
    expect(renderDoctor(report, PLAIN)).not.toContain(String.fromCharCode(27));
  });

  it('never prints the token', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    expect(renderDoctor(report, PLAIN)).not.toContain(ENV.HYDRA_TOKEN);
  });
});

describe('doctorPayload', () => {
  it('is valid JSON with the keys a script reads', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    const parsed = JSON.parse(JSON.stringify(doctorPayload(report))) as {
      command: string;
      ok: boolean;
      warnings: number;
      exitCode: number;
      checks: readonly { name: string; ok: boolean; state: string; detail: string }[];
    };

    expect(parsed.command).toBe('doctor');
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings).toBe(0);
    expect(parsed.exitCode).toBe(0);
    expect(parsed.checks).toHaveLength(6);
    expect(parsed.checks.map((check) => check.name))
      .toEqual(['node', 'config', 'token', 'reachable', 'round trip', 'artifacts']);
  });

  it('reports a warning as ok true and state warn, so old readers still work', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(0) });
    const parsed = JSON.parse(JSON.stringify(doctorPayload(report))) as {
      ok: boolean;
      warnings: number;
      checks: readonly { name: string; ok: boolean; state: string }[];
    };
    const trip = parsed.checks.find((check) => check.name === 'round trip');

    expect(trip?.state).toBe('warn');
    expect(trip?.ok).toBe(true);
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings).toBe(1);
  });

  it('reports a failure as ok false with the exit code', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: refusing });
    const parsed = JSON.parse(JSON.stringify(doctorPayload(report))) as {
      ok: boolean;
      exitCode: number;
      checks: readonly { name: string; ok: boolean; state: string }[];
    };

    expect(parsed.ok).toBe(false);
    expect(parsed.exitCode).toBe(4);
    expect(parsed.checks.find((check) => check.name === 'reachable')?.ok).toBe(false);
  });

  it('contains no token, under any spelling', async () => {
    const report = await runDoctor(ENV, 1_000, { ...options, fetch: counting(86) });
    const text = JSON.stringify(doctorPayload(report));

    expect(text).not.toContain(ENV.HYDRA_TOKEN);
    expect(text.toLowerCase()).not.toContain('zzz-not-a-real');
  });
});
