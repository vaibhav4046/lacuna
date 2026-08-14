import type { ClaimAnnotation, GoldQuestion } from '../corpus/types.js';
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
