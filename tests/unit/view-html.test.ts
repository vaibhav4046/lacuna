import { describe, expect, it } from 'vitest';

import { escape, html, HtmlError, join, markup } from '../../src/view/html';

/**
 * The escaping boundary.
 *
 * This is the one module whose failure is a vulnerability rather than a wrong
 * pixel, so it is tested against the shapes an injected string actually takes
 * rather than against a single angle bracket.
 */

describe('escape', () => {
  it('covers the five characters that change meaning', () => {
    expect(escape('&<>"\'')).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('escapes the ampersand first, so nothing is double decoded', () => {
    // Escaping < before & would produce &amp;lt;, which renders as the text
    // "&lt;" rather than as "<". Doing it in one pass avoids the question.
    expect(escape('&lt;')).toBe('&amp;lt;');
  });

  it('leaves ordinary text alone', () => {
    expect(escape('Meridian ships in Q3')).toBe('Meridian ships in Q3');
  });
});

describe('html', () => {
  it('escapes an interpolated string', () => {
    const quote = '<script>alert(1)</script>';
    expect(markup(html`<p>${quote}</p>`)).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('escapes a value that would break out of a quoted attribute', () => {
    const name = '" onmouseover="alert(1)';
    expect(markup(html`<a title="${name}">x</a>`)).toBe(
      '<a title="&quot; onmouseover=&quot;alert(1)">x</a>',
    );
  });

  it('nests markup without escaping it twice', () => {
    const inner = html`<em>${'a & b'}</em>`;
    expect(markup(html`<p>${inner}</p>`)).toBe('<p><em>a &amp; b</em></p>');
  });

  it('renders a list of pieces in order', () => {
    const items = ['one', 'two'].map((text) => html`<li>${text}</li>`);
    expect(markup(html`<ul>${items}</ul>`)).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  it('renders nothing for null and undefined', () => {
    expect(markup(html`<p>${null}${undefined}</p>`)).toBe('<p></p>');
  });

  it('renders numbers, which is what coordinates are', () => {
    expect(markup(html`<line x1="${12.5}" x2="${-3}" />`)).toBe(
      '<line x1="12.5" x2="-3" />',
    );
  });

  it('refuses a coordinate that is not a number', () => {
    // A NaN in a path is an invisible drawing, and the arithmetic that produces
    // one is upstream of here. Failing loudly beats rendering an empty chart.
    expect(() => html`<line x1="${NaN}" />`).toThrow(HtmlError);
    expect(() => html`<line x1="${Infinity}" />`).toThrow(HtmlError);
  });

  it('refuses anything else, including an object that only looks like markup', () => {
    const forged = { 'lacuna.markup': '<script>alert(1)</script>' } as unknown as string;
    expect(() => html`<p>${forged}</p>`).toThrow(HtmlError);
  });
});

describe('join', () => {
  it('puts the separator between pieces and not at the ends', () => {
    expect(markup(join(['a', 'b', 'c'], html`<i>, </i>`))).toBe('a<i>, </i>b<i>, </i>c');
  });

  it('escapes the pieces it joins', () => {
    expect(markup(join(['<a>', '<b>'], ' '))).toBe('&lt;a&gt; &lt;b&gt;');
  });

  it('renders one piece with no separator, and none with nothing', () => {
    expect(markup(join(['only'], ', '))).toBe('only');
    expect(markup(join([], ', '))).toBe('');
  });
});
