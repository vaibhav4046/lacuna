/**
 * Column alignment, computed from the data rather than guessed.
 *
 * Widths are measured across the rows that are actually being printed, so a
 * table of six-character values does not carry forty characters of padding it
 * inherited from a constant. The last column is never padded, which keeps
 * trailing whitespace out of anything piped into a file or a diff.
 */

const GAP = '  ';

export function columns(rows: readonly (readonly string[])[], indent = ''): readonly string[] {
  const width: number[] = [];
  for (const row of rows) {
    row.forEach((cell, at) => {
      width[at] = Math.max(width[at] ?? 0, cell.length);
    });
  }

  return rows.map((row) => {
    const padded = row.map((cell, at) => (
      at === row.length - 1 ? cell : cell.padEnd(width[at] ?? 0)
    ));
    return `${indent}${padded.join(GAP)}`.trimEnd();
  });
}

/**
 * Shortens a long single-line value for a table cell. Used on query text, where
 * the point is to show which statement ran rather than to reproduce it.
 */
export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 3)}...`;
}
