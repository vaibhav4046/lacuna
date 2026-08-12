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

function assertVertexId(value: unknown, role: string): number {
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
