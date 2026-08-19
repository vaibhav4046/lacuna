import { createHash } from 'node:crypto';

import type { HydraCloud, IngestResult } from '../hydra/cloud.js';
import { buildCloudGraph, toAppRecords } from '../hydra/cloud-graph.js';
import { extract } from '../extract/extract.js';
import { toCorpus } from '../extract/adapt.js';
import { buildPlan } from '../ingest/plan.js';

/**
 * A transcript somebody pasted, turned into memory they can then ask about.
 *
 * This is the path the product was missing. Everything else reads a corpus that
 * shipped with the repository, so a signed-in stranger reached an empty
 * workspace and had no way to fill it, which makes every claim about the
 * product a claim about a demo.
 *
 * One path rather than five connectors. Text in, and the same pipeline the
 * benchmarks use runs over it: the extractor decides what may become a claim,
 * the planner builds the graph, and the records go to HydraDB Cloud.
 *
 * Two things it deliberately does not do. It does not invent structure the
 * prose did not carry, so a transcript the frame table cannot read produces no
 * claims and says so rather than filling a workspace with guesses. And it does
 * not write anywhere the public demo can be read from: every workspace gets its
 * own collection, because ingesting one person's conversation into the
 * collection `/demo/*` serves would publish it.
 */

/** Long enough for a real meeting, short enough to extract inside a request. */
export const MAX_SOURCE_CHARS = 20_000;

/** The service's own vocabulary caps how much goes in one call. */
const BATCH = 25;

export type IngestFailure =
  | 'text_required'
  | 'text_too_long'
  | 'title_required'
  | 'nothing_extracted';

export interface IngestReport {
  readonly sourceKey: string;
  readonly collection: string;
  readonly turns: number;
  readonly claims: number;
  readonly entities: number;
  /** Records the service accepted for indexing. */
  readonly accepted: number;
  readonly refused: readonly { readonly id: string; readonly error: string }[];
  readonly ms: number;
  readonly truncated: boolean;
}

/**
 * The collection one account's memory lives in.
 *
 * Derived from the address rather than stored, so it is the same on every
 * request without a lookup, and hashed rather than spelled so the collection
 * names held by the service are not a list of who has signed up. The prefix
 * keeps them identifiable as this product's, beside whatever else shares the
 * database.
 */
export function workspaceCollection(email: string): string {
  const digest = createHash('sha256').update(email.trim().toLowerCase(), 'utf8').digest('hex');
  return `lacuna-ws-${digest.slice(0, 32)}`;
}

export function validateSource(title: unknown, text: unknown): IngestFailure | null {
  if (typeof title !== 'string' || title.trim() === '') return 'title_required';
  if (typeof text !== 'string' || text.trim() === '') return 'text_required';
  if (text.length > MAX_SOURCE_CHARS * 4) return 'text_too_long';
  return null;
}

/**
 * Runs one source all the way into the store.
 *
 * The whole pipeline is the shipped one: `extract` reads the prose, `toCorpus`
 * puts the claims in the shape `buildPlan` already consumes, and
 * `buildCloudGraph` produces the same record layout the demo corpus was written
 * with. Nothing here is a second implementation, which is why a claim ingested
 * this way answers through exactly the same resolver.
 */
export async function ingestSource(
  cloud: HydraCloud,
  collection: string,
  title: string,
  rawText: string,
  now: () => number = Date.now,
): Promise<IngestReport | IngestFailure> {
  const started = now();
  const truncated = rawText.length > MAX_SOURCE_CHARS;
  const text = truncated ? rawText.slice(0, MAX_SOURCE_CHARS) : rawText;

  // A key derived from the content, so ingesting the same transcript twice
  // upserts the same records rather than doubling the workspace.
  const sourceKey = `src-${createHash('sha256').update(`${title}\n${text}`, 'utf8').digest('hex').slice(0, 24)}`;

  const extraction = extract(text, {
    sessionKey: sourceKey,
    title: title.trim().slice(0, 120),
    startedAt: new Date(started).toISOString(),
  });

  if (extraction.claims.length === 0) return 'nothing_extracted';

  const corpus = toCorpus(extraction, {
    sessionKey: sourceKey,
    title: title.trim().slice(0, 120),
    startedAt: new Date(started).toISOString(),
  });

  const graph = buildCloudGraph(buildPlan(corpus));
  const records = toAppRecords(graph);

  const scoped = cloud.withCollection(collection);
  const accepted: string[] = [];
  const refused: { id: string; error: string }[] = [];

  for (let at = 0; at < records.length; at += BATCH) {
    const results: readonly IngestResult[] = await scoped.ingestApp(records.slice(at, at + BATCH), collection);
    for (const result of results) {
      if (result.error === null || result.error === '') accepted.push(result.id);
      else refused.push({ id: result.id, error: result.error });
    }
  }

  return {
    sourceKey,
    collection,
    turns: extraction.turns.length,
    claims: extraction.claims.length,
    entities: graph.entities.length,
    accepted: accepted.length,
    refused,
    ms: now() - started,
    truncated,
  };
}
