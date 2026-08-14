import { describe, expect, it } from 'vitest';

import { HydraGuardError } from '../../src/hydra/errors.js';
import {
  assertSingleStatement,
  findStatementSeparator,
} from '../../src/hydra/statement.js';

describe('findStatementSeparator', () => {
  it('returns -1 for a single statement', () => {
    expect(findStatementSeparator('MATCH (c:Claim) RETURN c.id AS id')).toBe(-1);
  });

  it('finds a bare separator and reports its offset', () => {
    const cypher = 'RETURN 1 AS a;RETURN 2 AS b';
    expect(findStatementSeparator(cypher)).toBe(13);
    expect(cypher[13]).toBe(';');
  });

  it('ignores a separator inside each of the three quoting forms', () => {
    expect(findStatementSeparator("MATCH (c {t: 'a;b'}) RETURN c.id AS id")).toBe(-1);
    expect(findStatementSeparator('MATCH (c {t: "a;b"}) RETURN c.id AS id')).toBe(-1);
    expect(findStatementSeparator('MATCH (c) RETURN c.`odd;name` AS v')).toBe(-1);
  });

  it('ignores an escaped quote inside a literal rather than ending it early', () => {
    // Without escape handling the \' would close the literal and the ; after it
    // would read as a separator.
    expect(findStatementSeparator("RETURN 'it\\'s a; test' AS v")).toBe(-1);
  });

  it('ignores a separator inside a line comment or a block comment', () => {
    expect(findStatementSeparator('RETURN 1 AS a // ; not a statement')).toBe(-1);
    expect(findStatementSeparator('RETURN 1 AS a /* ; still not */ ')).toBe(-1);
  });

  it('still finds a separator after a comment closes', () => {
    expect(findStatementSeparator('RETURN 1 AS a /* x */ ; DROP')).toBe(22);
  });

  it('refuses an unterminated literal instead of guessing', () => {
    expect(() => findStatementSeparator("RETURN 'open")).toThrowError(HydraGuardError);
    expect(() => findStatementSeparator("RETURN 'open"))
      .toThrowError(/unterminated string literal/);
    expect(() => findStatementSeparator('RETURN `open'))
      .toThrowError(/unterminated backtick literal/);
  });

  it('refuses an unterminated block comment', () => {
    expect(() => findStatementSeparator('RETURN 1 /* open'))
      .toThrowError(/unterminated block comment/);
  });
});

describe('assertSingleStatement', () => {
  it('passes a lone statement', () => {
    expect(() => assertSingleStatement('MATCH (c:Claim) RETURN c.id AS id')).not.toThrow();
  });

  it('refuses a trailing terminator, which the server was never proven to accept', () => {
    expect(() => assertSingleStatement('RETURN 1 AS a;')).toThrowError(HydraGuardError);
  });

  it('names the offset so the caller can find it', () => {
    expect(() => assertSingleStatement('RETURN 1 AS a; RETURN 2 AS b'))
      .toThrowError(/';' at offset 13/);
  });
});
