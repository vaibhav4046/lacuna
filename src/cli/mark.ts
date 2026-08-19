/**
 * The Lacuna mark, drawn in terminal cells.
 *
 * The website draws one spiral: three half turns of decreasing radius that
 * never close, with an amber point at the head. `web/src/design/mark.tsx`
 * holds it as an SVG path. This file holds the same three arcs as numbers and
 * samples them onto a character grid, so the terminal shows the mark the site
 * shows rather than a second logo that happens to share a name.
 *
 * The arcs below are read off that path directly. The path is
 * `M12 2.6 A8.4 ... 12 19.4 A6 ... 12 7.4 A3.7 ... 12 14.8`, which is three
 * semicircles: right, left, right, each starting where the last one ended. The
 * SVG's own translate is not repeated here because a constant offset applied
 * to every point disappears when the points are normalised to their own
 * bounding box.
 *
 * The centre stays open. That is the whole mark, and a renderer that fills it
 * in has drawn something else.
 */

import { PLAIN, type Palette } from './color.js';

/** A half turn of the spiral: centre, radius, and the arc swept, in degrees. */
interface Arc {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Angles run clockwise on screen because SVG's y axis points down, which is
 * why each arc goes from a smaller number to a larger one.
 */
const ARCS: readonly Arc[] = [
  { cx: 12, cy: 11, r: 8.4, from: -90, to: 90 },
  { cx: 12, cy: 13.4, r: 6, from: 90, to: 270 },
  { cx: 12, cy: 11.1, r: 3.7, from: -90, to: 90 },
];

/** Dense enough that no sampled arc leaves a gap at the sizes below. */
const SAMPLES_PER_ARC = 400;

/** Terminal cells are about twice as tall as they are wide. */
const CELL_ASPECT = 2;

const BODY = '·';
const HEAD = '●';
const BLANK = ' ';

interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * How many of the three half turns to draw.
 *
 * Five rows cannot hold three of them. Sampled at that height the inner turn
 * lands on the middle one and the spiral fills in, which is the one thing the
 * mark is not allowed to do. So the small size draws one and a half turns and
 * keeps the centre open, the way a small favicon drops detail rather than
 * printing it at a size nobody can read.
 */
function samplePoints(turns: number): readonly Point[] {
  const points: Point[] = [];
  for (const arc of ARCS.slice(0, turns)) {
    for (let i = 0; i <= SAMPLES_PER_ARC; i += 1) {
      const degrees = arc.from + ((arc.to - arc.from) * i) / SAMPLES_PER_ARC;
      const radians = (degrees * Math.PI) / 180;
      points.push({
        x: arc.cx + arc.r * Math.cos(radians),
        y: arc.cy + arc.r * Math.sin(radians),
      });
    }
  }
  return points;
}

/** The head of the spiral, which is where the amber point sits. */
const HEAD_POINT: Point = { x: 12, y: 2.6 };

interface Grid {
  readonly cells: readonly (readonly string[])[];
  readonly head: { readonly row: number; readonly col: number };
}

/**
 * Rasterise the spiral into `rows` rows of characters.
 *
 * Width follows from the height so the mark stays round rather than stretched:
 * a terminal cell is roughly twice as tall as it is wide, so a square drawing
 * needs twice as many columns as rows.
 */
function rasterise(rows: number, turns: number): Grid {
  const points = samplePoints(turns);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const cols = Math.max(1, Math.round(((rows - 1) * CELL_ASPECT * spanX) / spanY) + 1);

  const cells: string[][] = [];
  for (let r = 0; r < rows; r += 1) cells.push(new Array<string>(cols).fill(BLANK));

  const place = (p: Point): { row: number; col: number } => ({
    row: Math.round(((p.y - minY) / spanY) * (rows - 1)),
    col: Math.round(((p.x - minX) / spanX) * (cols - 1)),
  });

  // Both indices are in range by construction: `place` normalises against the
  // same bounding box the grid was sized from.
  for (const point of points) {
    const { row, col } = place(point);
    cells[row]![col] = BODY;
  }

  const head = place(HEAD_POINT);
  cells[head.row]![head.col] = HEAD;

  return { cells, head };
}

function render(rows: number, turns: number, palette: Palette): readonly string[] {
  const { cells, head } = rasterise(rows, turns);
  return cells.map((row, rowIndex) =>
    row
      .map((cell, colIndex) => {
        if (cell === BLANK) return BLANK;
        if (rowIndex === head.row && colIndex === head.col) return palette.accent(cell);
        return palette.dim(cell);
      })
      .join('')
      .replace(/\s+$/, ''),
  );
}

const COMPACT_ROWS = 5;
const COMPACT_TURNS = 2;
const ENHANCED_ROWS = 9;
const ENHANCED_TURNS = 3;

/** Five rows. The header a person sees when they run an interactive command. */
export function compactMark(palette: Palette): readonly string[] {
  return render(COMPACT_ROWS, COMPACT_TURNS, palette);
}

/** Nine rows and all three turns, for a terminal with the height to spare. */
export function enhancedMark(palette: Palette): readonly string[] {
  return render(ENHANCED_ROWS, ENHANCED_TURNS, palette);
}

/** The widest line a mark can occupy, ignoring colour escapes. */
export function markWidth(rows: number, turns: number): number {
  return Math.max(
    ...rasterise(rows, turns).cells.map((row) => row.join('').replace(/\s+$/, '').length),
  );
}

/**
 * The header, or nothing at all.
 *
 * Nothing at all is the common case: piped output, a log file, a CI job, and
 * `--json` all get no mark, because a decoration that reaches a parser is a
 * bug. The width floor is there so a 40 column terminal still gets a mark that
 * fits beside the wordmark rather than one that wraps.
 */
export function markHeader(
  palette: Palette,
  options: { readonly isTTY: boolean; readonly json: boolean; readonly columns: number },
): readonly string[] {
  const width = markWidth(COMPACT_ROWS, COMPACT_TURNS);
  if (!options.isTTY || options.json) return [];
  if (options.columns < width + 'lacuna'.length + 3) return [];

  const rows = compactMark(palette);
  const middle = Math.floor(rows.length / 2);

  // Measured on the uncoloured rows on purpose. A coloured row carries escape
  // bytes that occupy no columns, so padding the coloured string puts the
  // wordmark in a different place depending on whether colour is on.
  const plain = compactMark(PLAIN);

  return rows.map((row, index) => {
    if (index !== middle) return row;
    const gap = BLANK.repeat(width + 3 - plain[index]!.length);
    return `${row}${gap}${palette.heading('lacuna')}`;
  });
}
