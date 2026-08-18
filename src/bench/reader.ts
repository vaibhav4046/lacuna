import type { ClaimAnnotation, EntityKind, GoldQuestion } from '../corpus/types.js';
import type { BenchOutcome, IndexedMessage, ReaderMode } from './types.js';

/**
 * The answering step every flat baseline shares.
 *
 * This reader is deliberately better than a real one. It never misreads a
 * sentence, never invents a value, and never misses a statement that is in
 * front of it, because it reads the corpus annotations on the retrieved
 * messages rather than the prose. Giving the baselines a perfect extractor is
 * the only way to make the comparison about retrieval: if a baseline loses
 * here, it lost because the evidence never reached the reader, and not because
 * a language model fumbled it.
 *
 * What the reader is not given is the graph. It sees each claim's subject,
 * predicate, value, and whether the sentence announced itself as a correction
 * or a withdrawal, all of which are readable in the message text. It does not
 * see which claim supersedes which. That link is an edge, building it is the
 * thing under test, and handing it over would be handing over the answer.
 */

interface Matched {
  readonly claim: ClaimAnnotation;
  readonly ordinal: number;
}

/** Oldest first, message order breaking a tie on the stated date. */
function chronological(a: Matched, b: Matched): number {
  if (a.claim.validFrom !== b.claim.validFrom) {
    return a.claim.validFrom < b.claim.validFrom ? -1 : 1;
  }
  return a.ordinal - b.ordinal;
}

export interface ReadInput {
  readonly question: GoldQuestion;
  readonly retrieved: readonly IndexedMessage[];
  readonly mode: ReaderMode;
  /**
   * The subject to answer about, when it is not the one the question names.
   * Set by a two round baseline after it has followed a relation itself.
   */
  readonly subject?: string;
}

export function read({ question, retrieved, mode, subject }: ReadInput): BenchOutcome {
  const target = subject ?? question.subject;

  const matched: Matched[] = [];
  for (const message of retrieved) {
    for (const claim of message.claims) {
      if (claim.subject === target && claim.predicate === question.predicate) {
        matched.push({ claim, ordinal: message.ordinal });
      }
    }
  }

  if (matched.length === 0) {
    // Nothing on the predicate. Which absence this is depends on how the reader
    // arrived at the subject, and all three readings are available here.
    //
    // A caller that set `subject` got here by following a relation it resolved
    // itself, which means the entity it landed on was named by a claim and is
    // therefore known to exist. An entity that exists with nothing stated about
    // the property is the unconnected case, and it is the same test Lacuna
    // applies: it reports unconnected when it abstains after a hop and
    // never_stated when it abstains without one. Withholding this branch would
    // have scored a distinction the two round baseline had the information to
    // draw and simply was not allowed to say, which measures the reader rather
    // than the retrieval.
    if (subject !== undefined) {
      return { type: 'abstain', reason: 'unconnected' };
    }
    // No hop. Retrieving nothing at all that names the subject looks like a
    // subject it has never heard of, and retrieving plenty about the subject
    // with nothing on this property looks like a gap.
    const named = retrieved.some(
      (message) =>
        message.text.includes(target) || message.claims.some((claim) => claim.subject === target),
    );
    return { type: 'abstain', reason: named ? 'never_stated' : 'out_of_scope' };
  }

  const ordered = [...matched].sort(chronological);
  const newest = ordered[ordered.length - 1]!.claim;

  if (newest.kind === 'retract') {
    return { type: 'abstain', reason: 'retracted' };
  }

  if (mode === 'conflict_aware') {
    // No correction anywhere in view, and more than one value asserted, means
    // two statements that disagree with nothing to order them. Declining is the
    // right call. It is also the only conflict rule available without the
    // supersession edges, and it pays for itself in the revision cases, which
    // is exactly the trade this mode exists to measure.
    const announced = ordered.some((item) => item.claim.kind === 'revise');
    const values = new Set(
      ordered.filter((item) => item.claim.kind === 'assert').map((item) => item.claim.objectText),
    );
    if (!announced && values.size > 1) {
      return { type: 'abstain', reason: 'contradicted' };
    }
  }

  return { type: 'answer', text: newest.objectText };
}

/**
 * The entity a relation points at, read out of the retrieved messages.
 *
 * This is what lets a flat baseline attempt a second hop: the first round
 * retrieved a message saying the subject is supplied by someone, and that
 * someone is a name worth retrieving on. Returns null when the retrieved set
 * does not settle it, including when two live claims name different entities,
 * because guessing between them would be inventing the route.
 */
export function bridgeFrom(
  retrieved: readonly IndexedMessage[],
  subject: string,
  via: string,
): string | null {
  const matched: Matched[] = [];
  for (const message of retrieved) {
    for (const claim of message.claims) {
      if (claim.subject === subject && claim.predicate === via && claim.objectEntity !== null) {
        matched.push({ claim, ordinal: message.ordinal });
      }
    }
  }
  if (matched.length === 0) {
    return null;
  }
  const ordered = [...matched].sort(chronological);
  const newest = ordered[ordered.length - 1]!.claim;
  return newest.kind === 'retract' ? null : newest.objectEntity;
}

/**
 * Everything that depends on a name, according only to the messages retrieved.
 *
 * Breadth first, so the order is by distance from the root, which is the order a
 * second retrieval round wants to search in. A claim that announces itself as a
 * withdrawal is dropped; a claim that silently replaces an earlier one is not,
 * because the reader is not shown supersession and inferring it is the thing
 * under test.
 */
export function blastReach(
  retrieved: readonly IndexedMessage[],
  root: string,
): readonly string[] {
  const dependents = new Map<string, string[]>();
  for (const message of retrieved) {
    for (const claim of message.claims) {
      if (claim.predicate !== 'depends_on') continue;
      if (claim.kind === 'retract') continue;
      if (claim.objectEntity === null) continue;
      const known = dependents.get(claim.objectEntity);
      if (known === undefined) dependents.set(claim.objectEntity, [claim.subject]);
      else known.push(claim.subject);
    }
  }

  const seen = new Set<string>([root]);
  const queue = [root];
  const reached: string[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    for (const dependent of dependents.get(name) ?? []) {
      if (seen.has(dependent)) continue;
      seen.add(dependent);
      queue.push(dependent);
      reached.push(dependent);
    }
  }
  return reached;
}

export interface BlastReadInput {
  /** The package a change is being proposed to. */
  readonly root: string;
  readonly retrieved: readonly IndexedMessage[];
  readonly kinds: ReadonlyMap<string, EntityKind>;
}

/**
 * The blast radius a flat baseline can build out of what it retrieved.
 *
 * The traversal itself is not withheld. Every dependency claim in the retrieved
 * set is turned into an edge and the closure is walked to whatever depth those
 * edges reach, because a baseline that could not walk at all would be losing to
 * a straw man. What it cannot do is retrieve the rest of the corpus: a package
 * three hops out is named in a message nobody's similarity score put in the top
 * k, and an edge that never arrived is an edge that cannot be followed. That is
 * the whole of the difference this comparison is trying to show.
 *
 * Two things are deliberately not given. Supersession, because the reader is
 * never shown which claim replaces which and building that link is the thing
 * under test; a withdrawal is honoured only where the sentence announced itself
 * as one. And the reader mode, because `depends_on` holds many values at once,
 * so two live dependencies are a fact about the package rather than a
 * disagreement about it, and `conflict_aware` has nothing here to be careful
 * about.
 */
export function readBlast(input: BlastReadInput): BenchOutcome {
  const reached = blastReach(input.retrieved, input.root);
  const affected = reached.filter((name) => input.kinds.get(name) === 'service');

  if (affected.length > 0) {
    return { type: 'answer', text: [...affected].sort().join(', ') };
  }

  // Reached nothing, which splits the same way an unanswered question does: a
  // package the retrieved messages talk about was stated to have no dependents,
  // and a package they never mention was never in the corpus to begin with.
  const named = input.retrieved.some(
    (message) =>
      message.text.includes(input.root)
      || message.claims.some((claim) => claim.subject === input.root),
  );
  return { type: 'abstain', reason: named ? 'never_stated' : 'out_of_scope' };
}
