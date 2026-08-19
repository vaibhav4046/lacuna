import { askCore, lastReadEpoch, toRevisionItem } from '../contract/result.js';
import type { AskCore, QueryItem, RevisionItem } from '../contract/result.js';
import type { HydraConfig } from '../hydra/config.js';
import type { Answer } from '../retrieval/types.js';

/**
 * What an MCP client reads, which is the shared result contract plus the one
 * thing only this transport can supply: which node answered.
 *
 * The projection itself lives in `src/contract/result.ts` and is shared with
 * the CLI, because two hand-written mappers over the same `Answer` drifted once
 * already and there is no reason to believe they would not drift again. What is
 * left here is the part that is genuinely MCP's: the node identity, the two
 * envelopes that extend the shared one, and the health probe, which is not an
 * answer and so does not pretend to be one.
 *
 * This module is pure. It takes the object retrieval already produced and
 * reshapes it, and it never calls the graph, reads the environment or touches a
 * transport. That is deliberate: the shape a caller depends on is the part most
 * worth testing, and keeping it free of I/O means the tests are a set of
 * fixtures rather than a live node.
 *
 * Two rules govern what may appear in these results.
 *
 * The first is that every field is derived from something the domain actually
 * produced. There is no confidence score here, no relevance ranking, no
 * "sources consulted" count invented to look thorough. When a caller sees
 * `supersededClaims`, those are ids that came back from the graph with a
 * SUPERSEDES edge pointing at them.
 *
 * The second is that the base URL and the bearer token never reach a result.
 * `describeNode` is the narrowing that enforces it: it takes the whole config
 * and returns three strings, so a result cannot carry a credential even if a
 * later change starts spreading the node identity into more places. It is the
 * reason the shared contract module accepts no config at all.
 */

/**
 * Re-exported so the MCP layer stays one import for anything downstream of it.
 * `tools.ts` reads `MAX_EVIDENCE_ITEMS` to describe the cap it advertises, and
 * `index.ts` re-exports the whole set again for callers outside `src/mcp/`.
 */
export { lastReadEpoch, MAX_EVIDENCE_ITEMS } from '../contract/result.js';
export type { EvidenceItem, QueryItem, ResultStatus, RevisionItem } from '../contract/result.js';

/**
 * Which node answered.
 *
 * Namespace, graph and cell. Never the base URL, never the token.
 * `src/view/proof.ts` holds the same narrowing for the HTML surface. The
 * duplication is deliberate, so that nothing in the MCP layer has to import the
 * view layer to learn how to describe a node safely.
 */
export interface NodeIdentity {
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
}

/** The node identity a result carries, plus the epoch the reads observed. */
export interface HydraIdentity extends NodeIdentity {
  /** Which store answered. A node on loopback, or HydraDB Cloud. */
  readonly store: 'node' | 'cloud';
  readonly readEpoch: number | null;
}

/**
 * The envelope the three question tools share: the shared contract, plus the
 * node that served it.
 *
 * A caller can branch on `status` alone: `answer` and `claimId` are non-null
 * exactly when it is `'answered'`, and `reasonCode` is non-null exactly when it
 * is `'abstained'`. Every field before `hydra` is the same field, under the
 * same name, that the CLI emits for the same question.
 */
export interface AskResult extends AskCore {
  readonly hydra: HydraIdentity;
}

/** The envelope plus the resolver's own account of how it decided. */
export interface ExplainResult extends AskResult {
  readonly explanation: string;
  readonly trace: readonly string[];
}

/** The envelope plus the whole revision chain, oldest first. */
export interface TimelineResult extends AskResult {
  readonly considered: readonly RevisionItem[];
}

/** What `lacuna_health` returns. Not an answer, so it does not pretend to be one. */
export interface HealthResult {
  readonly reachable: boolean;
  readonly hydra: HydraIdentity;
  readonly queries: readonly QueryItem[];
  readonly timingMs: number;
  readonly sourceState: 'live';
  /**
   * An error category when the probe failed, null when it did not.
   *
   * A class name rather than a message. Transport failures name the endpoint
   * they could not reach, and the endpoint is built from the base URL, so
   * passing the message through would put the node's address in a tool result.
   */
  readonly error: string | null;
}

/** Everything a result may say about the node, and nothing more. */
export function describeNode(config: HydraConfig): NodeIdentity {
  return { namespace: config.namespace, graph: config.graph, cell: config.cell };
}

/**
 * The base envelope, shared by every question tool.
 *
 * The projection is the shared one, so `supersededClaims` keeps the order of
 * `considered` and an abstention carries the same fields an answer does. What
 * this function adds is the part only a transport knows: which node served the
 * request, and the epoch its reads observed.
 */
export function askResult(answer: Answer, node: NodeIdentity, store: 'node' | 'cloud'): AskResult {
  return {
    ...askCore(answer),
    hydra: { ...node, store, readEpoch: lastReadEpoch(answer.queries) },
  };
}

/**
 * The envelope plus the resolver's reasoning.
 *
 * `trace` is the resolver's own step list, not a reconstruction. It is included
 * because "why did you not answer" is the question this system exists to make
 * answerable, and a caller should not have to infer it from the reason code.
 */
export function explainResult(answer: Answer, node: NodeIdentity, store: 'node' | 'cloud'): ExplainResult {
  return {
    ...askResult(answer, node, store),
    explanation: answer.resolution.explanation,
    trace: answer.resolution.trace,
  };
}

/**
 * The envelope plus every claim about the predicate, oldest first.
 *
 * This is the tool that shows a revision chain. `considered` carries the
 * superseded claims alongside the current one, with both timestamps, so a
 * caller can see what the corpus used to say and when it changed its mind.
 */
export function timelineResult(answer: Answer, node: NodeIdentity, store: 'node' | 'cloud'): TimelineResult {
  return {
    ...askResult(answer, node, store),
    considered: answer.resolution.considered.map(toRevisionItem),
  };
}

/** Pretty JSON, which is what goes in the text block of a tool result. */
export function renderJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
