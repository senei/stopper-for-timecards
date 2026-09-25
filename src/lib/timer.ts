import { adminOrThrow } from "./supabase-admin";

export interface StartTimerResult {
  entryId: string;
  projectId: string;
  projectName: string;
  startedAt: string;
}
export type CurrentTimer = { projectId: string; projectName: string; startedAt: string } | null;

/** Thrown when `start_timer` hits the one-running-timer-per-link unique violation (`23505`). */
export class TimerAlreadyRunningError extends Error {
  constructor() {
    super("A timer is already running for this link");
    this.name = "TimerAlreadyRunningError";
  }
}

/** Thrown when `switch_timer` or `stop_timer` finds no open entry to close (`P0001`). */
export class NoActiveTimerError extends Error {
  constructor() {
    super("No timer is running for this link");
    this.name = "NoActiveTimerError";
  }
}

/** Validates the single row `start_timer` / `switch_timer` / `stop_timer` return and maps it to camelCase. */
function parseTimerRow(fnName: string, data: unknown): StartTimerResult {
  const rows: unknown = data;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error(`${fnName} returned an unexpected value`);
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
  throw new Error(`${fnName} returned an unexpected row`);
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

  return parseTimerRow("start_timer", response.data);
}

/**
 * Switches the running timer to a different project through the atomic `switch_timer`
 * function: closes the link's open entry, then finds-or-creates the target project and opens a
 * new entry for it, following the same shape as `startTimer`. `NoActiveTimerError` means the
 * link had no open entry to switch away from (`P0001`) — a race backstop, same philosophy as
 * `TimerAlreadyRunningError`.
 */
export async function switchTimer(linkId: string, projectName: string): Promise<StartTimerResult> {
  const admin = adminOrThrow();

  const response = await admin.rpc("switch_timer", { p_link_id: linkId, p_project_name: projectName });
  if (response.error) {
    if (response.error.code === "P0001") {
      throw new NoActiveTimerError();
    }
    throw new Error(`switch_timer failed: ${response.error.message}`);
  }

  return parseTimerRow("switch_timer", response.data);
}

/**
 * Stops the running timer through the atomic `stop_timer` function: closes the link's open entry
 * at the current moment and returns it. `NoActiveTimerError` means the link had no open entry to
 * stop (`P0001`) — a race backstop, same philosophy as in `switchTimer`.
 */
export async function stopTimer(linkId: string): Promise<StartTimerResult> {
  const admin = adminOrThrow();

  const response = await admin.rpc("stop_timer", { p_link_id: linkId });
  if (response.error) {
    if (response.error.code === "P0001") {
      throw new NoActiveTimerError();
    }
    throw new Error(`stop_timer failed: ${response.error.message}`);
  }

  return parseTimerRow("stop_timer", response.data);
}

/** The link's currently open (`ended_at is null`) time entry, if any. */
export async function getCurrentTimer(linkId: string): Promise<CurrentTimer> {
  const admin = adminOrThrow();

  const response = await admin
    .from("time_entries")
    .select("project_id, project_name, started_at")
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
    "project_id" in row &&
    typeof row.project_id === "string" &&
    "project_name" in row &&
    typeof row.project_name === "string" &&
    "started_at" in row &&
    typeof row.started_at === "string"
  ) {
    return { projectId: row.project_id, projectName: row.project_name, startedAt: row.started_at };
  }
  throw new Error("current timer lookup returned an unexpected row");
}
