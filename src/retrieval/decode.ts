import type { HydraValue } from '../hydra/values.js';
import { RetrievalDecodeError } from './errors.js';
import type {
  ClaimRecord,
  EvidenceRecord,
  Mention,
  Polarity,
} from './types.js';

/**
 * Turning wire rows into typed records, strictly.
 *
 * Every read in this layer names its columns and states their types, so a row
 * that does not fit is a change in the schema or in the engine, not a case to
 * paper over. Nothing here coerces, defaults, or skips a bad row. A missing
 * `object_text` becomes an error rather than an empty string, because an empty
 * string would travel all the way to a screen and sit there under a citation
 * looking like an answer.
 */

export type Row = Readonly<Record<string, HydraValue>>;

function fail(column: string, value: HydraValue, wanted: string): never {
  throw new RetrievalDecodeError(
    `column "${column}" should be ${wanted}, got ${JSON.stringify(value) ?? 'undefined'}`,
  );
}

function requireNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(column, value as HydraValue, 'a finite number');
  }
  return value;
}

function requireString(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    fail(column, value as HydraValue, 'a string');
  }
  return value;
}

/** null is a legitimate value here: it is what an unmatched OPTIONAL MATCH returns. */
function optionalNumber(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(column, value, 'a finite number or null');
  }
  return value;
}

function requirePolarity(row: Row, column: string): Polarity {
  const value = requireString(row, column);
  if (value !== 'positive' && value !== 'negative') {
    fail(column, value, '"positive" or "negative"');
  }
  return value;
}

export interface EntityHead {
  readonly id: number;
  readonly kind: string | null;
}

/**
 * Zero rows means the name is not in the graph, which is what `out_of_scope`
 * is. More than one row means two Entity nodes share a name, which the ingest
 * keying makes impossible and which would silently pick a winner if it were
 * tolerated here.
 */
export function decodeEntity(rows: readonly Row[]): EntityHead | null {
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    throw new RetrievalDecodeError(
      `entity name matched ${rows.length} nodes, expected at most one`,
    );
  }
  const row = rows[0]!;
  const kind = row['kind'];
  return {
    id: requireNumber(row, 'id'),
    kind: typeof kind === 'string' ? kind : null,
  };
}

/**
 * Groups the claim rows by claim id.
 *
 * The query is a MATCH with an OPTIONAL MATCH hanging off it, so a claim with
 * two superseders arrives as two rows that agree on everything except
 * `superseded_by`. Treating a row as a claim would double count it. The
 * disagreement check is not paranoia about the engine: it is the cheapest place
 * to catch a query edited later into returning something other than what its
 * grouping assumes.
 */
export function decodeClaims(rows: readonly Row[]): readonly ClaimRecord[] {
  const byId = new Map<number, {
    record: Omit<ClaimRecord, 'supersededBy'>;
    supersededBy: number[];
  }>();

  for (const row of rows) {
    const id = requireNumber(row, 'id');
    const record = {
      id,
      predicate: requireString(row, 'predicate'),
      objectText: requireString(row, 'object_text'),
      polarity: requirePolarity(row, 'polarity'),
      validFrom: requireString(row, 'valid_from'),
      txTime: requireString(row, 'tx_time'),
    };

    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, { record, supersededBy: [] });
    } else if (
      existing.record.predicate !== record.predicate
      || existing.record.objectText !== record.objectText
      || existing.record.polarity !== record.polarity
      || existing.record.validFrom !== record.validFrom
    ) {
      throw new RetrievalDecodeError(
        `claim ${id} came back with two different sets of properties`,
      );
    }

    const superseder = optionalNumber(row, 'superseded_by');
    if (superseder !== null) {
      const target = byId.get(id)!;
      if (!target.supersededBy.includes(superseder)) {
        target.supersededBy.push(superseder);
      }
    }
  }

  return [...byId.values()]
    .map(({ record, supersededBy }) => ({ ...record, supersededBy }))
    .sort(compareByTimeThenId);
}

/** Oldest first, with the id breaking ties so the order is total and stable. */
function compareByTimeThenId(a: ClaimRecord, b: ClaimRecord): number {
  if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
  return a.id - b.id;
}

export function decodeMentions(rows: readonly Row[]): readonly Mention[] {
  return rows.map((row) => ({
    claimId: requireNumber(row, 'claim'),
    predicate: requireString(row, 'predicate'),
    entityId: requireNumber(row, 'other'),
    entityName: requireString(row, 'other_name'),
  }));
}

/**
 * Citations for one claim, ordered by where they sit in the conversation.
 *
 * The claim id is passed in rather than read off a column because the query
 * matches it as a parameter and does not return it. Carrying it here keeps an
 * `EvidenceRecord` self describing once it is separated from the query that
 * produced it, which is what the interface does with it.
 */
export function decodeEvidence(claimId: number, rows: readonly Row[]): readonly EvidenceRecord[] {
  return rows
    .map((row) => ({
      claimId,
      spanId: requireNumber(row, 'span'),
      quote: requireString(row, 'quote'),
      start: requireNumber(row, 'start'),
      end: requireNumber(row, 'end_offset'),
      messageId: requireNumber(row, 'message'),
      role: requireString(row, 'role'),
      ts: requireString(row, 'ts'),
      sessionId: requireNumber(row, 'session'),
      sessionTitle: requireString(row, 'title'),
    }))
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
      if (a.messageId !== b.messageId) return a.messageId - b.messageId;
      return a.start - b.start;
    });
}
