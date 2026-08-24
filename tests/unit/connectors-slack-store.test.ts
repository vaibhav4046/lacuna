import { describe, expect, it } from 'vitest';

import { CloudConnectorStore } from '../../src/connectors/store.js';
import type { ConnectorObservation } from '../../src/connectors/types.js';
import type { AppRecord, HydraCloud, IngestResult, InspectedSource } from '../../src/hydra/cloud.js';

const WORKSPACE = `lacuna-ws-${'a'.repeat(32)}`;
const OBSERVATION: ConnectorObservation = {
  configuredAt: null,
  lastAttemptAt: '2026-08-24T15:45:00.000Z',
  lastSuccessAt: '2026-08-24T15:45:00.000Z',
  lastFailure: null,
  importedDocuments: 1,
};

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

describe('Slack connector-state registration', () => {
  it('persists and reads back one Slack observation through the shared store', async () => {
    const cloud = new RecordCloud();
    const store = new CloudConnectorStore(cloud as unknown as HydraCloud, {
      readbackTimeoutMs: 0,
      pollIntervalMs: 0,
    });

    await expect(store.put(WORKSPACE, 'slack', OBSERVATION)).resolves.toBe('stored');
    await expect(store.get(WORKSPACE)).resolves.toEqual({ slack: OBSERVATION });
  });
});
