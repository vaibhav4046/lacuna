import { accessSync, constants } from 'node:fs';
import { HydraClient } from '../hydra/client.js';
import { loadHydraConfig, queryEndpoint, type HydraConfig } from '../hydra/config.js';
import { HydraQueryError, HydraTransportError } from '../hydra/errors.js';
import { EXIT_CONFIG, EXIT_OK, EXIT_UNAVAILABLE, exitCodeFor, messageFor } from './exit.js';

/**
 * Everything that has to be true before an answer is possible, checked in order
 * and reported one line each.
 *
 * The distinction this command exists to draw is between "the node is not
 * there" and "the node is there and said no". Both look identical from the
 * outside when a query fails, and they need opposite responses: one is a service
 * to start, the other is a token or a namespace to fix. So reachability and the
 * round trip are two separate checks, and an HTTP error counts as proof the node
 * answered even though the query did not succeed.
 *
 * The token is reported as set or missing and never printed. That is the whole
 * of what this command knows about it.
 */

/** The one statement used as a probe. Cheap on any graph size. */
const PROBE_CYPHER = 'MATCH (n:Entity) RETURN count(*) AS n';

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
  /** The process exit code to use if this is the first check that failed. */
  readonly failureCode: number;
}

export interface DoctorReport {
  readonly checks: readonly Check[];
  readonly ok: boolean;
  readonly code: number;
}

function report(checks: readonly Check[]): DoctorReport {
  const failed = checks.find((check) => !check.ok);
  return {
    checks,
    ok: failed === undefined,
    code: failed === undefined ? EXIT_OK : failed.failureCode,
  };
}

/** ">=20.11.0" against "24.12.0", without pulling in a semver package. */
function meetsMinimum(actual: string, required: string): boolean {
  const parse = (text: string): readonly number[] =>
    (text.match(/\d+/g) ?? []).map((part) => Number(part));
  const have = parse(actual);
  const need = parse(required);
  for (let at = 0; at < need.length; at += 1) {
    const mine = have[at] ?? 0;
    const theirs = need[at] ?? 0;
    if (mine !== theirs) return mine > theirs;
  }
  return true;
}

function nodeCheck(runtime: string, required: string): Check {
  const ok = meetsMinimum(runtime, required);
  return {
    name: 'node',
    ok,
    detail: ok
      ? `v${runtime}, needs ${required}`
      : `v${runtime} is below the required ${required}`,
    failureCode: EXIT_CONFIG,
  };
}

function artifactsCheck(root: URL): Check {
  const directory = new URL('artifacts/', root);
  try {
    // A check, never a write. This command must not create anything under
    // artifacts/, and asking the filesystem is enough to answer the question.
    accessSync(directory, constants.W_OK);
    return { name: 'artifacts', ok: true, detail: 'artifacts/ is writable', failureCode: EXIT_CONFIG };
  } catch (error) {
    return {
      name: 'artifacts',
      ok: false,
      detail: `artifacts/ is not writable: ${messageFor(error)}`,
      failureCode: EXIT_CONFIG,
    };
  }
}

interface Probe {
  readonly reachable: Check;
  readonly query: Check;
}

async function probe(config: HydraConfig, timeoutMs: number): Promise<Probe> {
  const endpoint = queryEndpoint(config);
  const client = new HydraClient(config);
  const started = performance.now();

  try {
    const page = await client.query({ cypher: PROBE_CYPHER, timeoutMs });
    const ms = Math.round((performance.now() - started) * 10) / 10;
    const epoch = page.readEpoch === null ? 'no epoch reported' : `read epoch ${page.readEpoch}`;
    return {
      reachable: {
        name: 'reachable',
        ok: true,
        detail: `${endpoint} answered`,
        failureCode: EXIT_UNAVAILABLE,
      },
      query: {
        name: 'round trip',
        ok: true,
        detail: `${PROBE_CYPHER} returned ${page.rows.length} row in ${ms}ms, ${epoch}`,
        failureCode: EXIT_UNAVAILABLE,
      },
    };
  } catch (error) {
    if (error instanceof HydraTransportError) {
      return {
        reachable: {
          name: 'reachable',
          ok: false,
          detail: messageFor(error),
          failureCode: EXIT_UNAVAILABLE,
        },
        query: {
          name: 'round trip',
          ok: false,
          detail: 'not attempted, the node did not answer',
          failureCode: EXIT_UNAVAILABLE,
        },
      };
    }
    // Anything else means bytes came back. The node is up; this request is not
    // acceptable to it, which is a different problem with a different fix.
    const status = error instanceof HydraQueryError ? ` (HTTP ${error.status})` : '';
    return {
      reachable: {
        name: 'reachable',
        ok: true,
        detail: `${endpoint} answered${status}`,
        failureCode: EXIT_UNAVAILABLE,
      },
      query: {
        name: 'round trip',
        ok: false,
        detail: messageFor(error),
        failureCode: exitCodeFor(error),
      },
    };
  }
}

export async function runDoctor(
  env: Record<string, string | undefined>,
  timeoutMs: number,
  options: { readonly root: URL; readonly requiredNode: string },
): Promise<DoctorReport> {
  const checks: Check[] = [nodeCheck(process.versions.node, options.requiredNode)];

  let config: HydraConfig | null = null;
  try {
    config = loadHydraConfig(env);
    checks.push({
      name: 'config',
      ok: true,
      detail: `${config.baseUrl}, namespace ${config.namespace}, `
        + `graph ${config.graph}, cell ${config.cell}`,
      failureCode: EXIT_CONFIG,
    });
  } catch (error) {
    checks.push({
      name: 'config',
      ok: false,
      detail: messageFor(error),
      failureCode: exitCodeFor(error),
    });
  }

  const token = env['HYDRA_TOKEN'];
  checks.push({
    name: 'token',
    ok: token !== undefined && token !== '',
    detail: token !== undefined && token !== '' ? 'set' : 'missing',
    failureCode: EXIT_CONFIG,
  });

  if (config === null) {
    const skipped = 'not attempted, the configuration did not load';
    checks.push(
      { name: 'reachable', ok: false, detail: skipped, failureCode: EXIT_CONFIG },
      { name: 'round trip', ok: false, detail: skipped, failureCode: EXIT_CONFIG },
    );
  } else {
    const result = await probe(config, timeoutMs);
    checks.push(result.reachable, result.query);
  }

  checks.push(artifactsCheck(options.root));
  return report(checks);
}
