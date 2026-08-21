import { describe, expect, it } from 'vitest';

import {
  CloudMcpCapabilities,
  MCP_CAPABILITY_TTL_MS,
} from '../../src/auth/mcp-capability-store.js';
import { hashMcpCapability, mintMcpCapability } from '../../src/auth/mcp-capability.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const START = Date.parse('2026-08-20T10:00:00.000Z');
const WORKSPACE = `lacuna-ws-${'a'.repeat(32)}`;

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

function writeRecord(cloud: RecordCloud, capability: string, value: unknown): void {
  const digest = hashMcpCapability(capability);
  cloud.records.set(
    `lacuna-mcp-capabilities:lacuna:mcp-capability:${digest}`,
    JSON.stringify({ content: { text: JSON.stringify(value) } }),
  );
}

describe('MCP workspace capabilities', () => {
  it('stores only a digest, resolves one workspace and revokes immediately', async () => {
    const cloud = new RecordCloud();
    const store = new CloudMcpCapabilities(hydra(cloud));
    const issued = await store.issue(WORKSPACE, START);

    expect(issued.capability).toMatch(/^lmc_[A-Za-z0-9_-]{43}$/);
    expect(issued.createdAt).toBe('2026-08-20T10:00:00.000Z');
    expect(issued.expiresAt).toBe('2026-09-19T10:00:00.000Z');
    expect(JSON.stringify([...cloud.records.values()])).not.toContain(issued.capability);
    const envelope = JSON.parse([...cloud.records.values()][0] ?? '{}') as { content?: { text?: string } };
    const persisted = JSON.parse(envelope.content?.text ?? '{}') as { expiresAt?: string };
    expect(persisted.expiresAt).toBe(issued.expiresAt);
    await expect(store.resolve(issued.capability, START)).resolves.toBe(WORKSPACE);
    await expect(store.resolve(`lmc_${'b'.repeat(43)}`, START)).resolves.toBeNull();

    await expect(store.revoke(issued.capability, START + 60_000)).resolves.toBe(true);
    await expect(store.resolve(issued.capability, START + 60_001)).resolves.toBeNull();
    await expect(store.revoke(issued.capability, START + 60_002)).resolves.toBe(false);
  });

  it('expires at exactly 30 days and refuses to revive or revoke an expired bearer', async () => {
    const store = new CloudMcpCapabilities(hydra(new RecordCloud()));
    const issued = await store.issue(WORKSPACE, START);

    await expect(store.resolve(issued.capability, START - 1)).resolves.toBeNull();
    await expect(store.resolve(issued.capability, START + MCP_CAPABILITY_TTL_MS - 1)).resolves.toBe(WORKSPACE);
    await expect(store.resolve(issued.capability, START + MCP_CAPABILITY_TTL_MS)).resolves.toBeNull();
    await expect(store.revoke(issued.capability, START + MCP_CAPABILITY_TTL_MS)).resolves.toBe(false);
    await expect(store.resolve(issued.capability, START + MCP_CAPABILITY_TTL_MS + 1)).resolves.toBeNull();
  });

  it('fails closed for legacy, missing, invalid and overlong expiry records', async () => {
    const cloud = new RecordCloud();
    const store = new CloudMcpCapabilities(hydra(cloud));
    const createdAt = new Date(START).toISOString();
    const cases = [
      { version: 1, expiresAt: undefined },
      { version: 2, expiresAt: undefined },
      { version: 2, expiresAt: 'not-a-date' },
      { version: 2, expiresAt: createdAt },
      { version: 2, expiresAt: new Date(START + MCP_CAPABILITY_TTL_MS + 1).toISOString() },
    ] as const;

    for (const candidate of cases) {
      const capability = mintMcpCapability();
      const digest = hashMcpCapability(capability);
      writeRecord(cloud, capability, {
        version: candidate.version,
        digest,
        workspace: WORKSPACE,
        createdAt,
        ...(candidate.expiresAt === undefined ? {} : { expiresAt: candidate.expiresAt }),
        revokedAt: null,
      });
      await expect(store.resolve(capability, START)).resolves.toBeNull();
      await expect(store.revoke(capability, START)).resolves.toBe(false);
    }
  });

  it('fails closed for malformed revocation times and invalid issuance clocks', async () => {
    const cloud = new RecordCloud();
    const store = new CloudMcpCapabilities(hydra(cloud));
    const capability = mintMcpCapability();
    const digest = hashMcpCapability(capability);
    writeRecord(cloud, capability, {
      version: 2,
      digest,
      workspace: WORKSPACE,
      createdAt: new Date(START).toISOString(),
      expiresAt: new Date(START + MCP_CAPABILITY_TTL_MS).toISOString(),
      revokedAt: 'not-a-date',
    });

    await expect(store.resolve(capability, START)).resolves.toBeNull();
    await expect(store.revoke(capability, START)).resolves.toBe(false);
    const recordsBeforeInvalidIssue = cloud.records.size;
    await expect(store.issue(WORKSPACE, Number.NaN)).rejects.toThrow('invalid capability time');
    expect(cloud.records.size).toBe(recordsBeforeInvalidIssue);
  });

  it('refuses to mint a capability for an unscoped collection name', async () => {
    const store = new CloudMcpCapabilities(hydra(new RecordCloud()));
    await expect(store.issue('public')).rejects.toThrow('invalid workspace');
  });
});
