/**
 * Pulling the human-readable text out of a source file.
 *
 * This lives beside the lint rather than inside `scripts/copy-lint.ts` so it
 * can be tested directly. The lint is a script that runs on import, and the
 * part worth pinning is exactly this: what counts as copy. Every false positive
 * this check has produced was a piece of code being read as a sentence, and
 * each fix narrowed the extractor. A narrowing with no test is a lint quietly
 * going blind, so the narrowings are pinned in tests/unit/copy-segments.test.ts.
 */

export interface Segment {
  readonly line: number;
  readonly text: string;
}

/**
 * String literals first, then JSX text.
 *
 * Order is load-bearing rather than stylistic: a literal such as `'a > b'`
 * would otherwise be split by the JSX branch and read as a text node. Letting
 * the literal alternatives consume first means a quote always wins, which is
 * also how the language reads it.
 *
 * The JSX branch requires a closing `<` so that a stray angle bracket does not
 * turn the rest of a file into copy, and it refuses a `>` that belongs to `=>`
 * or `>=`. Without that second guard `selected >= 0 && selected !== ci;` reads
 * as a text node, and the lint reports the `!` in a strict inequality as an
 * exclamation mark in the interface, which is the kind of finding that teaches
 * people to stop reading the output.
 *
 * The same class comes back between the arms of a ternary. In
 * `) : !value.available ? (` the `>` closing one element and the `<` opening
 * the next are separated by an expression, which reads as a text node and puts
 * a `!` in front of the reader again. Prose in this product does not contain
 * `) :`, `? (`, `&&`, `||` or `=>`, so a segment carrying one of them is code
 * and is skipped.
 */
const LOOKS_LIKE_CODE = /\)\s*:|\?\s*\(|&&|\|\||=>/;
const SEGMENT_PATTERN = new RegExp(
  [
    "'(?:[^'\\\\\\n]|\\\\.)*'",
    '"(?:[^"\\\\\\n]|\\\\.)*"',
    '`(?:[^`\\\\]|\\\\.)*`',
    '(?<![=!<>-])>(?![=>])[^<>{}]+<',
  ].join('|'),
  'g',
);

export function segments(source: { readonly prose: boolean }, content: string): readonly Segment[] {
  if (source.prose) {
    return content
      .split('\n')
      .map((text, index) => ({ line: index + 1, text }))
      .filter((segment) => segment.text.trim().length > 0);
  }

  const found: Segment[] = [];
  for (const match of content.matchAll(SEGMENT_PATTERN)) {
    const raw = match[0] ?? '';
    const text = raw.slice(1, -1);
    if (text.trim().length === 0) continue;
    if (LOOKS_LIKE_CODE.test(text)) continue;
    found.push({ line: content.slice(0, match.index).split('\n').length, text });
  }
  return found;
}
