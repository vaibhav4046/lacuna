import { HydraGuardError } from './errors';

/**
 * Cypher parameters cover values, and nothing else. A label, a relationship
 * type and a property name are all part of the query text, so they are the one
 * place where caller-supplied strings get concatenated into a statement.
 *
 * That makes this file the injection boundary for the whole client. Everything
 * that reaches query text passes through here first.
 */

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_IDENTIFIER_LENGTH = 64;

export function isIdentifier(value: string): boolean {
  return value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && IDENTIFIER.test(value);
}

/**
 * Returns the identifier unchanged, or throws. Never escapes or repairs the
 * input: a name that is not already safe is a bug in the caller, and quietly
 * rewriting it would hide that.
 */
export function assertIdentifier(value: string, role: string): string {
  if (typeof value !== 'string') {
    throw new HydraGuardError(`${role} must be a string`);
  }
  if (!isIdentifier(value)) {
    throw new HydraGuardError(
      `${role} is not a safe Cypher identifier: it must start with a letter, `
      + `contain only letters, digits and underscores, and be at most `
      + `${MAX_IDENTIFIER_LENGTH} characters`,
    );
  }
  return value;
}

export { MAX_IDENTIFIER_LENGTH };
