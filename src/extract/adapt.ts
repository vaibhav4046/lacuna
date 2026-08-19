import type {
  ClaimAnnotation,
  Corpus,
  CorpusEntity,
  EntityKind,
  EvidenceSpan,
  Message,
  PredicateName,
  Session,
} from '../corpus/types.js';
import type { IngestPlan, NodeLabel, PropertyValue, VertexRow } from '../ingest/plan.js';
import { selectHopTarget } from '../retrieval/resolve.js';
import type {
  ClaimRecord,
  Mention,
  Polarity,
  RetrievalQuestion,
  SubgraphView,
  SubjectView,
} from '../retrieval/types.js';
import type { Extraction, ExtractedClaim, SourceMeta } from './types.js';

/**
 * The join between the extractor and everything that already exists.
 *
 * Two directions, both deliberately thin. `toCorpus` puts extracted claims into
 * the shape `buildPlan` already consumes, so the graph is built by the ingest
 * code that the corpus generator uses, unchanged, with the same contradiction
 * detection and the same supersession edges. `viewFor` reads a subject back out
 * of a plan, so the resolver can be handed the same `SubgraphView` a store
 * would hand it.
 *
 * `viewFor` exists because a plan is the last point in the pipeline that is
 * still a value. Beyond it the graph is a store, and a store is a network. A
 * test that wants to prove the extractor drives the real resolver either stands
 * up HydraDB or reads the plan, and reading the plan is the version that stays
 * deterministic and offline. It reads the same properties and the same edges
 * the store reads, and nothing about the resolver knows which one it got.
 */

/**
 * The corpus type narrows `predicate` to the thirteen the generator draws from,
 * because the generator draws from thirteen. Everything below it treats a
 * predicate as an opaque string: the plan writes it as a property, the
 * multi-valued set is keyed by string, and the resolver compares it with `===`.
 * The extractor reads its properties out of prose and cannot be held to a fixed
 * vocabulary, so the widening happens here, once, rather than by adding names
 * to the generator's list and pretending it produces them.
 */
function asPredicate(property: string): PredicateName {
  return property as PredicateName;
}

/**
 * The kind recorded on an entity node.
 *
 * The extractor infers a kind only where the connective states one: the object
 * of "is owned by" is a person, the object of "depends on" is a package.
 * Subjects get the neutral kind, because a sentence saying where something is
 * stored says nothing about what it is, and the field is read for display
 * rather than for any decision.
 */
const OBJECT_KINDS: Readonly<Record<string, EntityKind>> = Object.freeze({
  owner: 'person',
  depends_on: 'package',
});

const SUBJECT_KIND: EntityKind = 'service';

function entitiesOf(claims: readonly ExtractedClaim[]): readonly CorpusEntity[] {
  const kinds = new Map<string, EntityKind>();
  for (const claim of claims) {
    if (claim.objectEntity === null) continue;
    kinds.set(claim.objectEntity, OBJECT_KINDS[claim.property] ?? SUBJECT_KIND);
  }
  for (const claim of claims) {
    if (!kinds.has(claim.subject)) kinds.set(claim.subject, SUBJECT_KIND);
  }
  return [...kinds.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, kind]) => ({ name, kind }));
}

function annotationOf(claim: ExtractedClaim): ClaimAnnotation {
  return {
    key: claim.key,
    subject: claim.subject,
    predicate: asPredicate(claim.predicate),
    kind: claim.kind,
    objectText: claim.objectText,
    objectEntity: claim.objectEntity,
    supersedes: claim.supersedes,
    validFrom: claim.validFrom,
  };
}

/**
 * One session, whose messages are the turns and whose spans are the sentences
 * the claims came from.
 *
 * A span is attached to the turn that produced it, so `buildPlan` can find the
 * claim it supports in the message it is reading. That is why extraction has to
 * keep offsets rather than sentences: the graph stores the quotation and its
 * position, and both have to be true of the message text stored beside them.
 */
export function toCorpus(extraction: Extraction, meta: SourceMeta): Corpus {
  const byTurn = new Map<number, ExtractedClaim[]>();
  for (const claim of extraction.claims) {
    const bucket = byTurn.get(claim.turnIndex);
    if (bucket === undefined) byTurn.set(claim.turnIndex, [claim]);
    else bucket.push(claim);
  }

  const messages: Message[] = extraction.turns.map((turn) => {
    const made = byTurn.get(turn.index) ?? [];
    const spans: EvidenceSpan[] = made.map((claim) => ({
      claimKey: claim.key,
      start: claim.span.start,
      end: claim.span.end,
      quote: claim.span.quote,
    }));
    return {
      key: `${meta.sessionKey}/${turn.index}`,
      sessionKey: meta.sessionKey,
      index: turn.index,
      speaker: turn.role,
      timestamp: turn.timestamp,
      text: turn.text,
      claims: made.map(annotationOf),
      spans,
    };
  });

  const session: Session = {
    key: meta.sessionKey,
    title: meta.title,
    startedAt: meta.startedAt,
    messages,
  };

  const characters = messages.reduce((total, message) => total + message.text.length, 0);

  return {
    seed: meta.sessionKey,
    sessions: [session],
    // Gold questions are a property of the generated corpus and never of an
    // extracted one. Nothing here knows the answers, which is the point.
    questions: [],
    entities: entitiesOf(extraction.claims),
    stats: {
      sessions: 1,
      messages: messages.length,
      claims: extraction.claims.length,
      characters,
      estimatedTokens: Math.round(characters / 4),
    },
  };
}

function rowsOf(plan: IngestPlan, label: NodeLabel): readonly VertexRow[] {
  return plan.batches.filter((batch) => batch.label === label).flatMap((batch) => batch.rows);
}

function text(row: VertexRow, property: string): string {
  const value: PropertyValue | undefined = row[property];
  return typeof value === 'string' ? value : String(value ?? '');
}

function number(row: VertexRow, property: string): number {
  const value: PropertyValue | undefined = row[property];
  return typeof value === 'number' ? value : Number.NaN;
}

/** Everything the plan holds about one entity, in the shape a store returns. */
export function subjectFromPlan(plan: IngestPlan, name: string): SubjectView {
  const entity = rowsOf(plan, 'Entity').find((row) => text(row, 'name') === name);
  if (entity === undefined) return { name, id: null, kind: null, claims: [], mentions: [] };

  const superseders = new Map<number, number[]>();
  for (const edge of plan.edges) {
    if (edge.type !== 'SUPERSEDES') continue;
    const held = superseders.get(edge.dst);
    if (held === undefined) superseders.set(edge.dst, [edge.src]);
    else held.push(edge.src);
  }

  const claimRows = rowsOf(plan, 'Claim').filter((row) => number(row, 'subject_id') === entity.id);
  const claims: ClaimRecord[] = claimRows.map((row) => ({
    id: row.id,
    predicate: text(row, 'predicate'),
    objectText: text(row, 'object_text'),
    polarity: text(row, 'polarity') === 'negative' ? ('negative' as Polarity) : ('positive' as Polarity),
    validFrom: text(row, 'valid_from'),
    txTime: text(row, 'tx_time'),
    supersededBy: superseders.get(row.id) ?? [],
  }));

  const predicateById = new Map(claims.map((claim) => [claim.id, claim.predicate] as const));
  const entityNames = new Map(rowsOf(plan, 'Entity').map((row) => [row.id, text(row, 'name')] as const));
  const mentions: Mention[] = [];
  for (const edge of plan.edges) {
    if (edge.type !== 'MENTIONS') continue;
    const predicate = predicateById.get(edge.src);
    const entityName = entityNames.get(edge.dst);
    if (predicate === undefined || entityName === undefined) continue;
    mentions.push({ claimId: edge.src, predicate, entityId: edge.dst, entityName });
  }

  return {
    name,
    id: entity.id,
    kind: text(entity, 'kind'),
    claims,
    mentions: mentions.sort((a, b) => a.claimId - b.claimId || a.entityId - b.entityId),
  };
}

/**
 * The subgraph a question needs, read off a plan.
 *
 * The bridge is chosen with `selectHopTarget`, the same call the fetcher makes,
 * for the same reason it is shared there: a view whose bridge disagrees with
 * the resolver's own choice makes the resolver throw, and it should, because an
 * answer cited from the wrong node is the failure this product exists to avoid.
 */
export function viewFor(plan: IngestPlan, question: RetrievalQuestion): SubgraphView {
  const subject = subjectFromPlan(plan, question.subject);
  if (subject.id === null || question.via === null) {
    return { question, subject, bridge: null };
  }

  const selection = selectHopTarget(subject, question.via);
  const bridge = selection.type === 'one' ? subjectFromPlan(plan, selection.mention.entityName) : null;
  return { question, subject, bridge };
}
