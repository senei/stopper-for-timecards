export interface RawWeekEntry {
  projectName: string;
  task: string | null;
  type: string;
  workType: string;
  startedAt: string; // ISO timestamptz
  endedAt: string | null; // null = still running
}

export interface GridRow {
  projectName: string;
  task: string | null;
  type: string;
  workType: string;
  // index 0 = Monday .. index 6 = Sunday, minutes rounded up to 15
  dailyMinutes: [number, number, number, number, number, number, number];
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_WEEK = 7;
const ROUND_UP_TO_MINUTES = 15;

/** Raw (unrounded) per-day minute totals accumulated for one (Project, Task, Type, Work Type) row. */
type RawDailyMinutes = [number, number, number, number, number, number, number];

/** `rawMinutes` rounded up to the next `ROUND_UP_TO_MINUTES` increment; `0` stays `0`. */
function roundUpToQuarterHour(rawMinutes: number): number {
  return Math.ceil(rawMinutes / ROUND_UP_TO_MINUTES) * ROUND_UP_TO_MINUTES;
}

/** Stable grouping key for the (Project, Task, Type, Work Type) tuple; distinct historical values never collapse. */
function rowKey(entry: RawWeekEntry): string {
  return JSON.stringify([entry.projectName, entry.task, entry.type, entry.workType]);
}

/**
 * Groups `entries` by (Project, Task, Type, Work Type) and buckets each row's minutes into the 7 UTC days of the
 * week starting at `weekStartUtc` (a UTC Monday 00:00:00.000), rounding each (day, row) cell's *summed* raw minutes
 * up to the next 15-minute increment — never rounding an individual segment before summing. A segment that spans a
 * UTC day boundary is split at that boundary before rounding, so each day is credited its own raw portion. A still
 * running entry (`endedAt === null`) is credited up to `nowUtc`. Rows with zero minutes across all 7 days are
 * omitted; the rest are sorted alphabetically by `projectName`.
 */
export function buildWeeklyGrid(entries: RawWeekEntry[], weekStartUtc: Date, nowUtc: Date): GridRow[] {
  const weekStartMs = weekStartUtc.getTime();
  // [start, end) millisecond bounds for each of the 7 UTC days, Monday .. Sunday.
  const dayBoundsMs: [number, number][] = Array.from({ length: DAYS_PER_WEEK }, (_, day) => [
    weekStartMs + day * MS_PER_DAY,
    weekStartMs + (day + 1) * MS_PER_DAY,
  ]);

  const rowsByKey = new Map<string, { header: Omit<GridRow, "dailyMinutes">; raw: RawDailyMinutes }>();

  for (const entry of entries) {
    const startMs = new Date(entry.startedAt).getTime();
    const endMs = entry.endedAt === null ? nowUtc.getTime() : new Date(entry.endedAt).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) continue;

    const key = rowKey(entry);
    let bucket = rowsByKey.get(key);
    if (!bucket) {
      bucket = {
        header: { projectName: entry.projectName, task: entry.task, type: entry.type, workType: entry.workType },
        raw: [0, 0, 0, 0, 0, 0, 0],
      };
      rowsByKey.set(key, bucket);
    }

    for (let day = 0; day < DAYS_PER_WEEK; day++) {
      const [dayStartMs, dayEndMs] = dayBoundsMs[day];
      const overlapStartMs = Math.max(startMs, dayStartMs);
      const overlapEndMs = Math.min(endMs, dayEndMs);
      if (overlapEndMs > overlapStartMs) {
        bucket.raw[day] += (overlapEndMs - overlapStartMs) / MS_PER_MINUTE;
      }
    }
  }

  const rows: GridRow[] = [];
  for (const { header, raw } of rowsByKey.values()) {
    const dailyMinutes: GridRow["dailyMinutes"] = [
      roundUpToQuarterHour(raw[0]),
      roundUpToQuarterHour(raw[1]),
      roundUpToQuarterHour(raw[2]),
      roundUpToQuarterHour(raw[3]),
      roundUpToQuarterHour(raw[4]),
      roundUpToQuarterHour(raw[5]),
      roundUpToQuarterHour(raw[6]),
    ];
    if (dailyMinutes.every((minutes) => minutes === 0)) continue;
    rows.push({ ...header, dailyMinutes });
  }

  rows.sort((a, b) => a.projectName.localeCompare(b.projectName));
  return rows;
}
