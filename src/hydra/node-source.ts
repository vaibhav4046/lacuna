import type { HydraClient } from './client.js';
import type { PreparedQuery } from './queries.js';
import { rowsToObjects } from './values.js';
import { emptySubject, orderMentions, type HydraSource, type Read } from './source.js';
import {
  decodeClaims,
  decodeDependents,
  decodeEntity,
  decodeEvidence,
  decodeMentions,
  type DependentEdge,
  type EntityHead,
  type Row,
} from '../retrieval/decode.js';
import {
  claimsAbout,
  dependentsOf,
  entityByName,
  evidenceForClaim,
  mentionsFrom,
} from '../retrieval/queries.js';
import type { EvidenceRecord, QueryTrace, SubjectView } from '../retrieval/types.js';

/**
 * The self-hosted node behind the source interface.
 *
 * This is the read path the product was built on, moved behind the seam
 * without a change to what it asks or how it decodes the answer. Same queries,
 * same decoders, same round trip count: one read for a name that is not in the
 * graph, three for a name that is.
 */
export class NodeSource implements HydraSource {
  readonly kind = 'node' as const;
  readonly #client: HydraClient;

  constructor(client: HydraClient) {
    this.#client = client;
  }

  async #run(prepared: PreparedQuery, timeoutMs: number): Promise<{
    rows: readonly Row[];
    trace: QueryTrace;
  }> {
    const started = performance.now();
    const page = await this.#client.query({ ...prepared, timeoutMs });
    const trace: QueryTrace = {
      cypher: prepared.cypher,
      request: prepared.cypher,
      parameters: prepared.parameters,
      rows: page.rows.length,
      ms: Math.round((performance.now() - started) * 10) / 10,
      readEpoch: page.readEpoch,
    };
    return { rows: rowsToObjects(page.columns, page.rows) as readonly Row[], trace };
  }

  async entity(name: string, timeoutMs: number): Promise<Read<EntityHead | null>> {
    const { rows, trace } = await this.#run(entityByName(name), timeoutMs);
    return { value: decodeEntity(rows), traces: [trace] };
  }

  async subject(name: string, timeoutMs: number): Promise<Read<SubjectView>> {
    const head = await this.entity(name, timeoutMs);
    if (head.value === null) {
      // One query, and the question is already answered. Reading claims for a
      // name that has no node would be two round trips to learn nothing.
      return { value: emptySubject(name), traces: head.traces };
    }

    const [claims, mentions] = await Promise.all([
      this.#run(claimsAbout(head.value.id), timeoutMs),
      this.#run(mentionsFrom(head.value.id), timeoutMs),
    ]);

    return {
      value: {
        name,
        id: head.value.id,
        kind: head.value.kind,
        claims: decodeClaims(claims.rows),
        mentions: orderMentions(decodeMentions(mentions.rows)),
      },
      traces: [...head.traces, claims.trace, mentions.trace],
    };
  }

  async evidence(claimId: number, timeoutMs: number): Promise<Read<readonly EvidenceRecord[]>> {
    const { rows, trace } = await this.#run(evidenceForClaim(claimId), timeoutMs);
    return { value: decodeEvidence(claimId, rows), traces: [trace] };
  }

  async dependents(entityId: number, timeoutMs: number): Promise<Read<readonly DependentEdge[]>> {
    const { rows, trace } = await this.#run(dependentsOf(entityId), timeoutMs);
    return { value: decodeDependents(rows), traces: [trace] };
  }
}
