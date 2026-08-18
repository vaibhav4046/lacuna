import { RetrievalError } from './errors.js';
import type { RetrievalQuestion } from './types.js';

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

/**
 * "If <package> changes, which services are affected?" is a request for a
 * closure rather than a value. Anchored at both ends so a sentence that merely
 * mentions a change cannot be mistaken for one.
 */
const BLAST_PATTERN = /^if (.+?) changes, which services are affected\?$/i;

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

/**
 * The same guard, for the one input that is not a question.
 *
 * A blast radius takes a package name and nothing else. The name still has to
 * clear the cap and the control character check before it reaches the graph,
 * and it has to fail as a rejected input rather than as a transport error: the
 * guard inside the query builder throws a `HydraGuardError`, which this server
 * reports as the graph being unreachable. It is not. It is a bad name.
 */
export function buildPackageName(name: string): string {
  return assertTerm(name, 'package name');
}

/** The relation the question asks to follow, or null when it asks directly. */
export function parseVia(text: string): string | null {
  const found = VIA_PATTERN.exec(text);
  return found === null ? null : found[1]!.toLowerCase();
}

/**
 * The package a blast radius question names, or null when it is not one.
 *
 * Read off the sentence for the same reason `parseVia` is: a system under
 * comparison must not be allowed to look at the label the corpus filed the
 * question under. A thread kind is scoring metadata. A sentence is the input.
 * If a baseline is going to lose this comparison it should lose it on how far
 * it can reach, not on being told in advance which questions it may not win.
 */
export function parseBlast(text: string): string | null {
  const found = BLAST_PATTERN.exec(text.trim());
  return found === null ? null : found[1]!;
}
