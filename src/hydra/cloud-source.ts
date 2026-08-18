import type { HydraCloud } from './cloud.js';
import {
  entityRecordId,
  INDEX_ID,
  unwrapEnvelope,
  type EntityRecord,
  type IndexRecord,
} from './cloud-graph.js';
import { emptySubject, orderMentions, type HydraSource, type Read } from './source.js';
import { RetrievalDecodeError } from '../retrieval/errors.js';
import type { DependentEdge, EntityHead } from '../retrieval/decode.js';
import type { EvidenceRecord, QueryTrace, SubjectView } from '../retrieval/types.js';

/**
 * HydraDB Cloud behind the same seam the node sits behind.
 *
 * Reads are addressed by id rather than ranked by similarity, so the same
 * question reads the same record every time. That is not a detail: a temporal
 * resolver that answered differently on a second asking would not be a
 * resolver. The service's other endpoint, `/query`, is a vector search over
 * the conversations themselves, and it is used where similarity is the right
 * tool. Neither pretends to be the other.
 *
 * One fetch answers a question, against the node's three, because the record
 * holds what three Cypher reads would have gathered. The saving is real and it
 * is also the reason for the memo below: a hop, and every citation behind it,
 * is usually already in hand.
 */
export class CloudSource implements HydraSource {
  readonly kind = 'cloud' as const;
  readonly #cloud: HydraCloud;
  /**
   * Records already read on this instance.
   *
   * Scoped to one instance, and one instance serves one request, so nothing
   * here outlives the question that filled it and no two workspaces can share
   * an entry. A longer lived cache over a store whose whole subject is what
   * changed would be the wrong kind of clever.
   */
  readonly #records = new Map<string, EntityRecord | null>();
  #index: IndexRecord | null = null;

  constructor(cloud: HydraCloud) {
    this.#cloud = cloud;
  }

  /** A record and the round trip it cost, or a cache hit costing nothing. */
  async #record(name: string, timeoutMs: number): Promise<{
    record: EntityRecord | null;
    traces: QueryTrace[];
  }> {
    const id = entityRecordId(name);
    const cached = this.#records.get(id);
    if (cached !== undefined) return { record: cached, traces: [] };

    const started = performance.now();
    const source = await this.#cloud.inspect(id, timeoutMs);
    const ms = Math.round((performance.now() - started) * 10) / 10;
    const trace: QueryTrace = {
      cypher: null,
      request: `GET /context/inspect id=${id}`,
      parameters: { name, database: this.#cloud.database, collection: this.#cloud.collection },
      rows: source === null ? 0 : 1,
      ms,
      readEpoch: null,
    };

    if (source === null) {
      this.#records.set(id, null);
      return { record: null, traces: [trace] };
    }

    const record = parseEntity(unwrapEnvelope(source.envelope), name);
    this.#records.set(id, record);
    return { record, traces: [trace] };
  }

  async #indexRecord(timeoutMs: number): Promise<{ index: IndexRecord; traces: QueryTrace[] }> {
    if (this.#index !== null) return { index: this.#index, traces: [] };
    const started = performance.now();
    const source = await this.#cloud.inspect(INDEX_ID, timeoutMs);
    const trace: QueryTrace = {
      cypher: null,
      request: `GET /context/inspect id=${INDEX_ID}`,
      parameters: { database: this.#cloud.database, collection: this.#cloud.collection },
      rows: source === null ? 0 : 1,
      ms: Math.round((performance.now() - started) * 10) / 10,
      readEpoch: null,
    };
    const parsed = source === null ? null : parseIndex(unwrapEnvelope(source.envelope));
    this.#index = parsed ?? { claims: {}, entities: {} };
    return { index: this.#index, traces: [trace] };
  }

  async entity(name: string, timeoutMs: number): Promise<Read<EntityHead | null>> {
    const { record, traces } = await this.#record(name, timeoutMs);
    return {
      value: record === null ? null : { id: record.id, kind: record.kind },
      traces,
    };
  }

  async subject(name: string, timeoutMs: number): Promise<Read<SubjectView>> {
    const { record, traces } = await this.#record(name, timeoutMs);
    if (record === null) return { value: emptySubject(name), traces };
    return {
      value: {
        name,
        id: record.id,
        kind: record.kind,
        claims: record.claims,
        mentions: orderMentions(record.mentions),
      },
      traces,
    };
  }

  async evidence(claimId: number, timeoutMs: number): Promise<Read<readonly EvidenceRecord[]>> {
    // Almost always free: the citations for a cited claim came back with the
    // record that produced the claim.
    for (const record of this.#records.values()) {
      const held = record?.evidence[String(claimId)];
      if (held !== undefined) return { value: held, traces: [] };
    }

    // The exception the index exists for: a claim cited at the walk's depth
    // cap, whose own entity was never read.
    const { index, traces } = await this.#indexRecord(timeoutMs);
    const owner = index.claims[String(claimId)];
    if (owner === undefined) return { value: [], traces };

    const found = await this.#record(owner, timeoutMs);
    return {
      value: found.record?.evidence[String(claimId)] ?? [],
      traces: [...traces, ...found.traces],
    };
  }

  async dependents(entityId: number, timeoutMs: number): Promise<Read<readonly DependentEdge[]>> {
    for (const record of this.#records.values()) {
      if (record?.id === entityId) return { value: record.dependents, traces: [] };
    }

    const { index, traces } = await this.#indexRecord(timeoutMs);
    const name = index.entities[String(entityId)];
    if (name === undefined) return { value: [], traces };

    const found = await this.#record(name, timeoutMs);
    return {
      value: found.record?.dependents ?? [],
      traces: [...traces, ...found.traces],
    };
  }
}

function parseEntity(text: string | null, name: string): EntityRecord | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RetrievalDecodeError(`the record for "${name}" is not readable JSON`);
  }
  const record = parsed as Partial<EntityRecord> | null;
  if (
    record === null
    || typeof record.id !== 'number'
    || typeof record.name !== 'string'
    || !Array.isArray(record.claims)
    || !Array.isArray(record.mentions)
    || !Array.isArray(record.dependents)
    || typeof record.evidence !== 'object'
    || record.evidence === null
  ) {
    // Strict for the same reason the node's decoder is: a half read record
    // would travel to a screen and sit under a citation looking like an answer.
    throw new RetrievalDecodeError(`the record for "${name}" is missing required fields`);
  }
  return record as EntityRecord;
}

function parseIndex(text: string | null): IndexRecord | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<IndexRecord> | null;
    if (parsed === null || typeof parsed.claims !== 'object' || parsed.claims === null) return null;
    const entities = typeof parsed.entities === 'object' && parsed.entities !== null && !Array.isArray(parsed.entities)
      ? parsed.entities
      : {};
    return { claims: parsed.claims, entities };
  } catch {
    return null;
  }
}
