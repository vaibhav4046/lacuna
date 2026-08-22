import { canonicalName } from './canonical.js';
import { decodePersistedConnectorEvidence } from '../connectors/evidence.js';
import type { HydraCloud } from './cloud.js';
import {
  entityRecordId,
  INDEX_ID,
  unwrapEnvelope,
  type EntityRecord,
  type IndexRecord,
} from './cloud-graph.js';
import { emptySubject, orderMentions, type HydraSource, type Read } from './source.js';
import { HydraDecodeError } from './errors.js';
import { RetrievalDecodeError } from '../retrieval/errors.js';
import type { DependentEdge, EntityHead } from '../retrieval/decode.js';
import type { EvidenceRecord, QueryTrace, SubjectView } from '../retrieval/types.js';
import {
  assertImpactActive,
  assertImpactControl,
  type HydraImpactReadControl,
} from './impact-read.js';

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
  readonly #impactRecords = new Map<string, EntityRecord | null>();
  #impactIndex: IndexRecord | null = null;

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
      // Nothing at that id. Before reporting an absence, check whether the
      // corpus holds this name under a different case: the id is a hash of the
      // exact name, so `foxglove` and `Foxglove` address different records and
      // only one of them exists. See src/hydra/canonical.ts.
      const { index, traces: indexTraces } = await this.#indexRecord(timeoutMs);
      const canonical = canonicalName(Object.values(index.entities), name);
      if (canonical !== null) {
        const retried = await this.#record(canonical, timeoutMs);
        return { record: retried.record, traces: [trace, ...indexTraces, ...retried.traces] };
      }

      this.#records.set(id, null);
      return { record: null, traces: [trace, ...indexTraces] };
    }

    const text = unwrapEnvelope(source.envelope);
    if (text === null) {
      throw new HydraDecodeError('inspect response contains an unreadable stored entity envelope');
    }
    const record = parseEntity(text, name);
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
    if (source === null) {
      this.#index = { claims: {}, entities: {} };
      return { index: this.#index, traces: [trace] };
    }

    const text = unwrapEnvelope(source.envelope);
    if (text === null) {
      throw new HydraDecodeError('inspect response contains an unreadable stored index envelope');
    }
    const parsed = parseIndex(text);
    if (parsed === null) {
      throw new HydraDecodeError('inspect response contains a malformed stored index');
    }
    this.#index = parsed;
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

  async #impactRecord(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<{ record: EntityRecord | null; traces: QueryTrace[] }> {
    assertImpactActive(control);
    const id = entityRecordId(name);
    const cached = this.#impactRecords.get(id);
    if (cached !== undefined) return { record: cached, traces: [] };

    const started = performance.now();
    const source = await this.#cloud.inspectForImpact(id, control);
    assertImpactActive(control);
    const trace: QueryTrace = {
      cypher: null,
      request: `GET /context/inspect id=${id}`,
      parameters: { name, database: this.#cloud.database, collection: this.#cloud.collection },
      rows: source === null ? 0 : 1,
      ms: Math.round((performance.now() - started) * 10) / 10,
      readEpoch: null,
    };
    if (source === null) {
      const { index, traces } = await this.#impactIndexRecord(control);
      const canonical = canonicalName(Object.values(index.entities), name);
      assertImpactActive(control);
      if (canonical !== null) {
        const retried = await this.#impactRecord(canonical, control);
        assertImpactActive(control);
        return { record: retried.record, traces: [trace, ...traces, ...retried.traces] };
      }
      assertImpactActive(control);
      this.#impactRecords.set(id, null);
      return { record: null, traces: [trace, ...traces] };
    }
    const text = unwrapEnvelope(source.envelope);
    if (text === null) {
      throw new HydraDecodeError('impact inspect contains an unreadable stored entity envelope');
    }
    const record = parseEntity(text, name);
    assertImpactActive(control);
    this.#impactRecords.set(id, record);
    return { record, traces: [trace] };
  }

  async #impactIndexRecord(
    control: HydraImpactReadControl,
  ): Promise<{ index: IndexRecord; traces: QueryTrace[] }> {
    assertImpactActive(control);
    if (this.#impactIndex !== null) return { index: this.#impactIndex, traces: [] };
    const started = performance.now();
    const source = await this.#cloud.inspectForImpact(INDEX_ID, control);
    assertImpactActive(control);
    const trace: QueryTrace = {
      cypher: null,
      request: `GET /context/inspect id=${INDEX_ID}`,
      parameters: { database: this.#cloud.database, collection: this.#cloud.collection },
      rows: source === null ? 0 : 1,
      ms: Math.round((performance.now() - started) * 10) / 10,
      readEpoch: null,
    };
    if (source === null) {
      this.#impactIndex = { claims: {}, entities: {} };
      return { index: this.#impactIndex, traces: [trace] };
    }
    const text = unwrapEnvelope(source.envelope);
    if (text === null) {
      throw new HydraDecodeError('impact inspect contains an unreadable stored index envelope');
    }
    const parsed = parseIndex(text);
    if (parsed === null) {
      throw new HydraDecodeError('impact inspect contains a malformed stored index');
    }
    assertImpactActive(control);
    this.#impactIndex = parsed;
    return { index: parsed, traces: [trace] };
  }

  /** Strict impact-only subject read; never calls the legacy inspect path. */
  async subjectForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<Read<SubjectView>> {
    assertImpactControl(control);
    const { record, traces } = await this.#impactRecord(name, control);
    if (record === null) return { value: emptySubject(name), traces };
    const mentions = orderMentions(record.mentions);
    assertImpactActive(control);
    return {
      value: {
        name,
        id: record.id,
        kind: record.kind,
        claims: record.claims,
        mentions,
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

  /**
   * The names in this collection's index.
   *
   * The index is one record and is already fetched for name resolution, so
   * listing a workspace costs nothing a question would not already pay.
   */
  async subjects(timeoutMs: number): Promise<Read<readonly string[]>> {
    const { index, traces } = await this.#indexRecord(timeoutMs);
    return { value: [...new Set(Object.values(index.entities))].sort(), traces };
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
  for (const entries of Object.values(record.evidence)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null
        || !Object.prototype.hasOwnProperty.call(entry, 'connector')) continue;
      const decoded = decodePersistedConnectorEvidence((entry as { connector?: unknown }).connector);
      if (decoded === null) {
        throw new RetrievalDecodeError(`the record for "${name}" has invalid connector evidence`);
      }
      (entry as { connector?: unknown }).connector = decoded;
    }
  }
  return record as EntityRecord;
}

function parseIndex(text: string | null): IndexRecord | null {
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<IndexRecord> | null;
    if (!stringMap(parsed?.claims) || !stringMap(parsed.entities)) return null;
    return { claims: parsed.claims, entities: parsed.entities };
  } catch {
    return null;
  }
}

function stringMap(value: unknown): value is Readonly<Record<string, string>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'string');
}
