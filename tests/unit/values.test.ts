import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HydraDecodeError } from '../../src/hydra/errors.js';
import {
  decodeRows,
  decodeValue,
  isHydraPath,
  rowsToObjects,
  type HydraPath,
} from '../../src/hydra/values.js';

/**
 * The path case is decoded from the bytes a real node returned, not from a
 * hand-written fixture. artifacts/cypher-probe/path-value-shape.json is the
 * captured value; if the decoder and the server ever disagree, this fails.
 */
const capturedPath: unknown = JSON.parse(
  readFileSync(
    new URL('../../artifacts/cypher-probe/path-value-shape.json', import.meta.url),
    'utf8',
  ),
);

describe('decodeValue, scalar tags', () => {
  it('decodes null, which arrives with no value key at all', () => {
    expect(decodeValue({ type: 'null' })).toBe(null);
  });

  it('refuses a null tag that carries a value', () => {
    expect(() => decodeValue({ type: 'null', value: 7 }))
      .toThrowError(/tag "null" carried a value/);
  });

  it('decodes the three integer tags the engine uses', () => {
    expect(decodeValue({ type: 'integer', value: 20250101 })).toBe(20250101);
    expect(decodeValue({ type: 'signed_integer', value: -3 })).toBe(-3);
    expect(decodeValue({ type: 'vertex_id', value: 2000000000001 })).toBe(2000000000001);
  });

  it('refuses an integer that JSON.parse has already rounded', () => {
    expect(() => decodeValue({ type: 'integer', value: 2 ** 53 }))
      .toThrowError(HydraDecodeError);
  });

  it('decodes string, boolean and float', () => {
    expect(decodeValue({ type: 'string', value: 'March' })).toBe('March');
    expect(decodeValue({ type: 'boolean', value: false })).toBe(false);
    expect(decodeValue({ type: 'float', value: 1.5 })).toBe(1.5);
  });

  it('refuses a float that is not finite', () => {
    expect(() => decodeValue({ type: 'float', value: null })).toThrowError(HydraDecodeError);
  });

  it('refuses a tag it has never seen rather than passing the value through', () => {
    expect(() => decodeValue({ type: 'duration', value: 1 }))
      .toThrowError(/unknown value tag "duration"/);
  });

  it('reports where in the response the bad value was', () => {
    expect(() => decodeValue({ type: 'list', value: [{ type: 'nope' }] }, '$.rows[2][0]'))
      .toThrowError(/\$\.rows\[2\]\[0\]\[0\]: unknown value tag "nope"/);
  });
});

describe('decodeValue, list tag', () => {
  it('decodes a list of tagged values', () => {
    const decoded = decodeValue({
      type: 'list',
      value: [{ type: 'integer', value: 1 }, { type: 'string', value: 'a' }],
    });
    expect(decoded).toEqual([1, 'a']);
  });
});

describe('decodeValue, path tag against captured bytes', () => {
  it('decodes the nodes, keeping the capitalised property tags straight', () => {
    const decoded = decodeValue(capturedPath);
    expect(isHydraPath(decoded)).toBe(true);
    const path = decoded as HydraPath;

    expect(path.nodes).toHaveLength(3);
    expect(path.nodes[0]?.id).toBe(3000000000002);
    expect(path.nodes[0]?.labels).toEqual(['EvidenceSpan']);
    // {"Integer": 38} and {"String": "..."}, the second tagging convention.
    expect(path.nodes[0]?.properties['end']).toBe(38);
    expect(path.nodes[0]?.properties['text']).toBe('correction, launch moved to March');
    expect(path.nodes[1]?.properties['valid_from']).toBe(20250101);
    expect(path.nodes[2]?.properties['name']).toBe('Project Atlas launch');
  });

  it('decodes the relationships, including the always-null edge id', () => {
    const path = decodeValue(capturedPath) as HydraPath;
    expect(path.relationships).toHaveLength(2);
    expect(path.relationships[0]).toEqual({
      id: null,
      edgeType: 'SUPPORTS',
      src: 3000000000002,
      dst: 2000000000002,
      properties: {},
    });
    expect(path.relationships[1]?.edgeType).toBe('ABOUT');
  });

  it('refuses a property tag it does not know', () => {
    expect(() => decodeValue({
      type: 'path',
      value: {
        nodes: [{ id: 1, labels: ['X'], properties: { p: { Duration: 5 } } }],
        relationships: [],
      },
    })).toThrowError(/unknown property tag "Duration"/);
  });

  it('refuses a property object carrying more than one tag', () => {
    expect(() => decodeValue({
      type: 'path',
      value: {
        nodes: [{ id: 1, labels: ['X'], properties: { p: { String: 'a', Integer: 1 } } }],
        relationships: [],
      },
    })).toThrowError(/expected exactly one property tag, got 2/);
  });
});

describe('decodeRows and rowsToObjects', () => {
  it('decodes a rows array the way the engine sends one', () => {
    const rows = decodeRows([
      [{ type: 'vertex_id', value: 2000000000001 }, { type: 'string', value: 'launch_date' }],
      [{ type: 'vertex_id', value: 2000000000002 }, { type: 'null' }],
    ]);
    expect(rows).toEqual([[2000000000001, 'launch_date'], [2000000000002, null]]);
  });

  it('refuses rows that are not an array', () => {
    expect(() => decodeRows({ rows: [] })).toThrowError(/rows is not an array/);
  });

  it('keys rows by the response column names', () => {
    const objects = rowsToObjects(['id', 'predicate'], [[1, 'launch_date']]);
    expect(objects).toEqual([{ id: 1, predicate: 'launch_date' }]);
  });

  it('refuses a row whose width does not match the column list', () => {
    expect(() => rowsToObjects(['id', 'predicate'], [[1]]))
      .toThrowError(/has 1 values for 2 columns/);
  });
});
