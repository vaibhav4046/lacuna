import { describe, expect, it } from 'vitest';

import { PLAIN } from '../../src/cli/color.js';
import { renderStatus } from '../../src/cli/human-report.js';
import { statusPayload } from '../../src/cli/json.js';
import { runStatus, type StatusReport } from '../../src/cli/status.js';

/**
 * `status` reports the store the answers come from, and not a different one.
 *
 * This is a regression test with a real failure behind it. `runStatus` used to
 * call `loadHydraConfig` directly rather than going through the same seam
 * `ask` goes through, so on a machine configured for HydraDB Cloud it printed
 * the loopback node's counts while every question in that shell was answered by
 * the cloud. The two disagreed and neither said so. On a machine with no node
 * running it was worse: `status` failed to connect while the CLI itself worked
 * perfectly.
 *
 * The cloud case needs no network. `openSource` builds a `CloudSource` and
 * returns a null client, and this command has nothing to ask it, so the whole
 * path is reachable from environment variables alone.
 */

/**
 * The host is the real one because `cloudFromEnv` refuses any other, and the
 * token is not. Nothing here opens a socket: the cloud branch of `runStatus`
 * returns before it would use either.
 */
const CLOUD_ENV = {
  LACUNA_PROFILE: 'cloud',
  HYDRA_CLOUD_URL: 'https://api.hydradb.com',
  HYDRA_CLOUD_TOKEN: 'not-a-real-token',
  HYDRA_DATABASE: 'lacuna',
  HYDRA_COLLECTION: 'backend',
} as const;

const NODE_REPORT: StatusReport = {
  profile: 'node',
  store: 'HydraDB node, namespace local, graph default',
  node: {
    baseUrl: 'http://127.0.0.1:18443',
    namespace: 'local',
    graph: 'default',
    cell: 'cell-0',
    readEpoch: 6294,
  },
  counts: [{ label: 'Claim', count: 174 }],
};

describe('status under the cloud profile', () => {
  it('names the cloud, not a node on loopback', async () => {
    const report = await runStatus({ ...CLOUD_ENV }, 5_000);
    expect(report.profile).toBe('cloud');
    expect(report.store).toBe('HydraDB Cloud, database lacuna, collection backend');
    expect(report.node).toBeNull();
  });

  it('reaches no node, so it works on a machine that has none', async () => {
    const report = await runStatus({ ...CLOUD_ENV }, 5_000);
    expect(report.counts).toEqual([]);
  });

  it('never prints the token', async () => {
    const report = await runStatus({ ...CLOUD_ENV }, 5_000);
    const rendered = renderStatus(report, PLAIN);
    expect(rendered).not.toContain(CLOUD_ENV.HYDRA_CLOUD_TOKEN);
    expect(rendered).not.toContain(CLOUD_ENV.HYDRA_CLOUD_URL);
    expect(JSON.stringify(statusPayload(report))).not.toContain(CLOUD_ENV.HYDRA_CLOUD_TOKEN);
  });

  it('says the counts are unavailable rather than printing zero', async () => {
    const rendered = renderStatus(await runStatus({ ...CLOUD_ENV }, 5_000), PLAIN);
    expect(rendered).toContain('not available on this store');
    expect(rendered).not.toMatch(/\b0\b/);
  });

  it('reports a null node in JSON so a consumer cannot read a stale field', async () => {
    const payload = statusPayload(await runStatus({ ...CLOUD_ENV }, 5_000)) as Record<string, unknown>;
    expect(payload['profile']).toBe('cloud');
    expect(payload['node']).toBeNull();
    expect(payload['readEpoch']).toBeNull();
  });
});

describe('status under the node profile', () => {
  it('still reports the node identity and the label counts', () => {
    const rendered = renderStatus(NODE_REPORT, PLAIN);
    expect(rendered).toContain('http://127.0.0.1:18443');
    expect(rendered).toContain('namespace');
    expect(rendered).toContain('6294');
    expect(rendered).toContain('174');
  });

  it('names the profile and the store above the node', () => {
    const lines = renderStatus(NODE_REPORT, PLAIN).split('\n');
    expect(lines[0]).toContain('profile');
    expect(lines[0]).toContain('node');
    expect(lines[1]).toContain('HydraDB node');
  });

  it('keeps the JSON node object populated', () => {
    const payload = statusPayload(NODE_REPORT) as Record<string, unknown>;
    expect(payload['node']).toEqual({
      baseUrl: 'http://127.0.0.1:18443',
      namespace: 'local',
      graph: 'default',
      cell: 'cell-0',
    });
    expect(payload['readEpoch']).toBe(6294);
    expect(payload['counts']).toEqual({ Claim: 174 });
  });
});
