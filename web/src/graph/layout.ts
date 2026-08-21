import type { GraphEdge, GraphNode, PlacedGraphNode } from './types';

export const MAX_RENDER_NODES = 180;
export const MAX_RENDER_EDGES = 720;

const STATE_ORDER: Readonly<Record<GraphNode['state'], number>> = {
  missing: 0,
  current: 1,
  conflicted: 2,
  withdrawn: 3,
  neutral: 4,
  historical: 5,
};

const KIND_ORDER: Readonly<Record<GraphNode['kind'], number>> = {
  evidence: 0,
  claim: 1,
  entity: 2,
  source: 3,
  context_pack: 4,
  agent: 5,
  client: 6,
};

export function stableNodes(nodes: readonly GraphNode[]): readonly GraphNode[] {
  const seen = new Map<string, GraphNode>();
  for (const node of nodes) if (!seen.has(node.id)) seen.set(node.id, node);
  return [...seen.values()].sort((a, b) => (
    STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
  )).slice(0, MAX_RENDER_NODES);
}

/**
 * Lacuna's open spiral. Position communicates state bands and nothing about
 * edge direction or causality. The proof graph uses a separate layout.
 */
export function overviewLayout(
  input: readonly GraphNode[],
  width = 1_000,
  height = 620,
): readonly PlacedGraphNode[] {
  const nodes = stableNodes(input);
  const centreX = width / 2;
  const centreY = height / 2;
  const counts = new Map<GraphNode['state'], number>();
  return nodes.map((node) => {
    const index = counts.get(node.state) ?? 0;
    counts.set(node.state, index + 1);
    const peers = nodes.filter((candidate) => candidate.state === node.state).length;
    const progress = peers <= 1 ? 0.5 : index / (peers - 1);
    const band = node.state === 'missing' ? 68
      : node.state === 'current' ? 130
        : node.state === 'conflicted' ? 185
          : node.state === 'withdrawn' ? 215
            : node.state === 'historical' ? 270
              : 235;
    // 1.58 turns with an intentional gap at the right-hand edge.
    const angle = -2.35 + progress * Math.PI * 3.16 + STATE_ORDER[node.state] * 0.31;
    const branch = node.state === 'conflicted' ? (index % 2 === 0 ? -20 : 20) : 0;
    const kindDrift = (KIND_ORDER[node.kind] % 3) * 8;
    const radius = band + (progress - 0.5) * 42 + kindDrift + branch;
    return {
      ...node,
      x: Number((centreX + Math.cos(angle) * radius).toFixed(3)),
      y: Number((centreY + Math.sin(angle) * radius * 0.82).toFixed(3)),
      layer: STATE_ORDER[node.state],
    };
  });
}

export interface OverviewCamera3D {
  readonly yaw: number;
  readonly pitch: number;
}

export interface ProjectedGraphNode extends PlacedGraphNode {
  /** Stable semantic depth before camera rotation. */
  readonly z: number;
  readonly screenX: number;
  readonly screenY: number;
  /** Perspective scale. Values are clamped so labels remain usable. */
  readonly scale: number;
  /** Rotated depth, used for back-to-front painting. */
  readonly cameraZ: number;
}

function stableDepth(id: string): number {
  // FNV-1a keeps the same node at the same depth across filters and sessions.
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % 241) - 120;
}

/**
 * Project the state-shaped overview into a deterministic perspective field.
 *
 * The third axis is navigational, not invented evidence: the source graph still
 * owns every line and the proof layout still owns causality. Depth simply lets
 * a dense loaded page be rotated and inspected without flattening every mark
 * into the same plane.
 */
export function projectOverview3D(
  nodes: readonly PlacedGraphNode[],
  camera: OverviewCamera3D,
  width = 1_000,
  height = 620,
): readonly ProjectedGraphNode[] {
  const centreX = width / 2;
  const centreY = height / 2;
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  return nodes.map((node) => {
    const x = node.x - centreX;
    const y = node.y - centreY;
    const z = stableDepth(node.id) + (node.layer - 2.5) * 18;
    const yawX = x * cosYaw + z * sinYaw;
    const yawZ = -x * sinYaw + z * cosYaw;
    const pitchY = y * cosPitch - yawZ * sinPitch;
    const cameraZ = y * sinPitch + yawZ * cosPitch;
    const perspective = 760 / Math.max(470, 760 + cameraZ);
    return {
      ...node,
      z: Number(z.toFixed(3)),
      screenX: Number((centreX + yawX * perspective).toFixed(3)),
      screenY: Number((centreY + pitchY * perspective).toFixed(3)),
      scale: Number(Math.max(0.62, Math.min(1.42, perspective)).toFixed(4)),
      cameraZ: Number(cameraZ.toFixed(3)),
    };
  });
}

const PROOF_LAYER: Readonly<Record<GraphNode['kind'], number>> = {
  source: 0,
  evidence: 1,
  claim: 2,
  entity: 3,
  context_pack: 4,
  agent: 5,
  client: 5,
};

export interface ProofLayout {
  readonly nodes: readonly PlacedGraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly width: number;
  readonly height: number;
}

/** Fixed layers remain stable even when input edges contain cycles. */
export function proofLayout(input: readonly GraphNode[], inputEdges: readonly GraphEdge[]): ProofLayout {
  const nodes = [...stableNodes(input)].sort((a, b) => (
    PROOF_LAYER[a.kind] - PROOF_LAYER[b.kind]
    || STATE_ORDER[a.state] - STATE_ORDER[b.state]
    || a.label.localeCompare(b.label)
    || a.id.localeCompare(b.id)
  ));
  const byLayer = new Map<number, GraphNode[]>();
  for (const node of nodes) {
    const layer = PROOF_LAYER[node.kind];
    const peers = byLayer.get(layer) ?? [];
    peers.push(node);
    byLayer.set(layer, peers);
  }
  const rows = Math.max(1, ...[...byLayer.values()].map((peers) => peers.length));
  const height = Math.max(420, 112 + rows * 86);
  const width = 1_330;
  const placed: PlacedGraphNode[] = [];
  for (const [layer, peers] of [...byLayer.entries()].sort(([a], [b]) => a - b)) {
    // Start every provenance layer at the same readable baseline. Centering a
    // sparse source or entity column against a dense claim column pushed the
    // first source below the viewport, so the screen labelled SOURCE showed
    // an empty column until the user scrolled thousands of pixels.
    const top = 68;
    peers.forEach((node, row) => placed.push({
      ...node,
      x: 38 + layer * 216,
      y: top + row * 86,
      layer,
    }));
  }
  const ids = new Set(placed.map((node) => node.id));
  const seen = new Set<string>();
  const edges = [...inputEdges]
    .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
    .sort((a, b) => (
      a.from.localeCompare(b.from)
      || a.to.localeCompare(b.to)
      || a.relation.localeCompare(b.relation)
      || a.id.localeCompare(b.id)
    ))
    .filter((edge) => {
      const semantic = `${edge.from}\u0000${edge.to}\u0000${edge.relation}\u0000${edge.rejectionReason ?? ''}`;
      if (seen.has(semantic)) return false;
      seen.add(semantic);
      return true;
    })
    .slice(0, MAX_RENDER_EDGES);
  return { nodes: placed, edges, width, height };
}
