import type { HydraClient } from '../hydra/client';
import type { PreparedQuery } from '../hydra/queries';
import { rowsToObjects } from '../hydra/values';
import { RetrievalConsistencyError } from './errors';
import { decodeClaims, decodeEntity, decodeEvidence, decodeMentions, type Row } from './decode';
import {
  claimsAbout,
  entityByName,
  evidenceForClaim,
  mentionsFrom,
} from './queries';
import { citedClaims, resolve, selectHopTarget } from './resolve';
import type {
  Answer,
  EvidenceRecord,
  QueryTrace,
  RetrievalQuestion,
  SubjectView,
} from './types';

/**
 * Reading the subgraph a question needs, and nothing else.
 *
 * The shape of this file is the performance argument. An out of scope question
 * costs one query, because the first lookup already answers it. A direct
 * question costs three plus one per cited claim. A two hop question costs six
 * plus citations. Independent reads are issued together rather than in sequence,
 * so the wall clock cost of a question is closer to its deepest dependency than
 * to its total query count.
 *
 * No stage of this decides anything. It gathers, hands the result to the pure
 * resolver, and then fetches citations for whatever the resolver leaned on.
 */

/** Matches the node's own admission control ceiling. See DECISIONS.md D-024. */
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export interface AskOptions {
  readonly timeoutMs?: number;
}

/**
 * Keeps every round trip so the cost reported next to an answer is a
 * measurement a reader can repeat rather than a number to be trusted.
 *
 * It reads through `query` rather than `queryObjects` because the read epoch is
 * on the page and not on the rows, and the epoch is the part that shows which
 * version of the store an answer was read from.
 */
class QueryRecorder {
  readonly #trips: QueryTrace[] = [];

  get trips(): readonly QueryTrace[] {
    return this.#trips;
  }

  async run(
    client: HydraClient,
    prepared: PreparedQuery,
    timeoutMs: number,
  ): Promise<readonly Row[]> {
    const started = performance.now();
    const page = await client.query({ ...prepared, timeoutMs });
    this.#trips.push({
      cypher: prepared.cypher,
      parameters: prepared.parameters,
      rows: page.rows.length,
      ms: round(performance.now() - started),
      readEpoch: page.readEpoch,
    });
    return rowsToObjects(page.columns, page.rows) as readonly Row[];
  }
}

/** One decimal place, which is the resolution a wall clock reading deserves. */
function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

async function readSubject(
  client: HydraClient,
  counter: QueryRecorder,
  name: string,
  timeoutMs: number,
): Promise<SubjectView> {
  const head = decodeEntity(await counter.run(client, entityByName(name), timeoutMs));
  if (head === null) {
    // One query, and the question is already answered. Reading claims for a name
    // that has no node would be three round trips to learn nothing.
    return { name, id: null, kind: null, claims: [], mentions: [] };
  }

  const [claimRows, mentionRows] = await Promise.all([
    counter.run(client, claimsAbout(head.id), timeoutMs),
    counter.run(client, mentionsFrom(head.id), timeoutMs),
  ]);

  return {
    name,
    id: head.id,
    kind: head.kind,
    claims: decodeClaims(claimRows),
    mentions: decodeMentions(mentionRows),
  };
}

export async function ask(
  client: HydraClient,
  question: RetrievalQuestion,
  options: AskOptions = {},
): Promise<Answer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const counter = new QueryRecorder();
  const started = performance.now();

  const subject = await readSubject(client, counter, question.subject, timeoutMs);

  let bridge: SubjectView | null = null;
  if (subject.id !== null && question.via !== null) {
    const selection = selectHopTarget(subject, question.via);
    if (selection.type === 'one') {
      bridge = await readSubject(client, counter, selection.mention.entityName, timeoutMs);
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

  const wanted = citedClaims(resolution);
  const fetched = await Promise.all(
    wanted.map(async (claimId) => decodeEvidence(
      claimId,
      await counter.run(client, evidenceForClaim(claimId), timeoutMs),
    )),
  );
  const evidence: readonly EvidenceRecord[] = fetched.flat();

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
