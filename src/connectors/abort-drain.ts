/**
 * Starts one bounded fan-out, aborts siblings on the first failure, and does
 * not return until every started operation has terminated. The caller's
 * signal is relayed only for this batch and its listener is always removed.
 */
export async function abortAndDrain<T>(
  operations: readonly ((signal: AbortSignal) => Promise<T>)[],
  callerSignal?: AbortSignal,
): Promise<readonly T[]> {
  const controller = new AbortController();
  const relayAbort = () => controller.abort();
  if (callerSignal?.aborted === true) relayAbort();
  else callerSignal?.addEventListener('abort', relayAbort, { once: true });
  let failed = false;
  let firstFailure: unknown;
  try {
    const pending = operations.map(async (operation): Promise<T> => {
      try {
        return await operation(controller.signal);
      } catch (error) {
        if (!failed) {
          failed = true;
          firstFailure = error;
          controller.abort();
        }
        throw error;
      }
    });
    const settled = await Promise.allSettled(pending);
    if (failed) throw firstFailure;
    return settled.map((result) => {
      if (result.status === 'rejected') throw result.reason;
      return result.value;
    });
  } finally {
    callerSignal?.removeEventListener('abort', relayAbort);
  }
}
