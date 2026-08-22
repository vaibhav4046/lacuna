import { canonicalName } from './canonical.js';
import type { HydraClient } from './client.js';
import { HydraDecodeError } from './errors.js';
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
import type { ClaimRecord, EvidenceRecord, Mention, QueryTrace, SubjectView } from '../retrieval/types.js';
import {
  assertImpactActive,
  assertImpactControl,
  type HydraImpactReadControl,
} from './impact-read.js';

const IMPACT_ENTITY_COLUMNS = ['id', 'kind'] as const;
const IMPACT_NAME_COLUMNS = ['name'] as const;
const IMPACT_CLAIM_COLUMNS = [
  'id', 'predicate', 'object_text', 'polarity', 'valid_from', 'tx_time', 'superseded_by',
] as const;
const IMPACT_MENTION_COLUMNS = ['claim', 'predicate', 'other', 'other_name'] as const;
const MAX_IMPACT_SUBJECT_ROWS = 128;

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

  async #runForImpact(
    prepared: PreparedQuery,
    control: HydraImpactReadControl,
    expectedColumns: readonly string[],
  ): Promise<{
    rows: readonly Row[];
    trace: QueryTrace;
  }> {
    assertImpactActive(control);
    const started = performance.now();
    const page = await this.#client.queryForImpact(prepared, control);
    assertImpactActive(control);
    if (page.columns.length !== expectedColumns.length
      || page.columns.some((column, index) => column !== expectedColumns[index])) {
      throw new HydraDecodeError('impact node query returned an unexpected column shape');
    }
    if (page.rows.length > MAX_IMPACT_SUBJECT_ROWS
      || page.rows.some((row) => row.length !== expectedColumns.length)) {
      throw new HydraDecodeError('impact node query returned an invalid row shape');
    }
    const trace: QueryTrace = {
      cypher: prepared.cypher,
      request: prepared.cypher,
      parameters: prepared.parameters,
      rows: page.rows.length,
      ms: Math.round((performance.now() - started) * 10) / 10,
      readEpoch: page.readEpoch,
    };
    const rows = rowsToObjects(page.columns, page.rows) as readonly Row[];
    assertImpactActive(control);
    return { rows, trace };
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

  async #canonicalForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<{ canonical: string | null; traces: QueryTrace[] }> {
    const { rows, trace } = await this.#runForImpact(allEntityNames(), control, IMPACT_NAME_COLUMNS);
    const names = decodeImpactNames(rows);
    assertImpactActive(control);
    return { canonical: canonicalName(names, name), traces: [trace] };
  }

  async #entityForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<Read<EntityHead | null>> {
    const { rows, trace } = await this.#runForImpact(entityByName(name), control, IMPACT_ENTITY_COLUMNS);
    const head = decodeImpactEntity(rows);
    assertImpactActive(control);
    if (head !== null) return { value: head, traces: [trace] };
    const { canonical, traces } = await this.#canonicalForImpact(name, control);
    if (canonical === null) return { value: null, traces: [trace, ...traces] };
    const retried = await this.#runForImpact(entityByName(canonical), control, IMPACT_ENTITY_COLUMNS);
    const decoded = decodeImpactEntity(retried.rows);
    assertImpactActive(control);
    return { value: decoded, traces: [trace, ...traces, retried.trace] };
  }

  /** Strict impact-only subject read; every store call carries one required control. */
  async subjectForImpact(
    name: string,
    control: HydraImpactReadControl,
  ): Promise<Read<SubjectView>> {
    assertImpactControl(control);
    const head = await this.#entityForImpact(name, control);
    if (head.value === null) return { value: emptySubject(name), traces: head.traces };

    assertImpactActive(control);
    const peers = new AbortController();
    const relay = () => peers.abort();
    control.signal.addEventListener('abort', relay, { once: true });
    const child: HydraImpactReadControl = {
      signal: peers.signal,
      deadlineMs: control.deadlineMs,
      byteBudget: control.byteBudget,
    };
    try {
      const started = [
        this.#runForImpact(claimsAbout(head.value.id), child, IMPACT_CLAIM_COLUMNS),
        this.#runForImpact(mentionsFrom(head.value.id), child, IMPACT_MENTION_COLUMNS),
      ] as const;
      for (const peer of started) void peer.catch(() => peers.abort());
      const settled = await Promise.allSettled(started);
      const failed = settled.find(
        (entry): entry is PromiseRejectedResult => entry.status === 'rejected',
      );
      if (failed !== undefined) throw failed.reason;
      assertImpactActive(control);
      const claims = (settled[0] as PromiseFulfilledResult<Awaited<typeof started[0]>>).value;
      const mentions = (settled[1] as PromiseFulfilledResult<Awaited<typeof started[1]>>).value;
      const decodedClaims = decodeImpactClaims(claims.rows);
      const decodedMentions = orderMentions(decodeImpactMentions(mentions.rows));
      assertImpactActive(control);
      return {
        value: {
          name,
          id: head.value.id,
          kind: head.value.kind,
          claims: decodedClaims,
          mentions: decodedMentions,
        },
        traces: [...head.traces, claims.trace, mentions.trace],
      };
    } finally {
      control.signal.removeEventListener('abort', relay);
    }
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

function impactSubjectNumber(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new HydraDecodeError('impact subject contains an invalid integer');
  }
  return value;
}

function optionalImpactSubjectNumber(row: Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return impactSubjectNumber(row, column);
}

function impactSubjectString(
  row: Row,
  column: string,
  maxBytes: number,
  allowEmpty = false,
): string {
  const value = row[column];
  if (typeof value !== 'string' || (!allowEmpty && value === '')
    || !impactSubjectScalarString(value) || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new HydraDecodeError('impact subject contains an invalid string');
  }
  return value;
}

function impactSubjectScalarString(value: string): boolean {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(at + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      at += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function decodeImpactNames(rows: readonly Row[]): readonly string[] {
  return rows.map((row) => impactSubjectString(row, 'name', 512));
}

function decodeImpactEntity(rows: readonly Row[]): EntityHead | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new HydraDecodeError('impact subject entity lookup is ambiguous');
  }
  const row = rows[0]!;
  const rawKind = row['kind'];
  const kind = rawKind === null || rawKind === undefined
    ? null
    : impactSubjectString(row, 'kind', 256, true);
  return { id: impactSubjectNumber(row, 'id'), kind };
}

function decodeImpactClaims(rows: readonly Row[]): readonly ClaimRecord[] {
  if (rows.length > MAX_IMPACT_SUBJECT_ROWS) {
    throw new HydraDecodeError('impact subject claims exceed their cap');
  }
  const byId = new Map<number, {
    record: Omit<ClaimRecord, 'supersededBy'>;
    supersededBy: number[];
  }>();
  for (const row of rows) {
    const id = impactSubjectNumber(row, 'id');
    const rawPolarity = impactSubjectString(row, 'polarity', 8);
    if (rawPolarity !== 'positive' && rawPolarity !== 'negative') {
      throw new HydraDecodeError('impact subject claim has an invalid polarity');
    }
    const record = {
      id,
      predicate: impactSubjectString(row, 'predicate', 64, true),
      objectText: impactSubjectString(row, 'object_text', 2_048, true),
      polarity: rawPolarity,
      validFrom: impactSubjectString(row, 'valid_from', 256),
      txTime: impactSubjectString(row, 'tx_time', 256),
    } satisfies Omit<ClaimRecord, 'supersededBy'>;
    const existing = byId.get(id);
    if (existing === undefined) {
      byId.set(id, { record, supersededBy: [] });
    } else if (existing.record.predicate !== record.predicate
      || existing.record.objectText !== record.objectText
      || existing.record.polarity !== record.polarity
      || existing.record.validFrom !== record.validFrom
      || existing.record.txTime !== record.txTime) {
      throw new HydraDecodeError('impact subject repeats a claim inconsistently');
    }
    const superseder = optionalImpactSubjectNumber(row, 'superseded_by');
    if (superseder !== null) {
      const target = byId.get(id)!;
      if (!target.supersededBy.includes(superseder)) target.supersededBy.push(superseder);
    }
  }
  return [...byId.values()]
    .map(({ record, supersededBy }) => ({ ...record, supersededBy }))
    .sort((left, right) => left.validFrom === right.validFrom
      ? left.id - right.id
      : left.validFrom < right.validFrom ? -1 : 1);
}

function decodeImpactMentions(rows: readonly Row[]): readonly Mention[] {
  if (rows.length > MAX_IMPACT_SUBJECT_ROWS) {
    throw new HydraDecodeError('impact subject Mentions exceed their cap');
  }
  return rows.map((row) => ({
    claimId: impactSubjectNumber(row, 'claim'),
    predicate: impactSubjectString(row, 'predicate', 64, true),
    entityId: impactSubjectNumber(row, 'other'),
    entityName: impactSubjectString(row, 'other_name', 512, true),
  }));
}
