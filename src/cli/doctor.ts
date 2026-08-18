import { accessSync, constants } from 'node:fs';
import { HydraClient, type FetchLike } from '../hydra/client.js';
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
 *
 * There are three verdicts and not two, because two of the things worth
 * checking are not fatal and reporting them as failures would be a lie that
 * costs someone an afternoon. A read only checkout cannot write under
 * artifacts/, and every question still answers, because answering reads the
 * graph and writes nothing. A node that is up and holds no entities is
 * configured correctly and will abstain with the unconnected reason on every
 * question asked of it, which looks like a broken resolver and is an ingest
 * that has not been run. Both leave the exit code at zero and say so on the
 * line. Nothing else warns: a state that can never be reached is decoration.
 */

/** The one statement used as a probe. Cheap on any graph size. */
const PROBE_CYPHER = 'MATCH (n:Entity) RETURN count(*) AS n';

/** Passed, passed with something worth saying, or failed. */
export type CheckState = 'pass' | 'warn' | 'fail';

export interface Check {
  readonly name: string;
  readonly state: CheckState;
  readonly detail: string;
  /** The process exit code to use if this is the first check that failed. */
  readonly failureCode: number;
}

export interface DoctorReport {
  readonly checks: readonly Check[];
  readonly ok: boolean;
  readonly warnings: number;
  readonly code: number;
}

function report(checks: readonly Check[]): DoctorReport {
  const failed = checks.find((check) => check.state === 'fail');
  return {
    checks,
    ok: failed === undefined,
    warnings: checks.filter((check) => check.state === 'warn').length,
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
    state: ok ? 'pass' : 'fail',
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
    return {
      name: 'artifacts',
      state: 'pass',
      detail: 'artifacts/ is writable',
      failureCode: EXIT_CONFIG,
    };
  } catch (error) {
    // A warning and not a failure: nothing on the question path writes here,
    // and no command in this CLI does either. Answering reads the graph. Only
    // the recording scripts need this, and a read only checkout that answers
    // every question correctly should not be told it is broken.
    return {
      name: 'artifacts',
      state: 'warn',
      detail: `artifacts/ is not writable, so npm run ingest, eval, bench and `
        + `snapshot will fail: ${messageFor(error)}`,
      failureCode: EXIT_CONFIG,
    };
  }
}

interface Probe {
  readonly reachable: Check;
  readonly query: Check;
}

/**
 * The count out of the probe's one row, or null if the shape is not what was
 * asked for. Null means do not warn: a node that answered something unexpected
 * is not evidence of an empty graph.
 */
function entityCount(rows: readonly (readonly unknown[])[]): number | null {
  const value = rows[0]?.[0];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

async function probe(
  config: HydraConfig,
  timeoutMs: number,
  transport?: FetchLike,
): Promise<Probe> {
  const endpoint = queryEndpoint(config);
  const client = new HydraClient(config, transport === undefined ? {} : { fetch: transport });
  const started = performance.now();

  try {
    const page = await client.query({ cypher: PROBE_CYPHER, timeoutMs });
    const ms = Math.round((performance.now() - started) * 10) / 10;
    const epoch = page.readEpoch === null ? 'no epoch reported' : `read epoch ${page.readEpoch}`;
    // The probe counts entities as well as proving the round trip, because an
    // empty graph is the one configuration that passes every other check and
    // then abstains on every question with the unconnected reason. That looks
    // like a broken resolver from the outside and it is an ingest nobody ran.
    const entities = entityCount(page.rows);
    const empty = entities === 0;
    return {
      reachable: {
        name: 'reachable',
        state: 'pass',
        detail: `${endpoint} answered`,
        failureCode: EXIT_UNAVAILABLE,
      },
      query: {
        name: 'round trip',
        state: empty ? 'warn' : 'pass',
        detail: empty
          ? `${PROBE_CYPHER} answered in ${ms}ms and counted no entities, `
            + `so every question will abstain as unconnected until ingest runs`
          : `${PROBE_CYPHER} returned ${page.rows.length} row in ${ms}ms, ${epoch}`,
        failureCode: EXIT_UNAVAILABLE,
      },
    };
  } catch (error) {
    if (error instanceof HydraTransportError) {
      return {
        reachable: {
          name: 'reachable',
          state: 'fail',
          detail: messageFor(error),
          failureCode: EXIT_UNAVAILABLE,
        },
        query: {
          name: 'round trip',
          state: 'fail',
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
        state: 'pass',
        detail: `${endpoint} answered${status}`,
        failureCode: EXIT_UNAVAILABLE,
      },
      query: {
        name: 'round trip',
        state: 'fail',
        detail: messageFor(error),
        failureCode: exitCodeFor(error),
      },
    };
  }
}

export async function runDoctor(
  env: Record<string, string | undefined>,
  timeoutMs: number,
  options: {
    readonly root: URL;
    readonly requiredNode: string;
    /** Only the tests pass this. Production opens a socket. */
    readonly fetch?: FetchLike;
  },
): Promise<DoctorReport> {
  const checks: Check[] = [nodeCheck(process.versions.node, options.requiredNode)];

  let config: HydraConfig | null = null;
  try {
    config = loadHydraConfig(env);
    checks.push({
      name: 'config',
      state: 'pass',
      detail: `${config.baseUrl}, namespace ${config.namespace}, `
        + `graph ${config.graph}, cell ${config.cell}`,
      failureCode: EXIT_CONFIG,
    });
  } catch (error) {
    checks.push({
      name: 'config',
      state: 'fail',
      detail: messageFor(error),
      failureCode: exitCodeFor(error),
    });
  }

  const token = env['HYDRA_TOKEN'];
  const hasToken = token !== undefined && token !== '';
  checks.push({
    name: 'token',
    state: hasToken ? 'pass' : 'fail',
    detail: hasToken ? 'set' : 'missing',
    failureCode: EXIT_CONFIG,
  });

  if (config === null) {
    const skipped = 'not attempted, the configuration did not load';
    checks.push(
      { name: 'reachable', state: 'fail', detail: skipped, failureCode: EXIT_CONFIG },
      { name: 'round trip', state: 'fail', detail: skipped, failureCode: EXIT_CONFIG },
    );
  } else {
    const result = await probe(config, timeoutMs, options.fetch);
    checks.push(result.reachable, result.query);
  }

  checks.push(artifactsCheck(options.root));
  return report(checks);
}
