import { describe, expect, it } from 'vitest';

import { pixelMark, pixelWidth } from '../../src/cli/pixel.js';

/**
 * The mark, at twice the vertical resolution a character grid has.
 *
 * What is worth asserting is not that it looks right, which a test cannot see.
 * It is the two properties that make it the Lacuna mark rather than a ring: the
 * centre stays open, and the drawing stays round instead of being stretched by
 * whatever size it was asked for. Both have a failure mode that is easy to
 * introduce and invisible until somebody runs it.
 */

const PLAIN = { height: 26, turns: 3, colour: false } as const;

function rows(): readonly string[] {
  return pixelMark(PLAIN);
}

describe('the pixel mark', () => {
  it('folds two pixel rows into every text row', () => {
    expect(rows()).toHaveLength(PLAIN.height / 2);
  });

  it('keeps the centre open, which is the whole mark', () => {
    const drawn = rows();
    const middle = drawn[Math.floor(drawn.length / 2)] ?? '';
    const lit = [...middle].map((char, at) => (char === ' ' ? -1 : at)).filter((at) => at >= 0);

    // There is ink on both sides of the middle row and a gap between, because
    // the spiral passes left and right of a centre it never fills. A renderer
    // that closed it would produce one continuous run here.
    expect(lit.length).toBeGreaterThan(1);
    const first = lit[0] ?? 0;
    const last = lit[lit.length - 1] ?? 0;
    expect(last - first + 1).toBeGreaterThan(lit.length);
  });

  it('stays round rather than stretching to the size it was asked for', () => {
    // Two pixel rows to a cell makes a pixel roughly square, so width and
    // height should track each other. A version that forgot the fold would come
    // out about half as wide as it should be.
    const ratio = pixelWidth(PLAIN) / (PLAIN.height / 2);
    expect(ratio).toBeGreaterThan(1.4);
    expect(ratio).toBeLessThan(2.6);
  });

  it('scales without changing its proportions', () => {
    const small = pixelWidth({ height: 12, turns: 3, colour: false }) / 6;
    const large = pixelWidth({ height: 40, turns: 3, colour: false }) / 20;
    expect(Math.abs(small - large)).toBeLessThan(0.4);
  });

  it('rounds an odd height up rather than dropping half a row', () => {
    expect(pixelMark({ height: 13, turns: 3, colour: false })).toHaveLength(7);
  });

  it('emits no escape bytes when colour is off', () => {
    // A logo that renders as escape codes in a log file is worse than no logo.
    expect(rows().join('')).not.toMatch(//);
  });

  it('emits colour and always closes it', () => {
    const coloured = pixelMark({ ...PLAIN, colour: true }).join('\n');
    expect(coloured).toMatch(/\[38;2;/);
    // Every opened sequence is reset. Without this a lit cell bleeds its
    // background across the rest of the line and the spiral grows a shadow.
    const opens = coloured.match(/\[(?:38|48);2;/g)?.length ?? 0;
    const resets = coloured.match(/\[0m/g)?.length ?? 0;
    expect(resets).toBeGreaterThanOrEqual(opens / 2);
  });
});
