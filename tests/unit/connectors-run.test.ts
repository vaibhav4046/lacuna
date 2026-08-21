import { describe, expect, it, vi } from 'vitest';

import type { IngestPreparedReport } from '../../src/api/ingest.js';
import {
  ingestPreparedSource,
  IngestGraphLimitError,
  IngestReadinessError,
  IngestSubmissionIndeterminateError,
} from '../../src/api/ingest.js';
import { ConnectorRunner, serializeConnectorRunResult } from '../../src/connectors/run.js';
import type { ConnectorDocumentInput } from '../../src/connectors/normalize.js';
import type {
  ConnectorId,
  ConnectorObservation,
  ConnectorPutResult,
  ConnectorStore,
  ConnectorWorkspaceState,
} from '../../src/connectors/types.js';
import { HydraCloud } from '../../src/hydra/cloud.js';
import { HydraDecodeError, HydraTransportError } from '../../src/hydra/errors.js';

const WORKSPACE = 'lacuna-ws-0123456789abcdef0123456789abcdef';
const STARTED = Date.parse('2026-08-21T10:00:00.000Z');
const provenance = {
  connectorId: 'text' as const,
  sourceUrl: 'https://example.com/source',
  mediaType: 'text/plain' as const,
  observedAt: '2026-08-21T09:00:00.000Z',
};

function document(title: string, text = `${title} is owned by Priya.`): ConnectorDocumentInput {
  return { title, text, provenance: { ...provenance, sourceUrl: `https://example.com/${title.toLowerCase()}` } };
}

function report(sourceKey: string, searchable = true): IngestPreparedReport {
  return {
    sourceKey,
    collection: WORKSPACE,
    turns: 1,
    claims: 1,
    entities: 1,
    accepted: 4,
    refused: [],
    ms: 2,
    truncated: false,
    searchable,
    indexing: searchable ? 'completed' : 'accepted',
  };
}

class MemoryStore implements ConnectorStore {
  readonly writes: { workspace: string; id: ConnectorId; next: ConnectorObservation }[] = [];
  readonly #state: ConnectorWorkspaceState;
  readonly #result: ConnectorPutResult;

  constructor(result: ConnectorPutResult = 'stored', state: ConnectorWorkspaceState = {}) {
    this.#result = result;
    this.#state = state;
  }

  async get(workspace: string): Promise<ConnectorWorkspaceState> {
    expect(workspace).toBe(WORKSPACE);
    return this.#state;
  }

  async put(workspace: string, id: ConnectorId, next: ConnectorObservation): Promise<ConnectorPutResult> {
    this.writes.push({ workspace, id, next });
    return this.#result;
  }
}

class ChronologicalStore implements ConnectorStore {
  state: ConnectorWorkspaceState;
  readonly writes: ConnectorObservation[] = [];

  constructor(initial: ConnectorObservation) {
    this.state = { text: initial };
  }

  async get(): Promise<ConnectorWorkspaceState> {
    return structuredClone(this.state);
  }

  async put(_workspace: string, id: ConnectorId, next: ConnectorObservation): Promise<ConnectorPutResult> {
    const current = this.state[id];
    if (current !== undefined && current.lastAttemptAt !== null && next.lastAttemptAt !== null
      && next.lastAttemptAt <= current.lastAttemptAt) return 'stale';
    this.writes.push(next);
    this.state = { ...this.state, [id]: next };
    return 'stored';
  }
}

function tickingClock(): () => number {
  let tick = STARTED;
  return () => tick++;
}

describe('ConnectorRunner', () => {
  it('reports a pre-write webhook graph cap as validation failure, never transport failure', async () => {
    const runner = new ConnectorRunner({
      store: new MemoryStore(),
      now: tickingClock(),
      ingest: async () => { throw new IngestGraphLimitError(); },
    });
    const result = await runner.run(WORKSPACE, {
      connectorId: 'webhook',
      documents: [{
        title: 'Large webhook',
        text: 'Atlas is owned by Priya.',
        provenance: {
          connectorId: 'webhook', sourceUrl: null, mediaType: 'application/json',
          observedAt: '2026-08-21T09:00:00.000Z',
          webhook: { schemaVersion: 1, rawDigest: 'a'.repeat(64), parserVersion: 'webhook-v1' },
        },
      }],
      awaitSearchable: true,
    });

    expect(result).toMatchObject({
      acceptedDocuments: 0,
      failedDocuments: 1,
      failure: 'validation_failed',
      indeterminateSubmission: false,
    });
  });

  it('reports a missing exact submitted receipt as indeterminate, never known-zero failed', async () => {
    const store = new MemoryStore();
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async () => { throw new IngestSubmissionIndeterminateError(); },
    });
    const result = await runner.run(WORKSPACE, {
      connectorId: 'webhook',
      documents: [{
        title: 'Webhook',
        text: 'Atlas is owned by Priya.',
        provenance: {
          connectorId: 'webhook', sourceUrl: null, mediaType: 'application/json',
          observedAt: '2026-08-21T09:00:00.000Z',
          webhook: { schemaVersion: 1, rawDigest: 'a'.repeat(64), parserVersion: 'webhook-v1' },
        },
      }],
      awaitSearchable: true,
    });
    expect(result).toMatchObject({
      acceptedDocuments: 0,
      failedDocuments: 0,
      failure: 'transport_failed',
      indeterminateSubmission: true,
      observationWrite: 'stored',
    });
    expect(store.writes[0]?.next).toMatchObject({ importedDocuments: 0, lastSuccessAt: null });
  });

  it('derives absolute phase deadlines and passes the observation deadline to get and put', async () => {
    const controls: unknown[] = [];
    const store: ConnectorStore = {
      get: async (_workspace, storeControl) => {
        controls.push(storeControl);
        return {};
      },
      put: async (_workspace, _id, _next, storeControl) => {
        controls.push(storeControl);
        return 'stored';
      },
    };
    let ingestOptions: unknown;
    const runner = new ConnectorRunner({
      store,
      now: () => STARTED,
      ingest: async (_workspace, prepared, options) => {
        ingestOptions = options;
        return report(prepared.sourceKey);
      },
    });
    const controller = new AbortController();
    await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('budgeted')], awaitSearchable: true,
    }, { signal: controller.signal, settlementDeadlineMs: STARTED + 240_000 });
    expect(ingestOptions).toMatchObject({
      signal: controller.signal,
      deadlines: {
        prewriteDeadlineMs: STARTED + 60_000,
        submissionDeadlineMs: STARTED + 180_000,
        readinessDeadlineMs: STARTED + 210_000,
      },
    });
    expect(controls).toEqual([
      { deadlineMs: STARTED + 230_000 },
      { deadlineMs: STARTED + 230_000 },
    ]);
  });
  it('cancels before ingestion without writing connector observation state', async () => {
    let reads = 0;
    let writes = 0;
    let ingests = 0;
    const controller = new AbortController();
    controller.abort();
    const runner = new ConnectorRunner({
      store: {
        get: async () => { reads += 1; return {}; },
        put: async () => { writes += 1; return 'stored'; },
      },
      ingest: async (_workspace, prepared) => {
        ingests += 1;
        return report(prepared.sourceKey);
      },
    });

    await expect(runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('cancelled')], awaitSearchable: true,
    }, { signal: controller.signal })).rejects.toMatchObject({ name: 'ConnectorRunCancelledError' });
    expect({ reads, writes, ingests }).toEqual({ reads: 0, writes: 0, ingests: 0 });
  });

  it('propagates cancellation through readiness while preserving accepted receipts and observation truth', async () => {
    const controller = new AbortController();
    const store = new MemoryStore();
    let receivedSignal: AbortSignal | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let release: (() => void) | undefined;
    const released = new Promise<void>((resolve) => { release = resolve; });
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, _prepared, options) => {
        receivedSignal = options.signal;
        markStarted?.();
        await released;
        if (options.signal?.aborted) throw new IngestReadinessError('failed', 4, 0);
        return report('src-cancelled-readiness');
      },
    });

    const running = runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('accepted-before-cancel')], awaitSearchable: true,
    }, { signal: controller.signal });
    await started;
    controller.abort();
    release?.();
    const result = await running;

    expect(receivedSignal).toBe(controller.signal);
    expect(result).toMatchObject({
      acceptedDocuments: 1,
      acceptedRecords: 4,
      searchableDocuments: 0,
      failedDocuments: 1,
      failure: 'readiness_failed',
      observationWrite: 'stored',
    });
    expect(store.writes[0]?.next).toMatchObject({
      importedDocuments: 1,
      lastSuccessAt: expect.any(String),
      lastFailure: 'readiness_failed',
    });
  });

  it('preserves a completed searchable document when a sibling is cancelled after accepted receipts', async () => {
    const controller = new AbortController();
    const store = new MemoryStore();
    let markFirstReturned: (() => void) | undefined;
    const firstReturned = new Promise<void>((resolve) => { markFirstReturned = resolve; });
    let markSecondStarted: (() => void) | undefined;
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve; });
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared, options) => {
        if (prepared.title === 'A') {
          markFirstReturned?.();
          return report(prepared.sourceKey);
        }
        markSecondStarted?.();
        return new Promise<never>((_resolve, reject) => {
          const cancelled = () => reject(new IngestReadinessError('failed', 4, 0));
          if (options.signal?.aborted === true) cancelled();
          else options.signal?.addEventListener('abort', cancelled, { once: true });
        });
      },
    });

    const running = runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('A'), document('B')], awaitSearchable: true,
    }, { signal: controller.signal });
    await Promise.all([firstReturned, secondStarted]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();

    await expect(running).resolves.toMatchObject({
      acceptedDocuments: 2,
      acceptedRecords: 8,
      searchableDocuments: 1,
      failedDocuments: 1,
      failure: 'readiness_failed',
      observationWrite: 'stored',
    });
    expect(store.writes[0]?.next).toMatchObject({
      importedDocuments: 2,
      lastSuccessAt: expect.any(String),
      lastFailure: 'readiness_failed',
    });
  });

  it('normalizes and deduplicates before running at most two document jobs', async () => {
    const store = new MemoryStore('stored', {
      text: {
        configuredAt: null,
        lastAttemptAt: '2026-08-20T10:00:00.000Z',
        lastSuccessAt: '2026-08-20T10:00:00.000Z',
        lastFailure: null,
        importedDocuments: 7,
      },
    });
    let inFlight = 0;
    let peak = 0;
    const seen: string[] = [];
    const release: (() => void)[] = [];
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared, options) => {
        expect(options).toEqual({ awaitSearchable: true });
        seen.push(prepared.title);
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => release.push(resolve));
        inFlight -= 1;
        return report(prepared.sourceKey);
      },
    });
    const running = runner.run(WORKSPACE, {
      connectorId: 'text',
      documents: [document('A'), document('B'), document('A'), document('C')],
      awaitSearchable: true,
    });

    await vi.waitFor(() => expect(release).toHaveLength(2));
    expect(peak).toBe(2);
    release.splice(0).forEach((done) => done());
    await vi.waitFor(() => expect(release).toHaveLength(1));
    release.splice(0).forEach((done) => done());
    const result = await running;

    expect(seen).toEqual(['A', 'B', 'C']);
    expect(result).toMatchObject({
      connectorId: 'text',
      submittedDocuments: 4,
      duplicateDocuments: 1,
      acceptedDocuments: 3,
      searchableDocuments: 3,
      failedDocuments: 0,
      acceptedRecords: 12,
      refusedRecords: 0,
      failure: null,
      observationWrite: 'stored',
    });
    expect(store.writes).toEqual([{
      workspace: WORKSPACE,
      id: 'text',
      next: {
        configuredAt: null,
        lastAttemptAt: expect.stringMatching(/^2026-08-21T10:00:00\.00\dZ$/u),
        lastSuccessAt: expect.stringMatching(/^2026-08-21T10:00:00\.00\dZ$/u),
        lastFailure: null,
        importedDocuments: 10,
      },
    }]);
  });

  it('normalizes the whole request before the first write', async () => {
    const store = new MemoryStore();
    let ingests = 0;
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => {
        ingests += 1;
        return report(prepared.sourceKey);
      },
    });
    const result = await runner.run(WORKSPACE, {
      connectorId: 'text',
      documents: [document('valid'), { ...document('invalid'), text: new Uint8Array([0xc3, 0x28]) }],
      awaitSearchable: false,
    });

    expect(ingests).toBe(0);
    expect(result).toMatchObject({ failure: 'validation_failed', acceptedDocuments: 0, observationWrite: 'stored' });
    expect(store.writes[0]?.next.lastFailure).toBe('validation_failed');
  });

  it('distinguishes accepted receipts from terminal searchable documents', async () => {
    const store = new MemoryStore();
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey, false),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('queued')], awaitSearchable: false,
    });

    expect(result).toMatchObject({ acceptedDocuments: 1, searchableDocuments: 0, failure: null });
  });

  it.each([
    [new HydraTransportError('provider body: secret'), 'transport_failed'],
    [new HydraDecodeError('provider body: secret'), 'parse_failed'],
    [new IngestReadinessError('failed'), 'readiness_failed'],
    [new IngestReadinessError('timeout'), 'readiness_timeout'],
  ] as const)('maps typed failures to a fixed redacted code', async (thrown, expected) => {
    const store = new MemoryStore();
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async () => { throw thrown; },
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('failure')], awaitSearchable: true,
    });

    expect(result.failure).toBe(expected);
    expect(JSON.stringify(result)).not.toContain('provider body');
    expect(store.writes[0]?.next.lastFailure).toBe(expected);
  });

  it('preserves accepted receipt counts and success history when readiness times out', async () => {
    const store = new MemoryStore('stored', {
      text: {
        configuredAt: null,
        lastAttemptAt: '2026-08-20T10:00:00.000Z',
        lastSuccessAt: '2026-08-20T10:00:00.000Z',
        lastFailure: null,
        importedDocuments: 7,
      },
    });
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async () => { throw new IngestReadinessError('timeout', 4, 1); },
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('accepted-before-timeout')], awaitSearchable: true,
    });

    expect(result).toMatchObject({
      acceptedDocuments: 1,
      searchableDocuments: 0,
      failedDocuments: 1,
      acceptedRecords: 4,
      refusedRecords: 1,
      failure: 'readiness_timeout',
    });
    expect(store.writes[0]?.next).toMatchObject({
      importedDocuments: 8,
      lastSuccessAt: expect.stringMatching(/^2026-08-21T10:00:00\.00\dZ$/u),
      lastFailure: 'readiness_timeout',
    });
    expect(JSON.stringify(result)).not.toContain('receipt');
    expect(JSON.stringify(result)).not.toContain('provider');
  });

  it('retains accepted work when the readiness request rejects after exact receipts', async () => {
    const receiptIds: string[] = [];
    const cloud = new HydraCloud(
      {
        baseUrl: 'https://api.example.invalid',
        token: 'not-a-real-token',
        database: 'lacuna',
        collection: 'public-demo',
      },
      {
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (init?.method === 'GET' && url.pathname.endsWith('/context/status')) {
            throw new Error('provider readiness response: secret');
          }
          if (init?.method === 'GET') {
            return Response.json({ error: { code: 'FILE_NOT_FOUND' } }, { status: 404 });
          }
          const form = init?.body as FormData;
          const app = form.get('app_knowledge');
          const records = typeof app === 'string' ? (JSON.parse(app) as { id: string }[]) : [];
          receiptIds.push(...records.map((record) => record.id));
          return Response.json({
            data: { results: records.map((record) => ({ id: record.id, status: 'queued', error: null })) },
          });
        },
      },
    );
    const store = new MemoryStore('stored', {
      text: {
        configuredAt: null,
        lastAttemptAt: '2026-08-20T10:00:00.000Z',
        lastSuccessAt: '2026-08-20T10:00:00.000Z',
        lastFailure: null,
        importedDocuments: 7,
      },
    });
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: (workspace, prepared, options) => ingestPreparedSource(cloud, workspace, prepared, options),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('Atlas', 'a: Atlas is owned by Priya.')], awaitSearchable: true,
    });

    expect(receiptIds).toHaveLength(4);
    expect(result).toMatchObject({
      acceptedDocuments: 1,
      searchableDocuments: 0,
      failedDocuments: 1,
      acceptedRecords: 4,
      refusedRecords: 0,
      failure: 'readiness_failed',
      observationWrite: 'stored',
    });
    expect(store.writes[0]?.next).toMatchObject({
      importedDocuments: 8,
      lastSuccessAt: expect.stringMatching(/^2026-08-21T10:00:00\.00\dZ$/u),
      lastFailure: 'readiness_failed',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('provider readiness response');
    expect(serialized).not.toContain('secret');
    for (const id of receiptIds) expect(serialized).not.toContain(id);
  });

  it('maps refused receipts without returning their provider errors', async () => {
    const runner = new ConnectorRunner({
      store: new MemoryStore(),
      now: tickingClock(),
      ingest: async (_workspace, prepared) => ({
        ...report(prepared.sourceKey, false),
        accepted: 2,
        refused: [{ id: 'internal-hydra-id', error: 'provider body and secret' }],
      }),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('partial')], awaitSearchable: false,
    });

    expect(result).toMatchObject({
      acceptedDocuments: 1,
      failedDocuments: 1,
      acceptedRecords: 2,
      refusedRecords: 1,
      failure: 'receipt_refused',
    });
    expect(JSON.stringify(result)).not.toContain('internal-hydra-id');
    expect(JSON.stringify(result)).not.toContain('provider body');
  });

  it.each(['stored', 'unchanged', 'stale'] as const)('reports the store put result honestly: %s', async (putResult) => {
    const runner = new ConnectorRunner({
      store: new MemoryStore(putResult),
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document(putResult)], awaitSearchable: true,
    });

    expect(result.observationWrite).toBe(putResult);
  });

  it('keeps accepted counts but reports a redacted failure when observation persistence fails', async () => {
    const store: ConnectorStore = {
      get: async () => ({}),
      put: async () => { throw new Error('provider body and secret'); },
    };
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('accepted')], awaitSearchable: true,
    });

    expect(result).toMatchObject({
      acceptedDocuments: 1,
      searchableDocuments: 1,
      failure: 'transport_failed',
      observationWrite: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('provider body');
  });

  it('serializes post-run deltas so an older attempt completing last cannot lose accepted documents', async () => {
    const store = new ChronologicalStore({
      configuredAt: null,
      lastAttemptAt: '2026-08-20T10:00:00.000Z',
      lastSuccessAt: '2026-08-20T10:00:00.000Z',
      lastFailure: null,
      importedDocuments: 5,
    });
    const releases = new Map<string, () => void>();
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => {
        await new Promise<void>((resolve) => releases.set(prepared.title, resolve));
        return report(prepared.sourceKey);
      },
    });

    const older = runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('Older')], awaitSearchable: true,
    });
    await vi.waitFor(() => expect(releases.has('Older')).toBe(true));
    const newer = runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('Newer')], awaitSearchable: true,
    });
    await vi.waitFor(() => expect(releases.has('Newer')).toBe(true));

    releases.get('Newer')?.();
    const newerResult = await newer;
    releases.get('Older')?.();
    const olderResult = await older;

    expect(newerResult.observationWrite).toBe('stored');
    expect(olderResult.observationWrite).toBe('stored');
    expect(store.writes.map((entry) => entry.importedDocuments)).toEqual([6, 7]);
    expect(store.state.text?.importedDocuments).toBe(7);
  });

  it('does not write a default observation when the queued latest-state read fails', async () => {
    let puts = 0;
    const store: ConnectorStore = {
      get: async () => { throw new Error('state unavailable'); },
      put: async () => { puts += 1; return 'stored'; },
    };
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('accepted')], awaitSearchable: true,
    });

    expect(result).toMatchObject({ acceptedDocuments: 1, observationWrite: 'failed', failure: 'transport_failed' });
    expect(puts).toBe(0);
  });

  it('runtime-validates the exact connector request shape before reads or ingestion', async () => {
    let reads = 0;
    let ingests = 0;
    const store: ConnectorStore = {
      get: async () => { reads += 1; return {}; },
      put: async () => 'stored',
    };
    const runner = new ConnectorRunner({
      store,
      ingest: async (_workspace, prepared) => { ingests += 1; return report(prepared.sourceKey); },
    });
    const invalid = [
      { connectorId: 'slack', documents: [document('wrong-id')], awaitSearchable: true },
      { connectorId: 'text', documents: [document('wrong-ready')], awaitSearchable: 'true' },
      { connectorId: 'text', documents: [document('extra')], awaitSearchable: true, providerBody: 'secret' },
    ];

    for (const request of invalid) {
      await expect(runner.run(WORKSPACE, request as never)).rejects.toThrow('invalid connector request');
    }
    expect(reads).toBe(0);
    expect(ingests).toBe(0);
  });

  it('rejects a prepared document above the extractor limit before the ingest boundary', async () => {
    const store = new MemoryStore();
    let ingests = 0;
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => { ingests += 1; return report(prepared.sourceKey); },
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('oversized', 'x'.repeat(20_001))], awaitSearchable: false,
    });

    expect(result).toMatchObject({ acceptedDocuments: 0, failure: 'validation_failed' });
    expect(ingests).toBe(0);
  });

  it('rejects client-shaped workspace identifiers before normalization or storage', async () => {
    const store = new MemoryStore();
    const runner = new ConnectorRunner({
      store,
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
    });

    await expect(runner.run('alice@example.com', {
      connectorId: 'text', documents: [document('foreign')], awaitSearchable: true,
    })).rejects.toThrow('invalid workspace');
    expect(store.writes).toEqual([]);
  });

  it('serializes only bounded result fields', async () => {
    const runner = new ConnectorRunner({
      store: new MemoryStore(),
      now: tickingClock(),
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
    });
    const result = await runner.run(WORKSPACE, {
      connectorId: 'text', documents: [document('safe')], awaitSearchable: true,
    });
    const serialized = JSON.stringify(serializeConnectorRunResult({
      ...result,
      collection: WORKSPACE,
      rawSource: 'private text',
      providerBody: 'secret response',
      email: 'alice@example.com',
      secret: 'token',
    } as never));

    expect(serialized).not.toContain('lacuna-ws-');
    expect(serialized).not.toContain('private text');
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('alice@example.com');
    expect(serialized).not.toContain('providerBody');
  });
});
