import { describe, expect, it, vi } from 'vitest';

import { HydraClient } from '../../src/hydra/client.js';
import { HydraCloud } from '../../src/hydra/cloud.js';
import { CloudSource } from '../../src/hydra/cloud-source.js';
import { entityRecordId, INDEX_ID } from '../../src/hydra/cloud-graph.js';
import { loadHydraConfig } from '../../src/hydra/config.js';
import { HydraGuardError } from '../../src/hydra/errors.js';
import { NodeSource } from '../../src/hydra/node-source.js';
import type { PreparedQuery } from '../../src/hydra/queries.js';
import type { QueryPage } from '../../src/hydra/client.js';

const CLOUD_CONFIG = {
  baseUrl: 'https://api.hydradb.com',
  token: 'impact-test-token-not-real',
  database: 'impact-db',
  collection: 'owner-collection',
};

const NODE_CONFIG = loadHydraConfig({
  HYDRA_HTTP_URL: 'http://127.0.0.1:18443',
  HYDRA_NAMESPACE: 'impact',
  HYDRA_GRAPH: 'owner-graph',
  HYDRA_CELL: 'cell-impact',
  HYDRA_TOKEN: 'node-impact-token-not-real',
});

interface ImpactControl {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
  readonly byteBudget: { consume(chunkBytes: number): void };
}

interface ImpactPort {
  queryForImpact(text: string, control: ImpactControl): Promise<unknown>;
  relationsForImpact(control: ImpactControl): Promise<unknown>;
  subjectForImpact(name: string, control: ImpactControl): Promise<unknown>;
}

interface ImpactExports {
  readonly createCloudImpactReadPort: (cloud: HydraCloud) => ImpactPort;
}

async function impactExports(): Promise<ImpactExports | null> {
  try {
    return await import('../../src/hydra/impact-read.js') as ImpactExports;
  } catch {
    return null;
  }
}

function control(signal: AbortSignal = new AbortController().signal): ImpactControl {
  return { signal, deadlineMs: Date.now() + 30_000, byteBudget: { consume: vi.fn() } };
}

async function invokeImpact(
  target: object,
  method: string,
  args: readonly unknown[],
): Promise<unknown> {
  const candidate = Reflect.get(target, method);
  expect(candidate).toBeTypeOf('function');
  if (typeof candidate !== 'function') return undefined;
  return await Reflect.apply(candidate, target, args);
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function queryEnvelope(): Record<string, unknown> {
  return {
    success: true,
    data: { chunks: [], graph_context: { query_paths: [] } },
    error: null,
    meta: {},
  };
}

function relationsEnvelope(): Record<string, unknown> {
  return { success: true, data: { relations: [] }, error: null, meta: {} };
}

function nodePage(columns: readonly string[], rows: readonly (readonly unknown[])[]): QueryPage {
  return {
    queryId: 'impact-query',
    columns,
    rows: rows as QueryPage['rows'],
    readEpoch: 17,
    nextCursor: null,
    bookmark: null,
  };
}

const claim = {
  id: 10,
  predicate: 'depends_on',
  objectText: 'Redis',
  polarity: 'positive' as const,
  validFrom: '2026-08-21T10:00:00.000Z',
  txTime: '2026-08-21T10:00:00.000Z',
  supersededBy: [] as readonly number[],
};

const mention = {
  claimId: 10,
  predicate: 'depends_on',
  entityId: 2,
  entityName: 'Redis',
};

function storedEnvelope(value: unknown): string {
  return JSON.stringify({ content: { text: JSON.stringify(value) } });
}

const entityRecord = {
  id: 1,
  name: 'Root',
  kind: 'service',
  claims: [claim],
  mentions: [mention],
  dependents: [],
  evidence: {},
};

describe('impact-only read contract and legacy non-migration', () => {
  it('keeps the legacy cloud query, relations, and inspect request bytes unchanged', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        const pathname = new URL(String(url)).pathname;
        if (pathname === '/query') return json(queryEnvelope());
        if (pathname === '/context/relations') return json(relationsEnvelope());
        return json({ data: { content: 'stored-envelope' } });
      },
    });

    await cloud.query('Root dependency', { type: 'knowledge', maxResults: 3 });
    await cloud.relations(7);
    await cloud.inspect('record-1', 1_234, 'legacy-scope');

    expect(calls.map((call) => new URL(call.url).pathname + new URL(call.url).search)).toEqual([
      '/query',
      '/context/relations?database=impact-db&collection=owner-collection&limit=7',
      '/context/inspect?database=impact-db&collection=legacy-scope&id=record-1&mode=content',
    ]);
    expect(String(calls[0]?.init.body)).toBe(JSON.stringify({
      database: 'impact-db', collection: 'owner-collection', query: 'Root dependency',
      type: 'knowledge', graph_context: true, max_results: 3,
    }));
  });

  it('keeps the legacy node queryPage request bytes unchanged', async () => {
    let encoded = '';
    const client = new HydraClient(NODE_CONFIG, {
      fetch: async (_url, init) => {
        encoded = String(init.body);
        return json({
          query_id: 'fixed', columns: [], rows: [], read_epoch: null,
          next_cursor: null, bookmark: null,
        });
      },
    });

    await client.queryPage({
      cypher: 'RETURN $value AS value', parameters: { value: 7 },
      consistency: 'eventual', timeoutMs: 1_234, pageSize: 2, bookmark: null,
    }, { queryId: 'fixed' });

    expect(encoded).toBe(JSON.stringify({
      cell_id: 'cell-impact', query: 'RETURN $value AS value', query_id: 'fixed',
      consistency: 'eventual', timeout_ms: 1_234, parameters: { value: 7 }, page_size: 2,
    }));
  });

  it('exports one cloud-only port whose caller cannot raise query or relation options', async () => {
    const module = await impactExports();
    expect(module).not.toBeNull();
    if (module === null) return;

    const calls: { url: string; body: string }[] = [];
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: String(init.body ?? '') });
        return new URL(String(url)).pathname === '/query'
          ? json(queryEnvelope())
          : json(relationsEnvelope());
      },
    });
    const port = module.createCloudImpactReadPort(cloud);
    await port.queryForImpact('Root', control());
    await port.relationsForImpact(control());

    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({
      database: 'impact-db', collection: 'owner-collection', query: 'Root',
      type: 'all', graph_context: true, max_results: 6,
    });
    expect(new URL(calls[1]?.url ?? 'https://invalid.test').searchParams.get('limit')).toBe('128');
  });
});

describe('required impact control', () => {
  it('refuses every cloud impact method before transport when control is missing', async () => {
    const fetcher = vi.fn(async () => { throw new Error('transport must not start'); });
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: fetcher });

    for (const [method, args] of [
      ['queryForImpact', ['Root', undefined]],
      ['relationsForImpact', [undefined]],
      ['inspectForImpact', ['record-1', undefined]],
    ] as const) {
      await expect(invokeImpact(cloud, method, args)).rejects.toBeInstanceOf(HydraGuardError);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses the node impact query before transport when control is missing', async () => {
    const fetcher = vi.fn(async () => { throw new Error('transport must not start'); });
    const client = new HydraClient(NODE_CONFIG, { fetch: fetcher });
    const prepared: PreparedQuery = { cypher: 'RETURN 1 AS id', parameters: {} };

    await expect(invokeImpact(client, 'queryForImpact', [prepared, undefined]))
      .rejects.toBeInstanceOf(HydraGuardError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses concrete source impact reads with missing control and never falls back to legacy reads', async () => {
    const cloudLegacy = vi.fn(async () => { throw new Error('legacy cloud read used'); });
    const cloudImpact = vi.fn(async () => { throw new Error('impact transport must not start'); });
    const cloud = {
      database: 'impact-db', collection: 'owner-collection',
      inspect: cloudLegacy, inspectForImpact: cloudImpact,
    } as unknown as HydraCloud;
    await expect(invokeImpact(new CloudSource(cloud), 'subjectForImpact', ['Root', undefined]))
      .rejects.toBeInstanceOf(HydraGuardError);

    const nodeLegacy = vi.fn(async () => { throw new Error('legacy node read used'); });
    const nodeImpact = vi.fn(async () => { throw new Error('impact transport must not start'); });
    const client = { query: nodeLegacy, queryForImpact: nodeImpact } as unknown as HydraClient;
    await expect(invokeImpact(new NodeSource(client), 'subjectForImpact', ['Root', undefined]))
      .rejects.toBeInstanceOf(HydraGuardError);

    expect(cloudLegacy).not.toHaveBeenCalled();
    expect(cloudImpact).not.toHaveBeenCalled();
    expect(nodeLegacy).not.toHaveBeenCalled();
    expect(nodeImpact).not.toHaveBeenCalled();
  });
});

describe('concrete impact subject sources', () => {
  it('uses inspectForImpact only for cloud entity, index fallback, and canonical retry', async () => {
    const calls: { id: string; control: ImpactControl }[] = [];
    const impact = vi.fn(async (id: string, held: ImpactControl) => {
      calls.push({ id, control: held });
      if (id === entityRecordId('root')) return null;
      if (id === INDEX_ID) {
        return { id, envelope: storedEnvelope({ claims: {}, entities: { '1': 'Root' } }), latencyMs: 1 };
      }
      if (id === entityRecordId('Root')) {
        return { id, envelope: storedEnvelope(entityRecord), latencyMs: 1 };
      }
      throw new Error('unexpected id');
    });
    const legacy = vi.fn(async () => { throw new Error('legacy inspect used'); });
    const cloud = {
      database: 'impact-db', collection: 'owner-collection',
      inspectForImpact: impact, inspect: legacy,
    } as unknown as HydraCloud;
    const held = control();

    const read = await invokeImpact(new CloudSource(cloud), 'subjectForImpact', ['root', held]) as {
      value: typeof entityRecord; traces: readonly unknown[];
    };

    expect(read.value).toMatchObject({ id: 1, claims: [claim], mentions: [mention] });
    expect(calls.map((call) => call.id)).toEqual([
      entityRecordId('root'), INDEX_ID, entityRecordId('Root'),
    ]);
    expect(calls.every((call) => call.control.deadlineMs === held.deadlineMs
      && call.control.byteBudget === held.byteBudget)).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });

  it('uses queryForImpact only for node entity, claims, and Mention fan-out', async () => {
    const controls: ImpactControl[] = [];
    const impact = vi.fn(async (prepared: PreparedQuery, held: ImpactControl): Promise<QueryPage> => {
      controls.push(held);
      if (prepared.cypher.includes('RETURN e.id AS id')) {
        return nodePage(['id', 'kind'], [[1, 'service']]);
      }
      if (prepared.cypher.includes('newer.id AS superseded_by')) {
        return nodePage(
          ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by'],
          [[10, 'depends_on', 'Redis', 'positive', '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z', null]],
        );
      }
      if (prepared.cypher.includes('o.name AS other_name')) {
        return nodePage(['claim', 'predicate', 'other', 'other_name'], [[10, 'depends_on', 2, 'Redis']]);
      }
      throw new Error('unexpected prepared query');
    });
    const legacy = vi.fn(async () => { throw new Error('legacy node query used'); });
    const client = { queryForImpact: impact, query: legacy } as unknown as HydraClient;
    const held = control();

    const read = await invokeImpact(new NodeSource(client), 'subjectForImpact', ['Root', held]) as {
      value: typeof entityRecord; traces: readonly unknown[];
    };

    expect(read.value).toMatchObject({ id: 1, claims: [claim], mentions: [mention] });
    expect(impact).toHaveBeenCalledTimes(3);
    expect(controls.every((entry) => entry.deadlineMs === held.deadlineMs
      && entry.byteBudget === held.byteBudget)).toBe(true);
    expect(legacy).not.toHaveBeenCalled();
  });
});
