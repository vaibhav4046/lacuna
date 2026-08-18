import { createHash } from 'node:crypto';

import type { IngestPlan, PlannedEdge, VertexRow } from '../ingest/plan.js';
import type { DependentEdge } from '../retrieval/decode.js';
import type {
  ClaimRecord,
  EvidenceRecord,
  Mention,
  Polarity,
} from '../retrieval/types.js';
import type { AppRecord } from './cloud.js';

/**
 * The claim graph as records HydraDB Cloud can hold, and back again.
 *
 * The self-hosted node stores this graph as nodes and edges and answers
 * questions about it in Cypher. The cloud is a document service: it holds
 * sources, indexes them, searches them by similarity, and fetches one back by
 * the id its writer chose. Those are different stores, and the honest way to
 * put one product over both is to write the graph into the cloud in the shape
 * a read actually needs, then address it deterministically.
 *
 * So one record per entity, holding everything a question about that entity
 * reads: its claims, the claims that name a second entity, the claims that
 * name it as their object, and the citations behind each. A question costs one
 * fetch, or two when it hops, against the node's three and six. Plus one index
 * record, for the single case the blast walk can reach: a claim cited at the
 * depth cap, whose own entity was never fetched.
 *
 * What this is not: a summary. Every field is the value the node would have
 * returned, decoded into the same types, sorted by the same rules. A record
 * here and a row there are the same claim.
 */

/** The record ids this product writes. Derived, never assigned by the service. */
export const INDEX_ID = 'lacuna:index';

/**
 * Entity records are addressed by a hash of the name.
 *
 * The alternative is the name itself, and names carry spaces, slashes and
 * punctuation that would have to survive a query string, a storage key and a
 * dashboard. A hash is the same length for every name, and the readable name
 * travels in the title, where a person browsing the database can see it.
 */
export function entityRecordId(name: string): string {
  return `lacuna:entity:${createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 32)}`;
}

export function sessionRecordId(sessionId: number): string {
  return `lacuna:session:${sessionId}`;
}

/** Everything one entity's questions read, in one record. */
export interface EntityRecord {
  readonly id: number;
  readonly name: string;
  readonly kind: string | null;
  readonly claims: readonly ClaimRecord[];
  readonly mentions: readonly Mention[];
  readonly dependents: readonly DependentEdge[];
  /** Citations, keyed by claim id, for every claim this record carries. */
  readonly evidence: Readonly<Record<string, readonly EvidenceRecord[]>>;
}

export interface IndexRecord {
  /** Claim id to the name of the entity whose record carries its citations. */
  readonly claims: Readonly<Record<string, string>>;
  /** Entity id to name, so a walk holding only an id can address its record. */
  readonly entities: Readonly<Record<string, string>>;
}

interface Tables {
  readonly entities: Map<number, { name: string; kind: string | null }>;
  readonly claims: Map<number, {
    predicate: string;
    objectText: string;
    polarity: Polarity;
    validFrom: string;
    txTime: string;
  }>;
  readonly spans: Map<number, { messageId: number; start: number; end: number; quote: string }>;
  readonly messages: Map<number, { sessionId: number; role: string; ts: string; text: string }>;
  readonly sessions: Map<number, { title: string; startedAt: string }>;
}

function text(row: VertexRow, key: string): string {
  const value = row[key];
  return typeof value === 'string' ? value : String(value ?? '');
}

function num(row: VertexRow, key: string): number {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value);
}

function tablesOf(plan: IngestPlan): Tables {
  const tables: Tables = {
    entities: new Map(),
    claims: new Map(),
    spans: new Map(),
    messages: new Map(),
    sessions: new Map(),
  };
  for (const batch of plan.batches) {
    for (const row of batch.rows) {
      switch (batch.label) {
        case 'Entity': {
          const kind = row['kind'];
          tables.entities.set(row.id, {
            name: text(row, 'name'),
            kind: typeof kind === 'string' ? kind : null,
          });
          break;
        }
        case 'Claim':
          tables.claims.set(row.id, {
            predicate: text(row, 'predicate'),
            objectText: text(row, 'object_text'),
            polarity: text(row, 'polarity') === 'negative' ? 'negative' : 'positive',
            validFrom: text(row, 'valid_from'),
            txTime: text(row, 'tx_time'),
          });
          break;
        case 'EvidenceSpan':
          tables.spans.set(row.id, {
            messageId: num(row, 'message_id'),
            start: num(row, 'start'),
            end: num(row, 'end'),
            quote: text(row, 'quote'),
          });
          break;
        case 'Message':
          tables.messages.set(row.id, {
            sessionId: num(row, 'session_id'),
            role: text(row, 'role'),
            ts: text(row, 'ts'),
            text: text(row, 'text'),
          });
          break;
        case 'Session':
          tables.sessions.set(row.id, {
            title: text(row, 'title'),
            startedAt: text(row, 'started_at'),
          });
          break;
      }
    }
  }
  return tables;
}

function group(edges: readonly PlannedEdge[], type: string): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const edge of edges) {
    if (edge.type !== type) continue;
    const list = out.get(edge.src);
    if (list === undefined) out.set(edge.src, [edge.dst]);
    else list.push(edge.dst);
  }
  return out;
}

/** Oldest first, id breaking ties, exactly as the node's decoder orders them. */
function byTimeThenId(a: ClaimRecord, b: ClaimRecord): number {
  if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
  return a.id - b.id;
}

export interface SessionRecord {
  readonly id: string;
  readonly title: string;
  readonly timestamp: string;
  readonly text: string;
}

export interface BuiltGraph {
  readonly entities: readonly EntityRecord[];
  readonly index: IndexRecord;
  /** One record per session, carrying the conversation itself. */
  readonly sessions: readonly SessionRecord[];
}

/**
 * Plan to records. A pure function, so what the cloud holds is a function of
 * the seed and nothing else, and two runs write the same bytes under the same
 * ids rather than accumulating duplicates.
 */
export function buildCloudGraph(plan: IngestPlan): BuiltGraph {
  const t = tablesOf(plan);
  const about = group(plan.edges, 'ABOUT');           // claim -> entity
  const mentions = group(plan.edges, 'MENTIONS');     // claim -> entity
  const supersedes = group(plan.edges, 'SUPERSEDES'); // newer -> older
  const supports = group(plan.edges, 'SUPPORTS');     // span  -> claim
  const hasSpan = group(plan.edges, 'HAS_SPAN');      // message -> span

  const supersededBy = new Map<number, number[]>();
  for (const [newer, olders] of supersedes) {
    for (const older of olders) {
      const list = supersededBy.get(older);
      if (list === undefined) supersededBy.set(older, [newer]);
      else list.push(newer);
    }
  }

  const spanOwner = new Map<number, number>(); // span -> message
  for (const [message, spans] of hasSpan) {
    for (const span of spans) spanOwner.set(span, message);
  }

  const claimSubject = new Map<number, number>(); // claim -> entity
  for (const [claim, targets] of about) {
    const first = targets[0];
    if (first !== undefined) claimSubject.set(claim, first);
  }

  const claimSpans = new Map<number, number[]>(); // claim -> spans
  for (const [span, claims] of supports) {
    for (const claim of claims) {
      const list = claimSpans.get(claim);
      if (list === undefined) claimSpans.set(claim, [span]);
      else list.push(span);
    }
  }

  const evidenceFor = (claimId: number): readonly EvidenceRecord[] => (claimSpans.get(claimId) ?? [])
    .flatMap((spanId): EvidenceRecord[] => {
      const span = t.spans.get(spanId);
      const messageId = spanOwner.get(spanId);
      const message = messageId === undefined ? undefined : t.messages.get(messageId);
      const session = message === undefined ? undefined : t.sessions.get(message.sessionId);
      if (span === undefined || messageId === undefined || message === undefined || session === undefined) {
        return [];
      }
      return [{
        claimId,
        spanId,
        quote: span.quote,
        start: span.start,
        end: span.end,
        messageId,
        role: message.role,
        ts: message.ts,
        sessionId: message.sessionId,
        sessionTitle: session.title,
      }];
    })
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
      if (a.messageId !== b.messageId) return a.messageId - b.messageId;
      return a.start - b.start;
    });

  const claimRecord = (claimId: number): ClaimRecord | null => {
    const claim = t.claims.get(claimId);
    if (claim === undefined) return null;
    return {
      id: claimId,
      ...claim,
      supersededBy: [...(supersededBy.get(claimId) ?? [])].sort((a, b) => a - b),
    };
  };

  const claimsByEntity = new Map<number, number[]>();
  for (const [claim, entity] of claimSubject) {
    const list = claimsByEntity.get(entity);
    if (list === undefined) claimsByEntity.set(entity, [claim]);
    else list.push(claim);
  }

  const dependentsByEntity = new Map<number, number[]>(); // object entity -> claims naming it
  for (const [claim, targets] of mentions) {
    for (const target of targets) {
      const list = dependentsByEntity.get(target);
      if (list === undefined) dependentsByEntity.set(target, [claim]);
      else list.push(claim);
    }
  }

  const claimIndex: Record<string, string> = {};
  const entities: EntityRecord[] = [];

  for (const [entityId, entity] of [...t.entities].sort((a, b) => a[0] - b[0])) {
    const owned = (claimsByEntity.get(entityId) ?? [])
      .map(claimRecord)
      .filter((claim): claim is ClaimRecord => claim !== null)
      .sort(byTimeThenId);

    const named: Mention[] = [];
    for (const claim of owned) {
      for (const other of mentions.get(claim.id) ?? []) {
        const target = t.entities.get(other);
        if (target === undefined) continue;
        named.push({
          claimId: claim.id,
          predicate: claim.predicate,
          entityId: other,
          entityName: target.name,
        });
      }
    }
    named.sort((a, b) => (a.claimId - b.claimId) || (a.entityId - b.entityId));

    const inbound: DependentEdge[] = [];
    for (const claimId of dependentsByEntity.get(entityId) ?? []) {
      const claim = claimRecord(claimId);
      const owner = claimSubject.get(claimId);
      const ownerEntity = owner === undefined ? undefined : t.entities.get(owner);
      if (claim === null || owner === undefined || ownerEntity === undefined) continue;
      inbound.push({
        claimId,
        predicate: claim.predicate,
        polarity: claim.polarity,
        entityId: owner,
        entityName: ownerEntity.name,
        entityKind: ownerEntity.kind,
        supersededBy: claim.supersededBy,
      });
    }
    inbound.sort((a, b) => a.claimId - b.claimId);

    const evidence: Record<string, readonly EvidenceRecord[]> = {};
    for (const claim of owned) {
      evidence[String(claim.id)] = evidenceFor(claim.id);
      claimIndex[String(claim.id)] = entity.name;
    }
    // A claim this entity only names belongs to another record, but the walk
    // can cite it from here, so its citations ride along rather than costing a
    // second fetch.
    for (const edge of inbound) {
      if (evidence[String(edge.claimId)] === undefined) {
        evidence[String(edge.claimId)] = evidenceFor(edge.claimId);
      }
    }

    entities.push({
      id: entityId,
      name: entity.name,
      kind: entity.kind,
      claims: owned,
      mentions: named,
      dependents: inbound,
      evidence,
    });
  }

  const messagesBySession = new Map<number, { role: string; ts: string; text: string }[]>();
  for (const [, message] of [...t.messages].sort((a, b) => a[0] - b[0])) {
    const list = messagesBySession.get(message.sessionId);
    if (list === undefined) messagesBySession.set(message.sessionId, [message]);
    else list.push(message);
  }

  const sessions: SessionRecord[] = [...t.sessions]
    .sort((a, b) => a[0] - b[0])
    .map(([sessionId, session]) => ({
      id: sessionRecordId(sessionId),
      title: session.title,
      timestamp: session.startedAt,
      text: (messagesBySession.get(sessionId) ?? [])
        .map((message) => `${message.role}: ${message.text}`)
        .join('\n'),
    }));

  return {
    entities,
    index: {
      claims: claimIndex,
      entities: Object.fromEntries(entities.map((entity) => [String(entity.id), entity.name])),
    },
    sessions,
  };
}

/** The records as the ingest endpoint takes them. */
export function toAppRecords(graph: BuiltGraph): readonly AppRecord[] {
  const epoch = new Date(0).toISOString();
  const records: AppRecord[] = [{
    id: INDEX_ID,
    title: 'Lacuna claim index',
    type: 'custom',
    timestamp: epoch,
    text: JSON.stringify(graph.index),
    metadata: { lacuna_record: 'index' },
  }];

  for (const entity of graph.entities) {
    // The sessions carrying this entity's citations are declared as relations,
    // so the graph the service reports is the graph the product actually holds
    // rather than only the one inference found.
    const cited = new Set<string>();
    for (const list of Object.values(entity.evidence)) {
      for (const record of list) cited.add(sessionRecordId(record.sessionId));
    }
    records.push({
      id: entityRecordId(entity.name),
      title: entity.name,
      type: 'custom',
      timestamp: entity.claims[entity.claims.length - 1]?.txTime ?? epoch,
      text: JSON.stringify(entity),
      metadata: {
        lacuna_record: 'entity',
        lacuna_entity: entity.name,
        lacuna_kind: entity.kind ?? 'unknown',
        lacuna_claims: entity.claims.length,
      },
      relations: [...cited].sort(),
    });
  }

  for (const session of graph.sessions) {
    records.push({
      id: session.id,
      title: session.title,
      type: 'custom',
      timestamp: session.timestamp,
      text: session.text,
      metadata: { lacuna_record: 'session' },
    });
  }

  return records;
}

/**
 * The service stores what it was given inside an envelope of its own, so the
 * text this product wrote comes back one level down. Read strictly, because a
 * record that does not parse is a record that must not be answered from.
 */
export function unwrapEnvelope(envelope: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    return null;
  }
  const content = (parsed as { content?: { text?: unknown } } | null)?.content;
  const value = content?.text;
  return typeof value === 'string' && value !== '' ? value : null;
}
