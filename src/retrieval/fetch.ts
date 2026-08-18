import type { HydraSource, Read } from '../hydra/source.js';
import type {
  Answer,
  EvidenceRecord,
  QueryTrace,
  RetrievalQuestion,
  SubjectView,
} from './types.js';
import { RetrievalConsistencyError } from './errors.js';
import { citedClaims, resolve, selectHopTarget } from './resolve.js';

/**
 * Reading the subgraph a question needs, and nothing else.
 *
 * The shape of this file is the performance argument. An out of scope question
 * costs one read, because the first lookup already answers it. A direct
 * question costs the subject read plus one per cited claim. A two hop question
 * costs two subject reads plus citations. Independent reads are issued
 * together rather than in sequence, so the wall clock cost of a question is
 * closer to its deepest dependency than to its total read count.
 *
 * No stage of this decides anything. It gathers through the source seam, hands
 * the result to the pure resolver, and then fetches citations for whatever the
 * resolver leaned on. Which store answered is the source's business; this file
 * cannot tell and does not ask.
 */

/** Matches the node's own admission control ceiling. See DECISIONS.md D-024. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export interface AskOptions {
  readonly timeoutMs?: number;
}

/**
 * Keeps every round trip so the cost reported next to an answer is a
 * measurement a reader can repeat rather than a number to be trusted.
 */
export class QueryRecorder {
  readonly #trips: QueryTrace[] = [];

  get trips(): readonly QueryTrace[] {
    return this.#trips;
  }

  /** Records what a source read cost and hands back what it read. */
  take<T>(read: Read<T>): T {
    this.#trips.push(...read.traces);
    return read.value;
  }
}

/** One decimal place, which is the resolution a wall clock reading deserves. */
export function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

export async function ask(
  source: HydraSource,
  question: RetrievalQuestion,
  options: AskOptions = {},
): Promise<Answer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const counter = new QueryRecorder();
  const started = performance.now();

  const subject = counter.take(await source.subject(question.subject, timeoutMs));

  let bridge: SubjectView | null = null;
  if (subject.id !== null && question.via !== null) {
    const selection = selectHopTarget(subject, question.via);
    if (selection.type === 'one') {
      bridge = counter.take(await source.subject(selection.mention.entityName, timeoutMs));
      if (bridge.id !== selection.mention.entityId) {
        // The mention gave an id and the name lookup gave a different one, which
        // means two Entity nodes share a name. Answering would cite whichever
        // one this path happened to reach.
        throw new RetrievalConsistencyError(
          `"${selection.mention.entityName}" is entity ${selection.mention.entityId} `
          + `by mention and ${bridge.id ?? 'nothing'} by name`,
        );
      }
    }
  }

  const resolution = resolve({ question, subject, bridge });

  // Issued together, recorded in the order asked for rather than the order
  // they came back in, so the trace beside an answer is the same trace twice.
  const wanted = citedClaims(resolution);
  const reads = await Promise.all(
    wanted.map(async (claimId) => source.evidence(claimId, timeoutMs)),
  );
  const evidence: readonly EvidenceRecord[] = reads.flatMap((read) => counter.take(read));

  return {
    question,
    subject,
    bridge,
    resolution,
    evidence,
    queries: counter.trips,
    ms: round(performance.now() - started),
  };
}
