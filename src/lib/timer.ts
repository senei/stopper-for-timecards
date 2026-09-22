import { createAdminClient } from "./supabase-admin";

export interface StartTimerResult {
  entryId: string;
  projectId: string;
  projectName: string;
  startedAt: string;
}
export type CurrentTimer = { projectName: string; startedAt: string } | null;

/** Thrown when `start_timer` hits the one-running-timer-per-link unique violation (`23505`). */
export class TimerAlreadyRunningError extends Error {
  constructor() {
    super("A timer is already running for this link");
    this.name = "TimerAlreadyRunningError";
  }
}

function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Supabase is not configured");
  }
  return admin;
}

/**
 * Starts a timer through the atomic `start_timer` function: finds-or-creates the project by
 * name, then opens a new time entry. `TimerAlreadyRunningError` means the link already has one
 * running — see the partial unique index in `20260922150000_projects_and_timer.sql`.
 */
export async function startTimer(linkId: string, projectName: string): Promise<StartTimerResult> {
  const admin = adminOrThrow();

  const response = await admin.rpc("start_timer", { p_link_id: linkId, p_project_name: projectName });
  if (response.error) {
    if (response.error.code === "23505") {
      throw new TimerAlreadyRunningError();
    }
    throw new Error(`start_timer failed: ${response.error.message}`);
  }

  const rows: unknown = response.data;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error("start_timer returned an unexpected value");
  }

  const row: unknown = rows[0];
  if (
    typeof row === "object" &&
    row !== null &&
    "entry_id" in row &&
    typeof row.entry_id === "string" &&
    "project_id" in row &&
    typeof row.project_id === "string" &&
    "project_name" in row &&
    typeof row.project_name === "string" &&
    "started_at" in row &&
    typeof row.started_at === "string"
  ) {
    return {
      entryId: row.entry_id,
      projectId: row.project_id,
      projectName: row.project_name,
      startedAt: row.started_at,
    };
  }
  throw new Error("start_timer returned an unexpected row");
}

/** The link's currently open (`ended_at is null`) time entry, if any. */
export async function getCurrentTimer(linkId: string): Promise<CurrentTimer> {
  const admin = adminOrThrow();

  const response = await admin
    .from("time_entries")
    .select("project_name, started_at")
    .eq("link_id", linkId)
    .is("ended_at", null)
    .maybeSingle();
  if (response.error) {
    throw new Error(`current timer lookup failed: ${response.error.message}`);
  }

  const row: unknown = response.data;
  if (row === null) {
    return null;
  }
  if (
    typeof row === "object" &&
    "project_name" in row &&
    typeof row.project_name === "string" &&
    "started_at" in row &&
    typeof row.started_at === "string"
  ) {
    return { projectName: row.project_name, startedAt: row.started_at };
  }
  throw new Error("current timer lookup returned an unexpected row");
}
