/**
 * Colour is an accent here and never a carrier of meaning.
 *
 * Every line this CLI prints reads the same in a pipe, a log file and a terminal
 * that has never heard of ANSI: a failing check says FAIL in words, not in red.
 * That is the rule the rendering follows, and this module exists to make the
 * accent easy to switch off rather than to make it load bearing.
 *
 * Off when NO_COLOR is set to anything at all (that is the convention, an empty
 * value still counts), off when TERM is dumb, and off when stdout is not a
 * terminal, which covers `lacuna doctor > report.txt` without anyone asking.
 */

export interface Palette {
  readonly heading: (text: string) => string;
  readonly dim: (text: string) => string;
  readonly good: (text: string) => string;
  readonly warn: (text: string) => string;
  readonly bad: (text: string) => string;
}

const identity = (text: string): string => text;

export const PLAIN: Palette = {
  heading: identity,
  dim: identity,
  good: identity,
  warn: identity,
  bad: identity,
};

/** Built from the code point so no invisible byte lives in this file. */
const ESCAPE = String.fromCharCode(27);

const wrap = (code: string) => (text: string): string =>
  `${ESCAPE}[${code}m${text}${ESCAPE}[0m`;

export const ANSI: Palette = {
  heading: wrap('1'),
  dim: wrap('2'),
  good: wrap('32'),
  warn: wrap('33'),
  bad: wrap('31'),
};

export function paletteFor(
  stream: { readonly isTTY?: boolean },
  env: Record<string, string | undefined>,
): Palette {
  if (env['NO_COLOR'] !== undefined) return PLAIN;
  if (env['TERM'] === 'dumb') return PLAIN;
  return stream.isTTY === true ? ANSI : PLAIN;
}
