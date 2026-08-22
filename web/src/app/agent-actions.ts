export interface GuardedActionResult<T> {
  readonly value: T | null;
  readonly message: string | null;
}

/** Convert transient request failures into bounded UI state without throwing. */
export async function guardedAction<T>(
  action: () => Promise<T | null>,
  emptyMessage: string,
): Promise<GuardedActionResult<T>> {
  try {
    const value = await action();
    return value === null ? { value: null, message: emptyMessage } : { value, message: null };
  } catch {
    return { value: null, message: 'Connection failed.' };
  }
}
