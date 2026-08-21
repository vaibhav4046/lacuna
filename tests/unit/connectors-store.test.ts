import { describe, expect, it } from 'vitest';

import { CloudConnectorStore } from '../../src/connectors/store.js';
import type { ConnectorWorkspaceState } from '../../src/connectors/types.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const WORKSPACE = `lacuna-ws-${'a'.repeat(32)}`;
const DIGEST = '994ead84d118d3523bb03c63fc599594';
const ID = `lacuna:connector-state:${DIGEST}`;

class RecordCloud {
  readonly records = new Map<string, string>();
  readonly writes: { records: readonly AppRecord[]; collection: string }[] = [];

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    this.writes.push({ records, collection });
    for (const record of records) {
      this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text: record.text } }));
    }
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

function putRaw(cloud: RecordCloud, value: unknown): void {
  cloud.records.set(
    `lacuna-connectors:${ID}`,
    JSON.stringify({ content: { text: JSON.stringify(value) } }),
  );
}

const OBSERVED: ConnectorWorkspaceState = {
  github: {
    configuredAt: null,
    lastAttemptAt: '2026-08-21T10:00:00.000Z',
    lastSuccessAt: '2026-08-21T10:00:00.000Z',
    lastFailure: null,
    importedDocuments: 3,
  },
};

describe('CloudConnectorStore', () => {
  it('upserts one deterministic opaque record in the connector collection', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(hydra(cloud));

    await store.put(WORKSPACE, OBSERVED);

    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]?.collection).toBe('lacuna-connectors');
    expect(cloud.writes[0]?.records).toHaveLength(1);
    expect(cloud.writes[0]?.records[0]).toMatchObject({
      id: ID,
      title: 'Lacuna connector state',
      type: 'custom',
      metadata: { lacuna_record: 'connector_state' },
    });
    const text = cloud.writes[0]?.records[0]?.text ?? '';
    expect(text).toContain(`"workspaceDigest":"${DIGEST}"`);
    expect(text).not.toContain(WORKSPACE);
    expect(await store.get(WORKSPACE)).toEqual(OBSERVED);
  });

  it('serializes only bounded observations and never raw sensitive or process-local input', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(hydra(cloud));
    const hostile = {
      github: {
        ...OBSERVED.github,
        email: 'owner@example.com',
        cookie: 'lacuna_session=secret',
        secret: 'webhook-secret',
        rawToken: 'provider-token',
        importedText: 'private import body',
        collection: WORKSPACE,
        state: 'syncing',
      },
    } as unknown as ConnectorWorkspaceState;

    await store.put(WORKSPACE, hostile);

    const serialized = cloud.writes[0]?.records[0]?.text ?? '';
    for (const forbidden of [
      'owner@example.com', 'lacuna_session', 'webhook-secret', 'provider-token',
      'private import body', WORKSPACE, 'syncing',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('accepts the service envelope fields while keeping the stored payload parser strict', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(hydra(cloud));
    await store.put(WORKSPACE, OBSERVED);
    const held = cloud.records.get(`lacuna-connectors:${ID}`) ?? '{}';
    const envelope = JSON.parse(held) as { content: { text: string } };
    cloud.records.set(`lacuna-connectors:${ID}`, JSON.stringify({
      id: ID,
      content: { text: envelope.content.text, media_type: 'application/json' },
      additional_metadata: { lacuna_record: 'connector_state' },
    }));

    await expect(store.get(WORKSPACE)).resolves.toEqual(OBSERVED);
  });

  it('rejects malformed, foreign-version, foreign-digest, extra-field and unbounded records', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(hydra(cloud));
    const observation = OBSERVED.github;
    const cases: readonly unknown[] = [
      { version: 2, workspaceDigest: DIGEST, connectors: { github: observation } },
      { version: 1, workspaceDigest: 'f'.repeat(32), connectors: { github: observation } },
      { version: 1, workspaceDigest: DIGEST, connectors: { github: { ...observation, secret: 'no' } } },
      { version: 1, workspaceDigest: DIGEST, connectors: { github: { ...observation, importedDocuments: 1_000_001 } } },
      { version: 1, workspaceDigest: DIGEST, connectors: { github: { ...observation, lastAttemptAt: 'not-a-date' } } },
      { version: 1, workspaceDigest: DIGEST, connectors: { slack: observation } },
      { version: 1, workspaceDigest: DIGEST, connectors: null },
    ];

    for (const candidate of cases) {
      putRaw(cloud, candidate);
      await expect(store.get(WORKSPACE)).resolves.toEqual({});
    }
    cloud.records.set(`lacuna-connectors:${ID}`, '{bad envelope');
    await expect(store.get(WORKSPACE)).resolves.toEqual({});
  });

  it('refuses non-workspace scopes before making any cloud request', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(hydra(cloud));

    await expect(store.put('public', OBSERVED)).rejects.toThrow('invalid workspace');
    await expect(store.get('owner@example.com')).rejects.toThrow('invalid workspace');
    expect(cloud.writes).toHaveLength(0);
  });
});
