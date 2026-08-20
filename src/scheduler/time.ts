const MINUTE_MS = 60_000;
const MAX_SEARCH_MINUTES = 49 * 60;

function localParts(ms: number, timezone: string): { readonly hour: number; readonly minute: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(ms));
  } catch {
    throw new Error('invalid timezone');
  }
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('timezone could not be formatted');
  return { hour, minute };
}

function parseTime(localTime: string): { readonly hour: number; readonly minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(localTime);
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (match === null || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('daily time must be HH:mm');
  }
  return { hour, minute };
}

/**
 * Finds the next real occurrence of a local wall-clock minute. The bounded
 * scan handles DST without pretending every local time exists. A skipped time
 * becomes eligible the following day; a repeated time uses the first future
 * occurrence.
 */
export function nextDailyOccurrence(afterMs: number, localTime: string, timezone: string): string {
  if (!Number.isFinite(afterMs)) throw new Error('invalid current time');
  const target = parseTime(localTime);
  let candidate = Math.floor(afterMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  for (let checked = 0; checked < MAX_SEARCH_MINUTES; checked += 1) {
    const local = localParts(candidate, timezone);
    if (local.hour === target.hour && local.minute === target.minute) return new Date(candidate).toISOString();
    candidate += MINUTE_MS;
  }
  throw new Error('no daily occurrence found in the bounded search window');
}
