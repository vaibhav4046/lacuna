import { afterEach, describe, expect, it, vi } from 'vitest';

import { HydraClient, type QueryPage } from '../../src/hydra/client.js';
import { HydraCloud } from '../../src/hydra/cloud.js';
import { entityRecordId, INDEX_ID } from '../../src/hydra/cloud-graph.js';
import { CloudSource } from '../../src/hydra/cloud-source.js';
import { loadHydraConfig } from '../../src/hydra/config.js';
import {
  HydraDecodeError,
  HydraQueryError,
  HydraTransportError,
} from '../../src/hydra/errors.js';
import { NodeSource } from '../../src/hydra/node-source.js';
import type { PreparedQuery } from '../../src/hydra/queries.js';

const QUERY_CAP = 1_048_576;
const RELATIONS_CAP = 1_048_576;
const SUBJECT_CAP = 524_288;

const CLOUD_CONFIG = {
  baseUrl: 'https://api.hydradb.com',
  token: 'transport-token-not-real',
  database: 'impact-db',
  collection: 'workspace-collection',
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

interface TrackedBody {
  readonly response: Response;
  readonly cancelled: ReturnType<typeof vi.fn>;
  readonly completed: Promise<void>;
  readonly close?: () => void;
}

function control(
  overrides: Partial<ImpactControl> = {},
): ImpactControl {
  return {
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
    byteBudget: { consume: vi.fn() },
    ...overrides,
  };
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

function jsonBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function paddedJson(value: unknown, bytes: number): Uint8Array {
  const encoded = jsonBytes(value);
  if (encoded.byteLength > bytes) throw new Error('fixture exceeds requested bytes');
  const result = new Uint8Array(bytes);
  result.set(encoded);
  result.fill(0x20, encoded.byteLength);
  return result;
}

function trackedResponse(
  bytes: Uint8Array,
  options: { readonly status?: number; readonly chunks?: readonly number[] } = {},
): TrackedBody {
  const cancelled = vi.fn();
  let resolveCompleted!: () => void;
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
  const chunks = options.chunks ?? [bytes.byteLength];
  let offset = 0;
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        resolveCompleted();
        return;
      }
      const requested = chunks[index] ?? bytes.byteLength - offset;
      index += 1;
      const end = Math.min(bytes.byteLength, offset + requested);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
    cancel() {
      cancelled();
      resolveCompleted();
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(body, {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    }),
    cancelled,
    completed,
  };
}

function openResponse(): TrackedBody {
  const cancelled = vi.fn();
  let resolveCompleted!: () => void;
  const completed = new Promise<void>((resolve) => { resolveCompleted = resolve; });
  let streamController!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
    pull() {
      // Deliberately remains open until the consumer cancels it.
    },
    cancel() {
      cancelled();
      resolveCompleted();
    },
  }, { highWaterMark: 0 });
  return {
    response: new Response(body, { headers: { 'content-type': 'application/json' } }),
    cancelled,
    completed,
    close: () => {
      streamController.close();
      resolveCompleted();
    },
  };
}

function rawResponse(raw: string | Uint8Array, status = 200): TrackedBody {
  return trackedResponse(typeof raw === 'string' ? new TextEncoder().encode(raw) : raw, { status });
}

function validQuery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    data: {
      chunks: [],
      graph_context: { query_paths: [] },
      ...overrides,
    },
    error: null,
    meta: {},
  };
}

function validRelations(relations: readonly unknown[] = []): Record<string, unknown> {
  return { success: true, data: { relations }, error: null, meta: {} };
}

function validInspect(content = '{"content":{"text":"{}"}}'): Record<string, unknown> {
  return { success: true, data: { content }, error: null, meta: {} };
}

function liveQueryEnvelope(
  dataOverrides: Record<string, unknown> = {},
  rootOverrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: true,
    data: {
      chunks: [],
      sources: [],
      graph_context: {
        query_paths: [],
        chunk_relations: [{ provider_version: 2, relation_ids: ['rel-1'] }],
        chunk_id_to_group_ids: {},
        synthesis_context: '',
      },
      temporal_facts: [],
      temporal_filter: null,
      additional_context: {},
      ...dataOverrides,
    },
    error: null,
    meta: { request_id: 'impact-request-1', latency_ms: 12 },
    ...rootOverrides,
  };
}

function validNodePage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    query_id: 'impact-query',
    columns: [],
    rows: [],
    read_epoch: null,
    next_cursor: null,
    bookmark: null,
    ...overrides,
  };
}

function decodedNodePage(
  columns: readonly string[],
  rows: readonly (readonly unknown[])[],
): QueryPage {
  return {
    queryId: 'impact-query',
    columns,
    rows: rows as QueryPage['rows'],
    readEpoch: null,
    nextCursor: null,
    bookmark: null,
  };
}

function tagged(type: string, value?: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type, ...(value === undefined ? {} : { value }), ...extra };
}

function triplet(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    source: { name: 'Root' },
    relation: {
      relationship_id: 'rel-1',
      canonical_predicate: 'uses',
      chunk_id: 'chunk-1',
      context: 'Root uses Redis.',
    },
    target: { name: 'Redis' },
    ...overrides,
  };
}

function relationContainer(
  relations: readonly unknown[] = [{
    relationship_id: 'rel-1',
    canonical_predicate: 'uses',
    chunk_id: 'chunk-1',
    context: 'Root uses Redis.',
  }],
): Record<string, unknown> {
  return { source: { name: 'Root' }, target: { name: 'Redis' }, relations };
}

const NODE_QUERY: PreparedQuery = {
  cypher: 'MATCH (e:Entity) RETURN e.id AS id',
  parameters: {},
};

afterEach(() => {
  vi.useRealTimers();
});

describe('strict impact wire decoding', () => {
  it('accepts the proven live query envelope and joins relation provenance by chunk_uuid', async () => {
    const body = liveQueryEnvelope({
      chunks: [{
        chunk_uuid: 'chunk-uuid-1',
        id: 'source-1',
        source_id: 'source-1',
        source_ids: ['source-2', 'source-1'],
        chunk_content: 'Root uses Redis.',
        relevancy_score: 0.91,
        source_title: 'Imported note',
        source_type: 'custom',
        source_upload_time: '2026-08-21T09:00:00.000Z',
        source_last_updated_time: '2026-08-21T10:00:00.000Z',
        metadata: { department: 'platform' },
        additional_metadata: { reviewed: true, tags: ['impact'] },
        extra_context_ids: ['related-chunk-1'],
        layout: 'text',
      }],
      sources: [{
        id: 'source-1',
        title: 'Imported note',
        type: 'knowledge',
        url: 'https://example.invalid/note',
        timestamp: '2026-08-21T10:00:00.000Z',
        description: 'A reviewed source.',
        metadata: { department: 'platform' },
        additional_metadata: { reviewed: true },
        app_kind: null,
        app_provider: null,
        app_external_id: null,
        sub_tenant_id: 'workspace-collection',
      }],
      graph_context: {
        query_paths: [{
          triplets: [triplet({
            source: { entity_id: 'entity-root', name: 'Root', namespace: 'concepts', type: 'CONCEPT' },
            relation: {
              relationship_id: 'rel-1',
              canonical_predicate: 'uses',
              raw_predicate: 'uses',
              chunk_id: 'chunk-uuid-1',
              source_entity_id: 'entity-root',
              target_entity_id: 'entity-redis',
              context: 'Root uses Redis.',
              confidence: 0.8,
              temporal_details: null,
              timestamp: 1787096135.23018,
            },
            target: { entity_id: 'entity-redis', name: 'Redis', namespace: 'concepts', type: 'CONCEPT' },
          })],
          relevancy_score: 0.34,
          combined_context: 'Root uses Redis.',
          group_id: 'path-1',
          source_chunk_ids: ['chunk-uuid-1'],
        }],
        chunk_relations: [{ provider_version: 2, relation_ids: ['rel-1'] }],
        chunk_id_to_group_ids: { 'chunk-uuid-1': ['path-1'] },
        synthesis_context: 'Root uses Redis.',
      },
      temporal_facts: [{ subject: 'Root', predicate: 'uses', object: 'Redis' }],
      temporal_filter: { applied: true, bounds: null },
      additional_context: { provider_version: 2, hints: ['graph'] },
    });
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(body)).response,
    });

    const result = await invokeImpact(cloud, 'queryForImpact', ['Root', control()]) as {
      chunks: readonly { chunkId: string | null; sourceIds: readonly string[] }[];
      relations: readonly { chunkId: string | null }[];
    };

    expect(result.chunks).toEqual([
      expect.objectContaining({ chunkId: 'chunk-uuid-1', sourceIds: ['source-1', 'source-2'] }),
    ]);
    expect(result.relations).toEqual([
      expect.objectContaining({ chunkId: 'chunk-uuid-1' }),
    ]);
  });

  it.each([
    ['id only', { id: 'source-id' }, ['source-id']],
    ['source_id only', { source_id: 'source-id' }, ['source-id']],
    ['equal aliases', { id: 'source-id', source_id: 'source-id' }, ['source-id']],
    ['no singular alias', {}, []],
  ])('decodes %s as source provenance without substituting it for chunk_uuid', async (_label, aliases, sourceIds) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({
        chunks: [{ ...aliases, chunk_content: '' }],
      }))).response,
    });

    const result = await invokeImpact(cloud, 'queryForImpact', ['Root', control()]) as {
      chunks: readonly { chunkId: string | null; sourceIds: readonly string[] }[];
    };
    expect(result.chunks).toEqual([expect.objectContaining({ chunkId: null, sourceIds })]);
  });

  it('rejects conflicting id/source_id aliases atomically', async () => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({
        chunks: [{ id: 'source-a', source_id: 'source-b', chunk_content: '' }],
      }))).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it.each([
    ['sources wrong type', { sources: 'provider-sources' }],
    ['sources cap+1', { sources: Array.from({ length: 65 }, () => ({})) }],
    ['source unknown key', { sources: [{ id: 'source-1', provider_secret: true }] }],
    ['source metadata wrong outer type', { sources: [{ metadata: 'provider-metadata' }] }],
    ['source additional metadata wrong outer type', { sources: [{ additional_metadata: [] }] }],
    ['source metadata array cap+1', { sources: [{ metadata: { values: Array.from({ length: 257 }, () => null) } }] }],
    ['chunk metadata wrong outer type', { chunks: [{ chunk_content: '', metadata: ['wrong'] }] }],
    ['temporal facts depth cap+1', { temporal_facts: { a: { b: { c: { d: { e: { f: { g: null } } } } } } } }],
    ['temporal facts scalar', { temporal_facts: 'wrong' }],
    ['temporal filter array', { temporal_filter: [] }],
    ['additional context wrong outer type', { additional_context: 'wrong' }],
    ['graph unknown key', { graph_context: { query_paths: [], provider_secret: true } }],
    ['chunk relations wrong outer type', { graph_context: { query_paths: [], chunk_relations: {} } }],
    ['chunk relations auxiliary cap+1', { graph_context: { query_paths: [], chunk_relations: [{ values: Array.from({ length: 257 }, () => null) }] } }],
    ['chunk group map wrong value', { graph_context: { query_paths: [], chunk_id_to_group_ids: { c: 'group' } } }],
    ['relation temporal object', { graph_context: { query_paths: [{ triplets: [triplet({ relation: { canonical_predicate: 'uses', temporal_details: {} } })] }] } }],
    ['relation malformed temporal timestamp', { graph_context: { query_paths: [{ triplets: [triplet({ relation: { canonical_predicate: 'uses', temporal_details: 'not-a-timestamp' } })] }] } }],
    ['relation timestamp wrong type', { graph_context: { query_paths: [{ triplets: [triplet({ relation: { canonical_predicate: 'uses', timestamp: '2026-08-21T10:00:00.000Z' } })] }] } }],
  ])('rejects malformed live compatibility field: %s', async (_label, dataOverrides) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope(dataOverrides))).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it.each([
    ['success false', { success: false }],
    ['success missing', { success: undefined }],
    ['success error', { error: { code: 'PROVIDER_SECRET', message: 'sentinel-secret' } }],
    ['root unknown key', { provider_secret: true }],
    ['meta wrong outer type', { meta: 'provider-meta' }],
    ['meta array cap+1', { meta: { values: Array.from({ length: 257 }, () => null) } }],
  ])('rejects invalid successful envelope: %s', async (_label, rootOverrides) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({}, rootOverrides))).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('attributes a meta cap+1 refusal to the bounded auxiliary profile', async () => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({}, {
        meta: { values: Array.from({ length: 257 }, () => null) },
      }))).response,
    });

    const error = await invokeImpact(cloud, 'queryForImpact', ['Root', control()])
      .then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(HydraDecodeError);
    expect((error as Error).message).toContain('auxiliary array cap');
  });

  it.each([
    ['auxiliary object key', liveQueryEnvelope({}, {
      meta: { 'https://secret.invalid/?token=sentinel-token': Array.from({ length: 257 }, () => null) },
    })],
    ['chunk-group map key', liveQueryEnvelope({
      graph_context: {
        query_paths: [],
        chunk_id_to_group_ids: { 'https://secret.invalid/?token=sentinel-token': 'wrong-type' },
      },
    })],
  ])('redacts provider-controlled %s from compatibility decode errors', async (_label, body) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(body)).response,
    });

    const error = await invokeImpact(cloud, 'queryForImpact', ['Root', control()])
      .then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(HydraDecodeError);
    expect(String(error)).not.toContain('secret.invalid');
    expect(String(error)).not.toContain('sentinel-token');
  });

  it.each(['id', 'title', 'type', 'timestamp'])(
    'accepts the inclusive 256-byte source %s cap and rejects cap+1',
    async (field) => {
      const atCap = new HydraCloud(CLOUD_CONFIG, {
        fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({
          sources: [{ [field]: 'x'.repeat(256) }],
        }))).response,
      });
      const overCap = new HydraCloud(CLOUD_CONFIG, {
        fetch: async () => rawResponse(JSON.stringify(liveQueryEnvelope({
          sources: [{ [field]: 'x'.repeat(257) }],
        }))).response,
      });

      await expect(invokeImpact(atCap, 'queryForImpact', ['Root', control()]))
        .resolves.toBeDefined();
      await expect(invokeImpact(overCap, 'queryForImpact', ['Root', control()]))
        .rejects.toBeInstanceOf(HydraDecodeError);
    },
  );

  it('accepts proven success envelopes for inspect and relations', async () => {
    const stored = '{"content":{"text":"{}"}}';
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async (input) => {
        const path = new URL(String(input)).pathname;
        return path === '/context/inspect'
          ? rawResponse(JSON.stringify({
              success: true,
              data: { content: stored },
              meta: { request_id: 'inspect-1' },
            })).response
          : rawResponse(JSON.stringify({
              success: true,
              data: { relations: [relationContainer([{
                relationship_id: 'rel-1',
                canonical_predicate: 'uses',
                chunk_id: 'chunk-uuid-1',
                context: 'Root uses Redis.',
                temporal_details: '2026-08-21T10:00:00.000Z',
                timestamp: 1787096135.23018,
              }])] },
              error: null,
              meta: { request_id: 'relations-1' },
            })).response;
      },
    });

    await expect(invokeImpact(cloud, 'inspectForImpact', ['entity-1', control()]))
      .resolves.toEqual(expect.objectContaining({ id: 'entity-1', envelope: stored }));
    await expect(invokeImpact(cloud, 'relationsForImpact', [control()]))
      .resolves.toEqual([expect.objectContaining({ relationshipId: 'rel-1' })]);
  });

  it('decodes stable source-id union order and preserves raw null/empty relation scalars', async () => {
    const encoded = JSON.stringify(validQuery({
        chunks: [
          {
            chunk_uuid: 'chunk-1',
            chunk_content: 'Root uses Redis.',
            relevancy_score: -0,
            source_id: 'source-b',
            source_ids: ['source-a', 'source-b', 'source-c'],
            source_title: 'Imported note',
            source_type: 'custom',
            source_last_updated_time: '2026-08-21T10:00:00.000Z',
          },
          { chunk_uuid: 'chunk-2', chunk_content: '', relevancy_score: null },
        ],
        graph_context: {
          query_paths: [{
            triplets: [
              triplet({
                source: { name: '' },
                relation: {
                  relationship_id: null,
                  canonical_predicate: '',
                  chunk_id: null,
                  context: '',
                },
                target: { name: null },
              }),
            ],
          }],
        },
      })).replace('"relevancy_score":0', '"relevancy_score":-0');
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(encoded).response,
    });

    const result = await invokeImpact(cloud, 'queryForImpact', ['Root', control()]) as {
      chunks: readonly { chunkId: string | null; sourceIds: readonly string[]; score: number | null }[];
      relations: readonly Record<string, unknown>[];
    };

    expect(result.chunks).toEqual([
      expect.objectContaining({ chunkId: 'chunk-1', sourceIds: ['source-b', 'source-a', 'source-c'] }),
      expect.objectContaining({ chunkId: 'chunk-2', sourceIds: [] }),
    ]);
    expect(Object.is(result.chunks[0]?.score, -0)).toBe(true);
    expect(result.relations).toEqual([{
      relationshipId: null,
      source: '',
      target: null,
      predicate: '',
      chunkId: null,
      context: '',
    }]);
  });

  it('keeps all bounded relation occurrences instead of deduplicating them', async () => {
    const repeated = relationContainer([
      { relationship_id: null, canonical_predicate: '', chunk_id: null, context: '' },
      { relationship_id: null, canonical_predicate: '', chunk_id: null, context: '' },
    ]);
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(validRelations([repeated]))).response,
    });

    const result = await invokeImpact(cloud, 'relationsForImpact', [control()]) as readonly unknown[];
    expect(result).toEqual([
      { relationshipId: null, source: 'Root', target: 'Redis', predicate: '', chunkId: null, context: '' },
      { relationshipId: null, source: 'Root', target: 'Redis', predicate: '', chunkId: null, context: '' },
    ]);
  });

  it.each([
    ['query chunks', validQuery({ chunks: Array.from({ length: 7 }, (_, i) => ({ chunk_uuid: `c-${i}`, chunk_content: '' })) })],
    ['query paths', validQuery({ graph_context: { query_paths: Array.from({ length: 33 }, () => ({ triplets: [] })) } })],
    ['triplets per path', validQuery({ graph_context: { query_paths: [{ triplets: Array.from({ length: 9 }, () => triplet()) }] } })],
    ['total query triplets', validQuery({ graph_context: { query_paths: Array.from({ length: 17 }, () => ({ triplets: Array.from({ length: 8 }, () => triplet()) })) } })],
  ])('rejects cap+1 for %s atomically', async (_label, body) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(body)).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it.each([
    ['containers', Array.from({ length: 65 }, () => relationContainer([]))],
    ['nested rows', [relationContainer(Array.from({ length: 9 }, () => ({ canonical_predicate: 'uses' })))]],
    ['total rows', Array.from({ length: 17 }, () => relationContainer(Array.from({ length: 8 }, () => ({ canonical_predicate: 'uses' }))))],
  ])('rejects relation cap+1 for %s atomically', async (_label, relations) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(validRelations(relations))).response,
    });
    await expect(invokeImpact(cloud, 'relationsForImpact', [control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it.each([
    ['unknown key', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: '', provider_secret: 'no' }] })],
    ['wrong score type', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: '', relevancy_score: 'high' }] })],
    ['empty source id', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: '', source_id: '' }] })],
    ['source-id raw cap+1', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: '', source_ids: Array.from({ length: 9 }, (_, i) => `s-${i}`) }] })],
    ['source-id final union cap+1', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: '', source_id: 's-x', source_ids: Array.from({ length: 8 }, (_, i) => `s-${i}`) }] })],
    ['text byte cap+1', validQuery({ chunks: [{ chunk_uuid: 'c', chunk_content: 'x'.repeat(2_049) }] })],
    ['endpoint byte cap+1', validQuery({ graph_context: { query_paths: [{ triplets: [triplet({ source: { name: 'x'.repeat(513) } })] }] } })],
    ['predicate byte cap+1', validQuery({ graph_context: { query_paths: [{ triplets: [triplet({ relation: { canonical_predicate: 'x'.repeat(65) } })] }] } })],
  ])('rejects %s instead of coercing or truncating', async (_label, body) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(body)).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('rejects a JSON number that overflows to a non-finite score', async () => {
    const raw = '{"success":true,"data":{"chunks":[{"chunk_uuid":"c","chunk_content":"","relevancy_score":1e400}],"graph_context":{"query_paths":[]}},"error":null,"meta":{}}';
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => rawResponse(raw).response });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('rejects a JSON number that overflows to a non-finite relation timestamp', async () => {
    const raw = '{"success":true,"data":{"chunks":[],"graph_context":{"query_paths":[{"triplets":[{"source":{"name":"Root"},"relation":{"timestamp":1e400},"target":{"name":"Redis"}}]}]}},"error":null,"meta":{}}';
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => rawResponse(raw).response });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it.each([
    ['truncated JSON', '{"success":true,"data":{"chunks":[]'],
    ['duplicate key', '{"success":true,"data":{"chunks":[],"chunks":[],"graph_context":{"query_paths":[]}},"error":null,"meta":{}}'],
  ])('rejects %s', async (_label, raw) => {
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(raw).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('rejects invalid UTF-8 before JSON decoding', async () => {
    const invalid = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(invalid).response,
    });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('rejects an unpaired surrogate even inside a known unconsumed response field', async () => {
    const raw = String.raw`{"success":true,"data":{"chunks":[],"graph_context":{"query_paths":[]},"sources":["\ud800"]},"error":null,"meta":{}}`;
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => rawResponse(raw).response });
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('rejects a non-finite node read epoch decoded from a valid JSON number', async () => {
    const raw = '{"query_id":"impact-query","columns":[],"rows":[],"read_epoch":1e400,"next_cursor":null,"bookmark":null}';
    const client = new HydraClient(NODE_CONFIG, { fetch: async () => rawResponse(raw).response });
    await expect(invokeImpact(client, 'queryForImpact', [NODE_QUERY, control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });
});

describe('fixed streamed body ceilings and aggregate accounting', () => {
  it.each([
    ['queryForImpact', QUERY_CAP, validQuery(), ['Root']],
    ['relationsForImpact', RELATIONS_CAP, validRelations(), []],
    ['inspectForImpact', SUBJECT_CAP, validInspect(), ['entity-1']],
  ] as const)('accepts the inclusive %s endpoint cap and counts every stream chunk', async (method, cap, value, prefix) => {
    const tracked = trackedResponse(paddedJson(value, cap), { chunks: [7, 11, cap] });
    const budget = { consume: vi.fn() };
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });
    await invokeImpact(cloud, method, [...prefix, control({ byteBudget: budget })]);

    expect(budget.consume).toHaveBeenCalledTimes(3);
    expect(budget.consume.mock.calls.reduce((sum, call) => sum + Number(call[0]), 0)).toBe(cap);
    expect(tracked.cancelled).not.toHaveBeenCalled();
  });

  it('accepts the inclusive node subject-response cap', async () => {
    const tracked = trackedResponse(paddedJson(validNodePage(), SUBJECT_CAP), { chunks: [3, 5, SUBJECT_CAP] });
    const budget = { consume: vi.fn() };
    const client = new HydraClient(NODE_CONFIG, { fetch: async () => tracked.response });

    await invokeImpact(client, 'queryForImpact', [NODE_QUERY, control({ byteBudget: budget })]);
    expect(budget.consume.mock.calls.reduce((sum, call) => sum + Number(call[0]), 0)).toBe(SUBJECT_CAP);
  });

  it.each([
    ['queryForImpact', QUERY_CAP, validQuery(), ['Root']],
    ['relationsForImpact', RELATIONS_CAP, validRelations(), []],
    ['inspectForImpact', SUBJECT_CAP, validInspect(), ['entity-1']],
  ] as const)('cancels %s at cap+1 before parse', async (method, cap, value, prefix) => {
    const tracked = trackedResponse(paddedJson(value, cap + 1), { chunks: [cap, 1] });
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });

    await expect(invokeImpact(cloud, method, [...prefix, control()]))
      .rejects.toBeInstanceOf(HydraTransportError);
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
  });

  it('cancels the node response at cap+1 before parse', async () => {
    const tracked = trackedResponse(paddedJson(validNodePage(), SUBJECT_CAP + 1), { chunks: [SUBJECT_CAP, 1] });
    const client = new HydraClient(NODE_CONFIG, { fetch: async () => tracked.response });

    await expect(invokeImpact(client, 'queryForImpact', [NODE_QUERY, control()]))
      .rejects.toBeInstanceOf(HydraTransportError);
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
  });

  it('cancels immediately when the shared monotonic byte budget refuses a chunk', async () => {
    const tracked = trackedResponse(jsonBytes(validQuery()), { chunks: [4, 8, 16] });
    const budget = {
      consume: vi.fn(() => { throw new HydraTransportError('aggregate budget exhausted'); }),
    };
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });

    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control({ byteBudget: budget })]))
      .rejects.toBeInstanceOf(HydraTransportError);
    expect(budget.consume).toHaveBeenCalledTimes(1);
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
  });

  it('bounds non-2xx bodies with the same cap and never exposes raw provider text', async () => {
    const secret = 'provider-secret-that-must-not-surface';
    const exact = trackedResponse(paddedJson({ error: { code: secret, message: secret } }, QUERY_CAP), { status: 503 });
    const cloudExact = new HydraCloud(CLOUD_CONFIG, { fetch: async () => exact.response });
    const error = await invokeImpact(cloudExact, 'queryForImpact', ['Root', control()])
      .then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(HydraQueryError);
    expect(String(error)).not.toContain(secret);

    const over = trackedResponse(paddedJson({ error: { code: 'DENIED' } }, QUERY_CAP + 1), {
      status: 503,
      chunks: [QUERY_CAP, 1],
    });
    const cloudOver = new HydraCloud(CLOUD_CONFIG, { fetch: async () => over.response });
    await expect(invokeImpact(cloudOver, 'queryForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraTransportError);
    expect(over.cancelled).toHaveBeenCalledTimes(1);
  });
});

describe('closed redacted node impact decoding', () => {
  it.each([
    ['duplicate columns', validNodePage({ columns: ['value', 'value'], rows: [] })],
    ['column cap+1', validNodePage({ columns: Array.from({ length: 9 }, (_, at) => `column-${at}`), rows: [] })],
    ['row width beyond the column shape', validNodePage({ columns: ['value'], rows: [[tagged('null'), tagged('null')]] })],
    ['tagged-value extra key', validNodePage({ columns: ['value'], rows: [[tagged('string', 'safe', { provider_secret: true })]] })],
    ['tagged-value wrong type', validNodePage({ columns: ['value'], rows: [[tagged('boolean', 'true')]] })],
    ['tagged string byte cap+1', validNodePage({ columns: ['value'], rows: [[tagged('string', 'x'.repeat(2_049))]] })],
    ['row count cap+1', validNodePage({ columns: [], rows: Array.from({ length: 129 }, () => []) })],
  ])('rejects %s atomically', async (_label, body) => {
    const client = new HydraClient(NODE_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(body)).response,
    });
    await expect(invokeImpact(client, 'queryForImpact', [NODE_QUERY, control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
  });

  it('redacts malformed tagged provider values from impact decode errors', async () => {
    const sentinel = 'NODE_TAGGED_PROVIDER_SENTINEL';
    const client = new HydraClient(NODE_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(validNodePage({
        columns: ['id'],
        rows: [[tagged('vertex_id', sentinel)]],
      }))).response,
    });

    const error = await invokeImpact(client, 'queryForImpact', [NODE_QUERY, control()])
      .then(() => null, (cause: unknown) => cause);
    expect(error).toBeInstanceOf(HydraDecodeError);
    expect(String(error)).not.toContain(sentinel);
  });

  it('requires the exact impact query column shape before building subject rows', async () => {
    const legacy = vi.fn(async () => { throw new Error('legacy query must not run'); });
    const impact = vi.fn(async (prepared: PreparedQuery) => {
      if (prepared.cypher.includes('RETURN e.id AS id')) {
        return decodedNodePage(['kind', 'id'], [['service', 1]]);
      }
      if (prepared.cypher.includes('newer.id AS superseded_by')) {
        return decodedNodePage(
          ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by'],
          [],
        );
      }
      if (prepared.cypher.includes('o.name AS other_name')) {
        return decodedNodePage(['claim', 'predicate', 'other', 'other_name'], []);
      }
      throw new Error('unexpected query');
    });
    const source = new NodeSource({ query: legacy, queryForImpact: impact } as unknown as HydraClient);

    await expect(invokeImpact(source, 'subjectForImpact', ['Root', control()]))
      .rejects.toBeInstanceOf(HydraDecodeError);
    expect(legacy).not.toHaveBeenCalled();
  });

  it.each(['claim', 'Mention'] as const)(
    'redacts malformed %s provider values from subject decode errors',
    async (malformed) => {
      const sentinel = `${malformed.toUpperCase()}_PROVIDER_SENTINEL`;
      const legacy = vi.fn(async () => { throw new Error('legacy query must not run'); });
      const impact = vi.fn(async (prepared: PreparedQuery) => {
        if (prepared.cypher.includes('RETURN e.id AS id')) {
          return decodedNodePage(['id', 'kind'], [[1, 'service']]);
        }
        if (prepared.cypher.includes('newer.id AS superseded_by')) {
          return decodedNodePage(
            ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by'],
            [[10, 'depends_on', 'Redis', malformed === 'claim' ? sentinel : 'positive',
              '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z', null]],
          );
        }
        if (prepared.cypher.includes('o.name AS other_name')) {
          return decodedNodePage(
            ['claim', 'predicate', 'other', 'other_name'],
            [[10, 'depends_on', malformed === 'Mention' ? sentinel : 2, 'Redis']],
          );
        }
        throw new Error('unexpected query');
      });
      const source = new NodeSource({ query: legacy, queryForImpact: impact } as unknown as HydraClient);

      const error = await invokeImpact(source, 'subjectForImpact', ['Root', control()])
        .then(() => null, (cause: unknown) => cause);
      expect(error).toBeInstanceOf(HydraDecodeError);
      expect(String(error)).not.toContain(sentinel);
      expect(legacy).not.toHaveBeenCalled();
    },
  );

  it.each(['claims', 'Mentions'] as const)(
    'rejects the per-subject %s cap+1 before returning a partial subject',
    async (kind) => {
      const legacy = vi.fn(async () => { throw new Error('legacy query must not run'); });
      const impact = vi.fn(async (prepared: PreparedQuery) => {
        if (prepared.cypher.includes('RETURN e.id AS id')) {
          return decodedNodePage(['id', 'kind'], [[1, 'service']]);
        }
        if (prepared.cypher.includes('newer.id AS superseded_by')) {
          const rows = kind === 'claims'
            ? Array.from({ length: 129 }, (_, at) => [
                at + 1, 'depends_on', `Target ${at}`, 'positive',
                '2026-08-21T10:00:00.000Z', '2026-08-21T10:00:00.000Z', null,
              ])
            : [];
          return decodedNodePage(
            ['id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by'],
            rows,
          );
        }
        if (prepared.cypher.includes('o.name AS other_name')) {
          const rows = kind === 'Mentions'
            ? Array.from({ length: 129 }, (_, at) => [at + 1, 'depends_on', at + 2, `Target ${at}`])
            : [];
          return decodedNodePage(['claim', 'predicate', 'other', 'other_name'], rows);
        }
        throw new Error('unexpected query');
      });
      const source = new NodeSource({ query: legacy, queryForImpact: impact } as unknown as HydraClient);

      await expect(invokeImpact(source, 'subjectForImpact', ['Root', control()]))
        .rejects.toBeInstanceOf(HydraDecodeError);
      expect(legacy).not.toHaveBeenCalled();
    },
  );
});

describe('absolute cancellation and cleanup', () => {
  it('rechecks the deadline after a null-path canonical index scan', async () => {
    const indexText = JSON.stringify({ claims: {}, entities: { '1': 'Other' } });
    const inspectForImpact = vi.fn(async (id: string) => (
      id === INDEX_ID
        ? {
            id,
            envelope: JSON.stringify({ content: { text: indexText } }),
            latencyMs: 1,
          }
        : null
    ));
    const source = new CloudSource({
      database: CLOUD_CONFIG.database,
      collection: CLOUD_CONFIG.collection,
      inspectForImpact,
    } as unknown as HydraCloud);
    await invokeImpact(source, 'subjectForImpact', ['Preload', control()]);

    const instant = Date.parse('2026-08-21T10:00:00.000Z');
    const held = control({ deadlineMs: instant + 10 });
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValue(instant + 11);
    try {
      await expect(invokeImpact(source, 'subjectForImpact', ['Missing', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      clock.mockRestore();
    }
  });

  it('rechecks the deadline after a canonical retry resolves from cache', async () => {
    const entityText = JSON.stringify({
      id: 1,
      name: 'Root',
      kind: 'service',
      claims: [],
      mentions: [],
      dependents: [],
      evidence: {},
    });
    const indexText = JSON.stringify({ claims: {}, entities: { '1': 'Root' } });
    const inspectForImpact = vi.fn(async (id: string) => {
      if (id === INDEX_ID) {
        return { id, envelope: JSON.stringify({ content: { text: indexText } }), latencyMs: 1 };
      }
      if (id === entityRecordId('Root')) {
        return { id, envelope: JSON.stringify({ content: { text: entityText } }), latencyMs: 1 };
      }
      return null;
    });
    const source = new CloudSource({
      database: CLOUD_CONFIG.database,
      collection: CLOUD_CONFIG.collection,
      inspectForImpact,
    } as unknown as HydraCloud);
    await invokeImpact(source, 'subjectForImpact', ['Root', control()]);
    await invokeImpact(source, 'subjectForImpact', ['Preload', control()]);

    const instant = Date.parse('2026-08-21T10:00:00.000Z');
    const held = control({ deadlineMs: instant + 10 });
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValue(instant + 11);
    try {
      await expect(invokeImpact(source, 'subjectForImpact', ['root', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      clock.mockRestore();
    }
  });

  it('rechecks the deadline after ordering cached Mentions', async () => {
    const entityText = JSON.stringify({
      id: 1,
      name: 'Root',
      kind: 'service',
      claims: [],
      mentions: [
        { claimId: 2, predicate: 'uses', entityId: 3, entityName: 'B' },
        { claimId: 1, predicate: 'uses', entityId: 2, entityName: 'A' },
      ],
      dependents: [],
      evidence: {},
    });
    const inspectForImpact = vi.fn(async (id: string) => ({
      id,
      envelope: JSON.stringify({ content: { text: entityText } }),
      latencyMs: 1,
    }));
    const source = new CloudSource({
      database: CLOUD_CONFIG.database,
      collection: CLOUD_CONFIG.collection,
      inspectForImpact,
    } as unknown as HydraCloud);
    await invokeImpact(source, 'subjectForImpact', ['Root', control()]);

    const instant = Date.parse('2026-08-21T10:00:00.000Z');
    const held = control({ deadlineMs: instant + 10 });
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(instant)
      .mockReturnValue(instant + 11);
    try {
      await expect(invokeImpact(source, 'subjectForImpact', ['Root', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      clock.mockRestore();
    }
  });

  it('refuses an entity record whose stored JSON decode crosses the absolute deadline', async () => {
    const entityText = JSON.stringify({
      id: 1,
      name: 'Root',
      kind: 'service',
      claims: [],
      mentions: [],
      dependents: [],
      evidence: {},
    });
    const held = control();
    const inspectForImpact = vi.fn(async () => ({
      id: 'entity-1',
      envelope: JSON.stringify({ content: { text: entityText } }),
      latencyMs: 1,
    }));
    const source = new CloudSource({
      database: CLOUD_CONFIG.database,
      collection: CLOUD_CONFIG.collection,
      inspectForImpact,
    } as unknown as HydraCloud);
    const parseJson = JSON.parse;
    const parse = vi.spyOn(JSON, 'parse').mockImplementation((text: string) => {
      const decoded = parseJson(text);
      if (text === entityText) {
        Object.defineProperty(held, 'deadlineMs', { configurable: true, value: Date.now() - 1 });
      }
      return decoded;
    });

    try {
      await expect(invokeImpact(source, 'subjectForImpact', ['Root', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      parse.mockRestore();
    }
  });

  it('refuses an index record whose stored JSON decode crosses the absolute deadline', async () => {
    const indexText = JSON.stringify({ claims: {}, entities: {} });
    const held = control();
    const inspectForImpact = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'lacuna:index',
        envelope: JSON.stringify({ content: { text: indexText } }),
        latencyMs: 1,
      });
    const source = new CloudSource({
      database: CLOUD_CONFIG.database,
      collection: CLOUD_CONFIG.collection,
      inspectForImpact,
    } as unknown as HydraCloud);
    const parseJson = JSON.parse;
    const parse = vi.spyOn(JSON, 'parse').mockImplementation((text: string) => {
      const decoded = parseJson(text);
      if (text === indexText) {
        Object.defineProperty(held, 'deadlineMs', { configurable: true, value: Date.now() - 1 });
      }
      return decoded;
    });

    try {
      await expect(invokeImpact(source, 'subjectForImpact', ['Missing', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      parse.mockRestore();
    }
  });

  it('refuses an already-aborted caller and an elapsed deadline before fetch', async () => {
    const fetcher = vi.fn(async () => rawResponse(JSON.stringify(validQuery())).response);
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: fetcher });
    const aborted = new AbortController();
    aborted.abort();

    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control({ signal: aborted.signal })]))
      .rejects.toBeInstanceOf(HydraTransportError);
    await expect(invokeImpact(cloud, 'queryForImpact', ['Root', control({ deadlineMs: Date.now() - 1 })]))
      .rejects.toBeInstanceOf(HydraTransportError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('cancels an open reader on caller abort and removes its relay listener', async () => {
    const tracked = openResponse();
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });

    const pending = invokeImpact(cloud, 'queryForImpact', ['Root', control({ signal: caller.signal })]);
    await vi.waitFor(() => expect(add).toHaveBeenCalled());
    caller.abort();

    await expect(pending).rejects.toBeInstanceOf(HydraTransportError);
    await tracked.completed;
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('notices abort between fetch resolution and reader listener installation', async () => {
    const tracked = openResponse();
    const caller = new AbortController();
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => {
        caller.abort();
        return tracked.response;
      },
    });
    const pending = invokeImpact(cloud, 'queryForImpact', ['Root', control({ signal: caller.signal })]);
    const outcome = pending.then(
      () => null,
      (cause: unknown) => cause,
    );
    const settledEarly = await Promise.race([
      outcome.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 20)),
    ]);
    if (!settledEarly) tracked.close?.();
    expect(settledEarly).toBe(true);
    expect(await outcome).toBeInstanceOf(HydraTransportError);
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
  });

  it('rejects a caller abort that lands as a bodyless fetch response resolves', async () => {
    const caller = new AbortController();
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => {
        caller.abort();
        return new Response(null, { status: 204 });
      },
    });

    await expect(invokeImpact(cloud, 'queryForImpact', [
      'Root',
      control({ signal: caller.signal }),
    ])).rejects.toBeInstanceOf(HydraTransportError);
  });

  it('rechecks the absolute deadline after strict JSON and decoded query work', async () => {
    const instant = Date.parse('2026-08-21T10:00:00.000Z');
    const held: ImpactControl = {
      signal: new AbortController().signal,
      deadlineMs: instant + 10,
      byteBudget: { consume: vi.fn() },
    };
    const clock = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValueOnce(instant)
      .mockReturnValue(instant + 11);
    const cloud = new HydraCloud(CLOUD_CONFIG, {
      fetch: async () => rawResponse(JSON.stringify(validQuery({
        chunks: [{ chunk_uuid: 'chunk-1', chunk_content: 'Root uses Redis.' }],
      }))).response,
    });

    try {
      await expect(invokeImpact(cloud, 'queryForImpact', ['Root', held]))
        .rejects.toBeInstanceOf(HydraTransportError);
    } finally {
      clock.mockRestore();
    }
  });

  it('uses one absolute deadline, cancels the reader, and leaves no timer behind', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T10:00:00.000Z'));
    const tracked = openResponse();
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });
    const pending = invokeImpact(cloud, 'queryForImpact', [
      'Root',
      control({ deadlineMs: Date.now() + 25 }),
    ]);
    const outcome = pending.then(
      () => null,
      (cause: unknown) => cause,
    );

    await vi.advanceTimersByTimeAsync(25);
    expect(await outcome).toBeInstanceOf(HydraTransportError);
    await tracked.completed;
    expect(tracked.cancelled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes the relay after normal close so a late caller abort has no effect', async () => {
    const caller = new AbortController();
    const add = vi.spyOn(caller.signal, 'addEventListener');
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const tracked = rawResponse(JSON.stringify(validQuery()));
    const cloud = new HydraCloud(CLOUD_CONFIG, { fetch: async () => tracked.response });

    await invokeImpact(cloud, 'queryForImpact', ['Root', control({ signal: caller.signal })]);
    caller.abort();

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(tracked.cancelled).not.toHaveBeenCalled();
  });
});

describe('node subject fan-out lifecycle', () => {
  it('aborts a claims/Mention sibling on first failure and does not settle until it terminates', async () => {
    const legacy = vi.fn(async () => { throw new Error('legacy query must not run'); });
    let mentionStarted = false;
    let mentionAborted = false;
    let releaseMention!: () => void;
    const mentionTerminated = new Promise<void>((resolve) => { releaseMention = resolve; });
    const impact = vi.fn(async (prepared: PreparedQuery, held: ImpactControl) => {
      if (prepared.cypher.includes('RETURN e.id AS id')) {
        return validNodePage({ columns: ['id', 'kind'], rows: [[1, 'service']] });
      }
      if (prepared.cypher.includes('newer.id AS superseded_by')) {
        throw new HydraTransportError('claims failed');
      }
      if (prepared.cypher.includes('o.name AS other_name')) {
        mentionStarted = true;
        await new Promise<void>((resolve) => {
          const abort = () => {
            mentionAborted = true;
            held.signal.removeEventListener('abort', abort);
            resolve();
          };
          held.signal.addEventListener('abort', abort, { once: true });
        });
        await mentionTerminated;
        return validNodePage({ columns: ['claim', 'predicate', 'other', 'other_name'], rows: [] });
      }
      throw new Error('unexpected query');
    });
    const source = new NodeSource({ query: legacy, queryForImpact: impact } as unknown as HydraClient);

    let settled = false;
    const pending = invokeImpact(source, 'subjectForImpact', ['Root', control()]);
    void pending.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await vi.waitFor(() => expect(mentionStarted).toBe(true));
    await vi.waitFor(() => expect(mentionAborted).toBe(true));
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseMention();
    await expect(pending).rejects.toBeInstanceOf(HydraTransportError);
    expect(legacy).not.toHaveBeenCalled();
  });
});
