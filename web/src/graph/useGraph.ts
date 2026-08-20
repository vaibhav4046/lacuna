import { useCallback, useEffect, useMemo, useState } from 'react';

import { getJson, useLoaded, type Loaded } from '../api/client';
import { useScope } from '../api/scope';
import type { GraphEdge, GraphEnvelope, GraphMode, GraphNode } from './types';

interface GraphLoad {
  readonly loaded: Loaded<GraphEnvelope>;
  readonly loadingMore: boolean;
  readonly moreFailed: boolean;
  readonly loadMore: () => void;
}

function merge(first: GraphEnvelope, rest: readonly GraphEnvelope[]): GraphEnvelope {
  const pages = [first, ...rest];
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  for (const page of pages) {
    for (const node of page.nodes) nodes.set(node.id, node);
    for (const edge of page.edges) edges.set(edge.id, edge);
  }
  const last = pages[pages.length - 1] ?? first;
  return {
    ...first,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    page: {
      ...last.page,
      returnedNodes: nodes.size,
      returnedEdges: edges.size,
      totalNodes: first.page.totalNodes,
      totalEdges: first.page.totalEdges,
      truncated: pages.some((page) => page.page.truncated),
    },
    diagnostics: {
      duplicateNodes: Math.max(...pages.map((page) => page.diagnostics.duplicateNodes)),
      duplicateEdges: Math.max(...pages.map((page) => page.diagnostics.duplicateEdges)),
      orphanEdges: Math.max(...pages.map((page) => page.diagnostics.orphanEdges)),
    },
  };
}

/** Fetch the first bounded page, then append cursor pages only on request. */
export function useGraph(mode: GraphMode, limit = 120): GraphLoad {
  const scope = useScope();
  const path = `${scope.base}/graph?mode=${mode}&limit=${limit}`;
  const first = useLoaded<GraphEnvelope>(path);
  const [rest, setRest] = useState<readonly GraphEnvelope[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  useEffect(() => {
    setRest([]);
    setLoadingMore(false);
    setMoreFailed(false);
  }, [path]);

  const loaded = useMemo<Loaded<GraphEnvelope>>(() => {
    if (first.state !== 'ready') return first;
    return { state: 'ready', value: merge(first.value, rest) };
  }, [first, rest]);

  const loadMore = useCallback(() => {
    if (loaded.state !== 'ready' || loaded.value.page.nextCursor === null || loadingMore) return;
    const control = new AbortController();
    const cursor = encodeURIComponent(loaded.value.page.nextCursor);
    setLoadingMore(true);
    setMoreFailed(false);
    getJson<GraphEnvelope>(`${scope.base}/graph?mode=${mode}&limit=${limit}&cursor=${cursor}`, control.signal).then(
      (next) => setRest((current) => [...current, next]),
      () => setMoreFailed(true),
    ).finally(() => setLoadingMore(false));
  }, [limit, loaded, loadingMore, mode, scope.base]);

  return { loaded, loadingMore, moreFailed, loadMore };
}
