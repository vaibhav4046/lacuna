import { describe, expect, it } from 'vitest';

import { CloudMcpCapabilities } from '../../src/auth/mcp-capability-store.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

class RecordCloud {
  readonly records = new Map<string, string>();

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    for (const record of records) this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text: record.text } }));
    return records.map((record) => ({ id: record.id, filename: record.title, status: 'completed', error: null }));
  }

  async inspect(id: string, _timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    const envelope = this.records.get(`${collection}:${id}`);
    return envelope === undefined ? null : { id, envelope, latencyMs: 1 };
  }
}

function hydra(cloud: RecordCloud): HydraCloud {
  return cloud as unknown as HydraCloud;
}

describe('MCP workspace capabilities', () => {
  it('stores only a digest, resolves one workspace and revokes immediately', async () => {
    const cloud = new RecordCloud();
    const store = new CloudMcpCapabilities(hydra(cloud));
    const workspace = `lacuna-ws-${'a'.repeat(32)}`;
    const issued = await store.issue(workspace, Date.parse('2026-08-20T10:00:00.000Z'));

    expect(issued.capability).toMatch(/^lmc_[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify([...cloud.records.values()])).not.toContain(issued.capability);
    await expect(store.resolve(issued.capability)).resolves.toBe(workspace);
    await expect(store.resolve(`lmc_${'b'.repeat(43)}`)).resolves.toBeNull();

    await expect(store.revoke(issued.capability, Date.parse('2026-08-20T10:01:00.000Z'))).resolves.toBe(true);
    await expect(store.resolve(issued.capability)).resolves.toBeNull();
    await expect(store.revoke(issued.capability)).resolves.toBe(false);
  });

  it('refuses to mint a capability for an unscoped collection name', async () => {
    const store = new CloudMcpCapabilities(hydra(new RecordCloud()));
    await expect(store.issue('public')).rejects.toThrow('invalid workspace');
  });
});
