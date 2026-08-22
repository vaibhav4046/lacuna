import { MULTI_VALUED_PREDICATES } from '../corpus/predicates.js';
import { explainAbstention } from '../model/abstention.js';
import { RetrievalConsistencyError } from './errors.js';
import type {
  ClaimRecord,
  Hop,
  Mention,
  Resolution,
  SubgraphView,
  SubjectView,
} from './types.js';

/**
 * The decision. Given what the graph holds, what can honestly be said.
 *
 * This function is pure and it is the only place an answer or an abstention is
 * chosen. Everything above it fetches; everything below it renders. That split
 * is what makes the claim testable: the same subgraph always produces the same
 * outcome, so a disagreement between a live run and a unit test is a
 * disagreement about data rather than about ordering, caching or the network.
 *
 * The five abstention reasons are not confidence buckets. Each one is a
 * different arrangement of nodes and edges, and the point of the product is
 * that a graph can tell those arrangements apart where a similarity score
 * flattens them into one low number.
 */

function isLive(claim: ClaimRecord): boolean {
  return claim.supersededBy.length === 0;
}

function byPredicate(claims: readonly ClaimRecord[], predicate: string): readonly ClaimRecord[] {
  return claims.filter((claim) => claim.predicate === predicate);
}

const MAX_ENTITY_SCALARS = 160;
const MAX_ENTITY_UTF8_BYTES = 512;
const FORBIDDEN_ENTITY_SCALAR = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const UNICODE_WHITESPACE_RUN = /\p{White_Space}+/gu;

export interface CanonicalEntityName {
  readonly display: string;
  readonly key: string;
}

function boundedEntityText(value: string): boolean {
  let scalars = 0;
  for (const scalar of value) {
    const point = scalar.codePointAt(0);
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) return false;
    scalars += 1;
    if (scalars > MAX_ENTITY_SCALARS) return false;
  }
  return scalars > 0 && new TextEncoder().encode(value).byteLength <= MAX_ENTITY_UTF8_BYTES;
}

/** One locale-independent display/key pair for a bounded graph entity name. */
export function canonicalEntityName(raw: string): CanonicalEntityName | null {
  if (FORBIDDEN_ENTITY_SCALAR.test(raw)) return null;
  for (const scalar of raw) {
    const point = scalar.codePointAt(0);
    if (point === undefined || (point >= 0xd800 && point <= 0xdfff)) return null;
  }

  const display = raw.normalize('NFC')
    .replace(UNICODE_WHITESPACE_RUN, ' ')
    .replace(/^ +| +$/gu, '');
  if (!boundedEntityText(display)) return null;

  const key = display.toLowerCase();
  return boundedEntityText(key) ? { display, key } : null;
}

export type TargetStanding =
  | { readonly state: 'current'; readonly claim: ClaimRecord; readonly mention: Mention }
  | {
    readonly state:
      | 'missing_mention'
      | 'retracted'
      | 'historical'
      | 'contradicted'
      | 'unstated';
  };

function orderedClaims(subject: SubjectView, predicate: string): readonly ClaimRecord[] {
  return [...byPredicate(subject.claims, predicate)].sort(compareClaims);
}

function claimTarget(claim: ClaimRecord): CanonicalEntityName | null {
  return canonicalEntityName(claim.objectText);
}

function exactTargetMentions(
  subject: SubjectView,
  claim: ClaimRecord,
  predicate: string,
  targetKey: string,
): readonly Mention[] {
  return subject.mentions
    .filter((mention) => mention.claimId === claim.id
      && mention.predicate === predicate
      && canonicalEntityName(mention.entityName)?.key === targetKey)
    .sort((a, b) => a.entityId - b.entityId
      || (a.entityName < b.entityName ? -1 : a.entityName > b.entityName ? 1 : 0));
}

/** Decide one directed target from authentic claims and their exact Mention edge. */
export function evaluateTargetStanding(
  subject: SubjectView,
  internalPredicate: string,
  targetKey: string,
): TargetStanding {
  const canonicalTarget = canonicalEntityName(targetKey);
  if (canonicalTarget === null || canonicalTarget.key !== targetKey) return { state: 'unstated' };

  const claims = orderedClaims(subject, internalPredicate);
  const livePositives = claims
    .filter((claim) => isLive(claim) && claim.polarity === 'positive')
    .map((claim) => ({ claim, target: claimTarget(claim) }))
    .filter((entry): entry is { claim: ClaimRecord; target: CanonicalEntityName } => entry.target !== null);
  const liveTargetKeys = new Set(livePositives.map((entry) => entry.target.key));

  if (!MULTI_VALUED_PREDICATES.has(internalPredicate) && liveTargetKeys.size > 1) {
    return { state: 'contradicted' };
  }

  const matchingLive = livePositives.filter((entry) => entry.target.key === targetKey);
  const supported = matchingLive.flatMap(({ claim }) => {
    const mention = exactTargetMentions(subject, claim, internalPredicate, targetKey)[0];
    return mention === undefined ? [] : [{ claim, mention }];
  });
  const newest = supported.at(-1);
  if (newest !== undefined) return { state: 'current', ...newest };
  if (matchingLive.length > 0) return { state: 'missing_mention' };

  const applicableNegative = claims.some((claim) => {
    if (!isLive(claim) || claim.polarity !== 'negative') return false;
    if (claim.objectText.length === 0) return true;
    return claimTarget(claim)?.key === targetKey;
  });
  if (applicableNegative) return { state: 'retracted' };

  const wasPositive = claims.some((claim) => claim.polarity === 'positive'
    && !isLive(claim) && claimTarget(claim)?.key === targetKey);
  if (wasPositive && liveTargetKeys.size > 0) return { state: 'historical' };
  return { state: 'unstated' };
}

export type HopSelection =
  /** Nothing was ever said about this relation. */
  | { readonly type: 'none' }
  /** It was said and withdrawn, so there is no current target. */
  | { readonly type: 'retracted'; readonly claims: readonly ClaimRecord[] }
  /** A live relation claim exists but has no exact claim/predicate/target Mention. */
  | { readonly type: 'missing_mention'; readonly claims: readonly ClaimRecord[] }
  /** Several live claims point at different entities. */
  | { readonly type: 'ambiguous'; readonly mentions: readonly Mention[] }
  | { readonly type: 'one'; readonly mention: Mention; readonly claim: ClaimRecord };

/**
 * Which entity the question's relation leads to, if exactly one does.
 *
 * Shared deliberately. The fetcher calls it to decide which second entity to
 * read, and the resolver calls it to decide what the hop means. If they picked
 * separately they could disagree, and a disagreement would show as an answer
 * cited from the wrong node, which is the worst failure this product has.
 */
export function selectHopTarget(subject: SubjectView, via: string): HopSelection {
  const viaClaims = orderedClaims(subject, via);
  if (viaClaims.length === 0) {
    return { type: 'none' };
  }

  const liveTargets = new Map<string, CanonicalEntityName>();
  for (const claim of viaClaims) {
    if (!isLive(claim) || claim.polarity !== 'positive') continue;
    const target = claimTarget(claim);
    if (target !== null) liveTargets.set(target.key, target);
  }

  if (liveTargets.size === 0) {
    return { type: 'retracted', claims: viaClaims };
  }

  const standings = [...liveTargets.keys()].sort().map((targetKey) =>
    evaluateTargetStanding(subject, via, targetKey));
  if (standings.some((standing) => standing.state === 'contradicted')) {
    const mentions = viaClaims.flatMap((claim) => {
      if (!isLive(claim) || claim.polarity !== 'positive') return [];
      const target = claimTarget(claim);
      return target === null ? [] : exactTargetMentions(subject, claim, via, target.key);
    });
    return { type: 'ambiguous', mentions };
  }

  const current = standings.filter((standing): standing is Extract<TargetStanding, { state: 'current' }> =>
    standing.state === 'current');
  const currentTargetKeys = new Set(current.flatMap((entry) => {
    const target = claimTarget(entry.claim);
    return target === null ? [] : [target.key];
  }));
  const currentMentions = viaClaims.flatMap((claim) => {
    if (!isLive(claim) || claim.polarity !== 'positive') return [];
    const target = claimTarget(claim);
    return target === null || !currentTargetKeys.has(target.key)
      ? []
      : exactTargetMentions(subject, claim, via, target.key);
  });
  if (current.length > 1 || new Set(currentMentions.map((mention) => mention.entityId)).size > 1) {
    return { type: 'ambiguous', mentions: currentMentions };
  }
  if (liveTargets.size > 1 && standings.some((standing) => standing.state === 'missing_mention')) {
    return { type: 'missing_mention', claims: viaClaims };
  }
  const selected = current[0];
  if (selected !== undefined) {
    return { type: 'one', mention: selected.mention, claim: selected.claim };
  }
  if (standings.some((standing) => standing.state === 'missing_mention')) {
    return { type: 'missing_mention', claims: viaClaims };
  }
  return { type: 'retracted', claims: viaClaims };
}

function compareClaims(a: ClaimRecord, b: ClaimRecord): number {
  if (a.validFrom !== b.validFrom) return a.validFrom < b.validFrom ? -1 : 1;
  return a.id - b.id;
}

function abstain(
  reason: Parameters<typeof explainAbstention>[0],
  considered: readonly ClaimRecord[],
  hop: Hop | null,
  trace: readonly string[],
): Resolution {
  return {
    outcome: { type: 'abstain', reason },
    explanation: `No answer given, because ${explainAbstention(reason)}.`,
    considered,
    hop,
    trace,
  };
}

export function resolve(view: SubgraphView): Resolution {
  const { question, subject } = view;
  const trace: string[] = [];

  if (subject.id === null) {
    trace.push(`Looked for an entity named "${subject.name}". No node carries that name.`);
    return abstain('out_of_scope', [], null, trace);
  }
  trace.push(
    `Found "${subject.name}" as a ${subject.kind ?? 'thing'} with `
    + `${subject.claims.length} claim${subject.claims.length === 1 ? '' : 's'} about it.`,
  );

  let answering: SubjectView = subject;
  let hop: Hop | null = null;

  if (question.via !== null) {
    const selection = selectHopTarget(subject, question.via);
    switch (selection.type) {
      case 'none':
        trace.push(`Nothing states a "${question.via}" for "${subject.name}".`);
        return abstain('never_stated', [], null, trace);
      case 'retracted':
        trace.push(
          `The "${question.via}" of "${subject.name}" was stated and then withdrawn.`,
        );
        return abstain('retracted', selection.claims, null, trace);
      case 'missing_mention':
        trace.push(
          `The "${question.via}" of "${subject.name}" has no exact entity Mention to follow.`,
        );
        return abstain('unconnected', selection.claims, null, trace);
      case 'ambiguous': {
        const names = selection.mentions.map((m) => `"${m.entityName}"`).join(' and ');
        trace.push(`The "${question.via}" of "${subject.name}" is given as ${names}.`);
        return abstain('contradicted', byPredicate(subject.claims, question.via), null, trace);
      }
      case 'one':
        hop = {
          via: question.via,
          throughClaimId: selection.claim.id,
          toEntityId: selection.mention.entityId,
          toEntityName: selection.mention.entityName,
        };
        trace.push(
          `Followed "${question.via}" from "${subject.name}" to `
          + `"${selection.mention.entityName}".`,
        );
        if (view.bridge === null || view.bridge.id !== selection.mention.entityId) {
          // Not defensive noise. The fetcher and this function choose the target
          // with the same call, so a mismatch means a view was assembled by hand
          // and assembled wrong, and answering from it would cite the wrong node.
          throw new RetrievalConsistencyError(
            `hop resolves to entity ${selection.mention.entityId} but the view carries `
            + `${view.bridge === null ? 'no bridge' : `entity ${view.bridge.id}`}`,
          );
        }
        answering = view.bridge;
        break;
    }
  }

  const considered = byPredicate(answering.claims, question.predicate);
  const subjectLabel = `"${answering.name}"`;

  if (considered.length === 0) {
    if (hop !== null) {
      trace.push(
        `${subjectLabel} is in the graph, but nothing states its `
        + `"${question.predicate}".`,
      );
      return abstain('unconnected', [], hop, trace);
    }
    trace.push(`Nothing states a "${question.predicate}" for ${subjectLabel}.`);
    return abstain('never_stated', [], null, trace);
  }

  const live = considered.filter(isLive);
  const superseded = considered.length - live.length;
  trace.push(
    `Read ${considered.length} "${question.predicate}" claim`
    + `${considered.length === 1 ? '' : 's'} about ${subjectLabel}`
    + (superseded > 0 ? `, ${superseded} of them superseded.` : '.'),
  );

  if (live.length === 0) {
    // Every claim replaced, and nothing replacing them carries this predicate.
    trace.push('Every one of them has been superseded, and none of the replacements remain.');
    return abstain('retracted', considered, hop, trace);
  }

  const positives = live.filter((claim) => claim.polarity === 'positive');
  if (positives.length === 0) {
    trace.push('The current claim withdraws the earlier value and puts nothing in its place.');
    return abstain('retracted', considered, hop, trace);
  }

  const distinctText = new Set(positives.map((claim) => claim.objectText));
  if (distinctText.size > 1) {
    if (MULTI_VALUED_PREDICATES.has(question.predicate)) {
      // Several live values on a multi-valued predicate are a list, not a
      // disagreement: a service that depends on three packages holds three
      // true claims at once.
      const values = [...distinctText].sort();
      const newest = positives.reduce((a, b) => (compareClaims(a, b) >= 0 ? a : b));
      trace.push(
        `${values.length} current claims stand together: `
        + `${values.map((value) => `"${value}"`).join(', ')}.`,
      );
      return {
        outcome: { type: 'answer', claimId: newest.id, text: values.join(', ') },
        explanation: `All ${values.length} values hold at once, because `
          + `"${question.predicate}" names a list rather than a single fact.`,
        considered,
        hop,
        trace,
      };
    }
    const values = [...distinctText].map((text) => `"${text}"`).join(' and ');
    trace.push(`Two current claims disagree: ${values}. Nothing supersedes either.`);
    return abstain('contradicted', considered, hop, trace);
  }

  const answer = positives.reduce((a, b) => (compareClaims(a, b) >= 0 ? a : b));
  trace.push(`One current claim stands: "${answer.objectText}", stated ${answer.validFrom}.`);

  return {
    outcome: { type: 'answer', claimId: answer.id, text: answer.objectText },
    explanation: superseded > 0
      ? `This replaced ${superseded} earlier value${superseded === 1 ? '' : 's'} and nothing has superseded it.`
      : 'Stated once and never contradicted or withdrawn.',
    considered,
    hop,
    trace,
  };
}

/**
 * Which claims deserve a citation, in the order they should be shown.
 *
 * An abstention is a finding, not a shrug, so most of them cite too. Saying "the
 * sessions disagree" without showing both statements asks for the same trust a
 * bare answer does, and the whole argument here is that trust should not be
 * necessary.
 */
export function citedClaims(resolution: Resolution): readonly number[] {
  const ids: number[] = [];
  const add = (id: number): void => {
    if (!ids.includes(id)) ids.push(id);
  };

  if (resolution.hop !== null) {
    add(resolution.hop.throughClaimId);
  }
  if (resolution.outcome.type === 'answer') {
    add(resolution.outcome.claimId);
    const first = resolution.considered[0];
    if (first !== undefined && MULTI_VALUED_PREDICATES.has(first.predicate)) {
      // A list answer quotes every claim on the list, not just the newest:
      // three cited dependencies need three places a reader can check.
      for (const claim of resolution.considered.filter(isLive)) {
        if (claim.polarity === 'positive') {
          add(claim.id);
        }
      }
    }
    return ids;
  }

  switch (resolution.outcome.reason) {
    case 'contradicted':
      // Both sides, or the disagreement is a claim of its own.
      for (const claim of resolution.considered.filter(isLive)) add(claim.id);
      break;
    case 'retracted':
      // The withdrawal and what it withdrew, so the change is visible.
      for (const claim of resolution.considered) add(claim.id);
      break;
    case 'never_stated':
    case 'unconnected':
    case 'out_of_scope':
      // Nothing to quote. That is the finding.
      break;
  }
  return ids;
}
