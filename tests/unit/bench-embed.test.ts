import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { cosine, embedCached, type Embedder } from '../../src/bench/embed';

/**
 * Sentence embeddings for the vector and hybrid baselines.
 *
 * The real encoder is not loaded here. What matters at this level is the cache,
 * because a cache that returns the wrong vectors is the quietest way to break a
 * benchmark: nothing throws, the numbers still print, and the vector baseline is
 * silently ranking against text that no longer exists. So the cases below are
 * mostly about what has to miss.
 */

const DIMENSIONS = 4;

/** Vectors derived from the text, so a wrong cache hit shows up as wrong numbers. */
function fake(model = 'fake-model'): { embedder: Embedder; batches: string[][] } {
  const batches: string[][] = [];
  return {
    batches,
    embedder: {
      model,
      dimensions: DIMENSIONS,
      embed(texts: readonly string[]): Promise<Float32Array[]> {
        batches.push([...texts]);
        return Promise.resolve(
          texts.map((text) => {
            const seed = [...text].reduce((total, char) => total + char.charCodeAt(0), 0);
            return Float32Array.from(Array.from({ length: DIMENSIONS }, (_, i) => seed + i));
          }),
        );
      },
    },
  };
}

const rows = (vectors: readonly Float32Array[]): number[][] => vectors.map((row) => [...row]);

describe('cosine', () => {
  it('is zero for orthogonal vectors', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBe(0);
  });

  it('is one for a unit vector against itself', () => {
    expect(cosine(Float32Array.from([0.6, 0.8]), Float32Array.from([0.6, 0.8]))).toBeCloseTo(1, 6);
  });

  it('is negative for vectors pointing opposite ways', () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([-1, 0]))).toBe(-1);
  });

  it('is the dot product, which is the cosine only because the rows are normalised', () => {
    // Documented rather than defended: the encoder is asked for normalised
    // output, and this function trusts it. An unnormalised row would produce a
    // number above one here and rank fine anyway, which is why the normalise
    // flag at the call site is load bearing.
    expect(cosine(Float32Array.from([3, 0]), Float32Array.from([2, 0]))).toBe(6);
  });
});

describe('embedCached', () => {
  let directory = '';
  let cachePath = '';

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'lacuna-embed-'));
    cachePath = join(directory, 'nested', 'vectors.bin');
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('embeds on the first call and returns one row per text', async () => {
    const { embedder, batches } = fake();
    const result = await embedCached(embedder, ['alpha', 'beta'], cachePath);

    expect(batches).toEqual([['alpha', 'beta']]);
    expect(result).toHaveLength(2);
    expect([...(result[0] ?? [])]).toHaveLength(DIMENSIONS);
  });

  it('creates the directory it was pointed at', async () => {
    const { embedder } = fake();
    await embedCached(embedder, ['alpha'], cachePath);

    expect(() => readFileSync(cachePath)).not.toThrow();
  });

  it('reads the same vectors back without embedding again', async () => {
    const first = fake();
    const written = await embedCached(first.embedder, ['alpha', 'beta'], cachePath);

    const second = fake();
    const read = await embedCached(second.embedder, ['alpha', 'beta'], cachePath);

    expect(second.batches).toEqual([]);
    expect(rows(read)).toEqual(rows(written));
  });

  it('misses when any text changed', async () => {
    const first = fake();
    await embedCached(first.embedder, ['alpha', 'beta'], cachePath);

    const second = fake();
    await embedCached(second.embedder, ['alpha', 'gamma'], cachePath);

    // The corpus is regenerated from a seed and the cache path does not carry
    // the seed. Keying on the texts is what stops a regenerated corpus from
    // being scored against the previous one's vectors.
    expect(second.batches).toEqual([['alpha', 'gamma']]);
  });

  it('misses when the model changed', async () => {
    const first = fake('fake-model');
    await embedCached(first.embedder, ['alpha'], cachePath);

    const second = fake('other-model');
    await embedCached(second.embedder, ['alpha'], cachePath);

    expect(second.batches).toEqual([['alpha']]);
  });

  it('separates the texts, so two different lists cannot hash the same', async () => {
    // Both lists concatenate to "abc". Hashed without a separator they would be
    // the same key, and the second run would be handed the first run's vectors
    // for text it never saw.
    const first = fake();
    const written = await embedCached(first.embedder, ['ab', 'c'], cachePath);

    const second = fake();
    const read = await embedCached(second.embedder, ['a', 'bc'], cachePath);

    expect(second.batches).toEqual([['a', 'bc']]);
    expect(rows(read)).not.toEqual(rows(written));
  });

  it('re-embeds when there is no cache file at all', async () => {
    const { embedder, batches } = fake();
    await embedCached(embedder, ['alpha'], join(directory, 'absent.bin'));

    expect(batches).toEqual([['alpha']]);
  });

  it('re-embeds rather than throwing on a corrupt cache file', async () => {
    const first = fake();
    await embedCached(first.embedder, ['alpha'], cachePath);
    writeFileSync(cachePath, Buffer.from('not a cache file'));

    const second = fake();
    const result = await embedCached(second.embedder, ['alpha'], cachePath);

    expect(second.batches).toEqual([['alpha']]);
    expect(rows(result)).toEqual(rows(await second.embedder.embed(['alpha'])));
  });

  it('reports progress while embedding', async () => {
    const { embedder } = fake();
    const seen: Array<[number, number]> = [];
    await embedCached(embedder, ['alpha', 'beta'], cachePath, (done, total) =>
      seen.push([done, total]),
    );

    expect(seen).toEqual([[2, 2]]);
  });

  it('reports progress on a cache hit too, so the caller sees it finish', async () => {
    const first = fake();
    await embedCached(first.embedder, ['alpha', 'beta'], cachePath);

    const seen: Array<[number, number]> = [];
    await embedCached(fake().embedder, ['alpha', 'beta'], cachePath, (done, total) =>
      seen.push([done, total]),
    );

    expect(seen).toEqual([[2, 2]]);
  });

  it('handles an empty list without writing a broken cache', async () => {
    const first = fake();
    expect(await embedCached(first.embedder, [], cachePath)).toEqual([]);
    expect(first.batches).toEqual([]);

    const second = fake();
    expect(await embedCached(second.embedder, [], cachePath)).toEqual([]);
    expect(second.batches).toEqual([]);
  });
});
