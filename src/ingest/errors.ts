export class IngestError extends Error {
  override readonly name: string = 'IngestError';
}

/**
 * The read side of the check ADR 0002 asks for. `IdCollisionError` catches two
 * keys colliding inside one run; this catches a node that is already in the
 * graph under the same id and a different key, which is the case that would
 * otherwise overwrite real data.
 */
export class IngestCollisionError extends IngestError {
  override readonly name: string = 'IngestCollisionError';

  constructor(
    readonly id: number,
    /** null when the node exists but carries no key at all, which is equally wrong. */
    readonly storedKey: string | null,
    readonly plannedKey: string,
  ) {
    super(
      `vertex ${id} is already in the graph under a different key. `
      + `stored ${JSON.stringify(storedKey)}, planned ${JSON.stringify(plannedKey)}`,
    );
  }
}
