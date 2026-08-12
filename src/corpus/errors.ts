/**
 * Failures in corpus construction are bugs in the generator, not conditions to
 * recover from. Everything here throws loudly so a broken corpus can never be
 * ingested, evaluated against, or shown to anyone.
 */
export class CorpusError extends Error {
  override readonly name = 'CorpusError';
}

/** Indexed access that throws instead of handing back `undefined`. */
export function at<T>(items: readonly T[], index: number, what: string): T {
  const value = items[index];
  if (value === undefined) {
    throw new CorpusError(`${what}: index ${index} is out of range, length is ${items.length}`);
  }
  return value;
}
