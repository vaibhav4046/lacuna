import { RetrievalError } from './errors';
import type { RetrievalQuestion } from './types';

/**
 * Turning what a person asked into something retrieval can act on.
 *
 * This layer is deliberately thin. It reads the question and nothing else: it
 * never looks at the graph, never scores a similarity, and never sees an
 * expected answer. That is what makes the evaluation honest, because the two
 * questions the corpus builds to be indistinguishable ("who is our contact for
 * the vendor behind X" where the contact exists, and the same sentence where it
 * does not) come out of here as the same structure, and only the graph can
 * separate them.
 */

/** Long enough for any real name, short enough that a paste cannot become a payload. */
export const MAX_TERM_CHARS = 200;

/**
 * "for the <relation> behind <subject>" is an instruction to follow a relation
 * before answering. The relation is named in the sentence, so reading it is
 * parsing rather than guessing.
 */
const VIA_PATTERN = /\bfor the ([a-z][a-z0-9_]*) behind\b/i;

const SPACE = 0x20;
const DELETE = 0x7f;
const LAST_C1 = 0x9f;

/**
 * Written as code point arithmetic rather than a regex character class because
 * every control character is invisible in source, and an invisible character in
 * a guard against invisible characters is a guard nobody can review.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code < SPACE || (code >= DELETE && code <= LAST_C1)) {
      return true;
    }
  }
  return false;
}

function assertTerm(value: string, role: string): string {
  const trimmed = value.trim();
  if (trimmed === '') {
    throw new RetrievalError(`${role} is empty`);
  }
  if (trimmed.length > MAX_TERM_CHARS) {
    throw new RetrievalError(
      `${role} is ${trimmed.length} characters, over the ${MAX_TERM_CHARS} character cap`,
    );
  }
  // Letting one through would put an unprintable into a trace line that gets
  // rendered, and into a parameter that gets logged.
  if (hasControlCharacter(trimmed)) {
    throw new RetrievalError(`${role} contains a control character`);
  }
  return trimmed;
}

export function buildQuestion(
  subject: string,
  predicate: string,
  via: string | null = null,
): RetrievalQuestion {
  return {
    subject: assertTerm(subject, 'subject'),
    predicate: assertTerm(predicate, 'predicate'),
    via: via === null ? null : assertTerm(via, 'via'),
  };
}

/** The relation the question asks to follow, or null when it asks directly. */
export function parseVia(text: string): string | null {
  const found = VIA_PATTERN.exec(text);
  return found === null ? null : found[1]!.toLowerCase();
}
