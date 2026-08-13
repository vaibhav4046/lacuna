import { createHash } from 'node:crypto';

/**
 * Deterministic node ids, per D-007 and ADR 0002.
 *
 *   id = first 52 bits of SHA-256("<label>\x1f<canonical-key>")
 *
 * HydraDB node ids are non-negative integers, so nothing hands them out. They
 * are derived from what the node *is*, which is what makes ingestion idempotent:
 * re-ingesting the same transcript produces the same ids and the MERGE is a
 * no-op.
 *
 * 52 bits is not an arbitrary number. It is the largest width that fits inside
 * the JavaScript safe-integer range with room to spare, so an id survives JSON
 * on the way to HydraDB and back without a BigInt anywhere in the path.
 */

/** Four bits per hex character, so 13 characters is exactly 52 bits. */
const HEX_CHARS = 13;

export const ID_BITS = 52;
export const MAX_ID = 2 ** ID_BITS - 1;

/**
 * ASCII unit separator. It joins the label to the key so that
 * ("Claim", "a\x1fb") and ("Claim\x1fa", "b") cannot collide by construction,
 * which is why the separator is also rejected inside either half.
 */
export const KEY_SEPARATOR = String.fromCharCode(0x1f);

export class IdError extends Error {
  override readonly name: string = 'IdError';
}

/**
 * Two different canonical keys that truncate to the same 52-bit id. Possible,
 * astronomically unlikely at this scale, and a hard error rather than a silent
 * overwrite because this is a memory system whose pitch is not lying.
 */
export class IdCollisionError extends IdError {
  override readonly name = 'IdCollisionError';

  constructor(
    readonly id: number,
    readonly existingKey: string,
    readonly incomingKey: string,
  ) {
    super(
      `id ${id} is already held by ${JSON.stringify(existingKey)} ` +
        `and was derived again for ${JSON.stringify(incomingKey)}`,
    );
  }
}

function assertPart(value: string, role: string): string {
  if (value.length === 0) {
    throw new IdError(`${role} must not be empty`);
  }
  if (value.includes(KEY_SEPARATOR)) {
    throw new IdError(`${role} must not contain the unit separator`);
  }
  return value;
}

/** The exact bytes that get hashed. Exported so callers can store it verbatim. */
export function canonicalKey(label: string, key: string): string {
  return `${assertPart(label, 'label')}${KEY_SEPARATOR}${assertPart(key, 'canonical key')}`;
}

export function deriveId(label: string, key: string): number {
  const digest = createHash('sha256').update(canonicalKey(label, key), 'utf8').digest('hex');
  return Number.parseInt(digest.slice(0, HEX_CHARS), 16);
}

/**
 * Derives ids and remembers what it derived them from.
 *
 * ADR 0002 requires every node to store its full canonical key so that a
 * truncation collision is detectable. This is the write-side half of that: the
 * registry refuses to hand the same id to two different keys inside one run.
 * The read-side half belongs to ingestion, which compares against the key
 * already stored on the node.
 */
export class IdRegistry {
  readonly #keysById = new Map<number, string>();

  intern(label: string, key: string): number {
    const full = canonicalKey(label, key);
    const id = deriveId(label, key);
    const existing = this.#keysById.get(id);
    if (existing !== undefined && existing !== full) {
      throw new IdCollisionError(id, existing, full);
    }
    this.#keysById.set(id, full);
    return id;
  }

  keyFor(id: number): string | undefined {
    return this.#keysById.get(id);
  }

  /** Every id this registry handed out, with the key it was derived from. */
  entries(): IterableIterator<readonly [number, string]> {
    return this.#keysById.entries();
  }

  get size(): number {
    return this.#keysById.size;
  }
}
