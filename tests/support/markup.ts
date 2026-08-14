/**
 * Small readings of rendered markup, shared by the suites that check a page.
 *
 * These are regular expressions over a string, which is the right tool exactly
 * once: when the thing under test is the string. The pages are produced by one
 * escaping template with no way to opt a value into markup, so the output is
 * regular enough for a pattern to be a real check rather than a guess at a
 * parse. Anything that wanted to know about structure rather than about text
 * would belong in a test that renders and reads, not here.
 */

/**
 * Every link the page bar marks as the page you are on.
 *
 * Returned as a list rather than a count because the bar is rendered twice, at
 * the top of the page and again in the footer, and the property worth holding
 * is that both copies name one route rather than that there are exactly two of
 * them. A layout that adds a third nav should not fail a test about
 * `aria-current`, and a layout whose two navs disagree should.
 */
export function markedPages(rendered: string): readonly string[] {
  return [...rendered.matchAll(/href="([^"]*)" aria-current="page"/g)]
    .map((match) => match[1] ?? '');
}
