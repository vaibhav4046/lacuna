export { Bm25 } from './bm25.js';
export { cosine, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedCached, loadEmbedder } from './embed.js';
export type { Embedder } from './embed.js';
export { buildIndex, tokenize } from './index-corpus.js';
export { bridgeFrom, read } from './reader.js';
export type { ReadInput } from './reader.js';
export {
  hybridRetriever,
  lexicalRetriever,
  recencyRetriever,
  vectorRetriever,
} from './retrievers.js';
export {
  describeExpected,
  describeOutcome,
  judge,
  percent,
  percentile,
  scoreAll,
  VERDICTS,
} from './score.js';
export type { Metrics, Scored, Verdict } from './score.js';
export { flatSystem, followUpText, lacunaSystem, twoHopSystem } from './systems.js';
export type {
  BenchOutcome,
  BenchResult,
  BenchSystem,
  CorpusIndex,
  IndexedMessage,
  Ranking,
  ReaderMode,
  Retriever,
} from './types.js';

/**
 * No ranking cache lives in this module, on purpose.
 *
 * Caching one deep ranking per query and slicing it for every cut off would cut
 * the run time down, and it would turn every latency after the first into a
 * measurement of a map lookup. The scan is cheap enough to pay for on each
 * call, and a latency column that needs no footnote is worth more than the
 * minute it would save.
 */
