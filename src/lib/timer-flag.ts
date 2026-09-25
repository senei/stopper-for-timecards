/** A running timer at least this many hours old is flagged as possibly forgotten (FR-004). */
export const LONG_RUNNING_TIMER_HOURS = 12;

const MS_PER_HOUR = 3_600_000;

/** Milliseconds from `startedAt` to `now`; `null` when `startedAt` is unparseable or in the future. */
function elapsedMs(startedAt: string, now: Date): number | null {
  const elapsed = now.getTime() - new Date(startedAt).getTime();
  return Number.isNaN(elapsed) || elapsed < 0 ? null : elapsed;
}

/**
 * Whether a timer started at `startedAt` has been running for at least `LONG_RUNNING_TIMER_HOURS` at `now`.
 * Elapsed duration only, so no time zone is involved. An unparseable or future `startedAt` is never flagged.
 */
export function isTimerFlagged(startedAt: string, now: Date): boolean {
  const elapsed = elapsedMs(startedAt, now);
  return elapsed !== null && elapsed >= LONG_RUNNING_TIMER_HOURS * MS_PER_HOUR;
}

/** Whole hours elapsed from `startedAt` to `now`, rounded down; `0` for an unparseable or future `startedAt`. */
export function elapsedWholeHours(startedAt: string, now: Date): number {
  const elapsed = elapsedMs(startedAt, now);
  return elapsed === null ? 0 : Math.floor(elapsed / MS_PER_HOUR);
}
