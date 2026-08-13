import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Sentence embeddings for the vector and hybrid baselines.
 *
 * This runs a real trained model, all-MiniLM-L6-v2, locally through ONNX. It
 * makes no network call at query time, needs no account and no key, and the
 * weights are cached on disk after the first run. That matters because a vector
 * baseline standing in for a real one is the easiest way to rig a comparison in
 * favour of whatever the author is selling. If the model cannot be loaded the
 * harness fails rather than quietly substituting something weaker.
 *
 * Model card: https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 * Licence: Apache-2.0. ONNX conversion: Xenova/all-MiniLM-L6-v2.
 */

export const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

/** Batch size for the encoder. Large enough to amortise the call, small enough to hold. */
const BATCH = 64;

export interface Embedder {
  readonly model: string;
  readonly dimensions: number;
  /** One row per input, L2 normalised, so a dot product is the cosine. */
  embed: (texts: readonly string[]) => Promise<Float32Array[]>;
}

export async function loadEmbedder(): Promise<Embedder> {
  // Imported here rather than at module scope so that everything else in the
  // harness stays importable, and unit testable, without pulling in ONNX.
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', EMBEDDING_MODEL);

  return {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
    async embed(texts: readonly string[]): Promise<Float32Array[]> {
      const rows: Float32Array[] = [];
      for (let start = 0; start < texts.length; start += BATCH) {
        const batch = texts.slice(start, start + BATCH);
        const output = await extractor(batch as string[], { pooling: 'mean', normalize: true });
        const [count, width] = output.dims as [number, number];
        if (count !== batch.length || width !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `embedder returned ${count}x${width}, expected ${batch.length}x${EMBEDDING_DIMENSIONS}`,
          );
        }
        const flat = output.data as Float32Array;
        for (let row = 0; row < count; row += 1) {
          rows.push(flat.slice(row * width, (row + 1) * width));
        }
      }
      return rows;
    },
  };
}

/** Dot product of two L2 normalised vectors, which is their cosine similarity. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i]! * b[i]!;
  }
  return total;
}

/**
 * Embeddings keyed by the exact texts they were produced from.
 *
 * The key is a hash of the model name and every input string, so a corpus
 * change or a model change misses the cache rather than silently reusing
 * vectors for text that no longer exists. Cached under a gitignored directory:
 * it is derived data, and eight megabytes of floats do not belong in history.
 */
export async function embedCached(
  embedder: Embedder,
  texts: readonly string[],
  cachePath: string,
  onProgress?: (done: number, total: number) => void,
): Promise<Float32Array[]> {
  const digest = createHash('sha256');
  digest.update(embedder.model);
  for (const text of texts) {
    // A separator that cannot occur in the texts, so two different lists
    // cannot hash the same by running together at the join.
    digest.update('\0');
    digest.update(text);
  }
  const key = digest.digest('hex');
  const stamp = `${key}\n`;

  try {
    const raw = readFileSync(cachePath);
    const split = raw.indexOf(0x0a) + 1;
    if (raw.subarray(0, split).toString('utf8') === stamp) {
      const floats = new Float32Array(
        raw.buffer.slice(raw.byteOffset + split, raw.byteOffset + raw.length),
      );
      const rows: Float32Array[] = [];
      for (let i = 0; i < texts.length; i += 1) {
        rows.push(floats.slice(i * embedder.dimensions, (i + 1) * embedder.dimensions));
      }
      onProgress?.(texts.length, texts.length);
      return rows;
    }
  } catch {
    // No cache, or an unreadable one. Both mean the same thing: embed it again.
  }

  const rows: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += BATCH) {
    rows.push(...(await embedder.embed(texts.slice(start, start + BATCH))));
    onProgress?.(Math.min(start + BATCH, texts.length), texts.length);
  }

  const packed = new Float32Array(rows.length * embedder.dimensions);
  rows.forEach((row, index) => packed.set(row, index * embedder.dimensions));
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, Buffer.concat([Buffer.from(stamp, 'utf8'), Buffer.from(packed.buffer)]));
  return rows;
}
