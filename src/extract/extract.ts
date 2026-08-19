import { carryOver, classify } from './mode.js';
import { segmentTurns, splitSentences } from './segment.js';
import { STATING_MODES, slotFor } from './types.js';
import type {
  AssertionMode,
  ExtractedClaim,
  Extraction,
  Reading,
  RejectedSpan,
  Sentence,
  SourceMeta,
  Turn,
} from './types.js';

/**
 * Subject, property and value out of one sentence, and nothing out of the rest.
 *
 * The rule this file is built around is that saying nothing is a result. A
 * sentence with no property phrase in it produces no claim, a value with no
 * subject produces no claim, and a pronoun that cannot be tied to exactly one
 * earlier subject produces no claim. Every one of those could be guessed, and a
 * guess here does not surface as a low score, it surfaces as a fact the
 * sessions never contained. `never_stated` is a real answer this product is
 * proud of; inventing a pool size to avoid returning it would be the trade
 * running the wrong way.
 *
 * Properties come from a lexicon of connective phrases rather than from the
 * nouns around them. "is stored in", "is owned by", "TTL is", "must remain":
 * the phrase that links two things is what says which property is being talked
 * about, and it is also the part of a sentence that varies least between
 * writers. The lexicon is small and adding to it is the intended way to widen
 * coverage. What is deliberately absent is a fallback that reads any copula as
 * a property, because "the launch is delayed" would then become a storage claim
 * about a launch.
 */

interface Frame {
  readonly property: string;
  readonly connective: RegExp;
  /**
   * Set when the connective itself brackets the subject, as in "migrate the
   * session store to Postgres". Otherwise the subject is the phrase to the left.
   */
  readonly subjectGroup?: number;
  readonly objectIsEntity?: boolean;
}

const FRAMES: readonly Frame[] = [
  { property: 'storage', connective: /\b(?:is|are|was|were|been|gets?)\s+(?:\w+ly\s+)?stored\s+in\b/i },
  { property: 'storage', connective: /\bstorage\s+(?:is|was)\b/i },
  { property: 'storage', connective: /\b(?:migrated|moved|switched|cut\s+over)\s+to\b/i },
  {
    property: 'storage',
    connective:
      /\b(?:move|moves|moving|moved|migrate|migrating|migrated|switch|switching|switched)\s+(.+?)\s+to\b/i,
    subjectGroup: 1,
  },
  {
    property: 'owner',
    connective: /\b(?:is|are|was|were)\s+(?:\w+ly\s+)?owned\s+by\b/i,
    objectIsEntity: true,
  },
  { property: 'owner', connective: /\bowner\s+(?:is|was)\b/i, objectIsEntity: true },
  { property: 'ttl', connective: /\bttl\s+(?:is|was)\b/i },
  { property: 'pool_size', connective: /\bpool\s+size\s+(?:is|was)\b/i },
  { property: 'region', connective: /\b(?:runs|run|running|deployed|hosted)\s+in\b/i },
  { property: 'depends_on', connective: /\bdepends?\s+on\b/i, objectIsEntity: true },
  { property: 'policy', connective: /\bmust\s+(?:remain|stay|be)\b/i },
];

/**
 * The properties the frame table can read, for a screen that has to tell a
 * reader what it will and will not understand before they type into it.
 *
 * This is the honest ceiling of the extractor. It reads eleven sentence shapes,
 * not English, so prose about anything else produces nothing rather than
 * producing a guess. Saying so up front is the difference between a limit and a
 * silent failure.
 */
export const READABLE_PROPERTIES: readonly string[] = [...new Set(FRAMES.map((frame) => frame.property))];

/**
 * "It is Postgres, not Redis."
 *
 * A correction of this shape names its target by value rather than by subject,
 * which is more useful than it looks: the old value is a pointer into the graph
 * and needs no pronoun resolution at all. If no earlier claim holds that value,
 * there is nothing being corrected and nothing is emitted.
 */
const SWAP = /([A-Za-z0-9][\w .#/'-]*?)\s*,\s*not\s+([A-Za-z0-9][\w .#/'-]*?)\s*[.!?]*$/;

const PRONOUNS: ReadonlySet<string> = new Set(['it', 'this', 'that', 'they', 'them', 'these', 'those']);

/** Words that may open a noun phrase and carry no identity of their own. */
const DETERMINERS: ReadonlySet<string> = new Set([
  'the', 'a', 'an', 'all', 'every', 'each', 'our', 'my', 'your', 'their', 'its',
  'and', 'but', 'so', 'then', 'also', 'now', 'currently', 'actually', 'today',
  'still', 'just', 'only',
]);

/**
 * Words a noun phrase cannot reach back through. Mostly verbs: "the runbook
 * confirms session data" is a claim about session data, not about a runbook.
 */
const CLAUSE_BREAK: ReadonlySet<string> = new Set([
  'confirms', 'confirmed', 'says', 'said', 'states', 'stated', 'records', 'recorded',
  'shows', 'showed', 'notes', 'noted', 'reports', 'reported', 'thinks', 'think',
  'that', 'which', 'because', 'since', 'if', 'when', 'while', 'where',
  'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'must',
  'to', 'for', 'on', 'in', 'at', 'by', 'from', 'with', 'about',
]);

/**
 * Trailing words that say when rather than what.
 *
 * A value keeps only the thing it names. "We migrated sessions to Redis last
 * week" is a claim that the store is Redis, and "last week" belongs to the
 * clock rather than to the answer: left on, it produces the object text "Redis
 * last week", which is wrong as an answer and wrong as a value to compare a
 * later claim against. Ordering is already carried by turn order and by the
 * timestamp on the turn, so nothing is lost by dropping it here, exactly as
 * "now" and "currently" have always been dropped.
 */
const TRAILING_TIME =
  /\s+(?:now|today|currently|any\s?more|from\s+now\s+on|going\s+forward|at\s+the\s+moment|right\s+now|yesterday|recently|(?:last|this)\s+(?:night|week|month|year|quarter|morning|afternoon|evening))$/i;

/** Where a value ends. Anything past one of these is another clause. */
const VALUE_END = /[.!?,;]|\s+(?:because|so\s+that|and|but|since|which|that|on|for|from|as\s+of|with|until|while)\s+/i;

const MONTHS: readonly string[] = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

/**
 * A date that sets when a claim became true, and only when the sentence says so.
 *
 * The introducer is required. "Before 5 March 2026" names the end of something
 * rather than the start, and reading it as a `valid_from` would file a
 * historical claim under a date it was already over by. A year is required for
 * the same class of reason: "March 5" has no year in it, and picking one is
 * picking which side of a revision a claim falls on.
 */
const DATED = new RegExp(
  String.raw`\b(?:on|as of|since|from|effective)\s+` +
    String.raw`(?:(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})|([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4}))`,
  'i',
);

function isoFrom(day: string, month: string, year: string): string | null {
  const index = MONTHS.indexOf(month.toLowerCase());
  const dayNumber = Number.parseInt(day, 10);
  if (index === -1 || Number.isNaN(dayNumber) || dayNumber < 1 || dayNumber > 31) return null;
  const mm = String(index + 1).padStart(2, '0');
  const dd = String(dayNumber).padStart(2, '0');
  return `${year}-${mm}-${dd}T00:00:00.000Z`;
}

function statedDate(sentence: string): string | null {
  const match = DATED.exec(sentence);
  if (match === null) return null;
  if (match[1] !== undefined && match[2] !== undefined && match[3] !== undefined) {
    return isoFrom(match[1], match[2], match[3]);
  }
  if (match[4] !== undefined && match[5] !== undefined && match[6] !== undefined) {
    return isoFrom(match[5], match[4], match[6]);
  }
  return null;
}

function words(text: string): readonly string[] {
  return text.split(/\s+/).filter((word) => word !== '');
}

function stripDeterminers(parts: readonly string[]): readonly string[] {
  let start = 0;
  while (start < parts.length) {
    const word = parts[start];
    if (word === undefined || !DETERMINERS.has(word.toLowerCase().replace(/[^a-z]/g, ''))) break;
    start += 1;
  }
  return parts.slice(start);
}

/** The noun phrase closest to the connective, reaching back at most four words. */
function subjectToTheLeft(left: string): string {
  const clause = left.split(/[,;:]/).pop() ?? '';
  const parts = words(clause.replace(/["'`]/g, ''));
  const taken: string[] = [];
  for (let i = parts.length - 1; i >= 0 && taken.length < 4; i -= 1) {
    const word = parts[i];
    if (word === undefined) break;
    if (CLAUSE_BREAK.has(word.toLowerCase().replace(/[^a-z]/g, ''))) break;
    taken.unshift(word);
  }
  return stripDeterminers(taken).join(' ').replace(/[.,;:!?]+$/, '').trim();
}

function cleanSubject(raw: string): string {
  const parts = stripDeterminers(words(raw.replace(/["'`]/g, '')));
  return parts.join(' ').replace(/[.,;:!?]+$/, '').trim();
}

function valueToTheRight(right: string): string {
  const match = VALUE_END.exec(right);
  const head = match === null ? right : right.slice(0, match.index);
  return head.replace(TRAILING_TIME, '').replace(/["'`]/g, '').trim();
}

function usable(text: string): boolean {
  return text !== '' && /[A-Za-z0-9]/.test(text);
}

interface Hit {
  readonly frame: Frame;
  readonly subject: string;
  readonly value: string;
}

/** The frame whose connective appears earliest. One claim per sentence, at most. */
function readFrame(sentence: string): Hit | null {
  let best: { at: number; hit: Hit } | null = null;

  for (const frame of FRAMES) {
    const match = frame.connective.exec(sentence);
    if (match === null) continue;

    const captured = frame.subjectGroup === undefined ? undefined : match[frame.subjectGroup];
    const subject =
      captured === undefined
        ? subjectToTheLeft(sentence.slice(0, match.index))
        : cleanSubject(captured);
    const value = valueToTheRight(sentence.slice(match.index + match[0].length));
    if (!usable(subject) || !usable(value)) continue;

    if (best === null || match.index < best.at) {
      best = { at: match.index, hit: { frame, subject, value } };
    }
  }

  return best === null ? null : best.hit;
}

/** The value half of "X, not Y", with any leading copula clause removed. */
function swapValue(text: string): string {
  const tail = text.split(/\s+(?:is|are|was|were|'s)\s+/i).pop() ?? text;
  return cleanSubject(tail);
}

const fold = (name: string): string => name.toLowerCase();

/** Folded subject and property, joined by a character a property cannot hold. */
function slotKey(subject: string, property: string): string {
  return `${fold(subject)}|${property}`;
}

/**
 * Names differing only in case are one thing.
 *
 * The same fold `src/hydra/canonical.ts` applies on the read side, applied here
 * on the write side and for the same reason: "session data" written once with a
 * capital and once without is one subject, and treating it as two would file a
 * migration under a different entity than the state it replaced. Folding is
 * case and nothing else. "Auth API" and "Authentication Service" stay two
 * things, because deciding they are one is a claim about the system that the
 * sessions did not make.
 */
class Subjects {
  readonly #canonical = new Map<string, string>();

  /** The spelling first seen for this name. */
  intern(name: string): string {
    const key = fold(name);
    const known = this.#canonical.get(key);
    if (known !== undefined) return known;
    this.#canonical.set(key, name);
    return name;
  }
}

interface Live {
  readonly key: string;
  readonly subject: string;
  readonly property: string;
  readonly objectText: string;
}

/**
 * One turn as a caller already holds it, for sources that never were prose.
 *
 * A chat export, a benchmark haystack and a message table all arrive already
 * split into turns with a speaker and a clock on each one. Rendering them back
 * into "speaker: text" lines so the segmenter can split them again is lossy in
 * exactly the case that matters: a turn whose own text contains a newline comes
 * back as two turns, and every offset after it is wrong.
 */
export interface TurnInput {
  readonly speaker: string;
  readonly role: 'user' | 'assistant';
  readonly timestamp: string;
  readonly text: string;
}

/**
 * The separator between turns in the reconstructed source.
 *
 * The span check verifies a quote against both its turn and its position in the
 * whole source, and that second check is only meaningful if a source exists. So
 * one is built by joining the turns, and the offsets are assigned from the same
 * join rather than asserted alongside it.
 */
const TURN_JOIN = '\n';

export function extractTurns(input: readonly TurnInput[], meta: SourceMeta): Extraction {
  const turns: Turn[] = [];
  let offset = 0;
  input.forEach((turn, index) => {
    turns.push({ ...turn, index, offset });
    offset += turn.text.length + TURN_JOIN.length;
  });
  return run(turns, turns.map((turn) => turn.text).join(TURN_JOIN), meta);
}

export function extract(raw: string, meta: SourceMeta): Extraction {
  return run(segmentTurns(raw, meta), raw, meta);
}

function run(turns: readonly Turn[], raw: string, meta: SourceMeta): Extraction {
  const claims: ExtractedClaim[] = [];
  const readings: Reading[] = [];
  const rejected: RejectedSpan[] = [];

  const subjects = new Subjects();
  /** Folded subject and property to the stating claim that currently holds it. */
  const standing = new Map<string, Live>();
  /** Folded value to the stating claim that last asserted it, for "X, not Y". */
  const byValue = new Map<string, Live>();

  for (const turn of turns) {
    const sentences = splitSentences(turn.text);
    const modes = carryOver(sentences.map((sentence) => classify(sentence.text)));

    sentences.forEach((sentence, index) => {
      const mode = modes[index] ?? 'EXPLICIT_STATE';
      const made = readSentence({
        raw,
        turn,
        sentence,
        index,
        mode,
        meta,
        subjects,
        standing,
        byValue,
        rejected,
      });

      for (const claim of made) {
        claims.push(claim);
        if (!STATING_MODES.has(claim.mode)) continue;
        const live: Live = {
          key: claim.key,
          subject: claim.subject,
          property: claim.property,
          objectText: claim.objectText,
        };
        standing.set(slotKey(claim.subject, claim.property), live);
        byValue.set(fold(claim.objectText), live);
      }

      readings.push({
        turnIndex: turn.index,
        sentenceIndex: index,
        mode,
        text: sentence.text,
        start: sentence.start,
        end: sentence.end,
        claimKeys: made.map((claim) => claim.key),
      });
    });
  }

  return { turns, claims, readings, rejected };
}

interface Context {
  readonly raw: string;
  readonly turn: Turn;
  readonly sentence: Sentence;
  readonly index: number;
  readonly mode: AssertionMode;
  readonly meta: SourceMeta;
  readonly subjects: Subjects;
  readonly standing: Map<string, Live>;
  readonly byValue: Map<string, Live>;
  readonly rejected: RejectedSpan[];
}

function readSentence(context: Context): readonly ExtractedClaim[] {
  const swapped = context.mode === 'CORRECTION' ? readSwap(context) : null;
  if (swapped !== null) return [swapped];

  const hit = readFrame(context.sentence.text);
  if (hit === null) return [];

  const subject = resolveSubject(context, hit);
  if (subject === null) return [];

  const claim = build(context, {
    subject,
    property: hit.frame.property,
    objectText: hit.value,
    objectEntity: hit.frame.objectIsEntity === true ? hit.value : null,
  });
  return claim === null ? [] : [claim];
}

/**
 * A pronoun subject, tied to the one earlier subject that could own it.
 *
 * The property is already known from the connective, so this is not general
 * coreference: it asks which subjects have ever had a claim on this exact
 * property, and binds only when there is exactly one. Two candidates means the
 * sentence is ambiguous to a reader as well, and the extractor says nothing.
 */
function resolveSubject(context: Context, hit: Hit): string | null {
  const plain = hit.subject;
  if (!PRONOUNS.has(plain.toLowerCase())) return context.subjects.intern(plain);

  const candidates = new Set<string>();
  for (const live of context.standing.values()) {
    if (live.property === hit.frame.property) candidates.add(live.subject);
  }
  if (candidates.size !== 1) return null;
  return [...candidates][0] ?? null;
}

function readSwap(context: Context): ExtractedClaim | null {
  const match = SWAP.exec(context.sentence.text);
  if (match === null) return null;

  const replacement = swapValue(match[1] ?? '');
  const displaced = cleanSubject(match[2] ?? '');
  if (!usable(replacement) || !usable(displaced)) return null;

  const target = context.byValue.get(fold(displaced));
  if (target === undefined) return null;

  return build(context, {
    subject: target.subject,
    property: target.property,
    objectText: replacement,
    objectEntity: null,
  });
}

interface Draft {
  readonly subject: string;
  readonly property: string;
  readonly objectText: string;
  readonly objectEntity: string | null;
}

/**
 * A claim, once every part of it has been found in the text.
 *
 * The span check is the last gate and it is not a formality. `quote` has to be
 * the exact bytes at `[start, end)` of the turn *and* of the raw source, which
 * catches the whole class of bug where a normalising step upstream shifts an
 * offset by one and every citation in the graph starts pointing a character to
 * the left. A span that fails is dropped along with its claim and recorded,
 * because a claim nobody can check is worth less than no claim.
 */
function build(context: Context, draft: Draft): ExtractedClaim | null {
  const { turn, sentence, mode } = context;
  const quote = sentence.text;

  if (turn.text.slice(sentence.start, sentence.end) !== quote) {
    context.rejected.push({
      turnIndex: turn.index,
      reason: 'span does not match the turn text it indexes',
      quote,
    });
    return null;
  }
  const from = turn.offset + sentence.start;
  if (context.raw.slice(from, turn.offset + sentence.end) !== quote) {
    context.rejected.push({
      turnIndex: turn.index,
      reason: 'span does not match the raw source it indexes',
      quote,
    });
    return null;
  }

  const predicate = slotFor(draft.property, mode);
  const stated = STATING_MODES.has(mode);
  const held = context.standing.get(slotKey(draft.subject, draft.property));

  // Only a reported change or a correction replaces what stood before. Two
  // plain statements of state that disagree are left to contradict each other,
  // which is the arrangement the resolver has a distinct answer for.
  const replaces =
    stated &&
    mode !== 'EXPLICIT_STATE' &&
    held !== undefined &&
    fold(held.objectText) !== fold(draft.objectText)
      ? held.key
      : null;

  return {
    key: `${context.meta.sessionKey}#${turn.index}.${context.index}.${predicate}`,
    subject: draft.subject,
    predicate,
    property: draft.property,
    mode,
    kind: replaces === null ? 'assert' : 'revise',
    objectText: draft.objectText,
    objectEntity: draft.objectEntity,
    supersedes: replaces,
    validFrom: statedDate(sentence.text) ?? turn.timestamp,
    turnIndex: turn.index,
    span: { start: sentence.start, end: sentence.end, quote },
  };
}
