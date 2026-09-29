const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
/** FR-008's retention window: entries are purged once `started_at` is this many calendar months old
 * (see `supabase/migrations/20260925120000_purge_time_entries.sql`'s `interval '3 months'` cutoff). */
const RETENTION_MONTHS = 3;

/** UTC Monday 00:00:00.000 of the week containing `date`. */
export function utcMondayOf(date: Date): Date {
  const dayNumber = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / MS_PER_DAY);
  // getUTCDay(): 0 = Sunday .. 6 = Saturday; days elapsed since the most recent Monday.
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  return new Date((dayNumber - daysSinceMonday) * MS_PER_DAY);
}

/**
 * `nowUtc` minus 3 calendar months, mirroring the purge job's `now() - interval '3 months'` cutoff
 * (`purge_time_entries()`): calendar-month subtraction, not a fixed day count, so this never disagrees
 * with what the scheduled purge actually deletes. `Date.UTC` normalizes a negative month index by
 * rolling back into the prior year(s), the same calendar-month arithmetic Postgres's `interval` does.
 */
function retentionCutoff(nowUtc: Date): Date {
  return new Date(
    Date.UTC(
      nowUtc.getUTCFullYear(),
      nowUtc.getUTCMonth() - RETENTION_MONTHS,
      nowUtc.getUTCDate(),
      nowUtc.getUTCHours(),
      nowUtc.getUTCMinutes(),
      nowUtc.getUTCSeconds(),
      nowUtc.getUTCMilliseconds(),
    ),
  );
}

/**
 * The UTC Monday 00:00 of the oldest week that is entirely within FR-008's 3-month retention window, so
 * navigation can stop there and no partially-purged week is ever reachable (superseding the interview's
 * original incomplete-data-banner idea by construction).
 *
 * A week straddles the cutoff whenever its Monday falls before the cutoff but part of the week is still
 * at/after it — such a week has some days already eligible for purge, so it is excluded, not included.
 * Concretely: find the UTC Monday of the week containing the cutoff. If the cutoff lands exactly on that
 * Monday at 00:00:00.000, the whole week is at/after the cutoff and is the earliest navigable week.
 * Otherwise the containing week straddles the cutoff, so the earliest navigable week is the next one.
 */
export function earliestNavigableWeekStart(nowUtc: Date): Date {
  const cutoff = retentionCutoff(nowUtc);
  const cutoffWeekStart = utcMondayOf(cutoff);

  if (cutoff.getTime() === cutoffWeekStart.getTime()) {
    return cutoffWeekStart;
  }
  return new Date(cutoffWeekStart.getTime() + DAYS_PER_WEEK * MS_PER_DAY);
}
