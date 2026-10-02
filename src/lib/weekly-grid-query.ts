import { dbError } from "./db-error";
import { adminOrThrow } from "./supabase-admin";
import type { RawWeekEntry } from "./weekly-grid";

const DAYS_PER_WEEK = 7;
const MS_PER_DAY = 86_400_000;

/**
 * Every `time_entries` row for `linkId` that overlaps the UTC week starting at `weekStartUtc`, including
 * the currently-open entry (`ended_at is null`) and any entry whose span crosses into the week from an
 * adjacent day, ordered by `started_at`. Mapped to the `RawWeekEntry` shape `buildWeeklyGrid` consumes.
 */
export async function fetchWeekEntries(linkId: string, weekStartUtc: Date): Promise<RawWeekEntry[]> {
  const admin = adminOrThrow();

  const weekStartIso = weekStartUtc.toISOString();
  const weekEndIso = new Date(weekStartUtc.getTime() + DAYS_PER_WEEK * MS_PER_DAY).toISOString();

  const response = await admin
    .from("time_entries")
    .select("project_name, task, type, work_type, started_at, ended_at")
    .eq("link_id", linkId)
    .lt("started_at", weekEndIso)
    .or(`ended_at.is.null,ended_at.gt.${weekStartIso}`)
    .order("started_at", { ascending: true });
  if (response.error) {
    throw dbError("week entries lookup", response.error);
  }

  const rows: unknown = response.data;
  if (!Array.isArray(rows)) {
    throw new Error("week entries lookup returned an unexpected value");
  }

  return rows.map((row: unknown) => {
    if (
      typeof row === "object" &&
      row !== null &&
      "project_name" in row &&
      typeof row.project_name === "string" &&
      "task" in row &&
      (typeof row.task === "string" || row.task === null) &&
      "type" in row &&
      typeof row.type === "string" &&
      "work_type" in row &&
      typeof row.work_type === "string" &&
      "started_at" in row &&
      typeof row.started_at === "string" &&
      "ended_at" in row &&
      (typeof row.ended_at === "string" || row.ended_at === null)
    ) {
      return {
        projectName: row.project_name,
        task: row.task,
        type: row.type,
        workType: row.work_type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    }
    throw new Error("week entries lookup returned an unexpected row");
  });
}
