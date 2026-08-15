/**
 * The equality the snapshot verifier runs on.
 *
 * scripts/verify-snapshot.ts asks the live node and the snapshot transport
 * the same sixty questions and compares the full Answer objects field by
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

import type { Answer } from '../retrieval/index.js';

export function comparableAnswer(answer: Answer): string {
  const queries = answer.queries
    .map((trace) => ({ ...trace, ms: null, readEpoch: null }))
    .sort((a, b) => {
      const left = `${a.cypher} ${JSON.stringify(a.parameters)}`;
      const right = `${b.cypher} ${JSON.stringify(b.parameters)}`;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  return JSON.stringify({ ...answer, ms: null, queries }, null, 2);
}
