import type { GoldQuestion } from '../corpus/types.js';
import type { HydraClient } from '../hydra/client.js';
import { ask, buildQuestion, parseVia } from '../retrieval/index.js';
import { bridgeFrom, read } from './reader.js';
import type { BenchResult, BenchSystem, CorpusIndex, IndexedMessage, ReaderMode, Retriever } from './types.js';

/**
 * Each approach dressed as the same thing: a question in, a decision out, with
 * what it cost to get there.
 *
 * Counting context is part of the measurement rather than a footnote to it. A
 * flat baseline hands its reader whole messages, because a chunk is the unit it
 * stores. Lacuna hands its reader the spans it cited and the claims it weighed,
 * because a span is the unit the graph stores. That difference is not a
 * measurement trick, it is the thing being claimed, and it is reported in the
 * same table as the accuracy so neither number travels without the other.
 */

/**
 * The query a two round baseline issues once it knows which entity to ask about.
 *
 * Exported because the vector baseline has to embed its queries ahead of time
 * and cannot embed a string it has not seen. One definition here means the text
 * that gets embedded is the text that gets asked, rather than two spellings of
 * the same intent that drift apart the first time either is edited.
 */
export function followUpText(predicate: string, bridge: string): string {
  return `${predicate} ${bridge}`;
}

function resolveAll(index: CorpusIndex, ranking: readonly number[]): IndexedMessage[] {
  return ranking.map((ordinal) => index.messages[ordinal]!);
}

function charsOf(messages: readonly IndexedMessage[]): number {
  return messages.reduce((total, message) => total + message.text.length, 0);
}

/** Retrieve once, read once. What a straightforward pipeline does. */
export function flatSystem(
  retriever: Retriever,
  index: CorpusIndex,
  k: number,
  mode: ReaderMode,
): BenchSystem {
  return {
    name: `${retriever.name}@${k}`,
    description: retriever.description,
    async answer(question: GoldQuestion): Promise<BenchResult> {
      const started = performance.now();
      const retrieved = resolveAll(index, retriever.rank(question, k));
      const outcome = read({ question, retrieved, mode });
      return {
        outcome,
        contextChars: charsOf(retrieved),
        ms: performance.now() - started,
      };
    },
  };
}

/**
 * Retrieve, and if the question named a relation and the first round found
 * nothing on the predicate, follow that relation and retrieve again.
 *
 * This is the honest steelman. A question of the form "who is our contact for
 * the vendor behind X" is answerable from a flat index in two rounds: find the
 * vendor, then search on the vendor's name. Leaving this out would let Lacuna
 * win the multi hop cases against a baseline nobody would actually ship. It is
 * charged for both rounds of context, which is what a second round costs.
 */
export function twoHopSystem(
  retriever: Retriever,
  index: CorpusIndex,
  k: number,
  mode: ReaderMode,
): BenchSystem {
  return {
    name: `${retriever.name}+2hop@${k}`,
    description: `${retriever.description}, with a second retrieval round through the named relation`,
    async answer(question: GoldQuestion): Promise<BenchResult> {
      const started = performance.now();
      const first = resolveAll(index, retriever.rank(question, k));
      const direct = read({ question, retrieved: first, mode });

      const via = parseVia(question.text);
      if (via === null || direct.type === 'answer') {
        return { outcome: direct, contextChars: charsOf(first), ms: performance.now() - started };
      }

      const bridge = bridgeFrom(first, question.subject, via);
      if (bridge === null) {
        return { outcome: direct, contextChars: charsOf(first), ms: performance.now() - started };
      }

      // The second round searches on the bridge entity, using the question the
      // corpus would have asked about it directly. Same retriever, same k.
      const followUp: GoldQuestion = {
        ...question,
        subject: bridge,
        text: followUpText(question.predicate, bridge),
      };
      const second = resolveAll(index, retriever.rank(followUp, k));
      const outcome = read({ question, retrieved: second, mode, subject: bridge });

      const seen = new Map<number, IndexedMessage>();
      for (const message of [...first, ...second]) {
        seen.set(message.ordinal, message);
      }
      return {
        outcome,
        contextChars: charsOf([...seen.values()]),
        ms: performance.now() - started,
      };
    },
  };
}

export function lacunaSystem(client: HydraClient): BenchSystem {
  return {
    name: 'lacuna',
    description: 'graph traversal over HydraDB, with the ordered decision procedure',
    async answer(question: GoldQuestion): Promise<BenchResult> {
      const started = performance.now();
      const built = buildQuestion(question.subject, question.predicate, parseVia(question.text));
      const answer = await ask(client, built);

      // What the answering step had in front of it: the quotations it cited and
      // the claims it weighed before deciding.
      const quoted = answer.evidence.reduce((total, record) => total + record.quote.length, 0);
      const weighed = answer.resolution.considered.reduce(
        (total, claim) => total + claim.objectText.length,
        0,
      );

      return {
        outcome: answer.resolution.outcome,
        contextChars: quoted + weighed,
        ms: performance.now() - started,
      };
    },
  };
}
