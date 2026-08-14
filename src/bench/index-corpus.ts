import type { Corpus } from '../corpus/types.js';
import type { CorpusIndex, IndexedMessage } from './types.js';

/**
 * Flattening the corpus into the shape a flat retriever sees.
 *
 * A retriever that works over chunks does not get sessions, threads, or the
 * knowledge that two messages talk about the same fact. It gets text and a
 * timestamp. Building that view explicitly, rather than letting each baseline
 * reach into the corpus for whatever it likes, is what keeps the baselines
 * comparable to each other and honest about what they are.
 */

/** Tokens shorter than this carry no retrieval signal and inflate every posting list. */
const MIN_TOKEN_CHARS = 2;

/**
 * Split on anything that is not a letter or a digit, then lowercase.
 *
 * Deliberately plain. No stemming and no stopword list, because BM25 already
 * discounts a term that appears everywhere, and because a hand tuned tokenizer
 * is a place to accidentally help or hurt one baseline.
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_CHARS) {
      tokens.push(raw);
    }
  }
  return tokens;
}

export function buildIndex(corpus: Corpus): CorpusIndex {
  const flattened: Omit<IndexedMessage, 'ordinal'>[] = [];
  for (const session of corpus.sessions) {
    for (const message of session.messages) {
      flattened.push({
        key: message.key,
        sessionKey: session.key,
        sessionTitle: session.title,
        timestamp: message.timestamp,
        speaker: message.speaker,
        text: message.text,
        claims: message.claims,
        tokens: tokenize(message.text),
      });
    }
  }

  // Oldest first, with the message key as the tie break so the order is total
  // and does not depend on how the sessions happened to be emitted.
  flattened.sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.key < b.key ? -1 : 1;
  });

  const messages: IndexedMessage[] = flattened.map((message, ordinal) => ({
    ...message,
    ordinal,
  }));

  const subjects = new Set<string>();
  for (const message of messages) {
    for (const claim of message.claims) {
      subjects.add(claim.subject);
    }
  }

  return { messages, subjects };
}
