import { describe, expect, it } from 'vitest';

import { segments } from '../../scripts/lib/copy-segments.js';

/**
 * What the copy lint counts as a sentence.
 *
 * Every false positive this lint has produced was a piece of code being read as
 * copy, and each fix narrowed the extractor. A narrowing is a lint getting
 * quieter, and a lint that gets quieter without a test is one that has gone
 * blind without anybody noticing. So both halves are pinned here: the code that
 * must not be read as prose, and the prose that must still be found.
 *
 * The second half is the one that matters. It is easy to silence a false
 * positive by widening the skip until the rule catches nothing.
 */

const code = { prose: false };
const prose = { prose: true };

const texts = (source: { prose: boolean }, content: string): string[] =>
  segments(source, content).map((segment) => segment.text.trim());

describe('code that must not be read as copy', () => {
  it('skips an expression between the arms of a ternary', () => {
    // The `>` of </span> and the `<` of <span with an expression between them.
    const found = texts(code, '</span>\n) : !relations.value.available ? (\n<span>');
    expect(found.join(' ')).not.toContain('!relations');
  });

  it('skips a comparison, which would read as a strict inequality', () => {
    const found = texts(code, '</div>\n selected >= 0 && selected !== ci;\n<div>');
    expect(found.join(' ')).not.toContain('!==');
  });

  it('skips an arrow function between elements', () => {
    expect(texts(code, '</b>\n rows.map((r) => r.name)\n<b>').join(' ')).not.toContain('=>');
  });

  it('does not read a hex colour or a CSS length as a sentence', () => {
    const found = texts(code, "const s = { color: '#8052FF', padding: '9px 12px' };");
    expect(found).not.toContain('a sentence');
  });
});

describe('copy that must still be found', () => {
  it('reads a JSX text node, which is where the headlines live', () => {
    expect(texts(code, '<h1>Memory that knows what changed.</h1>'))
      .toContain('Memory that knows what changed.');
  });

  it('reads a string literal', () => {
    expect(texts(code, "const t = 'No evidence means no answer.';"))
      .toContain('No evidence means no answer.');
  });

  it('still finds an exclamation mark in real interface copy', () => {
    expect(texts(code, '<p>Welcome back!</p>').join(' ')).toContain('Welcome back!');
  });

  it('still finds filler in a JSX text node', () => {
    expect(texts(code, '<p>A seamless, revolutionary experience.</p>').join(' '))
      .toContain('seamless');
  });

  it('reads prose files line by line, skipping blank lines', () => {
    expect(texts(prose, 'First line.\n\nSecond line.')).toEqual(['First line.', 'Second line.']);
  });
});

describe('the line numbers it reports', () => {
  it('point at the line a person would open', () => {
    const found = segments(code, 'const a = 1;\nconst b = 2;\n<p>Give the model less.</p>');
    expect(found.find((segment) => segment.text.includes('Give the model less'))?.line).toBe(3);
  });
});
