import { ARCS, HEAD_POINT, type Point } from './mark.js';

/**
 * The mark as pixel art, at twice the vertical resolution a character grid has.
 *
 * `mark.ts` samples the same three arcs onto one glyph per cell, which is right
 * for a one line header and wrong for a splash: at that density the spiral
 * reads as a scatter of dots rather than a curve. The trick here is the half
 * block. A cell painted with U+2580 has a foreground colour on its top half and
 * a background colour on its bottom, so one row of text carries two rows of
 * pixels, and the drawing stops looking sampled and starts looking drawn.
 *
 * Everything else follows from that. Cells are about twice as tall as wide, so
 * two pixel rows per cell makes a pixel almost exactly square, which is why the
 * spiral comes out round here without the aspect correction the character
 * version needs.
 *
 * Colour is 24 bit and degrades honestly: a terminal that reports no colour
 * support gets the shape in plain glyphs rather than a screenful of escape
 * codes, because a logo that renders as `[38;2;128;82;255m` is worse than no
 * logo at all.
 */

/** Foreground on the top half, background on the bottom. */
const HALF = '▀';
const BLANK = ' ';

/** The violet the product uses, and the amber at the head of the spiral. */
const VIOLET: RGB = [128, 82, 255];
const AMBER: RGB = [255, 184, 41];
/** Where the tail fades to. Not black: it has to stay visible on a dark ground. */
const TAIL: RGB = [58, 38, 120];

type RGB = readonly [number, number, number];

export interface PixelOptions {
  /** Pixel rows. Half this many text rows are printed. */
  readonly height: number;
  /** How many of the three half turns to draw. */
  readonly turns: number;
  /** False prints the shape without escape codes. */
  readonly colour: boolean;
}

/**
 * Points along the spiral, carrying how far along it each one is.
 *
 * The position matters because the mark is not one colour. It runs from a deep
 * violet at the tail to the amber head, which is what makes it read as a stroke
 * with a direction rather than a ring.
 */
function trail(turns: number): readonly { readonly at: Point; readonly t: number }[] {
  const out: { at: Point; t: number }[] = [];
  const arcs = ARCS.slice(0, turns);
  // Dense enough that no arc leaves a gap even at the largest size below.
  const per = 900;
  let index = 0;
  const total = arcs.length * per;

  for (const arc of arcs) {
    for (let i = 0; i <= per; i += 1) {
      const degrees = arc.from + ((arc.to - arc.from) * i) / per;
      const radians = (degrees * Math.PI) / 180;
      out.push({
        at: { x: arc.cx + arc.r * Math.cos(radians), y: arc.cy + arc.r * Math.sin(radians) },
        t: index / total,
      });
      index += 1;
    }
  }
  return out;
}

function mix(from: RGB, to: RGB, amount: number): RGB {
  const at = Math.max(0, Math.min(1, amount));
  return [
    Math.round(from[0] + (to[0] - from[0]) * at),
    Math.round(from[1] + (to[1] - from[1]) * at),
    Math.round(from[2] + (to[2] - from[2]) * at),
  ];
}

/**
 * The picture, as a grid of pixels that are either a colour or nothing.
 *
 * Width is derived from height rather than given, so the mark cannot be
 * stretched by asking for a size that does not match its proportions.
 */
function paint(options: PixelOptions): readonly (readonly (RGB | null)[])[] {
  const points = trail(options.turns);
  const xs = points.map((p) => p.at.x);
  const ys = points.map((p) => p.at.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const height = Math.max(2, options.height % 2 === 0 ? options.height : options.height + 1);
  const width = Math.max(1, Math.round((height * spanX) / spanY));

  const grid: (RGB | null)[][] = [];
  for (let row = 0; row < height; row += 1) grid.push(new Array<RGB | null>(width).fill(null));

  const place = (p: Point): { row: number; col: number } => ({
    row: Math.min(height - 1, Math.round(((p.y - minY) / spanY) * (height - 1))),
    col: Math.min(width - 1, Math.round(((p.x - minX) / spanX) * (width - 1))),
  });

  for (const point of points) {
    const { row, col } = place(point.at);
    grid[row]![col] = mix(TAIL, VIOLET, point.t * 1.35);
  }

  // The head last, and fattened by one pixel each way, because a single lit
  // pixel at this size reads as a stray rather than as the point of the mark.
  const head = place(HEAD_POINT);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const row = head.row + dr;
      const col = head.col + dc;
      if (row < 0 || row >= height || col < 0 || col >= width) continue;
      if (Math.abs(dr) + Math.abs(dc) > 1) continue;
      grid[row]![col] = AMBER;
    }
  }

  return grid;
}

/**
 * Two pixel rows folded into one row of text.
 *
 * A cell with both halves lit needs both a foreground and a background colour;
 * a cell with only the top lit must reset the background, or it inherits the
 * previous cell's and the spiral grows a shadow to its right. That reset is the
 * whole reason this is not a one liner.
 */
export function pixelMark(options: PixelOptions): readonly string[] {
  const grid = paint(options);
  const lines: string[] = [];

  for (let row = 0; row < grid.length; row += 2) {
    const top = grid[row] ?? [];
    const bottom = grid[row + 1] ?? [];
    let line = '';

    for (let col = 0; col < top.length; col += 1) {
      const up = top[col] ?? null;
      const down = bottom[col] ?? null;

      if (!options.colour) {
        line += up !== null || down !== null ? HALF : BLANK;
        continue;
      }
      if (up === null && down === null) { line += BLANK; continue; }

      const fg = up === null ? '' : `[38;2;${up[0]};${up[1]};${up[2]}m`;
      const bg = down === null ? '[49m' : `[48;2;${down[0]};${down[1]};${down[2]}m`;
      line += `${bg}${fg}${up === null ? BLANK : HALF}[0m`;
    }
    lines.push(line.replace(/\s+$/, ''));
  }

  return lines;
}

/** The widest line, in columns, ignoring escape bytes. */
export function pixelWidth(options: PixelOptions): number {
  return Math.max(...pixelMark({ ...options, colour: false }).map((line) => line.length));
}
