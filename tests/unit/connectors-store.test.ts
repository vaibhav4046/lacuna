import { describe, expect, it } from 'vitest';

import { CloudConnectorStore, ConnectorStoreError } from '../../src/connectors/store.js';
import type { ConnectorId, ConnectorObservation } from '../../src/connectors/types.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const WORKSPACE = `lacuna-ws-${'a'.repeat(32)}`;
const DIGEST = '994ead84d118d3523bb03c63fc599594';

function idFor(id: ConnectorId): string {
  return `lacuna:connector-state:${DIGEST}:${id}`;
}

const GITHUB: ConnectorObservation = {
  configuredAt: null,
  lastAttemptAt: '2026-08-21T10:00:00.000Z',
  lastSuccessAt: '2026-08-21T10:00:00.000Z',
  lastFailure: null,
  importedDocuments: 3,
};

const TEXT: ConnectorObservation = {
  configuredAt: null,
  lastAttemptAt: '2026-08-21T10:05:00.000Z',
  lastSuccessAt: '2026-08-21T10:05:00.000Z',
  lastFailure: null,
  importedDocuments: 1,
};

interface StoredRecord {
  readonly version: 1;
  readonly workspaceDigest: string;
  readonly connectorId: ConnectorId;
  readonly observation: ConnectorObservation;
}

class RecordCloud {
  readonly records = new Map<string, string>();
  readonly writes: { records: readonly AppRecord[]; collection: string }[] = [];
  receiptStatus = 'completed';
  persistWrites = true;
  transformWrite: ((record: AppRecord) => AppRecord) | null = null;
  beforePersist: ((record: AppRecord) => Promise<void>) | null = null;
  wrongReadId = false;
  readonly controls: unknown[] = [];

  async ingestApp(records: readonly AppRecord[], collection: string, control?: unknown): Promise<readonly IngestResult[]> {
    this.controls.push(control);
    this.writes.push({ records, collection });
    for (const submitted of records) {
      await this.beforePersist?.(submitted);
      const record = this.transformWrite?.(submitted) ?? submitted;
      if (this.persistWrites) {
        this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text: record.text } }));
      }
    }
    return records.map((record) => ({
      id: record.id,
      filename: record.title,
      status: this.receiptStatus,
      error: null,
    }));
  }

  async inspect(id: string, timeoutMs: number, collection: string, signal?: AbortSignal): Promise<InspectedSource | null> {
    this.controls.push({ timeoutMs, signal });
    const envelope = this.records.get(`${collection}:${id}`);
    if (envelope === undefined) return null;
    return { id: this.wrongReadId ? `${id}:wrong` : id, envelope, latencyMs: 1 };
  }
}

function hydra(cloud: RecordCloud): HydraCloud {
  return cloud as unknown as HydraCloud;
}

function stored(connectorId: ConnectorId, observation: ConnectorObservation, extra: Record<string, unknown> = {}): StoredRecord {
  return { version: 1, workspaceDigest: DIGEST, connectorId, observation, ...extra };
}

function putRaw(cloud: RecordCloud, id: ConnectorId, value: unknown): void {
  cloud.records.set(
    `lacuna-connectors:${idFor(id)}`,
    JSON.stringify({ content: { text: JSON.stringify(value) } }),
  );
}

function fastStore(cloud: RecordCloud): CloudConnectorStore {
  return new CloudConnectorStore(hydra(cloud), {
    readbackTimeoutMs: 0,
    pollIntervalMs: 0,
  });
}

describe('CloudConnectorStore', () => {
  it('upserts and verifies one deterministic opaque record per connector', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);

    await expect(store.put(WORKSPACE, 'github', GITHUB)).resolves.toBe('stored');

    expect(cloud.writes).toHaveLength(1);
    expect(cloud.writes[0]?.collection).toBe('lacuna-connectors');
    expect(cloud.writes[0]?.records).toHaveLength(1);
    expect(cloud.writes[0]?.records[0]).toMatchObject({
      id: idFor('github'),
      title: 'Lacuna connector state',
      type: 'custom',
      metadata: { lacuna_record: 'connector_state', connector_id: 'github' },
    });
    const text = cloud.writes[0]?.records[0]?.text ?? '';
    expect(text).toContain(`"workspaceDigest":"${DIGEST}"`);
    expect(text).toContain('"connectorId":"github"');
    expect(text).not.toContain(WORKSPACE);
    expect(await store.get(WORKSPACE)).toEqual({ github: GITHUB });
  });

  it('keeps different connector writes isolated under adversarial interleaving', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);
    let releaseGithub!: () => void;
    let githubStarted!: () => void;
    const started = new Promise<void>((resolve) => { githubStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseGithub = resolve; });
    cloud.beforePersist = async (record) => {
      if (record.id.endsWith(':github')) {
        githubStarted();
        await release;
      }
    };

    const githubWrite = store.put(WORKSPACE, 'github', GITHUB);
    await Promise.race([
      started,
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('per-connector write did not start')), 250)),
    ]);
    await expect(store.put(WORKSPACE, 'text', TEXT)).resolves.toBe('stored');
    releaseGithub();
    await expect(githubWrite).resolves.toBe('stored');

    expect(await store.get(WORKSPACE)).toEqual({ github: GITHUB, text: TEXT });
    expect(cloud.writes.map((write) => write.records[0]?.id).sort()).toEqual([
      idFor('github'), idFor('text'),
    ].sort());
  });

  it('removes an aborted same-record queue waiter so it never runs after the holder releases', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);
    let releaseFirst!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    cloud.beforePersist = async () => {
      if (cloud.writes.length === 1) {
        markStarted();
        await release;
      }
    };
    const first = store.put(WORKSPACE, 'github', GITHUB);
    await started;
    const controller = new AbortController();
    const queued = store.put(WORKSPACE, 'github', {
      ...GITHUB, lastAttemptAt: '2026-08-21T10:01:00.000Z',
    }, { signal: controller.signal, deadlineMs: Date.now() + 5_000 });
    controller.abort();
    await expect(queued).rejects.toBeInstanceOf(ConnectorStoreError);
    releaseFirst();
    await first;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cloud.writes).toHaveLength(1);
  });

  it('clips provider calls to the caller observation deadline and signal', async () => {
    const cloud = new RecordCloud();
    const now = Date.now();
    const store = new CloudConnectorStore(hydra(cloud), {
      readbackTimeoutMs: 0, pollIntervalMs: 0, now: () => now,
    });
    const controller = new AbortController();
    await store.put(WORKSPACE, 'github', GITHUB, {
      signal: controller.signal, deadlineMs: now + 1_000,
    });
    expect(cloud.controls.some((entry) => (
      typeof entry === 'object' && entry !== null
      && (entry as { deadlineMs?: number }).deadlineMs === now + 1_000
      && (entry as { signal?: AbortSignal }).signal === controller.signal
    ))).toBe(true);
    expect(cloud.controls.filter((entry) => (
      typeof entry === 'object' && entry !== null && 'timeoutMs' in entry
    )).every((entry) => (entry as { timeoutMs: number }).timeoutMs <= 1_000)).toBe(true);
  });

  it('skips stale and same-attempt conflicting completions without another write', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);
    const newest: ConnectorObservation = {
      ...GITHUB,
      lastAttemptAt: '2026-08-21T11:00:00.000Z',
      lastSuccessAt: '2026-08-21T11:00:01.000Z',
      importedDocuments: 5,
    };
    const older: ConnectorObservation = {
      ...GITHUB,
      lastAttemptAt: '2026-08-21T10:59:59.000Z',
      lastSuccessAt: null,
      lastFailure: 'transport_failed',
      importedDocuments: 0,
    };
    const conflictingSameAttempt: ConnectorObservation = {
      ...newest,
      lastSuccessAt: null,
      lastFailure: 'readiness_timeout',
      importedDocuments: 0,
    };

    await expect(store.put(WORKSPACE, 'github', newest)).resolves.toBe('stored');
    await expect(store.put(WORKSPACE, 'github', older)).resolves.toBe('stale');
    await expect(store.put(WORKSPACE, 'github', conflictingSameAttempt)).resolves.toBe('stale');
    await expect(store.put(WORKSPACE, 'github', newest)).resolves.toBe('unchanged');

    expect(cloud.writes).toHaveLength(1);
    expect(await store.get(WORKSPACE)).toEqual({ github: newest });
  });

  it('serializes only bounded observations and never raw sensitive or process-local input', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);
    const hostile = {
      ...GITHUB,
      email: 'owner@example.com',
      cookie: 'lacuna_session=secret',
      secret: 'webhook-secret',
      rawToken: 'provider-token',
      importedText: 'private import body',
      collection: WORKSPACE,
      state: 'syncing',
    } as unknown as ConnectorObservation;

    await store.put(WORKSPACE, 'github', hostile);

    const serialized = cloud.writes[0]?.records[0]?.text ?? '';
    for (const forbidden of [
      'owner@example.com', 'lacuna_session', 'webhook-secret', 'provider-token',
      'private import body', WORKSPACE, 'syncing',
    ]) expect(serialized).not.toContain(forbidden);
  });

  it('accepts service envelope fields while keeping the stored payload parser strict', async () => {
    const cloud = new RecordCloud();
    putRaw(cloud, 'github', stored('github', GITHUB));
    const held = cloud.records.get(`lacuna-connectors:${idFor('github')}`) ?? '{}';
    const envelope = JSON.parse(held) as { content: { text: string } };
    cloud.records.set(`lacuna-connectors:${idFor('github')}`, JSON.stringify({
      id: idFor('github'),
      content: { text: envelope.content.text, media_type: 'application/json' },
      additional_metadata: { lacuna_record: 'connector_state' },
    }));

    await expect(fastStore(cloud).get(WORKSPACE)).resolves.toEqual({ github: GITHUB });
  });

  it('treats missing exact ids as empty observations', async () => {
    await expect(fastStore(new RecordCloud()).get(WORKSPACE)).resolves.toEqual({});
  });

  it('throws for every present wrong-id, malformed, foreign, extra, or unbounded record', async () => {
    const cases: readonly unknown[] = [
      { version: 2, workspaceDigest: DIGEST, connectorId: 'github', observation: GITHUB },
      { ...stored('github', GITHUB), workspaceDigest: 'f'.repeat(32) },
      { ...stored('github', GITHUB), connectorId: 'text' },
      stored('github', { ...GITHUB, secret: 'no' } as unknown as ConnectorObservation),
      stored('github', { ...GITHUB, importedDocuments: 1_000_001 }),
      stored('github', { ...GITHUB, lastAttemptAt: 'not-a-date' }),
      stored('github', GITHUB, { secret: 'no' }),
      { version: 1, workspaceDigest: DIGEST, connectorId: 'github', observation: null },
    ];

    for (const candidate of cases) {
      const cloud = new RecordCloud();
      putRaw(cloud, 'github', candidate);
      await expect(fastStore(cloud).get(WORKSPACE)).rejects.toBeInstanceOf(ConnectorStoreError);
    }

    const malformed = new RecordCloud();
    malformed.records.set(`lacuna-connectors:${idFor('github')}`, '{bad envelope');
    await expect(fastStore(malformed).get(WORKSPACE)).rejects.toBeInstanceOf(ConnectorStoreError);

    const wrongId = new RecordCloud();
    putRaw(wrongId, 'github', stored('github', GITHUB));
    wrongId.wrongReadId = true;
    await expect(fastStore(wrongId).get(WORKSPACE)).rejects.toBeInstanceOf(ConnectorStoreError);
  });

  it('does not accept a queued receipt when the exact payload never becomes readable', async () => {
    const cloud = new RecordCloud();
    cloud.receiptStatus = 'queued';
    cloud.persistWrites = false;

    await expect(fastStore(cloud).put(WORKSPACE, 'github', GITHUB))
      .rejects.toThrow('connector state was not readable');
  });

  it('refuses a readable payload that does not exactly match the accepted write', async () => {
    const cloud = new RecordCloud();
    cloud.transformWrite = (record) => ({
      ...record,
      text: JSON.stringify(stored('github', { ...GITHUB, importedDocuments: 2 })),
    });

    await expect(fastStore(cloud).put(WORKSPACE, 'github', GITHUB))
      .rejects.toThrow('connector state readback did not match');
  });

  it('refuses non-workspace scopes before making any cloud request', async () => {
    const cloud = new RecordCloud();
    const store = fastStore(cloud);

    await expect(store.put('public', 'github', GITHUB)).rejects.toThrow('invalid workspace');
    await expect(store.get('owner@example.com')).rejects.toThrow('invalid workspace');
    expect(cloud.writes).toHaveLength(0);
  });
});
