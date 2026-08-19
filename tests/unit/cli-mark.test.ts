import { describe, expect, it } from 'vitest';

import { ANSI, PLAIN } from '../../src/cli/color.js';
import { compactMark, enhancedMark, markHeader, markWidth } from '../../src/cli/mark.js';

/**
 * The mark, pinned at the widths a terminal actually gets.
 *
 * These are snapshots written out in full rather than a check that the output
 * is non-empty, because the failure this guards against is the drawing quietly
 * changing shape: a sampling tweak that closes the centre, an aspect ratio that
 * squashes it, an off by one that clips the head. All of those still return
 * five strings. Only the strings themselves show it.
 *
 * The centre of the spiral stays open. If a change fills it in, the fixture
 * below is the thing that says so.
 */

const COMPACT = ['   ●···', ' ···  ··', '··     ·', '··    ··', ' ······'];

/** The widths a real terminal is likely to be, plus one too narrow to use. */
const WIDTHS = [40, 60, 80, 120, 160] as const;

/** Strip the escape sequences so a coloured row can be measured in columns. */
const ESCAPE = String.fromCharCode(27);
const visible = (text: string): string =>
  text.split(`${ESCAPE}[`).map((part, index) => (index === 0 ? part : part.slice(part.indexOf('m') + 1))).join('');

describe('the compact mark', () => {
  it('draws one and a half open turns with the head on top', () => {
    expect(compactMark(PLAIN)).toEqual(COMPACT);
  });

  it('leaves the centre of the spiral open', () => {
    const middle = compactMark(PLAIN)[2]!;
    expect(middle).toBe('··     ·');
    expect(middle.slice(2, 7)).toBe('     ');
  });

  it('puts the amber point at the head and nowhere else', () => {
    const heads = compactMark(PLAIN).join('').split('').filter((c) => c === '●');
    expect(heads).toHaveLength(1);
    expect(compactMark(PLAIN)[0]).toContain('●');
  });

  it('is five rows and eight columns', () => {
    expect(compactMark(PLAIN)).toHaveLength(5);
    expect(markWidth(5, 2)).toBe(8);
  });
});

describe('the enhanced mark', () => {
  it('draws all three turns', () => {
    expect(enhancedMark(PLAIN)).toEqual([
      '      ●····',
      '          ···',
      '    ·····   ··',
      ' ····   ··   ··',
      '··       ·    ·',
      '·       ··   ··',
      '··    ···   ··',
      ' ···      ···',
      '   ········',
    ]);
  });

  it('is nine rows and fits a narrow terminal', () => {
    expect(enhancedMark(PLAIN)).toHaveLength(9);
    expect(markWidth(9, 3)).toBeLessThanOrEqual(40);
  });
});

describe('the header', () => {
  it.each(WIDTHS)('renders at %i columns without wrapping', (columns) => {
    const rows = markHeader(PLAIN, { isTTY: true, json: false, columns });
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(columns);
    expect(rows[2]).toBe('··     ·   lacuna');
  });

  it('is suppressed when the terminal is too narrow to hold it', () => {
    expect(markHeader(PLAIN, { isTTY: true, json: false, columns: 16 })).toEqual([]);
  });

  it('is suppressed when stdout is not a terminal', () => {
    expect(markHeader(PLAIN, { isTTY: false, json: false, columns: 120 })).toEqual([]);
  });

  it('is suppressed under --json, so no decoration reaches a parser', () => {
    expect(markHeader(PLAIN, { isTTY: true, json: true, columns: 120 })).toEqual([]);
  });

  it('places the wordmark in the same column with colour on and off', () => {
    const plain = markHeader(PLAIN, { isTTY: true, json: false, columns: 80 });
    const coloured = markHeader(ANSI, { isTTY: true, json: false, columns: 80 });
    expect(coloured.map(visible)).toEqual(plain);
  });

  it('colours the head amber and never a verdict', () => {
    const coloured = markHeader(ANSI, { isTTY: true, json: false, columns: 80 }).join('\n');
    expect(coloured).toContain(`${ESCAPE}[38;5;214m●`);
    expect(coloured).not.toContain(`${ESCAPE}[32m`);
    expect(coloured).not.toContain(`${ESCAPE}[31m`);
  });
});
