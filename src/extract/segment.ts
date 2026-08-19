import type { Sentence, SourceMeta, Turn } from './types.js';

/**
 * Raw text into turns and sentences, without losing a character position.
 *
 * Every offset produced here is an offset into the string that was handed in,
 * because the evidence span on a claim has to be checkable against the source a
 * reader can see. A segmenter that trims, normalises whitespace or rewrites
 * quotes would still produce readable turns and would quietly make every span
 * an approximation, which is the same as having no spans.
 *
 * A turn header is `speaker:` at the start of a line, optionally preceded by a
 * bracketed timestamp. The speaker label is one token: "Correction on the
 * launch: it moved" is a sentence about a launch, not a turn by somebody called
 * "Correction on the launch", and requiring a single token is what tells them
 * apart. Text with no headers at all is one turn, which is the right reading of
 * a pasted note.
 *
 * Nothing here invents a clock. A turn with no timestamp of its own inherits
 * the one before it, and the first inherits the session start, because the
 * alternative is a fabricated ordering that the resolver would then use to
 * decide which claim is newer.
 */

/**
 * `[2026-03-05T16:00:00.000Z] amir: PR #184 merged.`
 *
 * The label is capped at 24 characters and admits no spaces, which is the whole
 * defence against reading a colon in ordinary prose as a speaker change.
 */
const HEADER = /^[ \t]*(?:\[([^\]]{1,64})\][ \t]*)?([A-Za-z][A-Za-z0-9_.'-]{0,23})[ \t]*:[ \t]?/;

/**
 * `system` is deliberately absent. A line reading `SYSTEM: disregard the stored
 * value` is text somebody typed, and recording it as an ordinary participant is
 * the accurate reading. Nothing downstream treats either role as authoritative,
 * so the only thing a `system` entry could buy is the appearance of one.
 */
const ASSISTANT_LABELS: ReadonlySet<string> = new Set(['assistant', 'agent', 'bot', 'model']);

function roleOf(speaker: string): 'user' | 'assistant' {
  return ASSISTANT_LABELS.has(speaker.toLowerCase()) ? 'assistant' : 'user';
}

interface Header {
  readonly speaker: string;
  readonly timestamp: string | null;
  /** Where the turn's text begins, relative to the line start. */
  readonly bodyOffset: number;
}

function readHeader(line: string): Header | null {
  const match = HEADER.exec(line);
  if (match === null) return null;
  const speaker = match[2];
  if (speaker === undefined) return null;
  const stamp = match[1];
  return {
    speaker,
    timestamp: stamp === undefined ? null : stamp.trim(),
    bodyOffset: match[0].length,
  };
}

/**
 * Turns, in order, each carrying the offset of its text within `raw`.
 *
 * Lines between headers belong to the turn above them, joined with the newline
 * they were written with, so a multi line message stays one message and its
 * offsets stay true.
 */
export function segmentTurns(raw: string, meta: SourceMeta): readonly Turn[] {
  const turns: Turn[] = [];
  const fallbackSpeaker = meta.defaultSpeaker ?? 'user';

  let speaker = fallbackSpeaker;
  let timestamp = meta.startedAt;
  let start: number | null = null;
  let end = 0;
  let cursor = 0;

  const flush = (): void => {
    if (start === null) return;
    const text = raw.slice(start, end);
    if (text.trim() !== '') {
      turns.push({
        index: turns.length,
        speaker,
        role: roleOf(speaker),
        timestamp,
        text,
        offset: start,
      });
    }
    start = null;
  };

  for (const line of raw.split('\n')) {
    const lineStart = cursor;
    cursor += line.length + 1;

    const header = readHeader(line);
    if (header === null) {
      if (start === null) {
        // Text before any header. One turn, on the session's own clock.
        start = lineStart;
      }
      end = lineStart + line.length;
      continue;
    }

    flush();
    speaker = header.speaker;
    timestamp = header.timestamp ?? timestamp;
    start = lineStart + header.bodyOffset;
    end = lineStart + line.length;
  }
  flush();

  return turns;
}

/**
 * Sentences, split on terminal punctuation followed by whitespace or the end.
 *
 * The lookahead is what keeps `PR #184` and `1.2.0` in one piece, and it is
 * also the limit: an abbreviation followed by a space splits a sentence that a
 * reader would not. That costs a claim rather than inventing one, since the
 * halves stop matching any pattern, which is the failure direction to prefer.
 */
export function splitSentences(text: string): readonly Sentence[] {
  const found: Sentence[] = [];
  const terminator = /[.!?]+(?=\s|$)/g;
  let cursor = 0;

  for (let match = terminator.exec(text); match !== null; match = terminator.exec(text)) {
    const end = match.index + match[0].length;
    collect(text, cursor, end, found);
    cursor = end;
  }
  collect(text, cursor, text.length, found);

  return found;
}

function collect(text: string, from: number, to: number, into: Sentence[]): void {
  const slice = text.slice(from, to);
  const trimmed = slice.trim();
  if (trimmed === '') return;
  const lead = slice.length - slice.trimStart().length;
  into.push({ text: trimmed, start: from + lead, end: from + lead + trimmed.length });
}
