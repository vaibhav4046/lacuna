/**
 * HydraDB's own relation graph, normalised.
 *
 * This is not the product's claim graph and the difference is the point of
 * showing it. Lacuna's graph is built at ingest from structured annotations:
 * ingestion is told which statement supersedes which. HydraDB was handed the
 * same transcripts and extracted its own relations from the prose, naming a
 * source entity, a target entity, a predicate and a confidence, with the
 * sentence it read them out of.
 *
 * So the HydraDB screen can put the two side by side: what the store found on
 * its own, and what the product traversed. Every other screen shows the second
 * one, and a reader could reasonably finish the product believing the store is
 * a place to keep records rather than something that reads them.
 *
 * Two endpoints answer in this shape and both are read here. `/context/relations`
 * lists what the store holds for the scope. `/query` with `graph_context: true`
 * walks it for one question and returns the paths it reached, which is the
 * traversal rather than the inventory.
 *
 * The shape below is defensive on purpose. This is a third party response and
 * the fields it carries are theirs to change, so anything missing becomes null
 * and a row that has no source and no target is dropped rather than rendered as
 * two dashes and a predicate.
 */

export interface ServiceRelation {
  /** The service's own id for the edge. Two rows carrying one id are one edge. */
  readonly id: string | null;
  readonly source: string | null;
  readonly sourceType: string | null;
  readonly target: string | null;
  readonly targetType: string | null;
  readonly predicate: string | null;
  /** The service's own 0 to 1 score, kept as it came or null. */
  readonly confidence: number | null;
  /** The sentence the service read the relation out of. */
  readonly context: string | null;
}

function field(value: unknown, ...names: readonly string[]): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const name of names) {
    const found = record[name];
    if (typeof found === 'string' && found.trim() !== '') return found;
  }
  return null;
}

function nested(value: unknown, name: string): unknown {
  if (typeof value !== 'object' || value === null) return null;
  return (value as Record<string, unknown>)[name] ?? null;
}

/**
 * Flatten what the service returns into rows a screen can render.
 *
 * The response nests a list of relations under each source and target pair, so
 * one entry can carry several predicates. Each becomes its own row, because a
 * reader counts rows and a row with three predicates in it is three facts
 * wearing one.
 */
export function normaliseRelations(raw: readonly unknown[]): readonly ServiceRelation[] {
  const rows: ServiceRelation[] = [];

  for (const entry of raw) {
    const source = nested(entry, 'source');
    const target = nested(entry, 'target');
    const sourceName = field(source, 'name');
    const targetName = field(target, 'name');
    if (sourceName === null && targetName === null) continue;

    const inner = nested(entry, 'relations');
    const list = Array.isArray(inner) && inner.length > 0 ? inner : [entry];

    for (const relation of list) {
      rows.push(row(source, relation, target));
    }
  }

  return rows;
}

/**
 * The graph the service walked for one question, as the same rows.
 *
 * `/context/relations` lists the store's edges; `POST /query` with
 * `graph_context: true` walks them and returns the paths it reached for the
 * text it was given, under `data.graph_context.query_paths`. Each path holds
 * triplets of the same source, relation and target shape, so the flattening is
 * the one above and the row type is the one above.
 *
 * Two differences worth stating rather than hiding. The triplets carry no
 * `confidence` field, so confidence is null on every row from here, and that is
 * the service's shape rather than a value this code dropped. And one edge is
 * reached by many paths, so the same `relationship_id` comes back repeatedly:
 * rows are deduplicated by it, because a reader counts rows and the same edge
 * listed nine times is one fact wearing nine.
 */
export function normaliseGraphContext(graphContext: unknown): readonly ServiceRelation[] {
  const paths = nested(graphContext, 'query_paths');
  if (!Array.isArray(paths)) return [];

  const rows: ServiceRelation[] = [];
  const seen = new Set<string>();
  for (const path of paths) {
    const triplets = nested(path, 'triplets');
    if (!Array.isArray(triplets)) continue;
    for (const triplet of triplets) {
      const source = nested(triplet, 'source');
      const target = nested(triplet, 'target');
      const relation = nested(triplet, 'relation');
      const built = row(source, relation, target);
      if (built.source === null && built.target === null) continue;
      // No id means nothing to deduplicate against, so the row stands: dropping
      // it would lose an edge the service did reach.
      if (built.id !== null) {
        if (seen.has(built.id)) continue;
        seen.add(built.id);
      }
      rows.push(built);
    }
  }

  return rows;
}

function row(source: unknown, relation: unknown, target: unknown): ServiceRelation {
  const score = nested(relation, 'confidence');
  return {
    id: field(relation, 'relationship_id'),
    source: field(source, 'name'),
    sourceType: field(source, 'type'),
    target: field(target, 'name'),
    targetType: field(target, 'type'),
    predicate: field(relation, 'canonical_predicate', 'raw_predicate', 'predicate'),
    confidence: typeof score === 'number' && Number.isFinite(score) ? score : null,
    context: field(relation, 'context'),
  };
}
