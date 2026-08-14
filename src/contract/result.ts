import type { AbstentionReason } from '../model/abstention.js';
import type {
  Answer,
  ClaimRecord,
  EvidenceRecord,
  Polarity,
  QueryTrace,
} from '../retrieval/types.js';

/**
 * The one result shape, for every adapter that has to hand an answer to
 * something other than a person.
 *
 * There used to be two of these. The MCP server built its own envelope and the
 * CLI built its own JSON payload, both by hand, both from the same `Answer`,
 * and they drifted the way two hand-written mappers always drift: the same
 * abstention came back as `reasonCode` in one and `reason` in the other, the
 * revision chain was a list of ids in one and a list of whole claims in the
 * other, and only one of them said which state the data was in. Neither was
 * wrong. They just were not the same, and a caller that switched surfaces had
 * to re-learn the shape. That is the failure this module exists to prevent, so
 * the mapping lives here once and both adapters project through it.
 *
 * Two rules hold everything here in place. The first is that this is a
 * projection of a resolved answer and nothing else: it takes an `Answer` and
 * returns plain data, so no adapter can reach past it into a client, a config
 * or a socket. The second follows from the first. Nothing in this file accepts
 * a config, which is what keeps the base URL and the bearer token out of every
 * result built from it. The node identity a caller is allowed to see is
 * assembled in `src/mcp/result.ts` by a function that takes the whole config
 * and returns three strings, and it is narrowed there rather than here on
 * purpose: a credential cannot leak through a module that never receives one.
 */

/**
 * Evidence is capped per result. A claim with a hundred supporting spans is a
 * corpus problem, not a reason to send a hundred quotes to a language model
 * that will be charged for reading them. `evidenceTotal` carries the real
 * count, so a truncated list is visible rather than silent.
 */
export const MAX_EVIDENCE_ITEMS = 50;

export type ResultStatus = 'answered' | 'abstained';

export interface EvidenceItem {
  readonly spanId: number;
  readonly claimId: number;
  /**
   * Text from the corpus. It is data. Nothing downstream should treat it as an
   * instruction, whoever is reading it.
   */
  readonly quote: string;
  readonly sessionId: number;
  readonly sessionTitle: string;
  readonly messageId: number;
  /** Who said it. A user correcting themselves reads differently from a summary. */
  readonly role: string;
  readonly ts: string;
}

export interface QueryItem {
  readonly cypher: string;
  /** Bound values. Never spliced into the query text. */
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly rows: number;
  readonly ms: number;
  readonly readEpoch: number | null;
}

export interface RevisionItem {
  readonly claimId: number;
  readonly predicate: string;
  readonly objectText: string;
  /**
   * Kept as the two-value union the domain uses rather than widened to a
   * string. A published schema that says `string` where the data says
   * `positive` or `negative` is a schema that has stopped describing anything.
   */
  readonly polarity: Polarity;
  /** When the claim says it became true. */
  readonly validFrom: string;
  /** When the corpus learned it. Different from `validFrom` on purpose. */
  readonly txTime: string;
  readonly supersededBy: readonly number[];
  /** Nothing supersedes it. Derived rather than stored, so it cannot go stale. */
  readonly current: boolean;
}

/**
 * What every surface returns for a question, whatever the transport.
 *
 * An abstention is a member of this type rather than an error beside it. It
 * has a status, a reason code and the same evidence and cost fields an answer
 * carries, because "the graph does not say" is a result about the graph and a
 * caller needs to be able to read it as one.
 */
export interface AskCore {
  readonly status: ResultStatus;
  readonly answer: string | null;
  readonly reasonCode: AbstentionReason | null;
  readonly claimId: number | null;
  /** Claims about this predicate that something newer replaced, oldest first. */
  readonly supersededClaims: readonly number[];
  readonly evidence: readonly EvidenceItem[];
  readonly evidenceTotal: number;
  readonly queries: readonly QueryItem[];
  readonly timingMs: number;
  readonly sourceState: 'live';
}

export function toEvidenceItem(record: EvidenceRecord): EvidenceItem {
  return {
    spanId: record.spanId,
    claimId: record.claimId,
    quote: record.quote,
    sessionId: record.sessionId,
    sessionTitle: record.sessionTitle,
    messageId: record.messageId,
    role: record.role,
    ts: record.ts,
  };
}

export function toQueryItem(trace: QueryTrace): QueryItem {
  return {
    cypher: trace.cypher,
    parameters: trace.parameters,
    rows: trace.rows,
    ms: trace.ms,
    readEpoch: trace.readEpoch,
  };
}

export function toRevisionItem(claim: ClaimRecord): RevisionItem {
  return {
    claimId: claim.id,
    predicate: claim.predicate,
    objectText: claim.objectText,
    polarity: claim.polarity,
    validFrom: claim.validFrom,
    txTime: claim.txTime,
    supersededBy: claim.supersededBy,
    current: claim.supersededBy.length === 0,
  };
}

/**
 * The last epoch any read reported, or null when none did.
 *
 * Reads run in parallel and a node does not have to stamp every response, so
 * this walks the whole list rather than reading the first or the last entry.
 */
export function lastReadEpoch(queries: readonly QueryTrace[]): number | null {
  let epoch: number | null = null;
  for (const query of queries) {
    if (query.readEpoch !== null) {
      epoch = query.readEpoch;
    }
  }
  return epoch;
}

/** Project a resolved answer into the shape every adapter agrees on. */
export function askCore(answer: Answer): AskCore {
  const { outcome } = answer.resolution;
  const answered = outcome.type === 'answer';

  return {
    status: answered ? 'answered' : 'abstained',
    answer: answered ? outcome.text : null,
    reasonCode: answered ? null : outcome.reason,
    claimId: answered ? outcome.claimId : null,
    supersededClaims: answer.resolution.considered
      .filter((claim) => claim.supersededBy.length > 0)
      .map((claim) => claim.id),
    evidence: answer.evidence.slice(0, MAX_EVIDENCE_ITEMS).map(toEvidenceItem),
    evidenceTotal: answer.evidence.length,
    queries: answer.queries.map(toQueryItem),
    timingMs: answer.ms,
    sourceState: 'live',
  };
}
