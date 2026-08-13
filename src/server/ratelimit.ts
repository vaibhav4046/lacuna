/**
 * A fixed window counter, which is the smallest thing that honestly limits a
 * public demo.
 *
 * It is not a token bucket and it does not pretend to be fair across a window
 * boundary: a client can spend its whole allowance at the end of one window and
 * again at the start of the next. That is a known property of fixed windows and
 * it is acceptable here, because the thing being protected is a graph node on a
 * laptop and the goal is a ceiling rather than a smooth rate.
 *
 * The clock is a parameter rather than a call to `Date.now` inside, so the
 * behaviour at a window edge can be tested by passing numbers instead of by
 * installing a fake timer over the whole process.
 */

export interface RateLimitOptions {
  /** Requests allowed per key per window. */
  readonly limit: number;
  readonly windowMs: number;
  /**
   * Ceiling on tracked keys. Reached only under a source-address flood, which
   * is exactly when an unbounded map would be the vulnerability rather than
   * the defence.
   */
  readonly maxKeys: number;
}

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** How many more requests this key may make in the current window. */
  readonly remaining: number;
  /** Whole seconds until the window rolls over. Zero when the request passed. */
  readonly retryAfterSeconds: number;
}

interface Bucket {
  windowStart: number;
  count: number;
}

export class FixedWindow {
  readonly #limit: number;
  readonly #windowMs: number;
  readonly #maxKeys: number;
  readonly #buckets = new Map<string, Bucket>();

  constructor(options: RateLimitOptions) {
    if (options.limit < 1) throw new RangeError('limit must be at least 1');
    if (options.windowMs < 1) throw new RangeError('windowMs must be at least 1');
    if (options.maxKeys < 1) throw new RangeError('maxKeys must be at least 1');
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
    this.#maxKeys = options.maxKeys;
  }

  /** Tracked keys, for a test that wants to prove the map stays bounded. */
  get size(): number {
    return this.#buckets.size;
  }

  check(key: string, now: number): RateLimitVerdict {
    const existing = this.#buckets.get(key);

    if (existing === undefined || now - existing.windowStart >= this.#windowMs) {
      this.#evict(now);
      // Deleting before setting puts the key at the end of the iteration order,
      // so eviction below discards the keys whose windows are oldest rather
      // than the keys that were seen first.
      this.#buckets.delete(key);
      this.#buckets.set(key, { windowStart: now, count: 1 });
      return { allowed: true, remaining: this.#limit - 1, retryAfterSeconds: 0 };
    }

    const elapsed = now - existing.windowStart;
    const retryAfterSeconds = Math.max(1, Math.ceil((this.#windowMs - elapsed) / 1000));

    if (existing.count >= this.#limit) {
      return { allowed: false, remaining: 0, retryAfterSeconds };
    }

    existing.count += 1;
    return { allowed: true, remaining: this.#limit - existing.count, retryAfterSeconds: 0 };
  }

  /**
   * Drops finished windows, then oldest-window keys if that was not enough.
   *
   * Evicting a live counter early is a real loosening of the limit, and it is
   * the right trade: a flood of distinct source addresses can cost a legitimate
   * client its count, but it cannot cost the process its memory.
   */
  #evict(now: number): void {
    if (this.#buckets.size < this.#maxKeys) return;

    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.windowStart >= this.#windowMs) this.#buckets.delete(key);
    }

    for (const key of this.#buckets.keys()) {
      if (this.#buckets.size < this.#maxKeys) break;
      this.#buckets.delete(key);
    }
  }
}
