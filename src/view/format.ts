/**
 * Turning stored values into the forms a page says them in.
 *
 * Nothing here is locale aware on purpose. A date on this page is the date the
 * graph stored, printed as it was stored, because the reader is going to
 * compare it against a quotation two lines below and against a claim table two
 * panels down. A date that reformats itself per viewer would break that
 * comparison for no gain, and an evidence page owes the reader the stored value
 * rather than a convenient one.
 */

/** The day part of an ISO timestamp, or the value unchanged if it is not one. */
export function shortDate(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : iso;
}

/** Minute resolution, which is as fine as a session transcript is worth reading. */
export function shortStamp(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)
    ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}`
    : iso;
}

/** `launch_date` reads as "launch date" in a sentence and as itself in a table. */
export function words(identifier: string): string {
  return identifier.replace(/_/g, ' ');
}

/**
 * Milliseconds, at the resolution the number was measured to.
 *
 * A tenth of a millisecond, which is what `round` in src/retrieval/fetch.ts
 * stores every measurement at. Rounding again here is not belt and braces: a
 * sum of tenths is not a tenth in binary, so a panel that adds eight reads
 * together gets 448.4000000000003 out of eight clean numbers. Printing that
 * claims a resolution the clock was never read at, on a page whose whole
 * argument is that its figures are measurements rather than assertions.
 *
 * Values that need no decimal keep none, so a read that took 66 ms says so.
 */
export function roundMs(value: number): number {
  return Math.round(value * 10) / 10;
}

export function ms(value: number): string {
  return `${roundMs(value)} ms`;
}

/** A lower case clause from the model layer, said as a sentence on its own. */
export function sentence(clause: string): string {
  return clause === '' ? '' : `${clause.charAt(0).toUpperCase()}${clause.slice(1)}.`;
}

/**
 * Thousands separated, the same way on every machine.
 *
 * Written out rather than delegated to `toLocaleString`, for the reason at the
 * top of this file: a count on this page is a figure a reader is going to
 * compare against a number in the repository, and it should not depend on where
 * the browser thinks it is.
 */
export function grouped(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "1 claim" and "2 claims", without a stray "(s)" in the middle of prose. */
export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : plural}`;
}
