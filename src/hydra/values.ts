import { HydraDecodeError } from './errors.js';

/**
 * HydraDB v0.1.1 tags every value on the wire, and it uses two different
 * tagging conventions in the same response.
 *
 * Top-level row values are snake case with a `type` and a `value` field:
 *
 *   {"type": "vertex_id", "value": 2000000000001}
 *   {"type": "null"}                              // no value key at all
 *
 * Node properties nested inside a `path` value are capitalised single-key
 * objects instead:
 *
 *   {"String": "March"}
 *   {"Integer": 20250210}
 *
 * Both shapes are captured in artifacts/cypher-probe/. A client that only
 * implements the first one works fine until the first path query, which is why
 * this file implements both and tests them against the captured bytes.
 */

export type HydraScalar = string | number | boolean | null;

export interface HydraNode {
  readonly id: number;
  readonly labels: readonly string[];
  readonly properties: Readonly<Record<string, HydraScalar>>;
}

export interface HydraRelationship {
  /** Always null in v0.1.1. Edges are identified by src, type and dst. */
  readonly id: number | null;
  readonly edgeType: string;
  readonly src: number;
  readonly dst: number;
  readonly properties: Readonly<Record<string, HydraScalar>>;
}

export interface HydraPath {
  readonly nodes: readonly HydraNode[];
  readonly relationships: readonly HydraRelationship[];
}

export type HydraValue = HydraScalar | readonly HydraValue[] | HydraPath;

export function isHydraPath(value: HydraValue): value is HydraPath {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && 'nodes' in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(where: string, detail: string): never {
  throw new HydraDecodeError(`${where}: ${detail}`);
}

/**
 * Integers arrive as JSON numbers. Anything past 2^53 has already lost
 * precision by the time JSON.parse returns, so the most this can do is refuse
 * to hand back a value that is provably wrong. Lacuna's own ids are 52 bits by
 * construction (DECISIONS.md D-007) and stay inside the safe range.
 */
function requireSafeInteger(raw: unknown, where: string): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    fail(where, `expected an integer within Number.MAX_SAFE_INTEGER, got ${JSON.stringify(raw)}`);
  }
  return raw;
}

/** Decodes one top-level tagged value. */
export function decodeValue(raw: unknown, where = '$'): HydraValue {
  if (!isRecord(raw)) {
    fail(where, `expected a tagged value object, got ${JSON.stringify(raw)}`);
  }
  const tag = raw['type'];
  if (typeof tag !== 'string') {
    fail(where, 'tagged value has no string "type" field');
  }
  const value = raw['value'];

  switch (tag) {
    case 'null':
      if (value !== undefined && value !== null) {
        fail(where, `tag "null" carried a value: ${JSON.stringify(value)}`);
      }
      return null;

    case 'boolean':
      if (typeof value !== 'boolean') fail(where, 'tag "boolean" without a boolean value');
      return value;

    case 'string':
      if (typeof value !== 'string') fail(where, 'tag "string" without a string value');
      return value;

    case 'float':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(where, 'tag "float" without a finite number value');
      }
      return value;

    case 'integer':
    case 'signed_integer':
    case 'vertex_id':
      return requireSafeInteger(value, `${where} (tag "${tag}")`);

    case 'list': {
      if (!Array.isArray(value)) fail(where, 'tag "list" without an array value');
      return value.map((item, i) => decodeValue(item, `${where}[${i}]`));
    }

    case 'path':
      return decodePath(value, where);

    default:
      fail(where, `unknown value tag "${tag}"`);
  }
}

/**
 * Property tags observed on the wire are `String` and `Integer`. `Float` and
 * `Boolean` are accepted on the same naming pattern but have not been seen, so
 * they are validated by type rather than trusted: a wrong guess here fails
 * loudly instead of decoding to something plausible and false.
 */
const PROPERTY_TAGS: Readonly<Record<string, 'string' | 'number' | 'boolean'>> = {
  String: 'string',
  Integer: 'number',
  Float: 'number',
  Boolean: 'boolean',
};

function decodeProperty(raw: unknown, where: string): HydraScalar {
  if (raw === null) return null;
  if (!isRecord(raw)) {
    fail(where, `expected a tagged property object, got ${JSON.stringify(raw)}`);
  }
  const keys = Object.keys(raw);
  if (keys.length !== 1) {
    fail(where, `expected exactly one property tag, got ${keys.length}`);
  }
  const tag = keys[0] as string;
  const expected = PROPERTY_TAGS[tag];
  if (expected === undefined) {
    fail(where, `unknown property tag "${tag}"`);
  }
  const value = raw[tag];
  if (tag === 'Integer') return requireSafeInteger(value, `${where} (tag "Integer")`);
  if (typeof value !== expected) {
    fail(where, `property tag "${tag}" carried a ${typeof value}`);
  }
  return value as HydraScalar;
}

function decodeProperties(raw: unknown, where: string): Record<string, HydraScalar> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) fail(where, 'properties is not an object');
  const out: Record<string, HydraScalar> = {};
  for (const [key, value] of Object.entries(raw)) {
    out[key] = decodeProperty(value, `${where}.${key}`);
  }
  return out;
}

function decodeNode(raw: unknown, where: string): HydraNode {
  if (!isRecord(raw)) fail(where, 'node is not an object');
  const labels = raw['labels'];
  if (!Array.isArray(labels) || labels.some((l) => typeof l !== 'string')) {
    fail(where, 'node labels is not an array of strings');
  }
  return {
    id: requireSafeInteger(raw['id'], `${where}.id`),
    labels: labels as string[],
    properties: decodeProperties(raw['properties'], `${where}.properties`),
  };
}

function decodeRelationship(raw: unknown, where: string): HydraRelationship {
  if (!isRecord(raw)) fail(where, 'relationship is not an object');
  const id = raw['id'];
  const edgeType = raw['edge_type'];
  if (typeof edgeType !== 'string') fail(where, 'relationship has no string edge_type');
  return {
    id: id === null || id === undefined ? null : requireSafeInteger(id, `${where}.id`),
    edgeType,
    src: requireSafeInteger(raw['src'], `${where}.src`),
    dst: requireSafeInteger(raw['dst'], `${where}.dst`),
    properties: decodeProperties(raw['properties'], `${where}.properties`),
  };
}

export function decodePath(raw: unknown, where: string): HydraPath {
  if (!isRecord(raw)) fail(where, 'path value is not an object');
  const nodes = raw['nodes'];
  const relationships = raw['relationships'];
  if (!Array.isArray(nodes)) fail(where, 'path has no nodes array');
  if (!Array.isArray(relationships)) fail(where, 'path has no relationships array');
  return {
    nodes: nodes.map((n, i) => decodeNode(n, `${where}.nodes[${i}]`)),
    relationships: relationships.map(
      (r, i) => decodeRelationship(r, `${where}.relationships[${i}]`),
    ),
  };
}

export function decodeRows(raw: unknown, where = '$.rows'): HydraValue[][] {
  if (!Array.isArray(raw)) fail(where, 'rows is not an array');
  return raw.map((row, r) => {
    if (!Array.isArray(row)) fail(`${where}[${r}]`, 'row is not an array');
    return row.map((cell, c) => decodeValue(cell, `${where}[${r}][${c}]`));
  });
}

/** Turns positional rows into records keyed by the response's column names. */
export function rowsToObjects(
  columns: readonly string[],
  rows: readonly (readonly HydraValue[])[],
): Record<string, HydraValue>[] {
  return rows.map((row, r) => {
    if (row.length !== columns.length) {
      fail(`$.rows[${r}]`, `has ${row.length} values for ${columns.length} columns`);
    }
    const out: Record<string, HydraValue> = {};
    columns.forEach((name, i) => {
      out[name] = row[i] as HydraValue;
    });
    return out;
  });
}
