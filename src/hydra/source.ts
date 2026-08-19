import type { EntityHead, DependentEdge } from '../retrieval/decode.js';
import type {
  ClaimRecord,
  EvidenceRecord,
  Mention,
  QueryTrace,
  SubjectView,
} from '../retrieval/types.js';

/**
 * The seam between what retrieval reads and where it is stored.
 *
 * Everything above this consumes claims. The temporal resolver, the
 * contradiction policy, the evidence gate and the Context Pack compiler do not
 * know whether a claim arrived as a Cypher row from the self-hosted node or as
 * a record fetched from HydraDB Cloud, and that is the point: the two stores
 * speak different protocols, and only one product may exist above them.
 *
 * Four reads, because four is what the resolver and the blast walk actually
 * need. A source is stateless and reusable; the traces come back with the
 * values rather than accumulating inside the source, so two questions asked at
 * once cannot mix up whose round trips were whose.
 */

/** A value and what it cost to read, so a reported cost is always measured. */
export interface Read<T> {
  readonly value: T;
  readonly traces: readonly QueryTrace[];
}

export interface HydraSource {
  /** Which store answered. Reported on screens, never used to change a result. */
  readonly kind: 'node' | 'cloud';
  /** Name to head, or null when no entity carries the name. One read. */
  entity(name: string, timeoutMs: number): Promise<Read<EntityHead | null>>;
  /** Head, claims and mentions for one name. */
  subject(name: string, timeoutMs: number): Promise<Read<SubjectView>>;
  evidence(claimId: number, timeoutMs: number): Promise<Read<readonly EvidenceRecord[]>>;
  dependents(entityId: number, timeoutMs: number): Promise<Read<readonly DependentEdge[]>>;
  /**
   * Every subject this store holds, for a screen that has to show a workspace
   * rather than answer a question about one.
   *
   * Optional because a store is only required to answer about a name it is
   * given. A caller that cannot enumerate says so on the screen instead of
   * rendering an empty list, which is the difference between "nothing here" and
   * "nothing I can list".
   */
  subjects?(timeoutMs: number): Promise<Read<readonly string[]>>;
}

/**
 * Mentions in a total order, applied identically by both sources.
 *
 * The node returns them in whatever order the engine walked the pattern and
 * the cloud returns them in the order they were written, and the only place
 * the order is visible is the sentence an ambiguous hop produces, which names
 * the candidates in sequence. Sorting in one place means that sentence is the
 * same sentence whichever store answered.
 */
export function orderMentions(mentions: readonly Mention[]): readonly Mention[] {
  return [...mentions].sort((a, b) => {
    if (a.claimId !== b.claimId) return a.claimId - b.claimId;
    return a.entityId - b.entityId;
  });
}

export function emptySubject(name: string): SubjectView {
  return { name, id: null, kind: null, claims: [], mentions: [] };
}

export type { ClaimRecord, EvidenceRecord, Mention, SubjectView };
