import { HydraGuardError } from './errors.js';

/**
 * HydraDB's query transport takes exactly one Cypher statement per request and
 * says so when given two:
 *
 *   query transport requires exactly one Cypher statement
 *
 * That refusal is a real control, recorded in SECURITY.md, and it is the reason
 * an injected second statement has nowhere to run. This scanner enforces the
 * same rule one layer earlier so a malformed query fails locally with a clear
 * message instead of costing a round trip.
 *
 * It is deliberately stricter than the server: any `;` outside a literal is
 * refused, including a single trailing one. Whether the engine tolerates a
 * trailing terminator was never established, and guessing in the direction of
 * "probably fine" is how injection guards end up with holes.
 */

const SINGLE = "'";
const DOUBLE = '"';
const BACKTICK = '`';

/**
 * Finds the offset of the first statement separator that is not inside a string
 * literal or a comment. Returns -1 when there is none.
 *
 * Handles the three Cypher quoting forms, backslash escapes inside them, `//`
 * line comments and `/* *\/` block comments.
 */
export function findStatementSeparator(cypher: string): number {
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < cypher.length; i += 1) {
    const ch = cypher[i] as string;
    const next = i + 1 < cypher.length ? cypher[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === SINGLE || ch === DOUBLE || ch === BACKTICK) {
      quote = ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === ';') return i;
  }

  if (quote !== null) {
    throw new HydraGuardError(
      `query has an unterminated ${quote === BACKTICK ? 'backtick' : 'string'} literal`,
    );
  }
  if (inBlockComment) {
    throw new HydraGuardError('query has an unterminated block comment');
  }

  return -1;
}

/** Throws unless the query is exactly one statement with no terminator. */
export function assertSingleStatement(cypher: string): void {
  const at = findStatementSeparator(cypher);
  if (at !== -1) {
    throw new HydraGuardError(
      `query contains a ';' at offset ${at}. HydraDB accepts one statement per `
      + `request, and this client does not split them for you`,
    );
  }
}
