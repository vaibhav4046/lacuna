import { HydraClient } from '../hydra/client.js';
import { loadHydraConfig } from '../hydra/config.js';
import { assertIdentifier } from '../hydra/identifiers.js';
import { NODE_LABELS } from '../ingest/plan.js';

/**
 * What this CLI is pointed at and what is in there.
 *
 * `doctor` answers "can this work". This answers "what am I looking at", which
 * is the question that matters once two graphs exist and a wrong namespace
 * returns an empty answer that looks exactly like a real abstention.
 *
 * The counts are one `count(*)` per label, which the node answers from its own
 * bookkeeping rather than by walking anything, so this stays cheap on a corpus
 * of any size. The read epoch comes from the last of those requests, which is
 * the epoch a question asked right now would be answered at.
 */

export interface LabelCount {
  readonly label: string;
  readonly count: number;
}

export interface StatusReport {
  readonly baseUrl: string;
  readonly namespace: string;
  readonly graph: string;
  readonly cell: string;
  readonly counts: readonly LabelCount[];
  readonly readEpoch: number | null;
}

export async function runStatus(
  env: Record<string, string | undefined>,
  timeoutMs: number,
): Promise<StatusReport> {
  const config = loadHydraConfig(env);
  const client = new HydraClient(config);

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
    baseUrl: config.baseUrl,
    namespace: config.namespace,
    graph: config.graph,
    cell: config.cell,
    counts,
    readEpoch,
  };
}
