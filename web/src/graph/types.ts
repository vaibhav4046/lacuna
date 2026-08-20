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
  readonly date: string | null;
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
  readonly rejected: boolean;
  readonly rejectionReason: GraphRejection | null;
}

export interface GraphEnvelope {
  readonly schema: 'lacuna.graph.v1';
  readonly mode: GraphMode;
  readonly scope: 'workspace' | 'public';
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly page: {
    readonly limit: number;
    readonly returnedNodes: number;
    readonly returnedEdges: number;
    readonly totalNodes: number;
    readonly totalEdges: number;
    readonly nextCursor: string | null;
    readonly truncated: boolean;
  };
  readonly diagnostics: {
    readonly duplicateNodes: number;
    readonly duplicateEdges: number;
    readonly orphanEdges: number;
  };
}

export interface GraphPoint {
  readonly x: number;
  readonly y: number;
}

export interface PlacedGraphNode extends GraphNode {
  readonly x: number;
  readonly y: number;
  readonly layer: number;
}

export const STATE_LABEL: Readonly<Record<GraphNodeState, string>> = {
  current: 'Current',
  historical: 'Historical',
  conflicted: 'Conflicted',
  missing: 'Missing evidence',
  withdrawn: 'Withdrawn',
  neutral: 'Structural',
};

export const STATE_COLOUR: Readonly<Record<GraphNodeState, string>> = {
  current: '#8A64FF',
  historical: '#626273',
  conflicted: '#FFB829',
  missing: '#D5D0E8',
  withdrawn: '#4D857A',
  neutral: '#8D8A99',
};

