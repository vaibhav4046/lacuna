import type { GoldQuestion } from '../corpus/types.js';
import type { HydraClient } from '../hydra/client.js';
import {
  affectedText,
  ask,
  blastRadius,
  buildPackageName,
  buildQuestion,
  parseBlast,
  parseVia,
} from '../retrieval/index.js';
import { blastReach, bridgeFrom, read, readBlast } from './reader.js';
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

/** One entry per message, so a second round is not billed twice for an overlap. */
function dedupe(messages: readonly IndexedMessage[]): IndexedMessage[] {
  const seen = new Map<number, IndexedMessage>();
  for (const message of messages) {
    seen.set(message.ordinal, message);
  }
  return [...seen.values()];
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
      // A blast radius asks for a closure rather than a value, so it gets a
      // reader that walks one. Which questions those are is read off the
      // sentence, not off the thread kind the corpus filed it under.
      const root = parseBlast(question.text);
      const outcome = root === null
        ? read({ question, retrieved, mode })
        : readBlast({ root, retrieved, kinds: index.kinds });
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

      // A blast radius gets the same courtesy the relational questions get, and
      // then some: a second round on every name the first round reached, not
      // just one bridge. That is the strongest thing a flat index can do here,
      // and it is charged for all of it. What it still cannot do is a third
      // round, because a two round pipeline is what a two round pipeline is,
      // and the chains in this corpus are longer than two.
      const root = parseBlast(question.text);
      if (root !== null) {
        const rounds = [first];
        for (const name of [root, ...blastReach(first, root)]) {
          const followUp: GoldQuestion = {
            ...question,
            subject: name,
            text: followUpText(question.predicate, name),
          };
          rounds.push(resolveAll(index, retriever.rank(followUp, k)));
        }
        const union = dedupe(rounds.flat());
        return {
          outcome: readBlast({ root, retrieved: union, kinds: index.kinds }),
          contextChars: charsOf(union),
          ms: performance.now() - started,
        };
      }

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

      return {
        outcome,
        contextChars: charsOf(dedupe([...first, ...second])),
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

      // The same call the /blast page makes, against the same graph. Nothing
      // about the benchmark reaches into the traversal, and the traversal does
      // not know it is being scored.
      const name = parseBlast(question.text);
      if (name !== null) {
        const walked = await blastRadius(client, buildPackageName(name));
        const cited = walked.evidence.reduce((total, record) => total + record.quote.length, 0);
        return {
          outcome: walked.radius === null
            ? { type: 'abstain', reason: 'out_of_scope' }
            : { type: 'answer', text: affectedText(walked.radius) },
          contextChars: cited,
          ms: performance.now() - started,
        };
      }

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
