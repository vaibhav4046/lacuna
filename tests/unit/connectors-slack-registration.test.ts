import { describe, expect, it } from 'vitest';

import type { IngestPreparedReport } from '../../src/api/ingest.js';
import type { ConnectorDocumentInput } from '../../src/connectors/normalize.js';
import { ConnectorRunner } from '../../src/connectors/run.js';
import { CloudConnectorStore } from '../../src/connectors/store.js';
import type {
  ConnectorId,
  ConnectorObservation,
  ConnectorStore,
} from '../../src/connectors/types.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const WORKSPACE = `lacuna-ws-${'a'.repeat(32)}`;
const WHEN = '2026-08-24T15:30:00.000Z';

const SLACK_DOCUMENT: ConnectorDocumentInput = {
  title: 'Slack #platform',
  text: '[2026-08-24T15:00:00.000Z] Dana: ledger-fanout is stored in Postgres.',
  provenance: {
    connectorId: 'slack',
    sourceUrl: 'https://app.slack.com/client/T0AAAA1BC/C0123ABCDEF',
    mediaType: 'text/plain',
    observedAt: WHEN,
    slack: {
      schemaVersion: 1,
      teamId: 'T0AAAA1BC',
      channelId: 'C0123ABCDEF',
      messageCount: 1,
      oldestTs: '1756000100.000100',
      latestTs: '1756000100.000100',
      retrievedAt: WHEN,
      rawDigest: 'a'.repeat(64),
      parserVersion: 'slack-v1',
    },
  },
};

const OBSERVATION: ConnectorObservation = {
  configuredAt: null,
  lastAttemptAt: WHEN,
  lastSuccessAt: WHEN,
  lastFailure: null,
  importedDocuments: 1,
};

function report(sourceKey: string): IngestPreparedReport {
  return {
    sourceKey,
    collection: WORKSPACE,
    turns: 1,
    claims: 1,
    entities: 1,
    accepted: 4,
    refused: [],
    ms: 1,
    truncated: false,
    searchable: true,
    indexing: 'completed',
  };
}

class MemoryStore implements ConnectorStore {
  writes = 0;

  async get() {
    return {};
  }

  async put(_workspace: string, id: ConnectorId, next: ConnectorObservation) {
    expect(id).toBe('slack');
    expect(next.lastFailure).toBeNull();
    this.writes += 1;
    return 'stored' as const;
  }
}

class RecordCloud {
  readonly records = new Map<string, string>();

  async ingestApp(records: readonly AppRecord[], collection: string): Promise<readonly IngestResult[]> {
    for (const record of records) {
      this.records.set(`${collection}:${record.id}`, JSON.stringify({ content: { text: record.text } }));
    }
    return records.map((record) => ({
      id: record.id,
      filename: record.title,
      status: 'completed',
      error: null,
    }));
  }

  async inspect(id: string, _timeoutMs: number, collection: string): Promise<InspectedSource | null> {
    const envelope = this.records.get(`${collection}:${id}`);
    return envelope === undefined ? null : { id, envelope, latencyMs: 1 };
  }
}

describe('Slack shared connector registration', () => {
  it('lets the shared runner accept Slack instead of rejecting a valid connector request', async () => {
    const store = new MemoryStore();
    const runner = new ConnectorRunner({
      store,
      ingest: async (_workspace, prepared) => report(prepared.sourceKey),
      now: () => Date.parse(WHEN),
    });

    const result = await runner.run(WORKSPACE, {
      connectorId: 'slack',
      documents: [SLACK_DOCUMENT],
      awaitSearchable: true,
    });

    expect(result).toMatchObject({
      connectorId: 'slack',
      acceptedDocuments: 1,
      searchableDocuments: 1,
      failedDocuments: 0,
      failure: null,
      observationWrite: 'stored',
    });
    expect(store.writes).toBe(1);
  });

  it('persists and reads back Slack connector observations', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(cloud as unknown as HydraCloud, {
      readbackTimeoutMs: 0,
      pollIntervalMs: 0,
    });

    await expect(store.put(WORKSPACE, 'slack', OBSERVATION)).resolves.toBe('stored');
    await expect(store.get(WORKSPACE)).resolves.toEqual({ slack: OBSERVATION });
  });
});
