import type { HydraClient } from '../hydra/client.js';
import {
  decodeDependents,
  decodeEntity,
  decodeEvidence,
  type DependentEdge,
  type EntityHead,
} from './decode.js';
import { DEFAULT_QUERY_TIMEOUT_MS, QueryRecorder, round, type AskOptions } from './fetch.js';
import { dependentsOf, entityByName, evidenceForClaim } from './queries.js';
import type { EvidenceRecord, QueryTrace } from './types.js';

/**
 * The blast radius: change one package, and find every service that could feel
 * it, by walking the dependency claims the graph actually holds.
 *
 * The split mirrors ask(). `blastRadius` gathers, level by level, and
 * `computeBlast` decides, purely, from what was gathered. The walk exists in
 * one place: the fetch loop follows exactly the edges `liveDependencyEdges`
 * admits, and the pure pass re-derives its verdict through the same filter, so
 * the two cannot disagree the way two separately written walks could. That is
 * the same reason `selectHopTarget` is shared between fetch and resolve.
 *
 * Nothing in here knows what the answer should be. The affected set is
 * whatever the traversal reaches, and every step of every path carries the
 * claim id it walked through, so each hop can be cited back to a quotation.
 */

/**
 * Depth cap on the walk. The deepest chain the corpus builds is three hops;
 * six is past anything real, and a bound is what keeps a cycle written by a
 * future ingest from turning this read into one that never returns.
 */
export const MAX_BLAST_DEPTH = 6;

/** One hop of a path: the claim followed, and the entity it landed on. */
export interface BlastStep {
  readonly claimId: number;
  readonly entityId: number;
  readonly entityName: string;
  readonly entityKind: string | null;
}

export interface AffectedService {
  readonly entityId: number;
  readonly entityName: string;
  /** How many dependency hops separate this service from the changed package. */
  readonly depth: number;
  /** From the changed package outward, nearest hop first. Ends on this service. */
  readonly path: readonly BlastStep[];
}

export interface BlastRadius {
  /** Alphabetical, which is also the canonical serialisation order. */
  readonly affected: readonly AffectedService[];
  /** Packages the walk passed through on the way, root excluded. */
  readonly packagesTouched: readonly string[];
  /** Superseded or withdrawn dependency claims the walk refused to follow. */
  readonly ignored: number;
  readonly trace: readonly string[];
}

export interface BlastAnswer {
  readonly packageName: string;
  /** null is the out of scope case: the name has no node. */
  readonly root: EntityHead | null;
  readonly radius: BlastRadius | null;
  readonly evidence: readonly EvidenceRecord[];
  readonly queries: readonly QueryTrace[];
  readonly ms: number;
}

/**
 * The one definition of a followable edge. A dependency that was revised away
 * is history, a withdrawal is an absence, and anything that is not a
 * `depends_on` claim is a different relation wearing the same shape.
 */
export function liveDependencyEdges(
  edges: readonly DependentEdge[],
): readonly DependentEdge[] {
  return edges.filter(
    (edge) =>
      edge.predicate === 'depends_on'
      && edge.polarity === 'positive'
      && edge.supersededBy.length === 0,
  );
}

/**
 * Pure. Breadth-first over an adjacency map someone else fetched, so the unit
 * suite can hand it graphs that never touched a node. First discovery is the
 * shortest path, because the frontier advances one depth at a time, and the
 * decoder's claim-id ordering makes ties deterministic.
 */
export function computeBlast(
  root: { readonly id: number; readonly name: string },
  adjacency: ReadonlyMap<number, readonly DependentEdge[]>,
): BlastRadius {
  interface Arrival {
    readonly edge: DependentEdge;
    readonly parent: number;
    readonly depth: number;
  }

  const arrivals = new Map<number, Arrival>();
  const seen = new Set<number>([root.id]);
  const trace: string[] = [];
  let frontier: readonly number[] = [root.id];
  let ignored = 0;

  for (let depth = 1; depth <= MAX_BLAST_DEPTH && frontier.length > 0; depth += 1) {
    const next: number[] = [];
    let followed = 0;
    for (const id of frontier) {
      const edges = adjacency.get(id) ?? [];
      const dependency = edges.filter((edge) => edge.predicate === 'depends_on');
      const live = liveDependencyEdges(dependency);
      ignored += dependency.length - live.length;
      for (const edge of live) {
        followed += 1;
        if (!seen.has(edge.entityId)) {
          seen.add(edge.entityId);
          arrivals.set(edge.entityId, { edge, parent: id, depth });
          next.push(edge.entityId);
        }
      }
    }
    if (followed > 0) {
      trace.push(
        `Depth ${depth}: followed ${followed} live "depends_on" `
        + `claim${followed === 1 ? '' : 's'} and reached ${next.length} new `
        + `entit${next.length === 1 ? 'y' : 'ies'}.`,
      );
    }
    frontier = next;
  }

  const affected: AffectedService[] = [];
  const packagesTouched: string[] = [];
  for (const [entityId, arrival] of arrivals) {
    if (arrival.edge.entityKind === 'service') {
      affected.push({
        entityId,
        entityName: arrival.edge.entityName,
        depth: arrival.depth,
        path: pathTo(entityId, root.id, arrivals),
      });
    } else {
      packagesTouched.push(arrival.edge.entityName);
    }
  }
  affected.sort((a, b) => (a.entityName < b.entityName ? -1 : 1));
  packagesTouched.sort();

  if (ignored > 0) {
    trace.push(
      `Ignored ${ignored} dependency claim${ignored === 1 ? '' : 's'} that `
      + `${ignored === 1 ? 'is' : 'are'} superseded or withdrawn.`,
    );
  }
  trace.push(
    affected.length === 0
      ? `Nothing that reaches a service depends on "${root.name}".`
      : `${affected.length} service${affected.length === 1 ? '' : 's'} affected, `
        + `through ${packagesTouched.length} intermediate `
        + `package${packagesTouched.length === 1 ? '' : 's'}.`,
  );

  return { affected, packagesTouched, ignored, trace };

  function pathTo(
    entityId: number,
    rootId: number,
    parents: ReadonlyMap<number, Arrival>,
  ): readonly BlastStep[] {
    const steps: BlastStep[] = [];
    let at = entityId;
    while (at !== rootId) {
      const arrival = parents.get(at);
      if (arrival === undefined) {
        // Unreachable by construction: every arrival's parent is either the
        // root or an earlier arrival. Throwing beats returning a partial path
        // that would render as a route the walk never took.
        throw new Error(`entity ${at} has no recorded arrival`);
      }
      steps.push({
        claimId: arrival.edge.claimId,
        entityId: arrival.edge.entityId,
        entityName: arrival.edge.entityName,
        entityKind: arrival.edge.entityKind,
      });
      at = arrival.parent;
    }
    return steps.reverse();
  }
}

/** The canonical serialisation the benchmark compares. Names, sorted, one comma. */
export function affectedText(radius: BlastRadius): string {
  return radius.affected.map((service) => service.entityName).join(', ');
}

/**
 * Fetches the neighbourhood a blast needs and nothing more: one `dependentsOf`
 * per reached entity, issued a whole frontier at a time, so the wall clock cost
 * of a level is one round trip rather than one per node. An unknown name costs
 * exactly one query, same as ask().
 *
 * Evidence is fetched for every claim on every affected path, because a blast
 * radius that cannot quote the conversations behind each hop is a diagram, not
 * an answer.
 */
export async function blastRadius(
  client: HydraClient,
  packageName: string,
  options: AskOptions = {},
): Promise<BlastAnswer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const counter = new QueryRecorder();
  const started = performance.now();

  const root = decodeEntity(await counter.run(client, entityByName(packageName), timeoutMs));
  if (root === null) {
    return {
      packageName,
      root: null,
      radius: null,
      evidence: [],
      queries: counter.trips,
      ms: round(performance.now() - started),
    };
  }

  const adjacency = new Map<number, readonly DependentEdge[]>();
  const seen = new Set<number>([root.id]);
  let frontier: readonly number[] = [root.id];
  for (let depth = 1; depth <= MAX_BLAST_DEPTH && frontier.length > 0; depth += 1) {
    const fetched = await Promise.all(
      frontier.map(async (id) => {
        const rows = await counter.run(client, dependentsOf(id), timeoutMs);
        return [id, decodeDependents(rows)] as const;
      }),
    );
    const next: number[] = [];
    for (const [id, edges] of fetched) {
      adjacency.set(id, edges);
      for (const edge of liveDependencyEdges(edges)) {
        if (!seen.has(edge.entityId)) {
          seen.add(edge.entityId);
          next.push(edge.entityId);
        }
      }
    }
    frontier = next;
  }

  const radius = computeBlast({ id: root.id, name: packageName }, adjacency);

  const cited = [...new Set(
    radius.affected.flatMap((service) => service.path.map((step) => step.claimId)),
  )];
  const fetched = await Promise.all(
    cited.map(async (claimId) => decodeEvidence(
      claimId,
      await counter.run(client, evidenceForClaim(claimId), timeoutMs),
    )),
  );

  return {
    packageName,
    root,
    radius,
    evidence: fetched.flat(),
    queries: counter.trips,
    ms: round(performance.now() - started),
  };
}
