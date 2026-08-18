/**
 * The equality the snapshot verifier runs on.
 *
 * scripts/verify-snapshot.ts asks the live node and the snapshot transport
 * every gold question and compares the full answers field by
 * field: resolution, trace, evidence, subgraph, query log. Two fields are
 * excluded because they measure the run rather than the answer. Wall-clock
 * milliseconds measure network versus replay and cannot be equal. The read
 * epoch is the object-store version the read observed, and every later write
 * advances it: re-running the ingest after the snapshot was exported changes
 * every epoch in the graph and not one row of content, so comparing it would
 * fail the verifier on any node that has been written to since export.
 *
 * The query log is sorted before comparison: the claims and mentions reads
 * run in parallel and land in completion order, which races over the network
 * on the live path and is stable on replay. Two consecutive live runs can
 * disagree on that order too — it is scheduling, not content.
 *
 * Everything else counts: the verdict, the value, the claims and their
 * supersession edges, the quotations, the Cypher with its parameters and its
 * row counts.
 */

import type { Answer, BlastAnswer, QueryTrace } from '../retrieval/index.js';

function comparableQueries(queries: readonly QueryTrace[]): readonly unknown[] {
  return queries
    .map((trace) => ({ ...trace, ms: null, readEpoch: null }))
    .sort((a, b) => {
      const left = `${a.cypher} ${JSON.stringify(a.parameters)}`;
      const right = `${b.cypher} ${JSON.stringify(b.parameters)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
}

export function comparableAnswer(answer: Answer): string {
  return JSON.stringify(
    { ...answer, ms: null, queries: comparableQueries(answer.queries) },
    null,
    2,
  );
}

/**
 * The same equality for a blast radius, which the verifier has to compare
 * separately because it is a different shape reached by a different call. The
 * fields that matter are the affected set, every path with the claim id on
 * each hop, and the evidence those ids resolve to — all of which have to
 * survive replay, or the deployed page is showing a walk the node never did.
 */
export function comparableBlast(answer: BlastAnswer): string {
  return JSON.stringify(
    { ...answer, ms: null, queries: comparableQueries(answer.queries) },
    null,
    2,
  );
}
