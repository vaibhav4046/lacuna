import { createHash } from 'node:crypto';

import type { ClaimAnnotation, Corpus, Message, Session } from '../corpus/types.js';
import { IdRegistry, KEY_SEPARATOR } from '../model/ids.js';
import { IngestError } from './errors.js';

/**
 * Corpus to graph, as a pure function.
 *
 * Everything that decides *what* the graph contains lives here and touches no
 * network. `run.ts` decides how to get it there. The split is what lets the
 * interesting invariants (every claim has a supporting span, contradiction
 * detection finds exactly the threads the corpus planted) be unit tests rather
 * than integration tests.
 *
 * The schema is ADR 0002's, property for property.
 */

export const NODE_LABELS = ['Session', 'Message', 'EvidenceSpan', 'Claim', 'Entity'] as const;
export type NodeLabel = (typeof NODE_LABELS)[number];

export const EDGE_TYPES = [
  'CONTAINS',
  'HAS_SPAN',
  'SUPPORTS',
  'ABOUT',
  'MENTIONS',
  'SUPERSEDES',
  'CONTRADICTS',
] as const;
export type EdgeType = (typeof EDGE_TYPES)[number];

/** A retraction is a claim that something is not so, and reads as an empty object. */
export type Polarity = 'positive' | 'negative';

export type PropertyValue = string | number;
export type VertexRow = Readonly<Record<string, PropertyValue>> & { readonly id: number };

export interface VertexBatch {
  readonly label: NodeLabel;
  readonly properties: readonly string[];
  readonly rows: readonly VertexRow[];
}

export interface PlannedEdge {
  readonly type: EdgeType;
  readonly src: number;
  readonly dst: number;
}

export interface PlanCounts {
  readonly vertices: Readonly<Record<NodeLabel, number>>;
  readonly edges: Readonly<Record<EdgeType, number>>;
}

export interface IngestPlan {
  /** Vertex writes, already split into request-sized batches, in label order. */
  readonly batches: readonly VertexBatch[];
  readonly edges: readonly PlannedEdge[];
  /**
   * Node id to full canonical key, for the read side of the collision check
   * ADR 0002 requires. Ingestion compares this against what the graph already
   * holds before it writes anything.
   */
  readonly keys: ReadonlyMap<number, string>;
  readonly counts: PlanCounts;
}

/**
 * Batch sizing. `maxParameterBytes` is 1 MiB, and one row carries a whole
 * message body, so the byte cap is the one that actually binds. Both are well
 * under the limit because a rejected batch costs a whole round trip.
 */
const MAX_BATCH_ROWS = 500;
const MAX_BATCH_BYTES = 262_144;

const PROPERTIES: Readonly<Record<NodeLabel, readonly string[]>> = Object.freeze({
  Session: ['key', 'session_key', 'title', 'started_at', 'seq'],
  Message: ['key', 'message_key', 'session_id', 'role', 'ts', 'seq', 'text'],
  EvidenceSpan: ['key', 'message_id', 'start', 'end', 'text_hash', 'quote'],
  Claim: ['key', 'claim_key', 'subject_id', 'predicate', 'object_text', 'valid_from', 'tx_time', 'polarity'],
  Entity: ['key', 'name', 'kind'],
});

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** `<message key>#<start>-<end>`. Unique because spans within a message do not overlap. */
export function spanKey(messageKey: string, start: number, end: number): string {
  return `${messageKey}#${start}-${end}`;
}

function polarityOf(claim: ClaimAnnotation): Polarity {
  return claim.kind === 'retract' ? 'negative' : 'positive';
}

class PlanBuilder {
  readonly #ids = new IdRegistry();
  readonly #rows = new Map<NodeLabel, VertexRow[]>();
  readonly #edges: PlannedEdge[] = [];
  readonly #edgeSeen = new Set<string>();

  constructor() {
    for (const label of NODE_LABELS) {
      this.#rows.set(label, []);
    }
  }

  /** Interns the id, records the canonical key as a property, and keeps the row. */
  vertex(label: NodeLabel, key: string, properties: Readonly<Record<string, PropertyValue>>): number {
    const id = this.#ids.intern(label, key);
    const canonical = this.#ids.keyFor(id);
    if (canonical === undefined) {
      throw new IngestError(`registry lost the key for ${label} ${key}`);
    }
    const rows = this.#rows.get(label);
    if (rows === undefined) {
      throw new IngestError(`unknown label ${label}`);
    }
    rows.push({ id, key: canonical, ...properties });
    return id;
  }

  /**
   * Records an edge once. Duplicates are dropped rather than sent twice: MERGE
   * would make the second write a no-op anyway, and at one round trip per edge
   * a redundant write is a wasted request rather than a wrong result.
   */
  edge(type: EdgeType, src: number, dst: number): void {
    const seen = `${type}:${src}:${dst}`;
    if (this.#edgeSeen.has(seen)) {
      return;
    }
    this.#edgeSeen.add(seen);
    this.#edges.push({ type, src, dst });
  }

  finish(): IngestPlan {
    const batches: VertexBatch[] = [];
    const vertexCounts = emptyVertexCounts();
    for (const label of NODE_LABELS) {
      const rows = this.#rows.get(label) ?? [];
      vertexCounts[label] = rows.length;
      const properties = PROPERTIES[label];
      for (const row of rows) {
        for (const property of properties) {
          if (row[property] === undefined) {
            throw new IngestError(`a ${label} row is missing the "${property}" property`);
          }
        }
      }
      batches.push(...chunkRows(label, properties, rows));
    }

    const edgeCounts = emptyEdgeCounts();
    for (const edge of this.#edges) {
      edgeCounts[edge.type] += 1;
    }

    return {
      batches,
      edges: this.#edges,
      keys: new Map(this.#ids.entries()),
      counts: { vertices: vertexCounts, edges: edgeCounts },
    };
  }
}

function emptyVertexCounts(): Record<NodeLabel, number> {
  return { Session: 0, Message: 0, EvidenceSpan: 0, Claim: 0, Entity: 0 };
}

function emptyEdgeCounts(): Record<EdgeType, number> {
  return {
    CONTAINS: 0,
    HAS_SPAN: 0,
    SUPPORTS: 0,
    ABOUT: 0,
    MENTIONS: 0,
    SUPERSEDES: 0,
    CONTRADICTS: 0,
  };
}

function chunkRows(
  label: NodeLabel,
  properties: readonly string[],
  rows: readonly VertexRow[],
): readonly VertexBatch[] {
  const batches: VertexBatch[] = [];
  let current: VertexRow[] = [];
  let bytes = 0;

  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row), 'utf8');
    if (size > MAX_BATCH_BYTES) {
      throw new IngestError(
        `a single ${label} row encodes to ${size} bytes, over the ${MAX_BATCH_BYTES} byte cap`,
      );
    }
    if (current.length > 0 && (current.length >= MAX_BATCH_ROWS || bytes + size > MAX_BATCH_BYTES)) {
      batches.push({ label, properties, rows: current });
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) {
    batches.push({ label, properties, rows: current });
  }
  return batches;
}

interface ClaimRecord {
  readonly annotation: ClaimAnnotation;
  readonly id: number;
}

export function buildPlan(corpus: Corpus): IngestPlan {
  const builder = new PlanBuilder();

  const entityIds = new Map<string, number>();
  for (const entity of corpus.entities) {
    entityIds.set(entity.name, builder.vertex('Entity', entity.name, {
      name: entity.name,
      kind: entity.kind,
    }));
  }

  const claims: ClaimRecord[] = [];
  const claimIds = new Map<string, number>();

  corpus.sessions.forEach((session, sessionSeq) => {
    const sessionId = addSession(builder, session, sessionSeq);
    for (const message of session.messages) {
      const messageId = addMessage(builder, message, sessionId);
      builder.edge('CONTAINS', sessionId, messageId);

      for (const claim of message.claims) {
        const claimId = addClaim(builder, claim, entityIds);
        if (claimIds.has(claim.key)) {
          throw new IngestError(`claim key ${claim.key} appears twice in the corpus`);
        }
        claimIds.set(claim.key, claimId);
        claims.push({ annotation: claim, id: claimId });
      }

      for (const span of message.spans) {
        const claimId = claimIds.get(span.claimKey);
        if (claimId === undefined) {
          throw new IngestError(
            `${message.key} has a span for ${span.claimKey}, which no message has stated`,
          );
        }
        const spanId = builder.vertex('EvidenceSpan', spanKey(message.key, span.start, span.end), {
          message_id: messageId,
          start: span.start,
          end: span.end,
          text_hash: sha256Hex(span.quote),
          quote: span.quote,
        });
        builder.edge('HAS_SPAN', messageId, spanId);
        builder.edge('SUPPORTS', spanId, claimId);
      }
    }
  });

  addSupersedes(builder, claims, claimIds);
  addContradictions(builder, claims);

  return builder.finish();
}

function addSession(builder: PlanBuilder, session: Session, seq: number): number {
  return builder.vertex('Session', session.key, {
    session_key: session.key,
    title: session.title,
    started_at: session.startedAt,
    seq,
  });
}

function addMessage(builder: PlanBuilder, message: Message, sessionId: number): number {
  return builder.vertex('Message', message.key, {
    message_key: message.key,
    session_id: sessionId,
    role: message.speaker,
    ts: message.timestamp,
    seq: message.index,
    text: message.text,
  });
}

function addClaim(
  builder: PlanBuilder,
  claim: ClaimAnnotation,
  entityIds: ReadonlyMap<string, number>,
): number {
  const subjectId = entityIds.get(claim.subject);
  if (subjectId === undefined) {
    throw new IngestError(`${claim.key} is about "${claim.subject}", which has no Entity node`);
  }

  const claimId = builder.vertex('Claim', claim.key, {
    claim_key: claim.key,
    subject_id: subjectId,
    predicate: claim.predicate,
    object_text: claim.objectText,
    // One clock. The corpus states facts as it learns them, so valid time and
    // transaction time coincide here; see docs/INGEST.md for why that is
    // recorded rather than faked apart.
    valid_from: claim.validFrom,
    tx_time: claim.validFrom,
    polarity: polarityOf(claim),
  });
  builder.edge('ABOUT', claimId, subjectId);

  if (claim.objectEntity !== null) {
    const objectId = entityIds.get(claim.objectEntity);
    if (objectId === undefined) {
      throw new IngestError(`${claim.key} names "${claim.objectEntity}", which has no Entity node`);
    }
    builder.edge('MENTIONS', claimId, objectId);
  }

  return claimId;
}

function addSupersedes(
  builder: PlanBuilder,
  claims: readonly ClaimRecord[],
  claimIds: ReadonlyMap<string, number>,
): void {
  for (const { annotation, id } of claims) {
    if (annotation.supersedes === null) {
      continue;
    }
    const olderId = claimIds.get(annotation.supersedes);
    if (olderId === undefined) {
      throw new IngestError(
        `${annotation.key} supersedes ${annotation.supersedes}, which is not in the corpus`,
      );
    }
    builder.edge('SUPERSEDES', id, olderId);
  }
}

/**
 * Contradiction detection, which ADR 0002 makes an ingest step rather than a
 * query-time heuristic.
 *
 * Two claims contradict when they are about the same subject and predicate,
 * both still stand, both assert something, and they assert different things. A
 * claim that has been corrected or withdrawn carries a `supersedes` pointer
 * from whatever replaced it, so it no longer stands and cannot contradict
 * anything: that is what keeps an ordinary revision from being mistaken for a
 * disagreement.
 *
 * The edge is written both ways. Relationship patterns in this Cypher subset
 * are directed, so a single edge would make "what contradicts this claim" a
 * two-query question.
 */
function addContradictions(builder: PlanBuilder, claims: readonly ClaimRecord[]): void {
  const superseded = new Set<string>();
  for (const { annotation } of claims) {
    if (annotation.supersedes !== null) {
      superseded.add(annotation.supersedes);
    }
  }

  const live = new Map<string, ClaimRecord[]>();
  for (const record of claims) {
    const { annotation } = record;
    if (superseded.has(annotation.key) || polarityOf(annotation) === 'negative') {
      continue;
    }
    const group = `${annotation.subject}${KEY_SEPARATOR}${annotation.predicate}`;
    const bucket = live.get(group);
    if (bucket === undefined) {
      live.set(group, [record]);
    } else {
      bucket.push(record);
    }
  }

  for (const bucket of live.values()) {
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const a = bucket[i];
        const b = bucket[j];
        if (a === undefined || b === undefined) {
          continue;
        }
        if (a.annotation.objectText === b.annotation.objectText) {
          continue;
        }
        builder.edge('CONTRADICTS', a.id, b.id);
        builder.edge('CONTRADICTS', b.id, a.id);
      }
    }
  }
}
