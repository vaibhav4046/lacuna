/**
 * What the graph holds, counted off the plan that writes it.
 *
 * The Memory and Health pages both need to say what state every claim is in.
 * There are two ways to get that and only one of them is honest. The dishonest
 * one is a second state machine written beside the ingest planner, which would
 * agree with the graph right up until the day it did not. The honest one is
 * this: run `buildPlan` over the corpus, then read the states straight off the
 * edges it planned, because those edges are the same rows the node receives.
 *
 * So the derivation is entirely structural, and it is short:
 *
 *   - a claim something else supersedes is HISTORICAL, because a newer claim
 *     replaced it;
 *   - a claim written as a retraction carries negative polarity and is
 *     WITHDRAWN, because it took a value away and put nothing back;
 *   - a claim on either end of a CONTRADICTS edge is CONTRADICTED, because two
 *     live claims disagree and neither one wins;
 *   - anything left is CURRENT.
 *
 * The planner already refuses to draw a CONTRADICTS edge to a superseded or
 * negative claim, so the first three are disjoint by construction and the
 * order they are tested in changes nothing. It is written in that order anyway,
 * so that a future change to the planner degrades into a wrong count rather
 * than into two states claiming the same claim.
 *
 * Nothing here invents a state the corpus does not have. The design this page
 * follows also drew a PROPOSAL and an UNSUPPORTED state; the corpus annotates
 * claims as `assert`, `revise` or `retract` and gives every one of them an
 * evidence span, so both of those would have to be fabricated to appear, and
 * they do not appear. What replaces them is the structural check further down:
 * claims with no span, and entities nothing is ever said about, both counted
 * rather than assumed.
 */
import type { Corpus } from '../corpus/types.js';
import { buildPlan, type IngestPlan, type NodeLabel, type PropertyValue, type VertexRow } from '../ingest/plan.js';

export type ClaimState = 'current' | 'historical' | 'contradicted' | 'withdrawn';

export const CLAIM_STATES: readonly ClaimState[] = [
  'current',
  'historical',
  'contradicted',
  'withdrawn',
];

/** What each state is called on the page, and the sentence explaining it. */
export const STATE_LABELS: Readonly<Record<ClaimState, string>> = Object.freeze({
  current: 'Current',
  historical: 'Historical',
  contradicted: 'Contradicted',
  withdrawn: 'Withdrawn',
});

export const STATE_MEANINGS: Readonly<Record<ClaimState, string>> = Object.freeze({
  current: 'Nothing supersedes it and nothing contradicts it.',
  historical: 'A later claim replaced it. It is kept, not deleted.',
  contradicted: 'Two live claims disagree, and neither one was withdrawn.',
  withdrawn: 'Stated and then retracted, leaving no value behind.',
});

export interface ClaimRow {
  readonly key: string;
  readonly subject: string;
  readonly predicate: string;
  /** Empty on a retraction, which is the whole point of a retraction. */
  readonly objectText: string;
  readonly state: ClaimState;
  /** The session the claim was made in, or null if no span reached it. */
  readonly source: string | null;
  /** The date the corpus says the claim holds from. */
  readonly observed: string;
  /** One quotation from the transcript, or null where no span supports it. */
  readonly quote: string | null;
}

export interface StateCount {
  readonly state: ClaimState;
  readonly label: string;
  readonly meaning: string;
  readonly count: number;
}

export interface Structural {
  /** Claims nothing quotes. Zero is the expected answer and is still counted. */
  readonly claimsWithoutEvidence: number;
  /** Entities no claim is about: real, and the reason `unconnected` exists. */
  readonly entitiesWithoutClaims: number;
  /** Claims naming another entity, which is what makes a hop possible. */
  readonly claimsNamingAnEntity: number;
  readonly supersedesEdges: number;
  readonly contradictsEdges: number;
}

export interface Totals {
  readonly sessions: number;
  readonly messages: number;
  readonly spans: number;
  readonly claims: number;
  readonly entities: number;
  readonly vertices: number;
  readonly edges: number;
}

export interface Inventory {
  readonly seed: string;
  readonly claims: readonly ClaimRow[];
  readonly states: readonly StateCount[];
  readonly structural: Structural;
  readonly totals: Totals;
}

function text(row: VertexRow, property: string): string {
  const value: PropertyValue | undefined = row[property];
  return value === undefined ? '' : String(value);
}

function number(row: VertexRow, property: string): number {
  const value: PropertyValue | undefined = row[property];
  return typeof value === 'number' ? value : Number(value);
}

function rowsOf(plan: IngestPlan, label: NodeLabel): readonly VertexRow[] {
  return plan.batches.filter((batch) => batch.label === label).flatMap((batch) => batch.rows);
}

/**
 * Which session a claim was quoted in.
 *
 * The plan has no Claim to Message edge and should not grow one to feed a
 * table: the path already exists as SUPPORTS from a span, and the span row
 * carries the message it was cut from. So the walk is span to message to
 * session, the same three steps the proof panel takes, and a claim no span
 * reaches simply has no source rather than a guessed one.
 */
interface Provenance {
  readonly session: string;
  readonly quote: string;
}

function provenance(plan: IngestPlan): ReadonlyMap<number, Provenance> {
  const sessionTitles = new Map<number, string>();
  for (const row of rowsOf(plan, 'Session')) {
    sessionTitles.set(row.id, text(row, 'title'));
  }

  const messageSessions = new Map<number, number>();
  for (const row of rowsOf(plan, 'Message')) {
    messageSessions.set(row.id, number(row, 'session_id'));
  }

  const spans = new Map<number, VertexRow>();
  for (const row of rowsOf(plan, 'EvidenceSpan')) {
    spans.set(row.id, row);
  }

  const found = new Map<number, Provenance>();
  for (const edge of plan.edges) {
    if (edge.type !== 'SUPPORTS') continue;
    if (found.has(edge.dst)) continue;
    const span = spans.get(edge.src);
    if (span === undefined) continue;
    const sessionId = messageSessions.get(number(span, 'message_id'));
    const title = sessionId === undefined ? undefined : sessionTitles.get(sessionId);
    if (title === undefined) continue;
    found.set(edge.dst, { session: title, quote: text(span, 'quote') });
  }
  return found;
}

export function buildInventory(corpus: Corpus): Inventory {
  const plan = buildPlan(corpus);

  const superseded = new Set<number>();
  const contradicted = new Set<number>();
  const namesAnEntity = new Set<number>();
  for (const edge of plan.edges) {
    if (edge.type === 'SUPERSEDES') superseded.add(edge.dst);
    if (edge.type === 'CONTRADICTS') {
      contradicted.add(edge.src);
      contradicted.add(edge.dst);
    }
    if (edge.type === 'MENTIONS') namesAnEntity.add(edge.src);
  }

  const entityNames = new Map<number, string>();
  for (const row of rowsOf(plan, 'Entity')) {
    entityNames.set(row.id, text(row, 'name'));
  }

  const described = new Set<number>();
  for (const edge of plan.edges) {
    if (edge.type === 'ABOUT') described.add(edge.dst);
  }

  const sources = provenance(plan);

  const claims: ClaimRow[] = rowsOf(plan, 'Claim').map((row) => {
    const state: ClaimState = superseded.has(row.id)
      ? 'historical'
      : text(row, 'polarity') === 'negative'
        ? 'withdrawn'
        : contradicted.has(row.id)
          ? 'contradicted'
          : 'current';
    const source = sources.get(row.id);
    return {
      key: text(row, 'claim_key'),
      subject: entityNames.get(number(row, 'subject_id')) ?? '',
      predicate: text(row, 'predicate'),
      objectText: text(row, 'object_text'),
      state,
      source: source === undefined ? null : source.session,
      observed: text(row, 'valid_from'),
      quote: source === undefined ? null : source.quote,
    };
  });

  const tally = new Map<ClaimState, number>(CLAIM_STATES.map((state) => [state, 0]));
  for (const claim of claims) {
    tally.set(claim.state, (tally.get(claim.state) ?? 0) + 1);
  }

  const vertices = plan.counts.vertices;
  const edges = plan.counts.edges;

  return {
    seed: corpus.seed,
    claims,
    states: CLAIM_STATES.map((state) => ({
      state,
      label: STATE_LABELS[state],
      meaning: STATE_MEANINGS[state],
      count: tally.get(state) ?? 0,
    })),
    structural: {
      claimsWithoutEvidence: claims.filter((claim) => claim.quote === null).length,
      entitiesWithoutClaims: [...entityNames.keys()].filter((id) => !described.has(id)).length,
      claimsNamingAnEntity: namesAnEntity.size,
      supersedesEdges: edges.SUPERSEDES,
      contradictsEdges: edges.CONTRADICTS,
    },
    totals: {
      sessions: vertices.Session,
      messages: vertices.Message,
      spans: vertices.EvidenceSpan,
      claims: vertices.Claim,
      entities: vertices.Entity,
      vertices: Object.values(vertices).reduce((sum, count) => sum + count, 0),
      edges: Object.values(edges).reduce((sum, count) => sum + count, 0),
    },
  };
}
