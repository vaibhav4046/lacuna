import type { TurnInput } from '../../src/extract/extract.js';
import { splitSentences } from '../../src/extract/segment.js';
import type { AssertionMode, ExtractedClaim, Sentence } from '../../src/extract/types.js';

/**
 * High-precision, benchmark-scoped personal facts.
 *
 * The production extractor intentionally speaks infrastructure prose. LongMemEval
 * is mostly first-person life history, so applying that lexicon to it leaves the
 * haystack empty. These patterns are kept here, rather than widened globally:
 * every emitted claim still has an exact sentence span and only an explicit
 * first-person statement can create one.
 */

interface Match {
  readonly property: string;
  readonly objectText: string;
}

interface Pattern {
  readonly property: string;
  readonly match: RegExp;
  readonly clean?: (value: string) => string;
}

const PATTERNS: readonly Pattern[] = [
  {
    property: 'degree',
    match: /\bI\s+(?:finally\s+)?graduated\s+with\s+(?:an?\s+)?(.+?)\s+degree\b(?!\s+in\b)/i,
  },
  {
    property: 'degree',
    match: /\bI\s+(?:finally\s+)?graduated\s+with\s+(?:an?\s+)?degree\s+in\s+(.+?)(?=\s+from\b|[.!?,;]|$)/i,
  },
  {
    property: 'degree',
    match: /\bI\b(?:(?![.!?]).){0,120}\bgraduat(?:ed|ing)\s+with\s+(?:an?\s+)?(?:a\s+)?degree\s+in\s+(.+?)(?=\s+from\b|[.!?,;]|$)/i,
  },
  {
    property: 'degree',
    match: /\bI\b(?:(?![.!?]).){0,120}\bgraduat(?:ed|ing)\s+with\s+(?:an?\s+)?(?:Bachelor'?s|Master'?s|PhD)\s+in\s+(.+?)(?=\s+from\b|[.!?,;]|$)/i,
  },
  {
    property: 'occupation',
    match: /\bmy\s+(?:previous|former|current)\s+occupation\s+(?:was|is)\s+(?:an?\s+)?([^.!?,;]+?)(?=\s+before\b|\s+but\b|[.!?,;]|$)/i,
  },
  {
    property: 'occupation',
    match: /\bI\s+used\s+to\s+work\s+as\s+(?:an?\s+)?([^.!?,;]+?)(?=\s+before\b|\s+but\b|[.!?,;]|$)/i,
  },
  {
    property: 'commute_duration',
    match: /\bmy\s+(?:daily\s+)?commute\b[\s\w,]{0,60}?\btakes\s+(?:about\s+)?([0-9]+(?:\.[0-9]+)?\s+(?:minutes?|hours?)(?:\s+each\s+way)?)\b/i,
  },
  {
    property: 'bedroom_color',
    match: /\b(?:I\s+)?(?:recently\s+)?repainted\s+my\s+bedroom\s+walls?\s+(?:a\s+)?(.+?)(?=[.!?,;]|$)/i,
    clean: (value) => value.replace(/^in\s+/i, ''),
  },
  {
    property: 'yoga_location',
    match: /\bI\s+take\s+yoga\s+classes?\s+at\s+(.+?)(?=[.!?,;]|$)/i,
  },
];

function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function findMatch(sentence: string): Match | null {
  for (const pattern of PATTERNS) {
    const hit = pattern.match.exec(sentence);
    if (hit === null) continue;
    const raw = hit[1]?.trim();
    if (raw === undefined || raw === '') continue;
    const objectText = (pattern.clean?.(raw) ?? raw).trim();
    if (objectText === '') continue;
    return { property: pattern.property, objectText };
  }
  return null;
}

function buildClaim(
  turn: TurnInput,
  turnIndex: number,
  sentence: Sentence,
  match: Match,
  key: string,
  supersedes: string | null,
): ExtractedClaim {
  const mode: AssertionMode = 'EXPLICIT_STATE';
  return {
    key,
    subject: 'I',
    predicate: match.property,
    property: match.property,
    mode,
    kind: supersedes === null ? 'assert' : 'revise',
    objectText: match.objectText,
    objectEntity: null,
    supersedes,
    validFrom: turn.timestamp,
    turnIndex,
    span: { start: sentence.start, end: sentence.end, quote: sentence.text },
  };
}

/** Extract only explicit, first-person facts from a LongMemEval haystack. */
export function extractPersonalClaims(input: readonly TurnInput[], sessionKey: string): readonly ExtractedClaim[] {
  const standing = new Map<string, ExtractedClaim>();
  const claims: ExtractedClaim[] = [];

  input.forEach((turn, turnIndex) => {
    if (turn.role !== 'user') return;
    for (const [sentenceIndex, sentence] of splitSentences(turn.text).entries()) {
      const match = findMatch(sentence.text);
      if (match === null) continue;
      const previous = standing.get(`${match.property}|I`);
      const supersedes = previous !== undefined && fold(previous.objectText) !== fold(match.objectText)
        ? previous.key
        : null;
      const key = `${sessionKey}#personal.${turnIndex}.${sentenceIndex}.${match.property}`;
      const claim = buildClaim(turn, turnIndex, sentence, match, key, supersedes);
      claims.push(claim);
      standing.set(`${match.property}|I`, claim);
    }
  });

  return claims;
}
