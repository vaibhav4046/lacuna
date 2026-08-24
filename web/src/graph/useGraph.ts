import { useCallback, useEffect, useMemo, useState } from 'react';

import { getJson, useLoaded, type Loaded } from '../api/client';
import { useScope } from '../api/scope';
import { useSession } from '../api/session';
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
  const { loaded: session } = useSession();
  /**
   * The session binding, because `useLoaded` deliberately refuses to fetch a
   * workspace path without one.
   *
   * That refusal is right: a workspace read sent before the binding exists is
   * a guaranteed 401. But this hook never passed the binding at all, so on
   * every signed-in visit the guard held forever and the Graph screen showed
   * RETRIEVING MEMORY FIELD until the reader gave up. The endpoint was fine --
   * answered in under two seconds when asked by hand -- and the public
   * `/explore` scope worked, which is exactly why the break survived: every
   * audit sweeps the public routes.
   */
  const sessionBinding = session.state === 'ready' && session.value.signedIn
    ? session.value.session.binding
    : undefined;
  const path = `${scope.base}/graph?mode=${mode}&limit=${limit}`;
  const first = useLoaded<GraphEnvelope>(path, sessionBinding);
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
    getJson<GraphEnvelope>(`${scope.base}/graph?mode=${mode}&limit=${limit}&cursor=${cursor}`, control.signal, sessionBinding).then(
      (next) => setRest((current) => [...current, next]),
      () => setMoreFailed(true),
    ).finally(() => setLoadingMore(false));
  }, [limit, loaded, loadingMore, mode, scope.base, sessionBinding]);

  return { loaded, loadingMore, moreFailed, loadMore };
}
