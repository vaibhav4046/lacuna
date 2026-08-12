import { createHash } from 'node:crypto';

/**
 * A seeded generator, because the corpus has to be byte identical on every
 * machine that regenerates it. `Math.random` and `Date.now` appear nowhere in
 * `src/corpus/`, and a test asserts two generations match.
 *
 * mulberry32: 32 bits of state, fast, and adequate for laying out synthetic
 * text. Nothing here is security sensitive and nothing here should ever be
 * used where that would matter.
 */

export interface Rng {
  /** Uniform in `[0, 1)`. */
  next(): number;
  /** Uniform integer in `[0, maxExclusive)`. */
  int(maxExclusive: number): number;
  /** Uniform integer in `[min, max]`. */
  between(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffled<T>(items: readonly T[]): T[];
}

export class RngError extends Error {
  override readonly name = 'RngError';
}

function seedToInt(seed: string): number {
  const digest = createHash('sha256').update(seed, 'utf8').digest();
  return digest.readUInt32BE(0);
}

class Mulberry32 implements Rng {
  #state: number;

  constructor(seed: string) {
    this.#state = seedToInt(seed);
  }

  next(): number {
    this.#state = (this.#state + 0x6d2b79f5) | 0;
    let t = this.#state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
      throw new RngError(`int() needs a positive integer bound, got ${maxExclusive}`);
    }
    return Math.floor(this.next() * maxExclusive);
  }

  between(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
      throw new RngError(`between() needs min <= max integers, got ${min}..${max}`);
    }
    return min + this.int(max - min + 1);
  }

  pick<T>(items: readonly T[]): T {
    const value = items[this.int(items.length || 1)];
    if (value === undefined) {
      throw new RngError('pick() called on an empty list');
    }
    return value;
  }

  shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      const a = copy[i];
      const b = copy[j];
      if (a === undefined || b === undefined) {
        throw new RngError('shuffled() saw a hole in the array');
      }
      copy[i] = b;
      copy[j] = a;
    }
    return copy;
  }
}

export function createRng(seed: string): Rng {
  if (seed.length === 0) {
    throw new RngError('seed must not be empty');
  }
  return new Mulberry32(seed);
}
