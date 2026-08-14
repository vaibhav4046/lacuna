import {
  HydraConfigError,
  HydraQueryError,
  HydraTransportError,
} from '../hydra/errors';
import { ReportError } from '../report/bench';
import {
  RetrievalConsistencyError,
  RetrievalDecodeError,
  RetrievalError,
} from '../retrieval/errors';

/**
 * What went wrong, said in the one thing a shell reads.
 *
 * A script wrapping this CLI cannot parse prose, so every failure is sorted
 * into one of five numbers and the sorting rule is written down in
 * docs/CLI.md rather than left to be discovered. The distinction that matters
 * most is 3 against 4: a token that was refused is the operator's problem and
 * retrying will not fix it, while a node that did not answer may well answer on
 * the next attempt.
 *
 * An abstention is not in this list on purpose. "The sessions never settled
 * this" is an answer the product is built to give, so it exits 0 like any other
 * successful run and says so in the payload instead.
 */

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;
export const EXIT_CONFIG = 3;
export const EXIT_UNAVAILABLE = 4;
export const EXIT_INTERNAL = 5;

/** The command line was wrong. Nothing was attempted. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

/** Configuration this CLI owns is missing or malformed. */
export class CliConfigError extends Error {
  override readonly name = 'CliConfigError';
}

/** A refused token is a configuration problem, not an outage. */
const AUTH_STATUSES = new Set([401, 403]);

/** Statuses that mean the node is there but cannot serve the request now. */
const OVERLOAD_STATUSES = new Set([429, 503]);

export function exitCodeFor(error: unknown): number {
  if (error instanceof UsageError) return EXIT_USAGE;
  if (error instanceof CliConfigError) return EXIT_CONFIG;
  if (error instanceof HydraConfigError) return EXIT_CONFIG;
  if (error instanceof HydraTransportError) return EXIT_UNAVAILABLE;
  if (error instanceof HydraQueryError) {
    if (AUTH_STATUSES.has(error.status)) return EXIT_CONFIG;
    if (OVERLOAD_STATUSES.has(error.status) || error.status >= 500) return EXIT_UNAVAILABLE;
    // A 400 is this client sending a statement the engine will not run, which
    // is a bug here rather than a state the operator can correct.
    return EXIT_INTERNAL;
  }
  // A decoded row that does not fit, or a view that disagrees with itself, is
  // this codebase being wrong about the graph. The caller cannot act on it.
  if (error instanceof RetrievalDecodeError) return EXIT_INTERNAL;
  if (error instanceof RetrievalConsistencyError) return EXIT_INTERNAL;
  // What is left is the term validation in buildQuestion, which rejects what
  // the caller typed.
  if (error instanceof RetrievalError) return EXIT_USAGE;
  if (error instanceof ReportError) return EXIT_INTERNAL;
  return EXIT_INTERNAL;
}

export function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
