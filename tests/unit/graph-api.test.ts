import { describe, expect, it } from 'vitest';

import {
  GraphApiError,
  MAX_GRAPH_NODES,
  MAX_GRAPH_PAGE_SIZE,
  graphFromInventory,
  graphFromSource,
  graphPage,
  type GraphDataset,
  type GraphEdge,
  type GraphNode,
} from '../../src/api/graph.js';
import type { Inventory } from '../../src/report/inventory.js';
import type { HydraSource } from '../../src/hydra/source.js';
import { overviewLayout, proofLayout } from '../../web/src/graph/layout.js';

const KEY = 'unit-test-only-graph-cursor-key';
const WORKSPACE = 'workspace-a';

function id(kind: string, n: number): string {
  return `${kind}:${n.toString(16).padStart(20, '0')}`;
}

function node(n: number, label = `Node ${n}`): GraphNode {
  return {
    id: id('claim', n),
    kind: 'claim',
    label,
    state: 'current',
    date: '2026-08-20',
    sourceRef: 'Session one',
    detail: null,
  };
}

function edge(n: number, from: number, to: number, rejected = false): GraphEdge {
  return {
    id: id('edge', n),
    from: id('claim', from),
    to: id('claim', to),
    relation: 'depends_on',
    label: 'depends on',
    date: '2026-08-20',
    sourceRef: 'Session one',
    rejected,
    rejectionReason: rejected ? 'non_event' : null,
  };
}

function dataset(nodes: readonly GraphNode[], edges: readonly GraphEdge[] = []): GraphDataset {
  return { workspaceId: WORKSPACE, scope: 'workspace', nodes, edges };
}

function page(graph: GraphDataset, options: { cursor?: string; limit?: number; mode?: 'overview' | 'proof'; workspace?: string } = {}) {
  return graphPage(graph, {
    authenticatedWorkspaceId: options.workspace ?? WORKSPACE,
    requestedWorkspaceId: options.workspace ?? WORKSPACE,
    mode: options.mode ?? 'proof',
    cursor: options.cursor ?? null,
    limit: options.limit ?? 80,
    cursorKey: KEY,
  });
}

describe('graph API envelope', () => {
  it('paginates with an opaque scoped cursor and stable page counts', () => {
    const graph = dataset([node(3), node(1), node(2)]);
    const first = page(graph, { limit: 2 });
    expect(first.nodes.map((row) => row.label)).toEqual(['Node 1', 'Node 2']);
    expect(first.page).toMatchObject({ returnedNodes: 2, totalNodes: 3, limit: 2 });
    expect(first.page.nextCursor).toEqual(expect.any(String));
    expect(first.page.nextCursor).not.toContain(WORKSPACE);

    const second = page(graph, { limit: 2, cursor: first.page.nextCursor! });
    expect(second.nodes.map((row) => row.label)).toEqual(['Node 3']);
    expect(second.page.nextCursor).toBeNull();
  });

  it('rejects a malformed or tampered cursor', () => {
    expect(() => page(dataset([node(1)]), { cursor: 'not-a-cursor' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }));

    const cursor = page(dataset([node(1), node(2)]), { limit: 1 }).page.nextCursor!;
    const tampered = `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}`;
    expect(() => page(dataset([node(1), node(2)]), { limit: 1, cursor: tampered }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }));
  });

  it('rejects a cursor replayed into another mode', () => {
    const graph = dataset([node(1), node(2)]);
    const cursor = page(graph, { limit: 1, mode: 'overview' }).page.nextCursor!;
    expect(() => page(graph, { limit: 1, mode: 'proof', cursor }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR' }));
  });

  it('refuses oversize and nonsensical limits', () => {
    expect(() => page(dataset([]), { limit: MAX_GRAPH_PAGE_SIZE + 1 }))
      .toThrowError(expect.objectContaining({ code: 'OVERSIZE_LIMIT', status: 422 }));
    expect(() => page(dataset([]), { limit: 0 }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_LIMIT', status: 422 }));
  });

  it('guards the authenticated, requested and dataset workspaces independently', () => {
    const graph = dataset([node(1)]);
    expect(() => graphPage(graph, {
      authenticatedWorkspaceId: WORKSPACE,
      requestedWorkspaceId: 'workspace-b',
      mode: 'proof',
      cursorKey: KEY,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_SCOPE', status: 403 }));

    expect(() => page({ ...graph, workspaceId: 'workspace-b' }))
      .toThrowError(expect.objectContaining({ code: 'INVALID_SCOPE', status: 403 }));
  });

  it('rejects an otherwise valid cursor replayed into another workspace', () => {
    const cursor = page(dataset([node(1), node(2)]), { limit: 1 }).page.nextCursor!;
    expect(() => graphPage({ ...dataset([node(1), node(2)]), workspaceId: 'workspace-b' }, {
      authenticatedWorkspaceId: 'workspace-b',
      requestedWorkspaceId: 'workspace-b',
      mode: 'proof',
      limit: 1,
      cursor,
      cursorKey: KEY,
    })).toThrowError(expect.objectContaining({ code: 'INVALID_CURSOR', status: 400 }));
  });

  it('orders nodes and edges identically across shuffled inputs', () => {
    const nodes = [node(3), node(1), node(2)];
    const edges = [edge(2, 2, 3), edge(1, 1, 2)];
    const a = page(dataset(nodes, edges));
    const b = page(dataset([...nodes].reverse(), [...edges].reverse()));
    expect(a.nodes).toEqual(b.nodes);
    expect(a.edges).toEqual(b.edges);
  });

  it('keeps a connected provenance path on the first bounded proof page', () => {
    const source = { ...node(10, 'Session one'), id: id('source', 10), kind: 'source' as const };
    const evidence = { ...node(11, 'Quoted evidence'), id: id('evidence', 11), kind: 'evidence' as const };
    const claim = { ...node(12, 'Atlas · owner · Dana'), id: id('claim', 12), kind: 'claim' as const };
    const entity = { ...node(13, 'Atlas'), id: id('entity', 13), kind: 'entity' as const };
    const distractors = Array.from({ length: 12 }, (_, index) => ({
      ...node(100 + index, `Earlier evidence ${index}`),
      id: id('evidence', 100 + index),
      kind: 'evidence' as const,
    }));
    const edges: GraphEdge[] = [
      { ...edge(20, 1, 2), from: source.id, to: evidence.id, relation: 'contains' },
      { ...edge(21, 1, 2), from: evidence.id, to: claim.id, relation: 'supports' },
      { ...edge(22, 1, 2), from: claim.id, to: entity.id, relation: 'about' },
    ];

    const result = page(dataset([...distractors, source, evidence, claim, entity], edges), { limit: 4, mode: 'proof' });
    expect(result.nodes.map((row) => row.kind)).toEqual(['source', 'evidence', 'claim', 'entity']);
    expect(result.edges).toHaveLength(3);
  });

  it('keeps rejected stale and non-event edges visible', () => {
    const result = page(dataset([node(1), node(2)], [edge(1, 1, 2, true)]));
    expect(result.edges).toEqual([
      expect.objectContaining({ rejected: true, rejectionReason: 'non_event', relation: 'depends_on' }),
    ]);
  });

  it('deduplicates semantic edges and reports orphan edges instead of drawing them', () => {
    const duplicate = { ...edge(1, 1, 2), id: id('edge', 2) };
    const orphan = edge(3, 2, 99);
    const result = page(dataset([node(1), node(2)], [edge(1, 1, 2), duplicate, orphan]));
    expect(result.edges).toHaveLength(1);
    expect(result.diagnostics).toMatchObject({ duplicateEdges: 1, orphanEdges: 1 });
  });

  it('caps a ten-thousand-node response before it can reach a renderer', () => {
    const huge = Array.from({ length: 10_000 }, (_, index) => node(index));
    const result = page(dataset(huge), { limit: MAX_GRAPH_PAGE_SIZE });
    expect(result.nodes).toHaveLength(MAX_GRAPH_PAGE_SIZE);
    expect(result.page.totalNodes).toBe(MAX_GRAPH_NODES);
    expect(result.page.truncated).toBe(true);
  });

  it('bounds markup-shaped labels, removes controls and redacts email addresses', () => {
    const malicious = `<script>alert(1)</script>\u0000 person@example.com ${'x'.repeat(1_000)}`;
    const result = page(dataset([node(1, malicious)]));
    expect(result.nodes[0]?.label).not.toContain('\u0000');
    expect(result.nodes[0]?.label).not.toContain('person@example.com');
    expect(result.nodes[0]?.label).toContain('[redacted email]');
    expect(result.nodes[0]?.label.length).toBeLessThanOrEqual(320);
  });

  it('reports a short cursor key as a server configuration error', () => {
    expect(() => graphPage(dataset([node(1), node(2)]), {
      authenticatedWorkspaceId: WORKSPACE,
      requestedWorkspaceId: WORKSPACE,
      mode: 'proof',
      limit: 1,
      cursorKey: 'short',
    })).toThrowError(GraphApiError);
  });
});

describe('inventory graph', () => {
  const inventory: Inventory = {
    seed: 'demo-seed',
    claims: [
      {
        key: 'claim-old',
        subject: 'Atlas',
        predicate: 'depends_on',
        objectText: 'Borealis',
        state: 'historical',
        source: 'Session one',
        observed: '2026-08-18T00:00:00.000Z',
        quote: 'Atlas depended on Borealis.',
      },
      {
        key: 'claim-new',
        subject: 'Atlas',
        predicate: 'depends_on',
        objectText: 'Cirrus',
        state: 'current',
        source: 'Session two',
        observed: '2026-08-19T00:00:00.000Z',
        quote: 'Atlas now depends on Cirrus.',
      },
      {
        key: 'claim-missing',
        subject: 'Borealis',
        predicate: 'owner',
        objectText: 'Unknown',
        state: 'current',
        source: null,
        observed: '2026-08-20T00:00:00.000Z',
        quote: null,
      },
      {
        key: 'claim-mention',
        subject: 'Atlas',
        predicate: 'vendor',
        objectText: 'Borealis',
        state: 'current',
        source: 'Session two',
        observed: '2026-08-19T01:00:00.000Z',
        quote: 'Borealis is the vendor for Atlas.',
      },
      {
        key: 'claim-conflict-a',
        subject: 'Cirrus',
        predicate: 'owner',
        objectText: 'Alice',
        state: 'contradicted',
        source: 'Session three',
        observed: '2026-08-20T01:00:00.000Z',
        quote: 'Alice owns Cirrus.',
      },
      {
        key: 'claim-conflict-b',
        subject: 'Cirrus',
        predicate: 'owner',
        objectText: 'Bob',
        state: 'contradicted',
        source: 'Session four',
        observed: '2026-08-20T02:00:00.000Z',
        quote: 'Bob owns Cirrus.',
      },
    ],
    states: [],
    structural: {
      claimsWithoutEvidence: 1,
      entitiesWithoutClaims: 0,
      claimsNamingAnEntity: 1,
      supersedesEdges: 1,
      contradictsEdges: 0,
    },
    totals: { sessions: 4, messages: 5, spans: 5, claims: 6, entities: 3, vertices: 23, edges: 25 },
  };

  it('derives evidence to claim, source/date, supersession, mentions and missing states', () => {
    const result = page(graphFromInventory(WORKSPACE, inventory));
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'evidence', label: 'Atlas now depends on Cirrus.', date: '2026-08-19T00:00:00.000Z' }),
      expect.objectContaining({ kind: 'evidence', state: 'missing', label: 'No quoted evidence recorded' }),
      expect.objectContaining({ kind: 'claim', state: 'conflicted', label: 'Cirrus · owner · Alice' }),
      expect.objectContaining({ kind: 'context_pack', label: 'Context Pack · demo-seed' }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'supports', label: 'evidence → claim' }),
      expect.objectContaining({ relation: 'supersedes' }),
      expect.objectContaining({ relation: 'contradicts' }),
      expect.objectContaining({ relation: 'mentions' }),
      expect.objectContaining({ relation: 'depends_on', rejected: true, rejectionReason: 'historical' }),
    ]));
  });
});

describe('scoped HydraSource graph', () => {
  it('reads exact evidence, mentions and supersession through the canonical source seam', async () => {
    const claims = [
      { id: 1, predicate: 'depends_on', objectText: 'Borealis', polarity: 'positive' as const, validFrom: '2026-08-18T00:00:00.000Z', txTime: '2026-08-18T00:00:00.000Z', supersededBy: [2] },
      { id: 2, predicate: 'depends_on', objectText: 'Cirrus', polarity: 'positive' as const, validFrom: '2026-08-19T00:00:00.000Z', txTime: '2026-08-19T00:00:00.000Z', supersededBy: [] },
    ];
    const source: HydraSource = {
      kind: 'cloud',
      subjects: async () => ({ value: ['Atlas', 'Borealis', 'Cirrus'], traces: [] }),
      entity: async () => ({ value: null, traces: [] }),
      subject: async (name) => ({
        value: name === 'Atlas'
          ? {
            name,
            id: 10,
            kind: 'service',
            claims,
            mentions: [
              { claimId: 1, predicate: 'depends_on', entityId: 20, entityName: 'Borealis' },
              { claimId: 2, predicate: 'depends_on', entityId: 30, entityName: 'Cirrus' },
            ],
          }
          : { name, id: name === 'Borealis' ? 20 : 30, kind: 'service', claims: [], mentions: [] },
        traces: [],
      }),
      evidence: async (claimId) => ({
        value: [{
          claimId,
          spanId: claimId + 100,
          quote: claimId === 1 ? 'Atlas depended on Borealis.' : 'Atlas now depends on Cirrus.',
          start: 0,
          end: 30,
          messageId: claimId + 200,
          role: 'user',
          ts: claimId === 1 ? '2026-08-18T00:00:00.000Z' : '2026-08-19T00:00:00.000Z',
          sessionId: claimId + 300,
          sessionTitle: claimId === 1 ? 'Original decision' : 'Correction',
        }],
        traces: [],
      }),
      dependents: async () => ({ value: [], traces: [] }),
    };

    const result = page(await graphFromSource(WORKSPACE, source, 1_000));
    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'evidence', label: 'Atlas depended on Borealis.', sourceRef: 'Original decision' }),
      expect.objectContaining({ kind: 'claim', state: 'historical' }),
      expect.objectContaining({ kind: 'context_pack', label: 'Context Pack' }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ relation: 'supports', sourceRef: 'Original decision' }),
      expect.objectContaining({ relation: 'supersedes' }),
      expect.objectContaining({ relation: 'mentions', rejected: true, rejectionReason: 'historical' }),
      expect.objectContaining({ relation: 'depends_on', rejected: false }),
    ]));
  });
});

describe('deterministic graph layouts', () => {
  it('places the overview identically regardless of response order', () => {
    const nodes = [node(3), node(1), { ...node(2), state: 'historical' as const }];
    expect(overviewLayout(nodes)).toEqual(overviewLayout([...nodes].reverse()));
  });

  it('keeps proof layers deterministic for cycles, duplicate edges and orphan references', () => {
    const nodes: GraphNode[] = [
      { ...node(1), kind: 'evidence' },
      { ...node(4), kind: 'evidence' },
      node(2),
      { ...node(3), kind: 'entity' },
    ];
    const edges: GraphEdge[] = [
      { ...edge(1, 1, 2), relation: 'supports' },
      edge(2, 2, 3),
      edge(3, 3, 2),
      { ...edge(2, 2, 3), id: id('edge', 4) },
      edge(5, 3, 99),
    ];
    const layout = proofLayout(nodes, edges);
    const shuffled = proofLayout([...nodes].reverse(), [...edges].reverse());
    expect(layout).toEqual(shuffled);
    expect(layout.edges).toHaveLength(3);
    expect(layout.nodes.map((row) => row.layer)).toEqual([1, 1, 2, 3]);
    const firstYByLayer = new Map<number, number>();
    for (const placed of layout.nodes) {
      if (!firstYByLayer.has(placed.layer)) firstYByLayer.set(placed.layer, placed.y);
    }
    expect([...firstYByLayer.values()]).toEqual([68, 68, 68]);
  });
});
