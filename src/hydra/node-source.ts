import { canonicalName } from './canonical.js';
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
  allEntityNames,
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

  /**
   * The stored spelling of a name that missed, or null if there is not one.
   *
   * Read every time rather than cached, and the first attempt to cache it is
   * what proved why. A cached list is per instance, and the surfaces do not
   * share a lifetime: the MCP server holds one source across a whole session
   * while the CLI builds one per invocation. So the same question produced one
   * read from MCP and two from the CLI, and `npm run parity` fell from 64 to 59
   * on exactly the five out of scope questions. The product's headline claim is
   * that the surfaces agree, and a cache that makes them disagree costs more
   * than the read it saves.
   *
   * It would also go stale. A list held from before an ingest would keep
   * reporting a name as absent after the graph gained it, which is the same
   * false refusal this fallback exists to remove.
   *
   * The cost is one read on a path that is about to answer nothing.
   */
  async #canonical(name: string, timeoutMs: number): Promise<{
    canonical: string | null;
    traces: QueryTrace[];
  }> {
    const { rows, trace } = await this.#run(allEntityNames(), timeoutMs);
    const names = rows
      .map((row) => row['name'])
      .filter((value): value is string => typeof value === 'string');
    return { canonical: canonicalName(names, name), traces: [trace] };
  }

  async entity(name: string, timeoutMs: number): Promise<Read<EntityHead | null>> {
    const { rows, trace } = await this.#run(entityByName(name), timeoutMs);
    const head = decodeEntity(rows);
    if (head !== null) return { value: head, traces: [trace] };

    const { canonical, traces } = await this.#canonical(name, timeoutMs);
    if (canonical === null) return { value: null, traces: [trace, ...traces] };

    const retried = await this.#run(entityByName(canonical), timeoutMs);
    return { value: decodeEntity(retried.rows), traces: [trace, ...traces, retried.trace] };
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
