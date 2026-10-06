import { dbError, type DbErrorLike } from "./db-error";
import { adminOrThrow } from "./supabase-admin";

const MS_PER_DAY = 86_400_000;

export interface CorrectableEntry {
  id: string;
  projectName: string;
  task: string | null;
  type: string;
  workType: string;
  startedAt: string;
  endedAt: string | null;
}

export interface CorrectedEntry {
  entryId: string;
  startedAt: string;
  endedAt: string;
}

/** The six stable `P0001` codes `correct_time_entry` and `delete_time_entry` raise, in their validation order. */
export type CorrectionRefusal =
  "entry_not_found" | "entry_running" | "outside_window" | "bad_range" | "in_future" | "overlap";

const CORRECTION_REFUSALS: readonly string[] = [
  "entry_not_found",
  "entry_running",
  "outside_window",
  "bad_range",
  "in_future",
  "overlap",
];

/** Thrown when `correct_time_entry` or `delete_time_entry` refuses the call with one of the six stable codes. */
export class CorrectionRefusedError extends Error {
  readonly reason: CorrectionRefusal;

  constructor(reason: CorrectionRefusal) {
    super(reason);
    this.name = "CorrectionRefusedError";
    this.reason = reason;
  }
}

/** Maps a failed `correct_time_entry`/`delete_time_entry` call to `CorrectionRefusedError`, or `dbError` otherwise. */
function throwMapped(op: "correct_time_entry" | "delete_time_entry", error: DbErrorLike): never {
  if (error.code === "P0001" && CORRECTION_REFUSALS.includes(error.message)) {
    throw new CorrectionRefusedError(error.message as CorrectionRefusal);
  }
  throw dbError(op, error);
}

/** Yesterday 00:00 UTC, computed the same way as the two database functions, so the app and the database agree. */
export function correctionWindowStart(now: Date): Date {
  const todayStartUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(todayStartUtc - MS_PER_DAY);
}

/** Every closed entry of `linkId` whose current start is inside the correction window, newest first. */
export async function listCorrectableEntries(linkId: string, now: Date = new Date()): Promise<CorrectableEntry[]> {
  const admin = adminOrThrow();
  const windowStart = correctionWindowStart(now).toISOString();

  const response = await admin
    .from("time_entries")
    .select("id, project_name, task, type, work_type, started_at, ended_at")
    .eq("link_id", linkId)
    .gte("started_at", windowStart)
    .order("started_at", { ascending: false });
  if (response.error) {
    throw dbError("time entry list", response.error);
  }

  const rows: unknown = response.data;
  if (!Array.isArray(rows)) {
    throw new Error("time entry list returned an unexpected value");
  }

  return rows.map((row: unknown) => {
    if (
      typeof row === "object" &&
      row !== null &&
      "id" in row &&
      typeof row.id === "string" &&
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
        id: row.id,
        projectName: row.project_name,
        task: row.task,
        type: row.type,
        workType: row.work_type,
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
    }
    throw new Error("time entry list returned an unexpected row");
  });
}

/** Validates the single row `correct_time_entry` returns and maps it to camelCase. */
function parseCorrectedRow(data: unknown): CorrectedEntry {
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("correct_time_entry returned an unexpected value");
  }

  const row: unknown = rows[0];
  if (
    typeof row === "object" &&
    row !== null &&
    "entry_id" in row &&
    typeof row.entry_id === "string" &&
    "started_at" in row &&
    typeof row.started_at === "string" &&
    "ended_at" in row &&
    typeof row.ended_at === "string"
  ) {
    return { entryId: row.entry_id, startedAt: row.started_at, endedAt: row.ended_at };
  }
  throw new Error("correct_time_entry returned an unexpected row");
}

/** Edits a closed entry's span through `correct_time_entry`. Throws `CorrectionRefusedError` for any of the six refusals. */
export async function correctEntry(
  linkId: string,
  entryId: string,
  startedAt: Date,
  endedAt: Date,
): Promise<CorrectedEntry> {
  const admin = adminOrThrow();

  const response = await admin.rpc("correct_time_entry", {
    p_link_id: linkId,
    p_entry_id: entryId,
    p_started_at: startedAt.toISOString(),
    p_ended_at: endedAt.toISOString(),
  });
  if (response.error) {
    throwMapped("correct_time_entry", response.error);
  }

  return parseCorrectedRow(response.data);
}

/** Removes a closed entry through `delete_time_entry`. Throws `CorrectionRefusedError` for any of the six refusals. */
export async function deleteEntry(linkId: string, entryId: string): Promise<string> {
  const admin = adminOrThrow();

  const response = await admin.rpc("delete_time_entry", { p_link_id: linkId, p_entry_id: entryId });
  if (response.error) {
    throwMapped("delete_time_entry", response.error);
  }

  const deletedId: unknown = response.data;
  if (typeof deletedId !== "string") {
    throw new Error("delete_time_entry returned an unexpected value");
  }
  return deletedId;
}
