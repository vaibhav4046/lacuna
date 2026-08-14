import { at, CorpusError } from './errors.js';
import { fillerText, leadSentence, sessionTitle, tailSentence } from './filler.js';
import type { Rng } from './rng.js';
import type { PlannedClaim, ThreadPlan } from './threads.js';
import type { ClaimAnnotation, CorpusStats, EvidenceSpan, Message, Session } from './types.js';

/**
 * Placement of planned claims into sessions and messages.
 *
 * Two properties matter and are enforced rather than hoped for. Claims inside
 * one thread land in strictly increasing order, so a correction can never
 * appear before the thing it corrects. And every evidence span is found by
 * searching the finished message text, so the offsets are the real offsets and
 * a test can slice the text and get the quote back.
 */

/**
 * Sized so the whole history is well past what fits in a single model context.
 * The number was picked by generating and measuring, not by estimating: see the
 * stats printed by `tests/unit/corpus.test.ts`.
 */
const SESSION_COUNT = 72;
const MIN_MESSAGES = 56;
const MAX_MESSAGES = 88;
const BASE_EPOCH_MS = Date.UTC(2025, 0, 6, 9, 0, 0);
const SESSION_GAP_MS = 2 * 24 * 60 * 60 * 1000;
const MESSAGE_GAP_MS = 3 * 60 * 1000;
/** Threads start early enough that a three claim chain still has room to spread. */
const LATEST_START = SESSION_COUNT - 5;

interface Placement {
  readonly session: number;
  readonly message: number;
}

interface Skeleton {
  readonly key: string;
  readonly title: string;
  readonly startedAt: string;
  readonly messageCount: number;
}

function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

function sessionStart(index: number): number {
  return BASE_EPOCH_MS + index * SESSION_GAP_MS;
}

function ordinal(placement: Placement): number {
  return placement.session * MAX_MESSAGES + placement.message;
}

/**
 * Take the earliest free user slot at or after `preferred`, skipping anything
 * that would land at or before `minOrdinal`.
 */
function takeSlot(
  rng: Rng,
  free: readonly Set<number>[],
  preferred: number,
  minOrdinal: number,
): Placement {
  for (let session = preferred; session < free.length; session += 1) {
    const slots = at(free, session, 'free slot set');
    const open = [...slots]
      .filter((message) => ordinal({ session, message }) > minOrdinal)
      .sort((a, b) => a - b);
    if (open.length === 0) {
      continue;
    }
    const message = rng.pick(open);
    slots.delete(message);
    return { session, message };
  }
  throw new CorpusError(
    `no free message slot at or after session ${preferred} past ordinal ${minOrdinal}`,
  );
}

export interface Transcript {
  readonly sessions: readonly Session[];
  readonly stats: CorpusStats;
}

export function buildTranscript(rng: Rng, plan: ThreadPlan): Transcript {
  const skeletons: Skeleton[] = [];
  for (let i = 0; i < SESSION_COUNT; i += 1) {
    skeletons.push({
      key: `session-${String(i + 1).padStart(2, '0')}`,
      title: sessionTitle(rng),
      startedAt: isoAt(sessionStart(i)),
      messageCount: rng.between(MIN_MESSAGES / 2, MAX_MESSAGES / 2) * 2,
    });
  }

  // Even indices are the user's turns, and claims only ever go there. An
  // assistant that restated a claim would be a second source for it, which is
  // not what this corpus is testing.
  const free = skeletons.map((skeleton) => {
    const slots = new Set<number>();
    for (let i = 0; i < skeleton.messageCount; i += 2) {
      slots.add(i);
    }
    return slots;
  });

  const placed = new Map<string, PlannedClaim>();
  for (const thread of plan.threads) {
    if (thread.claims.length === 0) {
      continue;
    }
    let session = rng.int(LATEST_START);
    let minOrdinal = -1;
    for (const claim of thread.claims) {
      const placement = takeSlot(rng, free, session, minOrdinal);
      placed.set(`${placement.session}:${placement.message}`, claim);
      minOrdinal = ordinal(placement);
      session = Math.min(SESSION_COUNT - 1, placement.session + 1 + rng.int(3));
    }
  }

  const sessions: Session[] = [];
  let characters = 0;
  let claimCount = 0;

  for (let s = 0; s < skeletons.length; s += 1) {
    const skeleton = at(skeletons, s, 'session skeleton');
    const start = sessionStart(s);
    const messages: Message[] = [];

    for (let i = 0; i < skeleton.messageCount; i += 1) {
      const speaker = i % 2 === 0 ? 'user' : 'assistant';
      const timestamp = isoAt(start + i * MESSAGE_GAP_MS);
      const key = `${skeleton.key}-m${String(i).padStart(3, '0')}`;
      const claim = placed.get(`${s}:${i}`);

      let text: string;
      let claims: readonly ClaimAnnotation[] = [];
      let spans: readonly EvidenceSpan[] = [];

      if (claim === undefined) {
        text =
          speaker === 'assistant'
            ? fillerText(rng, 'assistant')
            : `${fillerText(rng, 'user')} ${tailSentence(rng)}`;
      } else {
        text = `${leadSentence(rng, claim.subject)} ${claim.sentence} ${tailSentence(rng)}`;
        const start_ = text.indexOf(claim.sentence);
        if (start_ < 0) {
          throw new CorpusError(`claim sentence for ${claim.key} is missing from its own message`);
        }
        if (text.indexOf(claim.sentence, start_ + 1) !== -1) {
          throw new CorpusError(`claim sentence for ${claim.key} appears twice in one message`);
        }
        claims = [
          {
            key: claim.key,
            subject: claim.subject,
            predicate: claim.predicate,
            kind: claim.kind,
            objectText: claim.objectText,
            objectEntity: claim.objectEntity,
            supersedes: claim.supersedes,
            validFrom: timestamp,
          },
        ];
        spans = [
          {
            claimKey: claim.key,
            start: start_,
            end: start_ + claim.sentence.length,
            quote: claim.sentence,
          },
        ];
        claimCount += 1;
      }

      characters += text.length;
      messages.push({
        key,
        sessionKey: skeleton.key,
        index: i,
        speaker,
        timestamp,
        text,
        claims,
        spans,
      });
    }

    sessions.push({
      key: skeleton.key,
      title: skeleton.title,
      startedAt: skeleton.startedAt,
      messages,
    });
  }

  const planned = plan.threads.reduce((total, thread) => total + thread.claims.length, 0);
  if (claimCount !== planned) {
    throw new CorpusError(`placed ${claimCount} claims but planned ${planned}`);
  }

  const stats: CorpusStats = {
    sessions: sessions.length,
    messages: sessions.reduce((total, session) => total + session.messages.length, 0),
    claims: claimCount,
    characters,
    estimatedTokens: Math.round(characters / 4),
  };

  return { sessions, stats };
}
