const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Parses an HTML `datetime-local` input's value (`YYYY-MM-DDTHH:mm` or `YYYY-MM-DDTHH:mm:ss`) as a UTC instant.
 * Returns `null` for anything else, including a value with an offset or a `Z`, and an impossible calendar date
 * (checked by round-tripping through `Date.UTC`, which otherwise silently rolls e.g. `2026-02-30` into March).
 */
export function parseUtcDateTimeLocal(value: unknown): Date | null {
  if (typeof value !== "string") return null;

  const match = DATETIME_LOCAL_PATTERN.exec(value);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match;
  // The optional seconds group is genuinely `undefined` when absent at runtime, even though
  // `RegExpExecArray`'s type (like every other element here) says `string`.
  const secondStr = match[6] as string | undefined;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = secondStr === undefined ? 0 : Number(secondStr);

  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const isSameInstant =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;

  return isSameInstant ? date : null;
}

/** The `YYYY-MM-DDTHH:mm` form of a UTC instant, for a `datetime-local` input's value. */
export function formatUtcDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}
