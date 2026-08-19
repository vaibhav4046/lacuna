import { HydraClient } from './client.js';
import { cloudFromEnv, type HydraCloud } from './cloud.js';
import { CloudSource } from './cloud-source.js';
import { loadHydraConfig } from './config.js';
import { HydraConfigError } from './errors.js';
import { NodeSource } from './node-source.js';
import type { HydraSource } from './source.js';

/**
 * Which store a client reads, decided once, in one place.
 *
 * "One context. Any agent." is a claim about where the context lives, and it
 * is only true if the terminal and the browser can be pointed at the same
 * store. Until this file existed the web read HydraDB Cloud and the CLI and
 * the MCP server read a node on loopback, which meant the three surfaces
 * agreed with each other and not necessarily with production.
 *
 * Two profiles, and the rule between them is boring on purpose:
 *
 *   cloud   HydraDB Cloud. What production reads.
 *   node    the self-hosted node. What a developer runs beside the tests.
 *
 * `LACUNA_PROFILE` decides when it is set. Otherwise a configured cloud wins,
 * because a machine that has been given a cloud database has been told which
 * store it belongs to. A machine with neither is a configuration error rather
 * than a silent fallback: answering from the wrong store is worse than
 * refusing to answer.
 */

export type Profile = 'cloud' | 'node';

export interface OpenedSource {
  readonly source: HydraSource;
  readonly profile: Profile;
  /** One line naming the store, safe to print. Never a URL, never a token. */
  readonly describe: string;
  /** Set on the node profile, for the surfaces that report node identity. */
  readonly client: HydraClient | null;
  readonly cloud: HydraCloud | null;
}

export function readProfile(env: Record<string, string | undefined>): Profile | null {
  const named = env['LACUNA_PROFILE']?.trim().toLowerCase();
  if (named === undefined || named === '') return null;
  if (named === 'cloud' || named === 'node') return named;
  throw new HydraConfigError(`LACUNA_PROFILE must be "cloud" or "node", got "${named}"`);
}

/**
 * Opens the store this environment is configured for.
 *
 * A fresh source per call. The cloud source memoises the records one question
 * reads, and a memo shared between questions would let a long-lived process
 * answer from a record the store has since replaced.
 */
export function openSource(env: Record<string, string | undefined> = process.env): OpenedSource {
  const named = readProfile(env);
  const cloud = cloudFromEnv(env);

  if (named === 'cloud' || (named === null && cloud !== null)) {
    if (cloud === null) {
      throw new HydraConfigError(
        'LACUNA_PROFILE=cloud, but no HydraDB Cloud database is configured. '
        + 'Set HYDRA_CLOUD_URL, HYDRA_CLOUD_TOKEN and HYDRA_DATABASE',
      );
    }
    return {
      source: new CloudSource(cloud),
      profile: 'cloud',
      describe: `HydraDB Cloud, database ${cloud.database}, collection ${cloud.collection}`,
      client: null,
      cloud,
    };
  }

  const config = loadHydraConfig(env);
  const client = new HydraClient(config);
  return {
    source: new NodeSource(client),
    profile: 'node',
    describe: `HydraDB node, namespace ${config.namespace}, graph ${config.graph}`,
    client,
    cloud: null,
  };
}
