import { describe, expect, it } from 'vitest';

import { HydraGuardError } from '../../src/hydra/errors';
import { mergeEdge, upsertVertices, vertexProperty } from '../../src/hydra/queries';

describe('upsertVertices', () => {
  it('builds the one form the engine accepts', () => {
    const q = upsertVertices({
      label: 'Claim',
      properties: ['predicate', 'object_text'],
      rows: [{ id: 2000000000001, predicate: 'launch_date', object_text: 'March' }],
    });
    expect(q.cypher).toBe(
      'UNWIND $rows AS row MERGE (n {id: row.id}) '
      + 'SET n:Claim, n.predicate = row.predicate, n.object_text = row.object_text',
    );
  });

  it('passes the rows through as parameters, not as query text', () => {
    const rows = [{ id: 1, predicate: 'x' }];
    const q = upsertVertices({ label: 'Claim', properties: ['predicate'], rows });
    expect(q.parameters).toEqual({ rows });
    expect(q.cypher).not.toContain('x');
  });

  it('refuses a label that is not a safe identifier', () => {
    expect(() => upsertVertices({
      label: 'Claim`) SET n.owner = "attacker" //',
      properties: ['predicate'],
      rows: [{ id: 1, predicate: 'x' }],
    })).toThrowError(HydraGuardError);
  });

  it('refuses a property name that is not a safe identifier', () => {
    expect(() => upsertVertices({
      label: 'Claim',
      properties: ['predicate = 1, n.owner'],
      rows: [{ id: 1 }],
    })).toThrowError(HydraGuardError);
  });

  it('refuses a row missing a declared property, instead of writing undefined', () => {
    expect(() => upsertVertices({
      label: 'Claim',
      properties: ['predicate', 'object_text'],
      rows: [{ id: 1, predicate: 'x' }],
    })).toThrowError(/rows\[0\] is missing the "object_text" property/);
  });

  it('refuses a row with a non-integer id', () => {
    expect(() => upsertVertices({
      label: 'Claim',
      properties: ['predicate'],
      rows: [{ id: '2000000000001', predicate: 'x' }],
    })).toThrowError(/rows\[0\]\.id must be a non-negative safe integer/);
  });

  it('refuses id in the property list, since MERGE already sets it', () => {
    expect(() => upsertVertices({
      label: 'Claim',
      properties: ['id'],
      rows: [{ id: 1 }],
    })).toThrowError(/must not be listed as a property/);
  });

  it('refuses a duplicate property name', () => {
    expect(() => upsertVertices({
      label: 'Claim',
      properties: ['predicate', 'predicate'],
      rows: [{ id: 1, predicate: 'x' }],
    })).toThrowError(/duplicate property name/);
  });

  it('refuses an empty batch and an empty property list', () => {
    expect(() => upsertVertices({ label: 'Claim', properties: [], rows: [{ id: 1 }] }))
      .toThrowError(/at least one property/);
    expect(() => upsertVertices({ label: 'Claim', properties: ['p'], rows: [] }))
      .toThrowError(/no rows/);
  });
});

describe('mergeEdge', () => {
  it('builds a one-hop MERGE with both endpoints as parameters', () => {
    const q = mergeEdge('SUPERSEDES', 2000000000002, 2000000000001);
    expect(q.cypher).toBe('MERGE (a {id: $src})-[:SUPERSEDES]->(b {id: $dst})');
    expect(q.parameters).toEqual({ src: 2000000000002, dst: 2000000000001 });
  });

  it('refuses an edge type that is not a safe identifier', () => {
    expect(() => mergeEdge('SUPERSEDES|ANYTHING*1..9', 1, 2)).toThrowError(HydraGuardError);
    expect(() => mergeEdge('A]->(c) MERGE (c)-[:OWNS', 1, 2)).toThrowError(HydraGuardError);
  });

  it('refuses non-integer endpoint ids', () => {
    expect(() => mergeEdge('SUPPORTS', 1.5, 2)).toThrowError(/srcId must be/);
    expect(() => mergeEdge('SUPPORTS', 1, -2)).toThrowError(/dstId must be/);
  });
});

describe('vertexProperty', () => {
  it('builds a parameterised read', () => {
    const q = vertexProperty(2000000000001, 'object_text');
    expect(q.cypher).toBe('MATCH (n {id: $id}) RETURN n.object_text AS value');
    expect(q.parameters).toEqual({ id: 2000000000001 });
  });

  it('refuses a property name that is not a safe identifier', () => {
    expect(() => vertexProperty(1, 'object_text AS v, n.secret')).toThrowError(HydraGuardError);
  });
});
