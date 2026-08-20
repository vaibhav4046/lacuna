import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { ImpactResult } from './impact.js';
import type { ClaimRow, Inventory } from '../report/inventory.js';

/**
 * The bounded JSON contract used by both graph screens.
 *
 * It deliberately does not return a workspace id. The route already knows the
 * scope it authenticated, and echoing an account collection name into the
 * browser would create a second place for tenant identifiers to leak.
 */

export const GRAPH_SCHEMA = 'lacuna.graph.v1' as const;
export const DEFAULT_GRAPH_PAGE_SIZE = 80;
export const MAX_GRAPH_PAGE_SIZE = 200;
export const MAX_GRAPH_NODES = 2_000;
export const MAX_GRAPH_EDGES = 4_000;
export const MAX_GRAPH_EDGES_PER_PAGE = 800;
export const MAX_GRAPH_LABEL_CHARS = 320;

export type GraphMode = 'overview' | 'proof';
export type GraphNodeKind = 'source' | 'evidence' | 'claim' | 'entity' | 'context_pack' | 'agent' | 'client';
export type GraphNodeState = 'current' | 'historical' | 'conflicted' | 'missing' | 'withdrawn' | 'neutral';
export type GraphRelation =
  | 'contains'
  | 'supports'
  | 'about'
  | 'supersedes'
  | 'contradicts'
  | 'mentions'
  | 'depends_on'
  | 'impact'
  | 'connects';
export type GraphRejection = 'historical' | 'contradicted' | 'unstated' | 'not_structural' | 'stale' | 'non_event';

export interface GraphNode {
  readonly id: string;
  readonly kind: GraphNodeKind;
  readonly label: string;
  readonly state: GraphNodeState;
  /** ISO date when known. A missing date stays null. */
  readonly date: string | null;
  /** A source title or stable source reference, never an account id. */
  readonly sourceRef: string | null;
  readonly detail: string | null;
}

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relation: GraphRelation;
  readonly label: string | null;
  readonly date: string | null;
  readonly sourceRef: string | null;
  /** Rejected edges stay in the proof instead of disappearing into policy. */
  readonly rejected: boolean;
  readonly rejectionReason: GraphRejection | null;
}

/** Server-side graph before scope validation and pagination. */
export interface GraphDataset {
  readonly workspaceId: string;
  readonly scope: 'workspace' | 'public';
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

declare const CURSOR: unique symbol;
export type GraphCursor = string & { readonly [CURSOR]: true };

export interface GraphPageRequest {
  /** Scope proved by the session or the fixed public-workspace route. */
  readonly authenticatedWorkspaceId: string;
  /** Scope named by the route or graph provider. Must match the proof above. */
  readonly requestedWorkspaceId: string;
  readonly mode: GraphMode;
  readonly cursor?: string | null;
  readonly limit?: number;
  /** Server-only secret. It must never be returned by this module. */
  readonly cursorKey: string;
}

export interface GraphPageInfo {
  readonly limit: number;
  readonly returnedNodes: number;
  readonly returnedEdges: number;
  readonly totalNodes: number;
  readonly totalEdges: number;
  readonly nextCursor: GraphCursor | null;
  readonly truncated: boolean;
}

export interface GraphDiagnostics {
  readonly duplicateNodes: number;
  readonly duplicateEdges: number;
  readonly orphanEdges: number;
}

export interface GraphEnvelope {
  readonly schema: typeof GRAPH_SCHEMA;
  readonly mode: GraphMode;
  readonly scope: 'workspace' | 'public';
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly page: GraphPageInfo;
  readonly diagnostics: GraphDiagnostics;
}

export type GraphApiErrorCode =
  | 'INVALID_SCOPE'
  | 'INVALID_CURSOR'
  | 'INVALID_LIMIT'
  | 'OVERSIZE_LIMIT'
  | 'INVALID_CURSOR_KEY';

export class GraphApiError extends Error {
  constructor(
    readonly code: GraphApiErrorCode,
    readonly status: 400 | 403 | 422 | 500,
  ) {
    super(code);
    this.name = 'GraphApiError';
  }
}

const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const CONTROL = /[\u0000-\u001f\u007f]/gu;
const ID = /^[a-z][a-z0-9_-]{0,31}:[a-f0-9]{20}$/u;
const CURSOR_TEXT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
const DEPENDENCY = /^(?:depends[_ ]on|uses|calls|requires)$/iu;

/** Bound, flatten and redact labels before they reach JSON or SVG. */
export function graphText(value: string, cap = MAX_GRAPH_LABEL_CHARS): string {
  const clean = value.replace(CONTROL, ' ').replace(EMAIL, '[redacted email]').replace(/\s+/gu, ' ').trim();
  if (clean.length <= cap) return clean;
  return `${clean.slice(0, Math.max(0, cap - 1))}…`;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 20);
}

function nodeId(kind: GraphNodeKind, key: string): string {
  return `${kind}:${digest(`${kind}\u0000${key}`)}`;
}

function edgeId(relation: GraphRelation, from: string, to: string, qualifier = ''): string {
  return `edge:${digest(`${relation}\u0000${from}\u0000${to}\u0000${qualifier}`)}`;
}

function stateOf(claim: ClaimRow): GraphNodeState {
  if (claim.state === 'historical') return 'historical';
  if (claim.state === 'contradicted') return 'conflicted';
  if (claim.state === 'withdrawn') return 'withdrawn';
  return claim.quote === null ? 'missing' : 'current';
}

function claimLabel(claim: ClaimRow): string {
  const object = claim.objectText === '' ? '[withdrawn]' : claim.objectText;
  return graphText(`${claim.subject} · ${claim.predicate.replace(/_/gu, ' ')} · ${object}`);
}

function claimNodes(claim: ClaimRow): readonly GraphNode[] {
  const claimId = nodeId('claim', claim.key);
  const sourceKey = claim.source ?? `missing:${claim.key}`;
  const sourceId = nodeId('source', sourceKey);
  const evidenceId = nodeId('evidence', claim.key);
  const entityId = nodeId('entity', claim.subject);
  const evidenceMissing = claim.quote === null;
  return [
    {
      id: sourceId,
      kind: 'source',
      label: graphText(claim.source ?? 'Source not recorded'),
      state: evidenceMissing ? 'missing' : 'neutral',
      date: claim.observed || null,
      sourceRef: null,
      detail: evidenceMissing ? 'No source reference was recorded for this claim.' : null,
    },
    {
      id: evidenceId,
      kind: 'evidence',
      label: graphText(claim.quote ?? 'No quoted evidence recorded'),
      state: evidenceMissing ? 'missing' : stateOf(claim),
      date: claim.observed || null,
      sourceRef: graphText(claim.source ?? 'Source not recorded'),
      detail: evidenceMissing ? 'The graph contains the claim but no supporting span.' : 'Quoted evidence span',
    },
    {
      id: claimId,
      kind: 'claim',
      label: claimLabel(claim),
      state: stateOf(claim),
      date: claim.observed || null,
      sourceRef: graphText(claim.source ?? 'Source not recorded'),
      detail: graphText(claim.predicate.replace(/_/gu, ' ')),
    },
    {
      id: entityId,
      kind: 'entity',
      label: graphText(claim.subject),
      state: 'neutral',
      date: null,
      sourceRef: null,
      detail: 'Claim family',
    },
  ];
}

function provenanceEdges(claim: ClaimRow): readonly GraphEdge[] {
  const source = nodeId('source', claim.source ?? `missing:${claim.key}`);
  const evidence = nodeId('evidence', claim.key);
  const claimId = nodeId('claim', claim.key);
  const entity = nodeId('entity', claim.subject);
  const common = {
    date: claim.observed || null,
    sourceRef: graphText(claim.source ?? 'Source not recorded'),
    rejected: false,
    rejectionReason: null,
  } as const;
  return [
    { id: edgeId('contains', source, evidence), from: source, to: evidence, relation: 'contains', label: null, ...common },
    { id: edgeId('supports', evidence, claimId), from: evidence, to: claimId, relation: 'supports', label: 'evidence → claim', ...common },
    { id: edgeId('about', claimId, entity), from: claimId, to: entity, relation: 'about', label: graphText(claim.predicate), ...common },
  ];
}

function relationEdges(claim: ClaimRow, subjects: ReadonlyMap<string, string>): readonly GraphEdge[] {
  const target = subjects.get(claim.objectText.toLocaleLowerCase('en'));
  if (target === undefined) return [];
  const from = nodeId('entity', claim.subject);
  const to = nodeId('entity', target);
  const claimId = nodeId('claim', claim.key);
  const relation: GraphRelation = DEPENDENCY.test(claim.predicate) ? 'depends_on' : 'mentions';
  return [{
    id: edgeId(relation, from, to, claimId),
    from,
    to,
    relation,
    label: graphText(claim.predicate.replace(/_/gu, ' ')),
    date: claim.observed || null,
    sourceRef: graphText(claim.source ?? 'Source not recorded'),
    rejected: claim.state !== 'current',
    rejectionReason: claim.state === 'historical'
      ? 'historical'
      : claim.state === 'contradicted'
        ? 'contradicted'
        : claim.state === 'withdrawn'
          ? 'stale'
          : null,
  }];
}

function temporalEdges(claim: ClaimRow, group: readonly ClaimRow[]): readonly GraphEdge[] {
  const ordered = [...group].sort((a, b) => a.observed.localeCompare(b.observed) || a.key.localeCompare(b.key));
  const claimIndex = ordered.findIndex((row) => row.key === claim.key);
  if (claimIndex < 0) return [];
  if (claim.state === 'historical') {
    const newer = ordered.slice(claimIndex + 1).find((row) => row.state !== 'historical');
    if (newer === undefined) return [];
    const from = nodeId('claim', newer.key);
    const to = nodeId('claim', claim.key);
    return [{
      id: edgeId('supersedes', from, to),
      from,
      to,
      relation: 'supersedes',
      label: 'replaces',
      date: newer.observed || null,
      sourceRef: graphText(newer.source ?? 'Source not recorded'),
      rejected: false,
      rejectionReason: null,
    }];
  }
  if (claim.state !== 'contradicted') return [];
  const peer = ordered.find((row) => row.state === 'contradicted' && row.key.localeCompare(claim.key) > 0);
  if (peer === undefined) return [];
  const from = nodeId('claim', claim.key);
  const to = nodeId('claim', peer.key);
  return [{
    id: edgeId('contradicts', from, to),
    from,
    to,
    relation: 'contradicts',
    label: 'disagrees',
    date: peer.observed || claim.observed || null,
    sourceRef: graphText(peer.source ?? claim.source ?? 'Source not recorded'),
    rejected: false,
    rejectionReason: null,
  }];
}

/**
 * Build the proofable graph from the same inventory used by Memory and Health.
 * No screen-only topology is introduced here.
 */
export function graphFromInventory(
  workspaceId: string,
  inventory: Inventory,
  scope: GraphDataset['scope'] = 'workspace',
): GraphDataset {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const subjects = new Map(inventory.claims.map((claim) => [claim.subject.toLocaleLowerCase('en'), claim.subject]));
  const groups = new Map<string, ClaimRow[]>();
  for (const claim of inventory.claims) {
    const groupKey = `${claim.subject.toLocaleLowerCase('en')}\u0000${claim.predicate.toLocaleLowerCase('en')}`;
    const group = groups.get(groupKey) ?? [];
    group.push(claim);
    groups.set(groupKey, group);
    nodes.push(...claimNodes(claim));
    edges.push(...provenanceEdges(claim), ...relationEdges(claim, subjects));
  }
  for (const claim of inventory.claims) {
    const groupKey = `${claim.subject.toLocaleLowerCase('en')}\u0000${claim.predicate.toLocaleLowerCase('en')}`;
    edges.push(...temporalEdges(claim, groups.get(groupKey) ?? []));
  }
  const pack = nodeId('context_pack', inventory.seed);
  nodes.push({
    id: pack,
    kind: 'context_pack',
    label: graphText(`Context Pack · ${inventory.seed}`),
    state: 'neutral',
    date: null,
    sourceRef: null,
    detail: `${inventory.totals.claims} claims · ${inventory.totals.spans} evidence spans`,
  });
  for (const claim of inventory.claims) {
    const entity = nodeId('entity', claim.subject);
    edges.push({
      id: edgeId('connects', entity, pack),
      from: entity,
      to: pack,
      relation: 'connects',
      label: 'included in pack',
      date: claim.observed || null,
      sourceRef: null,
      rejected: false,
      rejectionReason: null,
    });
  }
  return { workspaceId, scope, nodes, edges };
}

/** Add the store's accepted and rejected impact path to an inventory graph. */
export function withImpact(dataset: GraphDataset, impact: ImpactResult): GraphDataset {
  const nodes = [...dataset.nodes];
  const edges = [...dataset.edges];
  const ensureEntity = (name: string): string => {
    const id = nodeId('entity', name);
    nodes.push({ id, kind: 'entity', label: graphText(name), state: 'neutral', date: null, sourceRef: null, detail: 'Graph impact node' });
    return id;
  };
  for (const row of impact.accepted) {
    const from = ensureEntity(row.source);
    const to = ensureEntity(row.target);
    edges.push({
      id: edgeId('impact', from, to, row.id ?? `${row.depth}`),
      from,
      to,
      relation: 'impact',
      label: graphText(`${row.predicate} · depth ${row.depth}`),
      date: null,
      sourceRef: row.context === null ? null : graphText(row.context),
      rejected: false,
      rejectionReason: null,
    });
  }
  for (const row of impact.rejected) {
    const from = ensureEntity(row.source);
    const to = ensureEntity(row.target);
    edges.push({
      id: edgeId('impact', from, to, `${row.id ?? ''}:${row.reason}`),
      from,
      to,
      relation: 'impact',
      label: graphText(row.predicate),
      date: null,
      sourceRef: row.context === null ? null : graphText(row.context),
      rejected: true,
      rejectionReason: row.reason,
    });
  }
  return { ...dataset, nodes, edges };
}

interface NormalisedGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly duplicateNodes: number;
  readonly duplicateEdges: number;
  readonly orphanEdges: number;
  readonly truncated: boolean;
}

const KIND_ORDER: Readonly<Record<GraphNodeKind, number>> = {
  source: 0,
  evidence: 1,
  claim: 2,
  entity: 3,
  context_pack: 4,
  agent: 5,
  client: 6,
};

function normalise(dataset: GraphDataset): NormalisedGraph {
  const nodeMap = new Map<string, GraphNode>();
  let duplicateNodes = 0;
  for (const node of dataset.nodes) {
    if (!ID.test(node.id)) continue;
    const safe: GraphNode = {
      ...node,
      label: graphText(node.label),
      sourceRef: node.sourceRef === null ? null : graphText(node.sourceRef),
      detail: node.detail === null ? null : graphText(node.detail),
    };
    const previous = nodeMap.get(node.id);
    if (previous !== undefined) duplicateNodes += 1;
    if (previous === undefined || JSON.stringify(safe).localeCompare(JSON.stringify(previous)) < 0) nodeMap.set(node.id, safe);
  }
  const allNodes = [...nodeMap.values()].sort((a, b) => (
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
  ));
  const truncatedNodes = allNodes.length > MAX_GRAPH_NODES;
  const nodes = allNodes.slice(0, MAX_GRAPH_NODES);
  const ids = new Set(nodes.map((node) => node.id));

  const edgeMap = new Map<string, GraphEdge>();
  let duplicateEdges = 0;
  let orphanEdges = 0;
  for (const edge of dataset.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) {
      orphanEdges += 1;
      continue;
    }
    const semantic = `${edge.from}\u0000${edge.to}\u0000${edge.relation}\u0000${edge.rejectionReason ?? ''}`;
    const safe: GraphEdge = {
      ...edge,
      id: ID.test(edge.id) ? edge.id : edgeId(edge.relation, edge.from, edge.to, edge.id),
      label: edge.label === null ? null : graphText(edge.label),
      sourceRef: edge.sourceRef === null ? null : graphText(edge.sourceRef),
    };
    const previous = edgeMap.get(semantic);
    if (previous !== undefined) duplicateEdges += 1;
    if (previous === undefined || safe.id.localeCompare(previous.id) < 0) edgeMap.set(semantic, safe);
  }
  const allEdges = [...edgeMap.values()].sort((a, b) => (
    a.from.localeCompare(b.from)
    || a.to.localeCompare(b.to)
    || a.relation.localeCompare(b.relation)
    || a.id.localeCompare(b.id)
  ));
  const truncatedEdges = allEdges.length > MAX_GRAPH_EDGES;
  return {
    nodes,
    edges: allEdges.slice(0, MAX_GRAPH_EDGES),
    duplicateNodes,
    duplicateEdges,
    orphanEdges,
    truncated: truncatedNodes || truncatedEdges,
  };
}

interface CursorPayload {
  readonly v: 1;
  readonly scope: string;
  readonly mode: GraphMode;
  readonly offset: number;
}

function cursorScope(workspaceId: string): string {
  return digest(`scope\u0000${workspaceId}`);
}

function cursorKey(key: string): Buffer {
  if (key.length < 16) throw new GraphApiError('INVALID_CURSOR_KEY', 500);
  return Buffer.from(key, 'utf8');
}

function encodeCursor(payload: CursorPayload, key: string): GraphCursor {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = createHmac('sha256', cursorKey(key)).update(body).digest('base64url');
  return `${body}.${signature}` as GraphCursor;
}

function decodeCursor(value: string, key: string): CursorPayload {
  if (value.length > 512 || !CURSOR_TEXT.test(value)) throw new GraphApiError('INVALID_CURSOR', 400);
  const [body, supplied] = value.split('.');
  if (body === undefined || supplied === undefined) throw new GraphApiError('INVALID_CURSOR', 400);
  const expected = createHmac('sha256', cursorKey(key)).update(body).digest();
  let given: Buffer;
  try {
    given = Buffer.from(supplied, 'base64url');
  } catch {
    throw new GraphApiError('INVALID_CURSOR', 400);
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new GraphApiError('INVALID_CURSOR', 400);
  }
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<CursorPayload>;
    if (parsed.v !== 1 || (parsed.mode !== 'overview' && parsed.mode !== 'proof')
      || typeof parsed.scope !== 'string' || typeof parsed.offset !== 'number'
      || !Number.isSafeInteger(parsed.offset) || parsed.offset < 0) {
      throw new GraphApiError('INVALID_CURSOR', 400);
    }
    return { v: 1, scope: parsed.scope, mode: parsed.mode, offset: parsed.offset };
  } catch (error) {
    if (error instanceof GraphApiError) throw error;
    throw new GraphApiError('INVALID_CURSOR', 400);
  }
}

function pageLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_GRAPH_PAGE_SIZE;
  if (!Number.isSafeInteger(value) || value < 1) throw new GraphApiError('INVALID_LIMIT', 422);
  if (value > MAX_GRAPH_PAGE_SIZE) throw new GraphApiError('OVERSIZE_LIMIT', 422);
  return value;
}

/** Validate tenant scope and return one deterministic, HMAC-cursored page. */
export function graphPage(dataset: GraphDataset, request: GraphPageRequest): GraphEnvelope {
  if (request.authenticatedWorkspaceId === ''
    || request.requestedWorkspaceId !== request.authenticatedWorkspaceId
    || dataset.workspaceId !== request.authenticatedWorkspaceId) {
    throw new GraphApiError('INVALID_SCOPE', 403);
  }
  // Fail closed on a misconfigured cursor secret even for a one-page graph.
  cursorKey(request.cursorKey);
  const limit = pageLimit(request.limit);
  const expectedScope = cursorScope(request.authenticatedWorkspaceId);
  const decoded = request.cursor === undefined || request.cursor === null
    ? null
    : decodeCursor(request.cursor, request.cursorKey);
  if (decoded !== null && (decoded.scope !== expectedScope || decoded.mode !== request.mode)) {
    throw new GraphApiError('INVALID_CURSOR', 400);
  }
  const graph = normalise(dataset);
  const offset = decoded?.offset ?? 0;
  if (offset > graph.nodes.length) throw new GraphApiError('INVALID_CURSOR', 400);
  const nodes = graph.nodes.slice(offset, offset + limit);
  const pageIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => pageIds.has(edge.from) || pageIds.has(edge.to))
    .slice(0, MAX_GRAPH_EDGES_PER_PAGE);
  const nextOffset = offset + nodes.length;
  const nextCursor = nextOffset < graph.nodes.length
    ? encodeCursor({ v: 1, scope: expectedScope, mode: request.mode, offset: nextOffset }, request.cursorKey)
    : null;

  return {
    schema: GRAPH_SCHEMA,
    mode: request.mode,
    scope: dataset.scope,
    nodes,
    edges,
    page: {
      limit,
      returnedNodes: nodes.length,
      returnedEdges: edges.length,
      totalNodes: graph.nodes.length,
      totalEdges: graph.edges.length,
      nextCursor,
      truncated: graph.truncated,
    },
    diagnostics: {
      duplicateNodes: graph.duplicateNodes,
      duplicateEdges: graph.duplicateEdges,
      orphanEdges: graph.orphanEdges,
    },
  };
}
