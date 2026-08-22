import { createHash } from 'node:crypto';

import type {
  HydraImpactChunk,
  HydraImpactReadControl,
  HydraImpactReadPort,
  HydraImpactRelationOccurrence,
} from '../hydra/impact-read.js';
import {
  canonicalEntityName,
  evaluateTargetStanding,
  type CanonicalEntityName,
  type TargetStanding,
} from '../retrieval/resolve.js';
import type { Mention, SubjectView } from '../retrieval/types.js';

export const WORKSPACE_IMPACT_LIMITS = Object.freeze({
  routeDeadlineMs: 30_000,
  queryMaxResults: 6,
  decodedChunks: 6,
  relationsRequestLimit: 128,
  decodedRelationRows: 128,
  queryPaths: 32,
  tripletsPerPath: 8,
  queryTriplets: 128,
  relationContainers: 64,
  nestedRelationRows: 8,
  queryBodyBytes: 1_048_576,
  relationsBodyBytes: 1_048_576,
  subjectBodyBytes: 524_288,
  aggregateResponseBytes: 6_291_456,
  candidateOccurrences: 256,
  subjectReads: 40,
  canonicalEntities: 40,
  claimsPerSubject: 128,
  mentionsPerSubject: 128,
  aggregateSubjectRows: 1_024,
  queryRelationConcurrency: 2,
  subjectReadConcurrency: 4,
  walkDepth: 3,
  returnedEntries: 256,
  successJsonBytes: 262_144,
  entityScalars: 160,
  entityBytes: 512,
  sourceIdsPerChunk: 8,
  idBytes: 256,
  chunkTextBytes: 2_048,
  contextBytes: 2_048,
  endpointBytes: 512,
  rawPredicateBytes: 64,
  derivedPredicateBytes: 192,
});

export type WorkspaceImpactLimit = keyof typeof WORKSPACE_IMPACT_LIMITS;

export class WorkspaceImpactDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceImpactDataError';
  }
}

export function assertWorkspaceImpactLimit(name: string, value: number): number {
  if (!Object.prototype.hasOwnProperty.call(WORKSPACE_IMPACT_LIMITS, name)) {
    throw new WorkspaceImpactDataError('unknown workspace impact limit');
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new WorkspaceImpactDataError('workspace impact counter is invalid');
  }
  const cap = WORKSPACE_IMPACT_LIMITS[name as WorkspaceImpactLimit];
  if (value > cap) {
    throw new WorkspaceImpactDataError('workspace impact limit exceeded');
  }
  return value;
}

function utf8(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function scalarString(value: string): boolean {
  for (let at = 0; at < value.length; at += 1) {
    const code = value.charCodeAt(at);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(at + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      at += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function boundedPresentId(value: string, role: string): void {
  if (value === '' || !scalarString(value)
    || utf8(value).byteLength > WORKSPACE_IMPACT_LIMITS.idBytes) {
    throw new WorkspaceImpactDataError(`${role} is invalid`);
  }
}

export function stableImpactSourceIds(
  sourceId: string | null,
  sourceIds: readonly string[],
): readonly string[] {
  if (!Array.isArray(sourceIds)
    || sourceIds.length > WORKSPACE_IMPACT_LIMITS.sourceIdsPerChunk) {
    throw new WorkspaceImpactDataError('source id array exceeds its cap');
  }
  const joined: string[] = [];
  const add = (value: string | null, role: string) => {
    if (value === null) return;
    boundedPresentId(value, role);
    if (!joined.includes(value)) joined.push(value);
  };
  add(sourceId, 'singular source id');
  sourceIds.forEach((value, index) => add(value, `source id ${index}`));
  if (joined.length > WORKSPACE_IMPACT_LIMITS.sourceIdsPerChunk) {
    throw new WorkspaceImpactDataError('source id union exceeds its cap');
  }
  return Object.freeze(joined);
}

function uint32(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new WorkspaceImpactDataError('frame length or ordinal is invalid');
  }
  const result = Buffer.allocUnsafe(4);
  result.writeUInt32BE(value, 0);
  return result;
}

function frame(tag: number, value: Uint8Array | null): Buffer {
  if (!Number.isInteger(tag) || tag < 0 || tag > 0xff) {
    throw new WorkspaceImpactDataError('frame tag is invalid');
  }
  const payload = value === null ? Buffer.alloc(0) : Buffer.from(value);
  return Buffer.concat([
    Buffer.from([tag, value === null ? 0 : 1]),
    uint32(payload.byteLength),
    payload,
  ]);
}

function stringFrame(tag: number, value: string | null): Buffer {
  if (value !== null && !scalarString(value)) {
    throw new WorkspaceImpactDataError('frame contains a non-scalar string');
  }
  return frame(tag, value === null ? null : utf8(value));
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function scoreFrame(score: number | null): Buffer {
  if (score === null) return frame(0x03, null);
  if (!Number.isFinite(score)) {
    throw new WorkspaceImpactDataError('chunk score is not finite');
  }
  const payload = Buffer.allocUnsafe(8);
  payload.writeDoubleBE(score, 0);
  return frame(0x03, payload);
}

function sourceVectorFrame(sourceIds: readonly string[]): Buffer {
  if (sourceIds.length > WORKSPACE_IMPACT_LIMITS.sourceIdsPerChunk) {
    throw new WorkspaceImpactDataError('chunk source vector exceeds its cap');
  }
  const payload: Buffer[] = [Buffer.from([sourceIds.length])];
  sourceIds.forEach((value, index) => {
    boundedPresentId(value, `chunk source id ${index}`);
    const encoded = utf8(value);
    payload.push(uint32(encoded.byteLength), encoded);
  });
  return frame(0x04, Buffer.concat(payload));
}

export function encodeImpactChunkRecord(chunk: HydraImpactChunk): Uint8Array {
  return Buffer.concat([
    utf8('lacuna-impact-chunk-v1\0'),
    stringFrame(0x01, chunk.chunkId),
    stringFrame(0x02, chunk.text),
    scoreFrame(chunk.score),
    sourceVectorFrame(chunk.sourceIds),
    stringFrame(0x05, chunk.sourceTitle),
    stringFrame(0x06, chunk.sourceType),
    stringFrame(0x07, chunk.observedAt),
  ]);
}

export function digestImpactChunkRecord(chunk: HydraImpactChunk): string {
  return hash(encodeImpactChunkRecord(chunk));
}

export interface ImpactChunkTableEntry {
  readonly digest: string;
  readonly sourceIds: readonly string[];
  readonly recordBytes: Uint8Array;
}

export interface ImpactChunkTable {
  readonly byId: ReadonlyMap<string, ImpactChunkTableEntry>;
}

export function createImpactChunkTable(
  chunks: readonly HydraImpactChunk[],
): ImpactChunkTable {
  assertWorkspaceImpactLimit('decodedChunks', chunks.length);
  const byId = new Map<string, ImpactChunkTableEntry>();
  for (const chunk of chunks) {
    if (chunk.chunkId === null) continue;
    boundedPresentId(chunk.chunkId, 'chunk id');
    const recordBytes = encodeImpactChunkRecord(chunk);
    const prior = byId.get(chunk.chunkId);
    if (prior !== undefined && compareImpactBytes(prior.recordBytes, recordBytes) !== 0) {
      throw new WorkspaceImpactDataError('query chunk id was reused inconsistently');
    }
    if (prior === undefined) {
      byId.set(chunk.chunkId, Object.freeze({
        digest: hash(recordBytes),
        sourceIds: Object.freeze([...chunk.sourceIds]),
        recordBytes,
      }));
    }
  }
  return Object.freeze({ byId });
}

export type ImpactChunkJoinState =
  | 'matched_query_chunk'
  | 'query_chunk_null'
  | 'query_chunk_unmatched'
  | 'inventory_unattributed';

export function joinImpactChunk(
  table: ImpactChunkTable,
  relation: HydraImpactRelationOccurrence,
  origin: ImpactOccurrenceOrigin,
): { readonly state: ImpactChunkJoinState; readonly sourceIds: readonly string[] } {
  if (origin === 'inventory') {
    return { state: 'inventory_unattributed', sourceIds: [] };
  }
  if (relation.chunkId === null) return { state: 'query_chunk_null', sourceIds: [] };
  const matched = table.byId.get(relation.chunkId);
  return matched === undefined
    ? { state: 'query_chunk_unmatched', sourceIds: [] }
    : { state: 'matched_query_chunk', sourceIds: [...matched.sourceIds] };
}

export type ImpactOccurrenceOrigin = 'query' | 'inventory';

export interface RawImpactOccurrence {
  readonly relation: HydraImpactRelationOccurrence;
  readonly origin: ImpactOccurrenceOrigin;
  readonly groupOrdinal: number;
  readonly rowOrdinal: number;
}

const ASCII_PREDICATE_SPACE = /[ \t\r\n]+/gu;

export function normalizeImpactPredicate(value: string | null): string | null {
  if (value === null) return null;
  if (!scalarString(value)) {
    throw new WorkspaceImpactDataError('predicate is not a scalar string');
  }
  const normalized = value
    .replace(ASCII_PREDICATE_SPACE, ' ')
    .replace(/^ +| +$/gu, '')
    .toLowerCase();
  if (utf8(normalized).byteLength > WORKSPACE_IMPACT_LIMITS.derivedPredicateBytes) {
    throw new WorkspaceImpactDataError('normalized predicate exceeds its derived ceiling');
  }
  return normalized;
}

function occurrenceFrames(
  input: RawImpactOccurrence,
  includeRelationshipId: boolean,
): Buffer[] {
  const normalized = normalizeImpactPredicate(input.relation.predicate);
  return [
    stringFrame(0x01, input.relation.source),
    stringFrame(0x02, input.relation.target),
    stringFrame(0x03, normalized),
    ...(includeRelationshipId ? [stringFrame(0x04, input.relation.relationshipId)] : []),
    stringFrame(0x05, input.relation.chunkId),
    stringFrame(0x06, input.relation.context),
  ];
}

export function encodeImpactOccurrence(input: RawImpactOccurrence): Uint8Array {
  return Buffer.concat([
    utf8('lacuna-impact-occurrence-v1\0'),
    ...occurrenceFrames(input, true),
  ]);
}

function relationshipShapeBytes(input: RawImpactOccurrence): Uint8Array {
  return Buffer.concat([
    utf8('lacuna-impact-occurrence-v1\0'),
    ...occurrenceFrames(input, false),
  ]);
}

export type ImpactEndpointClass =
  | { readonly kind: 'null' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid'; readonly raw: string }
  | {
    readonly kind: 'valid';
    readonly display: string;
    readonly key: string;
  };

export type ImpactDirection = 'forward' | 'inverse' | 'unmapped';

export type ImpactPredicateClass =
  | { readonly kind: 'null' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unknown' }
  | {
    readonly kind: 'mapped';
    readonly internalPredicate: 'depends_on';
  };

export type ImpactCandidateReason =
  | 'source_null'
  | 'source_empty'
  | 'source_invalid'
  | 'target_null'
  | 'target_empty'
  | 'target_invalid'
  | 'predicate_null'
  | 'predicate_empty'
  | 'predicate_invalid'
  | 'predicate_unknown';

const FORWARD_PREDICATES = new Set([
  'depends_on', 'depends on', 'depended on', 'requires', 'uses', 'calls',
]);
const INVERSE_PREDICATES = new Set(['required by', 'used by', 'called by']);

function endpointClass(value: string | null): ImpactEndpointClass {
  if (value === null) return { kind: 'null' };
  if (value === '') return { kind: 'empty' };
  const canonical: CanonicalEntityName | null = canonicalEntityName(value);
  return canonical === null
    ? { kind: 'invalid', raw: value }
    : { kind: 'valid', display: canonical.display, key: canonical.key };
}

function predicateClass(normalized: string | null): {
  readonly classification: ImpactPredicateClass;
  readonly direction: ImpactDirection;
} {
  if (normalized === null) return { classification: { kind: 'null' }, direction: 'unmapped' };
  if (normalized === '') return { classification: { kind: 'empty' }, direction: 'unmapped' };
  if (utf8(normalized).byteLength > WORKSPACE_IMPACT_LIMITS.rawPredicateBytes) {
    return {
      classification: { kind: 'invalid' },
      direction: 'unmapped',
    };
  }
  if (FORWARD_PREDICATES.has(normalized)) {
    return {
      classification: { kind: 'mapped', internalPredicate: 'depends_on' },
      direction: 'forward',
    };
  }
  if (INVERSE_PREDICATES.has(normalized)) {
    return {
      classification: { kind: 'mapped', internalPredicate: 'depends_on' },
      direction: 'inverse',
    };
  }
  return {
    classification: { kind: 'unknown' },
    direction: 'unmapped',
  };
}

function reasonFor(
  source: ImpactEndpointClass,
  target: ImpactEndpointClass,
  predicate: ImpactPredicateClass,
): ImpactCandidateReason | null {
  if (source.kind !== 'valid') return `source_${source.kind}`;
  if (target.kind !== 'valid') return `target_${target.kind}`;
  if (predicate.kind === 'mapped') return null;
  return `predicate_${predicate.kind}`;
}

function endpointSortKey(endpoint: ImpactEndpointClass): Buffer {
  const ranks: Record<ImpactEndpointClass['kind'], number> = {
    null: 0,
    empty: 1,
    invalid: 2,
    valid: 3,
  };
  const payload = endpoint.kind === 'invalid'
    ? utf8(endpoint.raw)
    : endpoint.kind === 'valid'
      ? utf8(endpoint.key)
      : Buffer.alloc(0);
  return Buffer.concat([Buffer.from([ranks[endpoint.kind]]), uint32(payload.byteLength), payload]);
}

function lengthPayload(value: string): Buffer {
  const payload = utf8(value);
  return Buffer.concat([uint32(payload.byteLength), payload]);
}

function predicateSortKey(
  predicate: ImpactPredicateClass,
  normalizedPredicate: string | null,
): Buffer {
  const ranks: Record<ImpactPredicateClass['kind'], number> = {
    null: 0,
    empty: 1,
    invalid: 2,
    unknown: 3,
    mapped: 4,
  };
  const normalized = normalizedPredicate ?? '';
  const internal = predicate.kind === 'mapped' ? predicate.internalPredicate : '';
  return Buffer.concat([
    Buffer.from([ranks[predicate.kind]]),
    lengthPayload(normalized),
    lengthPayload(internal),
  ]);
}

function directionRank(direction: ImpactDirection): number {
  if (direction === 'forward') return 0;
  if (direction === 'inverse') return 1;
  return 2;
}

function candidateSortKey(
  input: RawImpactOccurrence,
  source: ImpactEndpointClass,
  target: ImpactEndpointClass,
  predicate: ImpactPredicateClass,
  normalizedPredicate: string | null,
  direction: ImpactDirection,
  identity: string,
): Uint8Array {
  if (!Number.isSafeInteger(input.groupOrdinal) || input.groupOrdinal < 0
    || !Number.isSafeInteger(input.rowOrdinal) || input.rowOrdinal < 0) {
    throw new WorkspaceImpactDataError('occurrence ordinal is invalid');
  }
  const effectiveSource = direction === 'inverse' ? target : source;
  const effectiveTarget = direction === 'inverse' ? source : target;
  const contextDigest = Buffer.from(hash(stringFrame(0x06, input.relation.context)), 'hex');
  return Buffer.concat([
    endpointSortKey(effectiveSource),
    endpointSortKey(effectiveTarget),
    predicateSortKey(predicate, normalizedPredicate),
    Buffer.from([directionRank(direction)]),
    Buffer.from(identity, 'hex'),
    stringFrame(0x05, input.relation.chunkId),
    contextDigest,
    Buffer.from([input.origin === 'query' ? 0 : 1]),
    uint32(input.groupOrdinal),
    uint32(input.rowOrdinal),
  ]);
}

export interface ClassifiedImpactOccurrence extends RawImpactOccurrence {
  readonly identity: string;
  readonly relationshipShapeDigest: string;
  readonly normalizedPredicate: string | null;
  readonly sourceClass: ImpactEndpointClass;
  readonly targetClass: ImpactEndpointClass;
  readonly predicateClass: ImpactPredicateClass;
  readonly direction: ImpactDirection;
  readonly effectiveSource: ImpactEndpointClass;
  readonly effectiveTarget: ImpactEndpointClass;
  readonly reason: ImpactCandidateReason | null;
  readonly rejection: 'malformed_candidate' | 'not_structural' | null;
  readonly sortKey: Uint8Array;
}

export function classifyImpactOccurrence(
  input: RawImpactOccurrence,
): ClassifiedImpactOccurrence {
  const normalizedPredicate = normalizeImpactPredicate(input.relation.predicate);
  const sourceClass = endpointClass(input.relation.source);
  const targetClass = endpointClass(input.relation.target);
  const { classification: classifiedPredicate, direction } = predicateClass(normalizedPredicate);
  const identity = hash(encodeImpactOccurrence(input));
  const relationshipShapeDigest = hash(relationshipShapeBytes(input));
  const reason = reasonFor(sourceClass, targetClass, classifiedPredicate);
  const effectiveSource = direction === 'inverse' ? targetClass : sourceClass;
  const effectiveTarget = direction === 'inverse' ? sourceClass : targetClass;
  return {
    ...input,
    identity,
    relationshipShapeDigest,
    normalizedPredicate,
    sourceClass,
    targetClass,
    predicateClass: classifiedPredicate,
    direction,
    effectiveSource,
    effectiveTarget,
    reason,
    rejection: reason === null
      ? null
      : reason === 'predicate_unknown'
        ? 'not_structural'
        : 'malformed_candidate',
    sortKey: candidateSortKey(
      input,
      sourceClass,
      targetClass,
      classifiedPredicate,
      normalizedPredicate,
      direction,
      identity,
    ),
  };
}

export function compareImpactBytes(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const a = left[index] as number;
    const b = right[index] as number;
    if (a !== b) return a < b ? -1 : 1;
  }
  return left.byteLength === right.byteLength ? 0 : left.byteLength < right.byteLength ? -1 : 1;
}

export function prepareImpactCandidates(
  inputs: readonly RawImpactOccurrence[],
): readonly ClassifiedImpactOccurrence[] {
  assertWorkspaceImpactLimit('candidateOccurrences', inputs.length);
  const byRelationshipId = new Map<string, string>();
  const classified = inputs.map((input) => {
    const candidate = classifyImpactOccurrence(input);
    const id = candidate.relation.relationshipId;
    if (id !== null) {
      const prior = byRelationshipId.get(id);
      if (prior !== undefined && prior !== candidate.relationshipShapeDigest) {
        throw new WorkspaceImpactDataError('relationship id was reused inconsistently');
      }
      byRelationshipId.set(id, candidate.relationshipShapeDigest);
    }
    return candidate;
  });
  return classified.sort((left, right) => compareImpactBytes(left.sortKey, right.sortKey));
}

export interface ImpactDiagnosticRejection extends ClassifiedImpactOccurrence {
  readonly depth: 0;
  readonly outcome: 'malformed_candidate' | 'not_structural';
  readonly reason: ImpactCandidateReason;
}

export interface ImpactDiagnosticPhase {
  readonly reached: number;
  readonly accepted: readonly never[];
  readonly rejected: readonly ImpactDiagnosticRejection[];
  readonly duplicates: number;
  /** Valid mapped rows retained verbatim for the later, source-backed BFS. */
  readonly structural: readonly ClassifiedImpactOccurrence[];
}

export function assertImpactReturnedEntries(
  accepted: number,
  rejected: number,
): number {
  if (!Number.isSafeInteger(accepted) || accepted < 0
    || !Number.isSafeInteger(rejected) || rejected < 0) {
    throw new WorkspaceImpactDataError('returned impact entry count is invalid');
  }
  const total = accepted + rejected;
  if (!Number.isSafeInteger(total)) {
    throw new WorkspaceImpactDataError('returned impact entry count overflowed');
  }
  return assertWorkspaceImpactLimit('returnedEntries', total);
}

/**
 * Account for every semantically invalid provider occurrence before traversal.
 * Structural candidates remain untouched: this phase has no root, frontier,
 * subject source, or authority to call one reachable.
 */
export function runImpactDiagnosticPhase(
  inputs: readonly RawImpactOccurrence[],
): ImpactDiagnosticPhase {
  // Preparing the complete set first makes a repeated real-id inconsistency an
  // atomic whole-request failure rather than a partial diagnostic result.
  const candidates = prepareImpactCandidates(inputs);
  const seen = new Set<string>();
  const rejected: ImpactDiagnosticRejection[] = [];
  const structural: ClassifiedImpactOccurrence[] = [];
  let reached = 0;
  let duplicates = 0;

  for (const candidate of candidates) {
    if (candidate.rejection === null) {
      structural.push(candidate);
      continue;
    }

    reached += 1;
    if (seen.has(candidate.identity)) {
      duplicates += 1;
      continue;
    }
    seen.add(candidate.identity);

    if (candidate.reason === null) {
      throw new WorkspaceImpactDataError('diagnostic candidate has no reason');
    }
    rejected.push({
      ...candidate,
      depth: 0,
      outcome: candidate.rejection,
      reason: candidate.reason,
    });
    assertImpactReturnedEntries(0, rejected.length);
  }

  if (reached !== rejected.length + duplicates) {
    throw new WorkspaceImpactDataError('diagnostic accounting is inconsistent');
  }
  return Object.freeze({
    reached,
    accepted: Object.freeze([]),
    rejected: Object.freeze(rejected),
    duplicates,
    structural: Object.freeze(structural),
  });
}

export type ImpactStandingOutcome =
  | {
    readonly accepted: true;
    readonly outcome: 'accepted';
    readonly claimId: number;
    readonly mention: Mention;
  }
  | {
    readonly accepted: false;
    readonly outcome: Exclude<TargetStanding['state'], 'current'>;
    readonly claimId: null;
    readonly mention: null;
  };

/** Keep the shared standing union total without changing its policy. */
export function impactStandingOutcome(standing: TargetStanding): ImpactStandingOutcome {
  if (standing.state === 'current') {
    return {
      accepted: true,
      outcome: 'accepted',
      claimId: standing.claim.id,
      mention: standing.mention,
    };
  }
  return {
    accepted: false,
    outcome: standing.state,
    claimId: null,
    mention: null,
  };
}

export interface WorkspaceImpactEndpoint {
  readonly raw: string | null;
  readonly display: string | null;
  readonly key: string | null;
}

export type WorkspaceImpactOutcome =
  | 'malformed_candidate'
  | 'not_structural'
  | 'unstated'
  | 'historical'
  | 'retracted'
  | 'contradicted'
  | 'missing_mention'
  | 'budget_excluded'
  | 'accepted';

export interface WorkspaceImpactEdge {
  readonly outcome: WorkspaceImpactOutcome;
  readonly reason: string | null;
  readonly depth: number;
  readonly identity: string;
  readonly relationshipId: string | null;
  readonly origin: ImpactOccurrenceOrigin;
  readonly source: WorkspaceImpactEndpoint;
  readonly target: WorkspaceImpactEndpoint;
  readonly rawPredicate: string | null;
  readonly predicate: 'depends_on' | null;
  readonly direction: ImpactDirection;
  readonly chunkId: string | null;
  readonly context: string | null;
  readonly provenanceJoin: ImpactChunkJoinState;
  readonly sourceIds: readonly string[];
  readonly claimId: number | null;
  readonly mention: Mention | null;
}

export interface WorkspaceImpactResult {
  readonly subject: CanonicalEntityName;
  readonly reached: number;
  readonly accepted: readonly WorkspaceImpactEdge[];
  readonly rejected: readonly WorkspaceImpactEdge[];
  readonly duplicates: number;
  readonly affected: readonly CanonicalEntityName[];
  readonly depth: number;
}

export interface WorkspaceImpactRunControl {
  readonly signal: AbortSignal;
  readonly deadlineMs: number;
}

function endpointResult(
  raw: string | null,
  endpoint: ImpactEndpointClass,
): WorkspaceImpactEndpoint {
  return endpoint.kind === 'valid'
    ? { raw, display: endpoint.display, key: endpoint.key }
    : { raw, display: null, key: null };
}

function resultEdge(
  candidate: ClassifiedImpactOccurrence,
  outcome: WorkspaceImpactOutcome,
  reason: string | null,
  depth: number,
  chunks: ImpactChunkTable,
  claimId: number | null,
  selectedMention: Mention | null,
): WorkspaceImpactEdge {
  const provenance = joinImpactChunk(chunks, candidate.relation, candidate.origin);
  return {
    outcome,
    reason,
    depth,
    identity: candidate.identity,
    relationshipId: candidate.relation.relationshipId,
    origin: candidate.origin,
    source: endpointResult(candidate.relation.source, candidate.sourceClass),
    target: endpointResult(candidate.relation.target, candidate.targetClass),
    rawPredicate: candidate.relation.predicate,
    predicate: candidate.predicateClass.kind === 'mapped'
      ? candidate.predicateClass.internalPredicate
      : null,
    direction: candidate.direction,
    chunkId: candidate.relation.chunkId,
    context: candidate.relation.context,
    provenanceJoin: provenance.state,
    sourceIds: Object.freeze([...provenance.sourceIds]),
    claimId,
    mention: selectedMention === null ? null : Object.freeze({ ...selectedMention }),
  };
}

export function assertWorkspaceImpactOutput(value: unknown): number {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw new WorkspaceImpactDataError('workspace impact output cannot be encoded');
  }
  if (encoded === undefined) {
    throw new WorkspaceImpactDataError('workspace impact output cannot be encoded');
  }
  return assertWorkspaceImpactLimit('successJsonBytes', utf8(encoded).byteLength);
}

function validSignal(value: unknown): value is AbortSignal {
  return typeof value === 'object'
    && value !== null
    && typeof (value as AbortSignal).aborted === 'boolean'
    && typeof (value as AbortSignal).addEventListener === 'function'
    && typeof (value as AbortSignal).removeEventListener === 'function';
}

function readFailure(): WorkspaceImpactDataError {
  return new WorkspaceImpactDataError('workspace impact read did not complete');
}

function unwrapSettled<T>(result: PromiseSettledResult<T>): T {
  if (result.status === 'fulfilled') return result.value;
  throw result.reason;
}

function boundedSubjectString(value: unknown, role: string, bytes = 4_096): string {
  if (typeof value !== 'string' || !scalarString(value) || utf8(value).byteLength > bytes) {
    throw new WorkspaceImpactDataError(`workspace subject ${role} is invalid`);
  }
  return value;
}

function boundedSubjectInteger(value: unknown, role: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new WorkspaceImpactDataError(`workspace subject ${role} is invalid`);
  }
  return value;
}

/**
 * Copy the exact rows the standing evaluator is allowed to observe. Hydra
 * subject adapters may carry provider metadata, but it must never become part
 * of the cached view or the returned proof. Invalid values fail the complete
 * run before any partial subject can influence traversal.
 */
function sanitizeSubjectRows(subject: SubjectView): SubjectView {
  if (typeof subject !== 'object' || subject === null
    || !Array.isArray(subject.claims) || !Array.isArray(subject.mentions)) {
    throw new WorkspaceImpactDataError('workspace subject rows are invalid');
  }
  const name = boundedSubjectString(subject.name, 'name', WORKSPACE_IMPACT_LIMITS.endpointBytes);
  const id = subject.id === null ? null : boundedSubjectInteger(subject.id, 'id');
  const kind = subject.kind === null
    ? null
    : boundedSubjectString(subject.kind, 'kind', WORKSPACE_IMPACT_LIMITS.endpointBytes);
  assertWorkspaceImpactLimit('claimsPerSubject', subject.claims.length);
  assertWorkspaceImpactLimit('mentionsPerSubject', subject.mentions.length);

  const claims = subject.claims.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkspaceImpactDataError(`workspace subject claim ${index} is invalid`);
    }
    const claim = raw as Record<string, unknown>;
    const polarity = claim.polarity;
    if (polarity !== 'positive' && polarity !== 'negative') {
      throw new WorkspaceImpactDataError(`workspace subject claim ${index} polarity is invalid`);
    }
    if (!Array.isArray(claim.supersededBy)
      || claim.supersededBy.length > WORKSPACE_IMPACT_LIMITS.claimsPerSubject) {
      throw new WorkspaceImpactDataError(`workspace subject claim ${index} supersession is invalid`);
    }
    const supersededBy = claim.supersededBy.map((value, supersededIndex) =>
      boundedSubjectInteger(value, `claim ${index} supersession ${supersededIndex}`));
    return Object.freeze({
      id: boundedSubjectInteger(claim.id, `claim ${index} id`),
      predicate: boundedSubjectString(claim.predicate, `claim ${index} predicate`),
      objectText: boundedSubjectString(claim.objectText, `claim ${index} object`),
      polarity,
      validFrom: boundedSubjectString(claim.validFrom, `claim ${index} validFrom`),
      txTime: boundedSubjectString(claim.txTime, `claim ${index} txTime`),
      supersededBy: Object.freeze(supersededBy),
    });
  });
  const mentions = subject.mentions.map((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      throw new WorkspaceImpactDataError(`workspace subject mention ${index} is invalid`);
    }
    const mention = raw as Record<string, unknown>;
    return Object.freeze({
      claimId: boundedSubjectInteger(mention.claimId, `mention ${index} claim id`),
      predicate: boundedSubjectString(mention.predicate, `mention ${index} predicate`),
      entityId: boundedSubjectInteger(mention.entityId, `mention ${index} entity id`),
      entityName: boundedSubjectString(mention.entityName, `mention ${index} entity name`,
        WORKSPACE_IMPACT_LIMITS.endpointBytes),
    });
  });
  return Object.freeze({
    name,
    id,
    kind,
    claims: Object.freeze(claims),
    mentions: Object.freeze(mentions),
  });
}

function assertSubjectRows(subject: SubjectView): { readonly view: SubjectView; readonly rows: number } {
  const view = sanitizeSubjectRows(subject);
  return { view, rows: view.claims.length + view.mentions.length };
}

/**
 * Execute the private source-backed impact walk. Provider rows remain
 * candidates until the shared standing evaluator proves the exact target.
 */
export async function runWorkspaceImpact(
  rawSubject: string,
  port: HydraImpactReadPort,
  control: WorkspaceImpactRunControl,
): Promise<WorkspaceImpactResult> {
  const root = canonicalEntityName(rawSubject);
  if (root === null) {
    throw new WorkspaceImpactDataError('workspace impact subject is invalid');
  }
  if (!validSignal(control?.signal)
    || !Number.isFinite(control.deadlineMs)) {
    throw new WorkspaceImpactDataError('workspace impact control is invalid');
  }

  const controller = new AbortController();
  const deadlineMs = Math.min(
    control.deadlineMs,
    Date.now() + WORKSPACE_IMPACT_LIMITS.routeDeadlineMs,
  );
  const abortFromCaller = () => controller.abort();
  control.signal.addEventListener('abort', abortFromCaller, { once: true });
  if (control.signal.aborted || deadlineMs <= Date.now()) controller.abort();
  const deadlineTimer = setTimeout(
    () => controller.abort(),
    Math.max(0, deadlineMs - Date.now()),
  );

  let aggregateBytes = 0;
  const byteBudget = Object.freeze({
    consume(chunkBytes: number): void {
      if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 0) {
        throw new WorkspaceImpactDataError('workspace impact byte count is invalid');
      }
      const next = aggregateBytes + chunkBytes;
      if (!Number.isSafeInteger(next)) {
        throw new WorkspaceImpactDataError('workspace impact byte count overflowed');
      }
      aggregateBytes = assertWorkspaceImpactLimit('aggregateResponseBytes', next);
    },
  });
  const readControl: HydraImpactReadControl = Object.freeze({
    signal: controller.signal,
    deadlineMs,
    byteBudget,
  });

  try {
    const assertRunActive = (): void => {
      if (controller.signal.aborted || Date.now() >= deadlineMs) {
        controller.abort();
        throw readFailure();
      }
    };
    assertRunActive();

    let firstReadFailure: unknown;
    const observe = <T>(readPromise: Promise<T>): Promise<T> => readPromise.catch((cause) => {
      if (firstReadFailure === undefined) firstReadFailure = cause;
      controller.abort();
      throw cause;
    });
    const queryPromise = observe(Promise.resolve()
      .then(() => port.queryForImpact(root.display, readControl)));
    const inventoryPromise = observe(Promise.resolve()
      .then(() => port.relationsForImpact(readControl)));
    const initial = await Promise.allSettled([queryPromise, inventoryPromise]);
    assertRunActive();
    if (firstReadFailure !== undefined) throw firstReadFailure;
    if (controller.signal.aborted) throw readFailure();
    const query = unwrapSettled(initial[0]);
    const inventory = unwrapSettled(initial[1]);

    if (!Array.isArray(query.chunks)
      || !Array.isArray(query.relations)
      || !Array.isArray(inventory)) {
      throw new WorkspaceImpactDataError('workspace impact provider rows are invalid');
    }
    assertWorkspaceImpactLimit('decodedChunks', query.chunks.length);
    assertWorkspaceImpactLimit('queryTriplets', query.relations.length);
    assertWorkspaceImpactLimit('decodedRelationRows', inventory.length);
    const chunks = createImpactChunkTable(query.chunks);
    const occurrences: RawImpactOccurrence[] = [
      ...query.relations.map((rawRelation, rowOrdinal) => ({
        relation: rawRelation,
        origin: 'query' as const,
        groupOrdinal: 0,
        rowOrdinal,
      })),
      ...inventory.map((rawRelation, rowOrdinal) => ({
        relation: rawRelation,
        origin: 'inventory' as const,
        groupOrdinal: 1,
        rowOrdinal,
      })),
    ];
    assertWorkspaceImpactLimit('candidateOccurrences', occurrences.length);
    const diagnostic = runImpactDiagnosticPhase(occurrences);
    const accepted: WorkspaceImpactEdge[] = [];
    const rejected: WorkspaceImpactEdge[] = diagnostic.rejected.map((candidate) =>
      resultEdge(
        candidate,
        candidate.outcome,
        candidate.reason,
        0,
        chunks,
        null,
        null,
      ));
    let reached = diagnostic.reached;
    let duplicates = diagnostic.duplicates;
    let maximumDepth = 0;
    assertImpactReturnedEntries(accepted.length, rejected.length);

    const seenOccurrences = new Set<string>();
    for (const candidate of diagnostic.rejected) seenOccurrences.add(candidate.identity);
    const bySource = new Map<string, ClassifiedImpactOccurrence[]>();
    for (const candidate of diagnostic.structural) {
      if (candidate.effectiveSource.kind !== 'valid'
        || candidate.effectiveTarget.kind !== 'valid'
        || candidate.predicateClass.kind !== 'mapped') {
        throw new WorkspaceImpactDataError('structural candidate is inconsistent');
      }
      const outgoing = bySource.get(candidate.effectiveSource.key) ?? [];
      outgoing.push(candidate);
      bySource.set(candidate.effectiveSource.key, outgoing);
    }

    const entityNames = new Map<string, CanonicalEntityName>([[root.key, root]]);
    const scheduled = new Set<string>([root.key]);
    const expanded = new Set<string>();
    const subjectCache = new Map<string, SubjectView>();
    const affected = new Map<string, CanonicalEntityName>();
    let subjectReads = 0;
    let aggregateSubjectRows = 0;

    const readFrontier = async (frontier: readonly CanonicalEntityName[]): Promise<void> => {
      const pending = frontier.filter((entity) => !subjectCache.has(entity.key));
      let nextIndex = 0;
      let firstFailure: unknown;
      const worker = async (): Promise<void> => {
        while (nextIndex < pending.length
          && firstFailure === undefined
          && !controller.signal.aborted) {
          const index = nextIndex;
          nextIndex += 1;
          const entity = pending[index];
          if (entity === undefined) break;
          try {
            subjectReads += 1;
            assertWorkspaceImpactLimit('subjectReads', subjectReads);
            assertRunActive();
            const subjectRead = await port.subjectForImpact(entity.display, readControl);
            assertRunActive();
            const sanitized = assertSubjectRows(subjectRead.value);
            const rows = sanitized.rows;
            const nextRows = aggregateSubjectRows + rows;
            if (!Number.isSafeInteger(nextRows)) {
              throw new WorkspaceImpactDataError('workspace subject row count overflowed');
            }
            aggregateSubjectRows = assertWorkspaceImpactLimit('aggregateSubjectRows', nextRows);
            subjectCache.set(entity.key, sanitized.view);
          } catch (cause) {
            if (firstFailure === undefined) firstFailure = cause;
            controller.abort();
          }
        }
      };
      const workers = Array.from(
        { length: Math.min(WORKSPACE_IMPACT_LIMITS.subjectReadConcurrency, pending.length) },
        () => worker(),
      );
      await Promise.allSettled(workers);
      if (firstFailure !== undefined) throw firstFailure;
      if (controller.signal.aborted) throw readFailure();
    };

    // Diagnostics and empty inventories are complete without touching a
    // subject source. Only entities with structural outgoing rows can affect
    // the source-backed BFS, so do not perform speculative reads.
    let frontier: CanonicalEntityName[] = bySource.has(root.key) ? [root] : [];
    let entityDepth = 0;
    while (frontier.length > 0 && entityDepth <= WORKSPACE_IMPACT_LIMITS.walkDepth) {
      assertRunActive();
      frontier.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
      await readFrontier(frontier);
      assertRunActive();
      const nextFrontier = new Map<string, CanonicalEntityName>();

      for (const source of frontier) {
        expanded.add(source.key);
        const subject = subjectCache.get(source.key);
        if (subject === undefined) {
          throw new WorkspaceImpactDataError('workspace subject cache is incomplete');
        }
        for (const candidate of bySource.get(source.key) ?? []) {
          assertRunActive();
          reached += 1;
          if (seenOccurrences.has(candidate.identity)) {
            duplicates += 1;
            continue;
          }
          seenOccurrences.add(candidate.identity);
          if (candidate.effectiveTarget.kind !== 'valid') {
            throw new WorkspaceImpactDataError('workspace target is inconsistent');
          }
          const edgeDepth = entityDepth + 1;
          const standing = impactStandingOutcome(evaluateTargetStanding(
            subject,
            candidate.predicateClass.kind === 'mapped'
              ? candidate.predicateClass.internalPredicate
              : '',
            candidate.effectiveTarget.key,
          ));
          if (!standing.accepted) {
            rejected.push(resultEdge(
              candidate,
              standing.outcome,
              standing.outcome,
              edgeDepth,
              chunks,
              null,
              null,
            ));
            assertImpactReturnedEntries(accepted.length, rejected.length);
            continue;
          }

          let budgetReason: 'depth_limit' | 'entity_limit' | null = null;
          if (edgeDepth > WORKSPACE_IMPACT_LIMITS.walkDepth) {
            budgetReason = 'depth_limit';
          } else if (!entityNames.has(candidate.effectiveTarget.key)
            && entityNames.size >= WORKSPACE_IMPACT_LIMITS.canonicalEntities) {
            budgetReason = 'entity_limit';
          }
          if (budgetReason !== null) {
            rejected.push(resultEdge(
              candidate,
              'budget_excluded',
              budgetReason,
              edgeDepth,
              chunks,
              standing.claimId,
              standing.mention,
            ));
            assertImpactReturnedEntries(accepted.length, rejected.length);
            continue;
          }

          const targetName: CanonicalEntityName = entityNames.get(candidate.effectiveTarget.key) ?? {
            display: candidate.effectiveTarget.display,
            key: candidate.effectiveTarget.key,
          };
          entityNames.set(targetName.key, targetName);
          accepted.push(resultEdge(
            candidate,
            'accepted',
            null,
            edgeDepth,
            chunks,
            standing.claimId,
            standing.mention,
          ));
          assertImpactReturnedEntries(accepted.length, rejected.length);
          maximumDepth = Math.max(maximumDepth, edgeDepth);
          if (targetName.key !== root.key && !affected.has(targetName.key)) {
            affected.set(targetName.key, targetName);
          }
          if (bySource.has(targetName.key)
            && !scheduled.has(targetName.key) && !expanded.has(targetName.key)) {
            scheduled.add(targetName.key);
            nextFrontier.set(targetName.key, targetName);
          }
        }
      }
      frontier = [...nextFrontier.values()];
      entityDepth += 1;
    }

    if (reached !== accepted.length + rejected.length + duplicates) {
      throw new WorkspaceImpactDataError('workspace impact accounting is inconsistent');
    }
    assertRunActive();
    const result: WorkspaceImpactResult = {
      subject: root,
      reached,
      accepted: Object.freeze(accepted),
      rejected: Object.freeze(rejected),
      duplicates,
      affected: Object.freeze([...affected.values()]
        .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)),
      depth: maximumDepth,
    };
    assertWorkspaceImpactOutput(result);
    return Object.freeze(result);
  } finally {
    clearTimeout(deadlineTimer);
    control.signal.removeEventListener('abort', abortFromCaller);
  }
}
