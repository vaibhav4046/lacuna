/**
 * Retry a read while a just-accepted write is still becoming searchable.
 *
 * The caller decides what "pending" means. This keeps the helper usable for
 * the onboarding proof without turning a genuine no-evidence answer into a
 * success or retrying ordinary questions forever.
 */
export async function retryWhilePending<T>(
  read: () => Promise<T | null>,
  pending: (value: T | null) => boolean,
  options: {
    readonly attempts?: number;
    readonly delayMs?: (retry: number) => number;
    readonly sleep?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<T | null> {
  const attempts = Math.max(1, Math.floor(options.attempts ?? 1));
  const delayMs = options.delayMs ?? ((retry: number) => Math.min(900, 300 * (retry + 1)));
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  }));

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = await read();
    if (!pending(value) || attempt === attempts - 1) return value;
    await sleep(Math.max(0, delayMs(attempt)));
  }
  return null;
}
