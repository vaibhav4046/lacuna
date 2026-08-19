import { assertIdentifier } from '../hydra/identifiers.js';
import { openSource, type Profile } from '../hydra/open.js';
import { NODE_LABELS } from '../ingest/plan.js';

/**
 * What this CLI is pointed at and what is in there.
 *
 * `doctor` answers "can this work". This answers "what am I looking at", which
 * is the question that matters once two stores exist and a wrong one returns an
 * empty answer that looks exactly like a real abstention.
 *
 * Which store is not this file's decision. It calls `openSource`, the same seam
 * `ask` goes through, so the two cannot disagree. They used to: this command
 * loaded the node configuration directly, so on a machine with
 * `LACUNA_PROFILE=cloud` it printed the loopback node's counts while every
 * question in the same shell was answered by HydraDB Cloud, and on a machine
 * with no node at all it failed outright while the CLI worked. A status command
 * that reports a different store than the answers came from is worse than no
 * status command.
 *
 * The counts are one `count(*)` per label, which the node answers from its own
 * bookkeeping rather than by walking anything, so this stays cheap on a corpus
 * of any size. The cloud has no equivalent: it is a document API addressed by
 * id, with no query that counts a label. So the cloud profile reports the store
 * and no counts, rather than counting zero and letting a zero read as empty.
 */

export interface LabelCount {
  readonly label: string;
  readonly count: number;
}

/** Reported on the node profile only. The cloud exposes none of it. */
export interface NodeIdentity {
  readonly baseUrl: string;
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
  readonly readEpoch: number | null;
}

export interface StatusReport {
  readonly profile: Profile;
  /** One line naming the store. Never a URL, never a token. */
  readonly store: string;
  readonly node: NodeIdentity | null;
  readonly counts: readonly LabelCount[];
}

export async function runStatus(
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<StatusReport> {
  const opened = openSource(env);

  if (opened.profile === 'cloud' || opened.client === null) {
    return { profile: opened.profile, store: opened.describe, node: null, counts: [] };
  }

  const client = opened.client;
  const identity = client.identity;
  const counts: LabelCount[] = [];
  let readEpoch: number | null = null;

  for (const label of NODE_LABELS) {
    // The label reaches the statement as text rather than as a parameter, so it
    // goes through the same guard every other query in this repository uses.
    const safe = assertIdentifier(label, 'node label');
    const page = await client.queryPage({
      cypher: `MATCH (n:${safe}) RETURN count(*) AS n`,
      timeoutMs,
    });
    const value = page.rows[0]?.[0];
    counts.push({ label, count: typeof value === 'number' ? value : 0 });
    readEpoch = page.readEpoch;
  }

  return {
    profile: opened.profile,
    store: opened.describe,
    node: { ...identity, readEpoch },
    counts,
  };
}
