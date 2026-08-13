export { Bm25 } from './bm25';
export { cosine, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, embedCached, loadEmbedder } from './embed';
export type { Embedder } from './embed';
export { buildIndex, tokenize } from './index-corpus';
export { bridgeFrom, read } from './reader';
export type { ReadInput } from './reader';
export {
  hybridRetriever,
  lexicalRetriever,
  recencyRetriever,
  vectorRetriever,
} from './retrievers';
export {
  describeExpected,
  describeOutcome,
  judge,
  percent,
  percentile,
  scoreAll,
  VERDICTS,
} from './score';
export type { Metrics, Scored, Verdict } from './score';
export { flatSystem, followUpText, lacunaSystem, twoHopSystem } from './systems';
export type {
  BenchOutcome,
  BenchResult,
  BenchSystem,
  CorpusIndex,
  IndexedMessage,
  Ranking,
  ReaderMode,
  Retriever,
} from './types';

/**
 * No ranking cache lives in this module, on purpose.
 *
 * Caching one deep ranking per query and slicing it for every cut off would cut
 * the run time down, and it would turn every latency after the first into a
 * measurement of a map lookup. The scan is cheap enough to pay for on each
 * call, and a latency column that needs no footnote is worth more than the
 * minute it would save.
 */
