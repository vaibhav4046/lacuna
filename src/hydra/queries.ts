import { HydraGuardError } from './errors';
import { assertIdentifier } from './identifiers';

/**
 * Query builders for the forms that HydraDB v0.1.1 actually executes.
 *
 * The supported Cypher subset is narrow and the engine is specific about it.
 * Every shape here was run against a live node before it was written down, and
 * the refusals that shaped them are quoted next to each one. Nothing gets added
 * to this file on the strength of it looking reasonable.
 */

export interface PreparedQuery {
  readonly cypher: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface VertexUpsert {
  /** Exactly one label. The engine refuses zero or more than one. */
  readonly label: string;
  /** Property names to write. Part of the query text, so they are validated. */
  readonly properties: readonly string[];
  /** One object per vertex: an `id` plus every declared property. */
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

/**
 * Exported because retrieval builds its own read shapes and must reject the same
 * values this file does. Two guards with the same job drift; one does not.
 */
export function assertVertexId(value: unknown, role: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HydraGuardError(
      `${role} must be a non-negative safe integer, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/**
 * Batched vertex upsert. The only form the engine accepts:
 *
 *   UNWIND $rows AS row MERGE (n {id: row.id}) SET n:Label, n.p = row.p
 *
 * Putting the label in the MERGE pattern gets "UNWIND vertex upsert MERGE
 * pattern matches only id; apply labels with SET". Two labels in the SET gets
 * "UNWIND vertex upsert requires exactly one SET label".
 */
export function upsertVertices(spec: VertexUpsert): PreparedQuery {
  const label = assertIdentifier(spec.label, 'vertex label');
  if (spec.properties.length === 0) {
    throw new HydraGuardError('vertex upsert needs at least one property to set');
  }
  const properties = spec.properties.map((p) => assertIdentifier(p, 'property name'));
  if (new Set(properties).size !== properties.length) {
    throw new HydraGuardError('vertex upsert has a duplicate property name');
  }
  if (properties.includes('id')) {
    throw new HydraGuardError(
      'id is set by the MERGE pattern and must not be listed as a property',
    );
  }
  if (spec.rows.length === 0) {
    throw new HydraGuardError('vertex upsert has no rows');
  }

  spec.rows.forEach((row, i) => {
    assertVertexId(row['id'], `rows[${i}].id`);
    for (const property of properties) {
      if (row[property] === undefined) {
        throw new HydraGuardError(`rows[${i}] is missing the "${property}" property`);
      }
    }
  });

  const assignments = properties.map((p) => `n.${p} = row.${p}`).join(', ');
  return {
    cypher: `UNWIND $rows AS row MERGE (n {id: row.id}) SET n:${label}, ${assignments}`,
    parameters: { rows: spec.rows },
  };
}

/**
 * One edge, one request. Batching edges through UNWIND is refused with "UNWIND
 * vertex upsert requires MERGE by id followed by SET", and a multi-hop pattern
 * with "only one-hop edge patterns are executable in Query engine MERGE". See
 * DECISIONS.md D-011.
 *
 * The endpoint ids travel as parameters. That was verified rather than assumed:
 * every earlier probe of this form used integer literals, and the parameterised
 * version was executed and read back before this builder was written.
 */
export function mergeEdge(edgeType: string, srcId: number, dstId: number): PreparedQuery {
  const type = assertIdentifier(edgeType, 'edge type');
  return {
    cypher: `MERGE (a {id: $src})-[:${type}]->(b {id: $dst})`,
    parameters: {
      src: assertVertexId(srcId, 'srcId'),
      dst: assertVertexId(dstId, 'dstId'),
    },
  };
}

/**
 * Every vertex carrying one label, with its id and stored canonical key.
 *
 * A label on its own counts as a predicate here. The engine's usual refusal for
 * a node-only MATCH ("MATCH without a predicate is not executable") does not
 * apply, which was checked against a live node rather than assumed. A label with
 * no nodes returns zero rows rather than an error, so this is also the shape a
 * first ingest against an empty graph reads.
 */
export function verticesByLabel(label: string): PreparedQuery {
  const name = assertIdentifier(label, 'vertex label');
  return {
    cypher: `MATCH (n:${name}) RETURN n.id AS id, n.key AS key`,
    parameters: {},
  };
}

/**
 * The id and stored canonical key of one vertex, addressed by id.
 *
 * The same two columns `verticesByLabel` returns, for one node instead of all of
 * them. The pattern carries the id as a property rather than a WHERE clause
 * because the WHERE form is not a slower version of this query, it is not a
 * query at all: against a graph holding 5,642 vertices this answers in 10 ms,
 * and `MATCH (n) WHERE n.id = $id` is refused with a 400 reading `node-only
 * MATCH requires an id, label, or property predicate`. The probe that measured
 * both is in DECISIONS.md D-053.
 *
 * No label, deliberately. A canonical key begins with the label, so a planned id
 * found under a different label is a node whose stored key cannot match, which
 * is exactly the overwrite the pre-write check exists to refuse. Scoping the
 * read to one label would look past it.
 *
 * One row back does not mean the node is there. This pattern addresses a vertex
 * slot, and an id never written answers with a row whose key is null. The caller
 * decides what that means, which is why `run.ts` reads the key rather than
 * counting rows.
 */
export function vertexKeyById(id: number): PreparedQuery {
  return {
    cypher: 'MATCH (n {id: $id}) RETURN n.id AS id, n.key AS key',
    parameters: { id: assertVertexId(id, 'id') },
  };
}

/**
 * Removes one vertex and every edge attached to it.
 *
 * DETACH is what makes this safe to run without looking first. A bare `DELETE n`
 * is rejected with HTTP 400 once the vertex has any incident edge, and against a
 * vertex that does not exist it is a 200 that removes nothing, so the plain form
 * fails exactly where cleanup needs it to work. See DECISIONS.md D-020.
 *
 * Used by the contract tests and by scripts/reset.ts, not by ingestion, which
 * only ever merges.
 */
export function detachDeleteVertex(id: number): PreparedQuery {
  return {
    cypher: 'MATCH (n {id: $id}) DETACH DELETE n',
    parameters: { id: assertVertexId(id, 'id') },
  };
}

/**
 * Reads one property off one vertex.
 *
 * RETURN is restricted: "RETURN currently supports <binding>.<property> or
 * count(*)". A bare RETURN n, or RETURN *, does not parse.
 */
export function vertexProperty(id: number, property: string): PreparedQuery {
  const name = assertIdentifier(property, 'property name');
  return {
    cypher: `MATCH (n {id: $id}) RETURN n.${name} AS value`,
    parameters: { id: assertVertexId(id, 'id') },
  };
}
