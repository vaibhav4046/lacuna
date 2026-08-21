import { createHash, createHmac } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';

import { describe, expect, it } from 'vitest';

import {
  WebhookBodyError,
  WebhookBodyReader,
  WebhookRejectedError,
  WebhookService,
  parseWebhookMasterKey,
  redactWebhookPath,
  type WebhookRequestControl,
} from '../../src/connectors/webhook.js';
import type {
  StoredWebhookActiveIndex,
  StoredWebhookEndpoint,
  StoredWebhookReplayWindow,
  WebhookRecordStore,
  WebhookStoreControl,
} from '../../src/connectors/webhook-store.js';
import { CloudWebhookRecordStore, WebhookStoreError } from '../../src/connectors/webhook-store.js';
import type { ConnectorRunResult } from '../../src/connectors/run.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const MASTER = Buffer.from(Array.from({ length: 32 }, (_, index) => index));
const WORKSPACE = 'lacuna-ws-0123456789abcdef0123456789abcdef';
const NOW = Date.parse('2026-08-21T12:00:00.000Z');
const ENDPOINT_ID = 'AAECAwQFBgcICQoLDA0ODw';
const SITE_ORIGIN = 'https://app.example.test';

class MemoryWebhookStore implements WebhookRecordStore {
  readonly endpoints = new Map<string, StoredWebhookEndpoint>();
  readonly indexes = new Map<string, StoredWebhookActiveIndex>();
  readonly replays = new Map<string, StoredWebhookReplayWindow>();
  readonly operations: string[] = [];
  reads = 0;
  replayWriteError: Error | null = null;

  async getEndpoint(id: string, _control?: WebhookStoreControl): Promise<StoredWebhookEndpoint | null> {
    this.operations.push('get-endpoint');
    this.reads += 1;
    return this.endpoints.get(id) ?? null;
  }

  async putEndpoint(record: StoredWebhookEndpoint, _control?: WebhookStoreControl): Promise<void> {
    this.operations.push('put-endpoint');
    this.endpoints.set(record.endpointId, structuredClone(record));
  }

  async getActive(ownerDigest: string, _control?: WebhookStoreControl): Promise<StoredWebhookActiveIndex | null> {
    this.operations.push('get-index');
    this.reads += 1;
    return this.indexes.get(ownerDigest) ?? null;
  }

  async putActive(record: StoredWebhookActiveIndex, _control?: WebhookStoreControl): Promise<void> {
    this.operations.push('put-index');
    this.indexes.set(record.ownerDigest, structuredClone(record));
  }

  async getReplay(endpointId: string, _control?: WebhookStoreControl): Promise<StoredWebhookReplayWindow | null> {
    this.operations.push('get-replay');
    this.reads += 1;
    return this.replays.get(endpointId) ?? null;
  }

  async putReplay(record: StoredWebhookReplayWindow, _control?: WebhookStoreControl): Promise<void> {
    this.operations.push('put-replay');
    if (this.replayWriteError !== null) throw this.replayWriteError;
    this.replays.set(record.endpointId, structuredClone(record));
  }
}

class WebhookRecordCloud {
  readonly records = new Map<string, string>();
  readonly writes: { records: readonly AppRecord[]; collection: string; control: unknown }[] = [];
  controls: unknown[] = [];
  corruptReadback = false;

  async ingestApp(
    records: readonly AppRecord[],
    collection: string,
    control?: unknown,
  ): Promise<readonly IngestResult[]> {
    this.writes.push({ records, collection, control });
    for (const record of records) {
      const text = this.corruptReadback ? `${record.text} ` : record.text;
      this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text } }));
    }
    return records.map((record) => ({
      id: record.id, filename: record.title, status: 'completed', error: null,
    }));
  }

  async inspect(
    id: string,
    timeoutMs: number,
    collection: string,
    signal?: AbortSignal,
  ): Promise<InspectedSource | null> {
    this.controls.push({ timeoutMs, signal });
    const envelope = this.records.get(`${collection}:${id}`);
    return envelope === undefined ? null : { id, envelope, latencyMs: 1 };
  }
}

function acceptedResult(overrides: Partial<ConnectorRunResult> = {}): ConnectorRunResult {
  return {
    connectorId: 'webhook',
    submittedDocuments: 1,
    duplicateDocuments: 0,
    acceptedDocuments: 1,
    searchableDocuments: 1,
    failedDocuments: 0,
    acceptedRecords: 4,
    refusedRecords: 0,
    failure: null,
    indeterminateSubmission: false,
    startedAt: '2026-08-21T12:00:00.000Z',
    completedAt: '2026-08-21T12:00:01.000Z',
    observationWrite: 'stored',
    ...overrides,
  };
}

function deterministicRandomSequence(): (size: number) => Buffer {
  let endpoint = 0;
  return (size: number): Buffer => {
    if (size === 16) {
      const offset = endpoint * 32;
      endpoint += 1;
      return Buffer.from(Array.from({ length: 16 }, (_, index) => index + offset));
    }
    if (size === 12) return Buffer.from(Array.from({ length: 12 }, (_, index) => index + 16));
    throw new Error(`unexpected random request ${size}`);
  };
}

function service(
  store = new MemoryWebhookStore(),
  run: (workspace: string, request: unknown, options: unknown) => Promise<ConnectorRunResult>
    = async () => acceptedResult(),
  masterKey = MASTER,
): { readonly service: WebhookService; readonly store: MemoryWebhookStore } {
  return {
    store,
    service: new WebhookService({
      masterKey,
      store,
      runner: { run },
      siteOrigin: SITE_ORIGIN,
      now: () => NOW,
      randomBytes: deterministicRandomSequence(),
    }),
  };
}

function rawBody(title = 'Atlas', text = 'Atlas depends on cache-a.', observedAt = '2026-08-21T12:00:00.000Z'): Buffer {
  return Buffer.from(JSON.stringify({ title, text, observed_at: observedAt }), 'utf8');
}

function signingSecret(endpointId = ENDPOINT_ID, master = MASTER): Buffer {
  return createHmac('sha256', master)
    .update(`lacuna:webhook:v1:secret\0${endpointId}`, 'utf8')
    .digest();
}

function signedHeaders(
  body: Buffer,
  eventId = 'event_1234567890',
  timestamp = String(Math.floor(NOW / 1_000)),
  endpointId = ENDPOINT_ID,
  master = MASTER,
): string[] {
  const signature = createHmac('sha256', signingSecret(endpointId, master))
    .update(Buffer.concat([
      Buffer.from(`${timestamp}.${eventId}.`, 'ascii'),
      body,
    ]))
    .digest('hex');
  return [
    'X-Lacuna-Timestamp', timestamp,
    'X-Lacuna-Event-Id', eventId,
    'X-Lacuna-Signature', `v1=${signature}`,
  ];
}

function control(signal = new AbortController().signal): WebhookRequestControl {
  return {
    requestSignal: signal,
    startedAtMs: NOW,
    settlementDeadlineMs: NOW + 240_000,
  };
}

async function issued(): Promise<{
  readonly service: WebhookService;
  readonly store: MemoryWebhookStore;
}> {
  const fixture = service();
  const result = await fixture.service.issue(WORKSPACE);
  expect(result.created).toBe(true);
  return fixture;
}

describe('webhook master key and sealed registry', () => {
  it('redacts public and private endpoint ids from application-controlled log paths', () => {
    expect(redactWebhookPath(`/api/connectors/webhook/${ENDPOINT_ID}`))
      .toBe('/api/connectors/webhook/:redacted');
    expect(redactWebhookPath(`/api/workspace/connectors/webhook/${ENDPOINT_ID}`))
      .toBe('/api/workspace/connectors/webhook/:redacted');
    expect(redactWebhookPath('/api/workspace/connectors/webhook')).toBe('/api/workspace/connectors/webhook');
  });

  it('accepts only canonical encodings of exactly 32 key bytes', () => {
    expect(parseWebhookMasterKey(MASTER.toString('hex'))).toEqual(MASTER);
    expect(parseWebhookMasterKey(MASTER.toString('base64url'))).toEqual(MASTER);

    for (const invalid of [
      undefined,
      '',
      ` ${MASTER.toString('hex')}`,
      `${MASTER.toString('hex')}\n`,
      MASTER.toString('hex').toUpperCase(),
      `${MASTER.toString('base64url')}=`,
      MASTER.subarray(1).toString('hex'),
      MASTER.subarray(1).toString('base64url'),
      `${MASTER.toString('base64url').slice(0, -1)}9`,
    ]) expect(parseWebhookMasterKey(invalid)).toBeNull();
  });

  it('uses the exact KDFs, canonical ids/secrets, AES-GCM AAD, and endpoint-before-index order', async () => {
    const { service: webhook, store } = service();
    const result = await webhook.issue(WORKSPACE);

    expect(result).toEqual({
      created: true,
      endpointId: ENDPOINT_ID,
      endpoint: `${SITE_ORIGIN}/api/connectors/webhook/${ENDPOINT_ID}`,
      secret: '27e9t3M2kZ2lz84-0mVTJK_jPdVacNum1AjckK__LCg',
      configuredAt: '2026-08-21T12:00:00.000Z',
    });
    expect(store.operations).toEqual(['get-index', 'put-endpoint', 'get-endpoint', 'put-index', 'get-index']);
    const endpoint = store.endpoints.get(ENDPOINT_ID);
    expect(endpoint).toEqual({
      version: 1,
      keyFingerprint: '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
      endpointId: ENDPOINT_ID,
      ownerDigest: 'f43c26212e343f46ffc900b6bd99a8de93f6d0560b54c815548242ce7987bec8',
      workspaceCiphertext: '7Zb0Rz_QvrwZXI-a2dRmrGV2_1IEqahSQU1957IkQoCh4X0C1SnAoxQf',
      workspaceIv: 'EBESExQVFhcYGRob',
      workspaceTag: '5Q3vT0I03iOjIHNowDHb0A',
      lifecycle: 'active',
      createdAt: '2026-08-21T12:00:00.000Z',
      revokedAt: null,
    });
    const durable = JSON.stringify({ endpoint, index: [...store.indexes.values()] });
    expect(durable).not.toContain(result.secret);
    expect(durable).not.toContain(WORKSPACE);
  });

  it('returns an active state without redisplaying a secret after response loss or reload', async () => {
    const store = new MemoryWebhookStore();
    const first = service(store).service;
    await first.issue(WORKSPACE);
    const reloaded = service(store).service;

    expect(await reloaded.issue(WORKSPACE)).toMatchObject({
      created: false,
      endpointId: ENDPOINT_ID,
      secret: null,
    });
    expect(await reloaded.state(WORKSPACE)).toEqual({
      configured: true,
      endpointId: ENDPOINT_ID,
      endpoint: `${SITE_ORIGIN}/api/connectors/webhook/${ENDPOINT_ID}`,
      configuredAt: '2026-08-21T12:00:00.000Z',
    });
  });

  it('fails malformed current-key active state closed instead of silently replacing it', async () => {
    const fixture = await issued();
    const [ownerDigest, index] = [...fixture.store.indexes.entries()][0]!;
    fixture.store.indexes.set(ownerDigest, {
      ...index,
      endpointId: 'not-a-canonical-endpoint',
    });

    await expect(fixture.service.state(WORKSPACE)).rejects.toThrow('invalid webhook state');
    await expect(fixture.service.issue(WORKSPACE)).rejects.toThrow('invalid webhook state');
    expect(fixture.store.endpoints.size).toBe(1);
  });

  it('revokes monotonically, leaves a stale index inert, and permits an explicit reissue', async () => {
    const { service: webhook, store } = await issued();
    expect(await webhook.revoke(WORKSPACE, ENDPOINT_ID)).toBe(true);
    expect(await webhook.state(WORKSPACE)).toEqual({
      configured: false, endpointId: null, endpoint: null, configuredAt: null,
    });
    expect(store.indexes.size).toBe(1);
    expect(store.endpoints.get(ENDPOINT_ID)?.lifecycle).toBe('revoked');

    const second = await webhook.issue(WORKSPACE);
    expect(second.created).toBe(true);
    expect(second.secret).not.toBeNull();
  });

  it('makes key rotation destructive and demonstrates why a retired key must never be restored', async () => {
    const store = new MemoryWebhookStore();
    const original = service(store).service;
    await original.issue(WORKSPACE);
    const rotatedKey = Buffer.alloc(32, 0xa5);

    expect(await service(store, async () => acceptedResult(), rotatedKey).service.state(WORKSPACE))
      .toMatchObject({ configured: false });
    await expect(service(store, async () => acceptedResult(), rotatedKey).service.accept(
      ENDPOINT_ID,
      signedHeaders(rawBody(), 'event_1234567890', String(NOW / 1_000), ENDPOINT_ID, rotatedKey),
      rawBody(),
      control(),
    )).rejects.toBeInstanceOf(WebhookRejectedError);

    // Restoring the retired key can see retained records again. Deployment
    // rotation is therefore deliberately irreversible operationally.
    expect(await service(store).service.state(WORKSPACE)).toMatchObject({ configured: true });
  });
});

describe('CloudWebhookRecordStore', () => {
  it('round-trips exact dedicated endpoint/index/replay records under bounded controls', async () => {
    const cloud = new WebhookRecordCloud();
    const store = new CloudWebhookRecordStore(cloud as unknown as HydraCloud, {
      readbackTimeoutMs: 0, pollIntervalMs: 0, now: () => NOW,
    });
    const webhook = service(store as unknown as MemoryWebhookStore).service;
    await webhook.issue(WORKSPACE);

    expect(cloud.writes).toHaveLength(2);
    expect(cloud.writes.every((write) => write.collection === 'lacuna-webhooks')).toBe(true);
    expect(cloud.writes.map((write) => write.records[0]?.metadata)).toEqual([
      { lacuna_record: 'webhook_endpoint' },
      { lacuna_record: 'webhook_active_index' },
    ]);
    const durable = JSON.stringify([...cloud.records.values()]);
    expect(durable).not.toContain(WORKSPACE);
    expect(durable).not.toContain('27e9t3M2');
    await expect(webhook.state(WORKSPACE)).resolves.toMatchObject({ configured: true });
  });

  it('fails exact readback closed and passes clipped store controls to every provider call', async () => {
    const cloud = new WebhookRecordCloud();
    cloud.corruptReadback = true;
    const store = new CloudWebhookRecordStore(cloud as unknown as HydraCloud, {
      readbackTimeoutMs: 0, pollIntervalMs: 0, now: () => NOW,
    });
    const endpoint: StoredWebhookEndpoint = {
      version: 1,
      keyFingerprint: 'a'.repeat(64),
      endpointId: ENDPOINT_ID,
      ownerDigest: 'b'.repeat(64),
      workspaceCiphertext: 'A'.repeat(56),
      workspaceIv: 'A'.repeat(16),
      workspaceTag: 'A'.repeat(22),
      lifecycle: 'active',
      createdAt: '2026-08-21T12:00:00.000Z',
      revokedAt: null,
    };
    const controller = new AbortController();
    await expect(store.putEndpoint(endpoint, {
      signal: controller.signal, deadlineMs: NOW + 1_000,
    })).rejects.toBeInstanceOf(WebhookStoreError);
    expect(cloud.writes[0]?.control).toMatchObject({
      signal: controller.signal, deadlineMs: NOW + 1_000,
    });
    expect(cloud.controls.every((entry) => (entry as { timeoutMs: number }).timeoutMs <= 1_000)).toBe(true);
  });
});

describe('signed at-least-once delivery', () => {
  it('verifies exact raw bytes before reads, prepares closed provenance, and records known acceptance', async () => {
    const calls: { workspace: string; request: Record<string, unknown>; options: Record<string, unknown> }[] = [];
    const store = new MemoryWebhookStore();
    const fixture = service(store, async (workspace, request, options) => {
      calls.push({ workspace, request: request as Record<string, unknown>, options: options as Record<string, unknown> });
      return acceptedResult();
    });
    await fixture.service.issue(WORKSPACE);
    store.operations.length = 0;
    const body = rawBody();

    const receipt = await fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control());

    expect(receipt).toMatchObject({
      state: 'accepted', acceptedDocuments: 1, searchableDocuments: 1,
      acceptedRecords: 4, refusedRecords: 0, indeterminateSubmission: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.workspace).toBe(WORKSPACE);
    expect(calls[0]?.request).toMatchObject({ connectorId: 'webhook', awaitSearchable: true });
    const document = (calls[0]?.request['documents'] as readonly Record<string, unknown>[])[0];
    expect(document?.['provenance']).toEqual({
      connectorId: 'webhook',
      sourceUrl: null,
      mediaType: 'application/json',
      observedAt: '2026-08-21T12:00:00.000Z',
      webhook: {
        schemaVersion: 1,
        rawDigest: createHash('sha256').update(body).digest('hex'),
        parserVersion: 'webhook-v1',
      },
    });
    expect(JSON.stringify(document)).not.toMatch(/event_1234567890|AAECAw|lacuna-ws/u);
    expect(store.operations).toEqual([
      'get-endpoint', 'get-index', 'get-replay', 'get-endpoint', 'get-index', 'put-replay', 'get-replay',
    ]);
    expect(store.replays.get(ENDPOINT_ID)?.entries[0]).toEqual({
      eventAddress: '35dacd170cc3bb33fb82891dbf8a317b326b77e8463ad0de3fc625f84afbda69',
      rawDigest: createHash('sha256').update(body).digest('hex'),
      normalizedDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      parserVersion: 'webhook-v1',
      acceptedAt: '2026-08-21T12:00:00.000Z',
      accepted: true,
    });
  });

  it('performs no durable read for a bad signature and collapses authentication failures', async () => {
    const { service: webhook, store } = await issued();
    store.reads = 0;
    const body = rawBody();
    const bad = signedHeaders(body);
    bad[5] = `v1=${'0'.repeat(64)}`;

    await expect(webhook.accept(ENDPOINT_ID, bad, body, control()))
      .rejects.toMatchObject({ code: 'webhook_rejected', status: 401 });
    expect(store.reads).toBe(0);

    await expect(webhook.accept('AAAAAAAAAAAAAAAAAAAAAA', signedHeaders(body, 'event_1234567890', String(NOW / 1_000), 'AAAAAAAAAAAAAAAAAAAAAA'), body, control()))
      .rejects.toMatchObject({ code: 'webhook_rejected', status: 401 });
  });

  it.each([
    ['missing timestamp', ['X-Lacuna-Event-Id', 'event_1234567890', 'X-Lacuna-Signature', `v1=${'0'.repeat(64)}`]],
    ['mixed-case duplicate', ['X-Lacuna-Timestamp', String(NOW / 1_000), 'x-lacuna-timestamp', String(NOW / 1_000), 'X-Lacuna-Event-Id', 'event_1234567890', 'X-Lacuna-Signature', `v1=${'0'.repeat(64)}`]],
    ['comma fold', ['X-Lacuna-Timestamp', `${NOW / 1_000},${NOW / 1_000}`, 'X-Lacuna-Event-Id', 'event_1234567890', 'X-Lacuna-Signature', `v1=${'0'.repeat(64)}`]],
    ['event delimiter', ['X-Lacuna-Timestamp', String(NOW / 1_000), 'X-Lacuna-Event-Id', 'event.1234567890', 'X-Lacuna-Signature', `v1=${'0'.repeat(64)}`]],
    ['uppercase signature', ['X-Lacuna-Timestamp', String(NOW / 1_000), 'X-Lacuna-Event-Id', 'event_1234567890', 'X-Lacuna-Signature', `v1=${'A'.repeat(64)}`]],
  ])('rejects %s without a registry read', async (_label, headers) => {
    const { service: webhook, store } = await issued();
    store.reads = 0;
    await expect(webhook.accept(ENDPOINT_ID, headers, rawBody(), control()))
      .rejects.toBeInstanceOf(WebhookRejectedError);
    expect(store.reads).toBe(0);
  });

  it.each([-301, 301])('rejects a signed timestamp outside the symmetric five-minute window (%s)', async (offset) => {
    const { service: webhook, store } = await issued();
    store.reads = 0;
    const body = rawBody();
    const timestamp = String(Math.floor(NOW / 1_000) + offset);
    await expect(webhook.accept(ENDPOINT_ID, signedHeaders(body, 'event_1234567890', timestamp), body, control()))
      .rejects.toBeInstanceOf(WebhookRejectedError);
    expect(store.reads).toBe(0);
  });

  it.each([-300, 300])('accepts the signed timestamp boundary (%s)', async (offset) => {
    const { service: webhook } = await issued();
    const body = rawBody();
    const timestamp = String(Math.floor(NOW / 1_000) + offset);
    await expect(webhook.accept(ENDPOINT_ID, signedHeaders(body, `event_boundary_${offset < 0 ? 'past' : 'future'}`, timestamp), body, control()))
      .resolves.toMatchObject({ state: 'accepted' });
  });

  it('returns duplicate or conflict from the bounded visible replay window without rerunning', async () => {
    let runs = 0;
    const fixture = service(new MemoryWebhookStore(), async () => { runs += 1; return acceptedResult(); });
    await fixture.service.issue(WORKSPACE);
    const first = rawBody();
    await fixture.service.accept(ENDPOINT_ID, signedHeaders(first), first, control());

    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(first), first, control()))
      .resolves.toMatchObject({ state: 'duplicate', acceptedDocuments: 0 });
    const changed = rawBody('Atlas', 'Atlas depends on cache-b.');
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(changed), changed, control()))
      .resolves.toMatchObject({ state: 'conflict', acceptedDocuments: 0 });
    expect(runs).toBe(1);
  });

  it('keeps only the newest 256 accepted event markers', async () => {
    const fixture = await issued();
    for (let index = 0; index < 257; index += 1) {
      const body = rawBody('Atlas', `Atlas depends on cache-${index}.`);
      const eventId = `event_${String(index).padStart(10, '0')}`;
      await fixture.service.accept(ENDPOINT_ID, signedHeaders(body, eventId), body, control());
    }
    const entries = fixture.store.replays.get(ENDPOINT_ID)?.entries ?? [];
    expect(entries).toHaveLength(256);
    expect(new Set(entries.map((entry) => entry.eventAddress)).size).toBe(256);
  });

  it('preserves accepted truth on readiness/observation failure and reports replay-finalization uncertainty', async () => {
    const store = new MemoryWebhookStore();
    const fixture = service(store, async () => acceptedResult({
      searchableDocuments: 0,
      failedDocuments: 1,
      failure: 'readiness_failed',
      observationWrite: 'failed',
    }));
    await fixture.service.issue(WORKSPACE);
    store.replayWriteError = new Error('provider body containing secret');
    const body = rawBody();

    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .resolves.toMatchObject({
        state: 'indeterminate', acceptedDocuments: 1, searchableDocuments: 0,
        acceptedRecords: 4, failure: 'readiness_failed', observationWrite: 'failed',
      });
  });

  it('maps a missing submitted Hydra receipt to indeterminate rather than known-zero failed', async () => {
    const fixture = service(new MemoryWebhookStore(), async () => acceptedResult({
      acceptedDocuments: 0,
      searchableDocuments: 0,
      failedDocuments: 0,
      acceptedRecords: 0,
      failure: 'transport_failed',
      indeterminateSubmission: true,
    }));
    await fixture.service.issue(WORKSPACE);
    const body = rawBody();
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .resolves.toMatchObject({ state: 'indeterminate', indeterminateSubmission: true });
  });

  it('rejects tampered ciphertext/tag/index and a revoked endpoint before the runner', async () => {
    let runs = 0;
    const fixture = service(new MemoryWebhookStore(), async () => { runs += 1; return acceptedResult(); });
    await fixture.service.issue(WORKSPACE);
    const body = rawBody();
    const endpoint = fixture.store.endpoints.get(ENDPOINT_ID)!;

    fixture.store.endpoints.set(ENDPOINT_ID, { ...endpoint, workspaceTag: `${endpoint.workspaceTag.slice(0, -1)}B` });
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .rejects.toBeInstanceOf(WebhookRejectedError);
    fixture.store.endpoints.set(ENDPOINT_ID, endpoint);
    fixture.store.indexes.clear();
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .rejects.toBeInstanceOf(WebhookRejectedError);
    await fixture.service.issue(WORKSPACE);
    await fixture.service.revoke(WORKSPACE, ENDPOINT_ID);
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .rejects.toBeInstanceOf(WebhookRejectedError);
    expect(runs).toBe(0);
  });

  it.each([
    ['extra field', '{"title":"A","text":"A depends on B.","observed_at":"2026-08-21T12:00:00.000Z","workspace":"x"}'],
    ['nested text', '{"title":"A","text":{"value":"A depends on B."},"observed_at":"2026-08-21T12:00:00.000Z"}'],
    ['BOM', '\ufeff{"title":"A","text":"A depends on B.","observed_at":"2026-08-21T12:00:00.000Z"}'],
    ['escaped NUL', '{"title":"A","text":"A\\u0000B","observed_at":"2026-08-21T12:00:00.000Z"}'],
    ['lone surrogate', '{"title":"A","text":"A\\ud800B","observed_at":"2026-08-21T12:00:00.000Z"}'],
    ['noncanonical observed time', '{"title":"A","text":"A depends on B.","observed_at":"2026-08-21T12:00:00Z"}'],
    ['before epoch', '{"title":"A","text":"A depends on B.","observed_at":"1999-12-31T23:59:59.999Z"}'],
    ['too far future', '{"title":"A","text":"A depends on B.","observed_at":"2026-08-21T12:05:00.001Z"}'],
    ['text too long', JSON.stringify({ title: 'A', text: 'x'.repeat(20_001), observed_at: '2026-08-21T12:00:00.000Z' })],
  ])('fails malformed payloads as known-zero: %s', async (_label, source) => {
    let runs = 0;
    const fixture = service(new MemoryWebhookStore(), async () => { runs += 1; return acceptedResult(); });
    await fixture.service.issue(WORKSPACE);
    const body = Buffer.from(source, 'utf8');
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .resolves.toMatchObject({ state: 'failed', acceptedDocuments: 0 });
    expect(runs).toBe(0);
  });

  it('uses explicit JSON last-key-wins behavior and accepts exactly 20,000 normalized characters', async () => {
    let captured = '';
    const fixture = service(new MemoryWebhookStore(), async (_workspace, request) => {
      const document = ((request as { documents: readonly { text: string }[] }).documents)[0];
      captured = document?.text ?? '';
      return acceptedResult();
    });
    await fixture.service.issue(WORKSPACE);
    const body = Buffer.from(`{"title":"old","title":"new","text":"${'x'.repeat(20_000)}","observed_at":"2026-08-21T12:00:00.000Z"}`, 'utf8');
    await expect(fixture.service.accept(ENDPOINT_ID, signedHeaders(body), body, control()))
      .resolves.toMatchObject({ state: 'accepted' });
    expect(captured).toHaveLength(20_000);
  });
});

function bodyRequest(
  chunks: readonly Buffer[],
  rawHeaders: readonly string[],
  options: {
    readonly complete?: boolean;
    readonly trailers?: Readonly<Record<string, string>>;
    readonly autoDestroy?: boolean;
  } = {},
): IncomingMessage {
  const stream = new PassThrough({ autoDestroy: options.autoDestroy ?? true }) as PassThrough & Partial<IncomingMessage>;
  stream.rawHeaders = [...rawHeaders];
  stream.rawTrailers = [];
  stream.trailers = options.trailers ?? {};
  stream.complete = options.complete ?? true;
  queueMicrotask(() => {
    for (const chunk of chunks) stream.write(chunk);
    stream.end();
  });
  return stream as unknown as IncomingMessage;
}

describe('strict raw webhook body reader', () => {
  const body = rawBody();
  const baseHeaders = [
    'Content-Type', 'application/json',
    'Content-Length', String(body.byteLength),
    ...signedHeaders(body),
  ];

  it('returns the exact de-chunked entity bytes independent of stream segmentation', async () => {
    const reader = new WebhookBodyReader({ now: () => NOW });
    const request = bodyRequest([body.subarray(0, 7), body.subarray(7)], baseHeaders);
    await expect(reader.read(request, control())).resolves.toEqual(body);
  });

  it.each([
    ['missing framing', baseHeaders.filter((_, index) => index < 2 || index >= 4)],
    ['duplicate content length', [...baseHeaders, 'content-length', String(body.byteLength)]],
    ['CL plus TE', [...baseHeaders, 'Transfer-Encoding', 'chunked']],
    ['content encoding', [...baseHeaders, 'Content-Encoding', 'gzip']],
    ['wrong media type', baseHeaders.map((value) => value === 'application/json' ? 'application/json; charset=utf-8' : value)],
    ['noncanonical length', baseHeaders.map((value) => value === String(body.byteLength) ? `0${value}` : value)],
    ['trailer declaration', [...baseHeaders, 'Trailer', 'x-checksum']],
  ])('rejects ambiguous framing: %s', async (_label, headers) => {
    const reader = new WebhookBodyReader({ now: () => NOW });
    await expect(reader.read(bodyRequest([body], headers), control())).rejects.toBeInstanceOf(WebhookBodyError);
  });

  it('rejects declared/actual mismatch, incomplete streams, trailers, aborts, and entity overflow', async () => {
    const reader = new WebhookBodyReader({ now: () => NOW });
    await expect(reader.read(bodyRequest([body.subarray(1)], baseHeaders), control()))
      .rejects.toBeInstanceOf(WebhookBodyError);
    await expect(reader.read(bodyRequest([body], baseHeaders, { complete: false }), control()))
      .rejects.toBeInstanceOf(WebhookBodyError);
    await expect(reader.read(bodyRequest([body], baseHeaders, { trailers: { checksum: 'x' } }), control()))
      .rejects.toBeInstanceOf(WebhookBodyError);
    const aborted = new AbortController();
    aborted.abort();
    await expect(reader.read(bodyRequest([body], baseHeaders), control(aborted.signal)))
      .rejects.toBeInstanceOf(WebhookBodyError);
    const oversized = Buffer.alloc(256 * 1024 + 1, 0x61);
    const oversizedHeaders = baseHeaders.map((value) => value === String(body.byteLength) ? String(oversized.byteLength) : value);
    await expect(reader.read(bodyRequest([oversized], oversizedHeaders), control()))
      .rejects.toMatchObject({ status: 413 });
  });

  it('does not release an active chunked-body lease until overflow teardown confirms stream close', async () => {
    const reader = new WebhookBodyReader({ now: () => NOW });
    const oversized = Buffer.alloc(256 * 1024 + 1, 0x61);
    const headers = [
      'Content-Type', 'application/json',
      'Transfer-Encoding', 'chunked',
      ...signedHeaders(oversized),
    ];
    const request = bodyRequest([oversized], headers, { autoDestroy: false });
    let closed = false;
    request.once('close', () => { closed = true; });
    await expect(reader.read(request, control())).rejects.toMatchObject({ status: 413 });
    expect(closed).toBe(true);
  });
});
