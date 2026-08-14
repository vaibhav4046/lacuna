import type { GoldQuestion } from '../corpus/types.js';
import { Bm25 } from './bm25.js';
import { cosine } from './embed.js';
import { tokenize } from './index-corpus.js';
import type { CorpusIndex, Ranking, Retriever } from './types.js';

/**
 * The four ways of finding messages that Lacuna is being compared against.
 *
 * Each one is given the question text and nothing else, and each returns
 * message positions best first. None of them is allowed to see the gold answer,
 * the thread kind, or the annotations, because a retriever that can see what it
 * is being scored on is not a retriever.
 */

/** The constant from the reciprocal rank fusion paper. Not tuned here. */
const RRF_K = 60;

/**
 * Recency over the messages that name the subject.
 *
 * Plain recency over the whole corpus would return the last few messages of a
 * five thousand message transcript and score near zero on everything, which
 * would be a strawman rather than a baseline. Filtering to messages that name
 * the subject first is what an assistant with a scrollback and a search box
 * actually does, so that is what is measured.
 */
export function recencyRetriever(index: CorpusIndex): Retriever {
  return {
    name: 'recency',
    description: 'newest messages naming the subject, most recent first',
    rank(question: GoldQuestion, limit: number): Ranking {
      const hits: number[] = [];
      for (let i = index.messages.length - 1; i >= 0 && hits.length < limit; i -= 1) {
        const message = index.messages[i]!;
        if (message.text.includes(question.subject)) {
          hits.push(message.ordinal);
        }
      }
      return hits;
    },
  };
}

export function lexicalRetriever(index: CorpusIndex): Retriever {
  const bm25 = new Bm25(index.messages);
  return {
    name: 'lexical',
    description: 'Okapi BM25 over message text, k1=1.2 b=0.75',
    rank(question: GoldQuestion, limit: number): Ranking {
      return bm25.score(tokenize(question.text)).slice(0, limit).map((hit) => hit.ordinal);
    },
  };
}

/**
 * `queryVectors` is keyed by the query text, never by the question id. A second
 * round query carries the id of the question that spawned it and asks something
 * different, so keying by id would quietly rank round two by round one's
 * meaning. Missing text throws rather than falling back, because the fallback
 * would be a ranking that looks fine and answers the wrong question.
 */
export function vectorRetriever(
  index: CorpusIndex,
  messageVectors: readonly Float32Array[],
  queryVectors: ReadonlyMap<string, Float32Array>,
  model: string,
): Retriever {
  return {
    name: 'vector',
    description: `cosine similarity over ${model} sentence embeddings`,
    rank(question: GoldQuestion, limit: number): Ranking {
      const query = queryVectors.get(question.text);
      if (query === undefined) {
        throw new Error(`no query embedding for text "${question.text}"`);
      }
      const scored = index.messages.map((message) => ({
        ordinal: message.ordinal,
        score: cosine(query, messageVectors[message.ordinal]!),
      }));
      scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.ordinal - b.ordinal));
      return scored.slice(0, limit).map((hit) => hit.ordinal);
    },
  };
}

/**
 * Reciprocal rank fusion of the lexical and vector rankings.
 *
 * Fusion over rank rather than score, because a BM25 score and a cosine are not
 * on the same scale and normalising them against each other is a choice that
 * would need defending. Rank fusion needs no such choice, which is why it is
 * the common default.
 *
 * Both inputs are asked for a deeper list than the caller wants, so that a
 * message ranked tenth by one method and fiftieth by the other can still
 * surface. Fusing two already truncated lists would throw away the agreement
 * that makes fusion worth doing.
 */
export function hybridRetriever(lexical: Retriever, vector: Retriever, depth: number): Retriever {
  return {
    name: 'hybrid',
    description: `reciprocal rank fusion of BM25 and vector, depth ${depth}, k=${RRF_K}`,
    rank(question: GoldQuestion, limit: number): Ranking {
      const fused = new Map<number, number>();
      for (const ranking of [lexical.rank(question, depth), vector.rank(question, depth)]) {
        ranking.forEach((ordinal, position) => {
          fused.set(ordinal, (fused.get(ordinal) ?? 0) + 1 / (RRF_K + position + 1));
        });
      }
      return [...fused.entries()]
        .sort((a, b) => (b[1] !== a[1] ? b[1] - a[1] : a[0] - b[0]))
        .slice(0, limit)
        .map(([ordinal]) => ordinal);
    },
  };
}
