export const ERROR_INVALID_NAME = "invalid-name";
export const ERROR_PROJECT_IN_USE = "project-in-use";
export const ERROR_CONFIRM_PHRASE = "confirm-phrase";
export const ERROR_GENERIC = "1";
export const ERROR_ENTRY_TIME_INVALID = "entry-time-invalid";
export const ERROR_ENTRY_RANGE = "entry-range";
export const ERROR_ENTRY_OVERLAP = "entry-overlap";
export const ERROR_ENTRY_OUTSIDE_WINDOW = "entry-outside-window";
export const ERROR_ENTRY_IN_FUTURE = "entry-in-future";
export const ERROR_ENTRY_RUNNING = "entry-running";
export const STATUS_PROJECT_DELETED = "project-deleted";
export const STATUS_LINK_REGENERATED = "link-regenerated";
export const STATUS_TIMER_STOPPED = "timer-stopped";
export const STATUS_ACCOUNT_DELETED = "account-deleted";
export const STATUS_ENTRY_CORRECTED = "entry-corrected";
export const STATUS_ENTRY_DELETED = "entry-deleted";

export function errorMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    [ERROR_INVALID_NAME]: "That project name isn't valid.",
    [ERROR_PROJECT_IN_USE]: "That project has logged time and can't be deleted.",
    [ERROR_CONFIRM_PHRASE]: "Type DELETE exactly to confirm.",
    [ERROR_ENTRY_TIME_INVALID]: "Enter both times as a UTC date and time.",
    [ERROR_ENTRY_RANGE]: "The end must be after the start.",
    [ERROR_ENTRY_OVERLAP]: "That time overlaps another entry or the running timer. Shorten the other one first.",
    [ERROR_ENTRY_OUTSIDE_WINDOW]: "Only entries from today and yesterday (UTC) can be corrected.",
    [ERROR_ENTRY_IN_FUTURE]: "The end can't be in the future.",
    [ERROR_ENTRY_RUNNING]: "Stop the running timer first; then you can correct it.",
  };
  return messages[code] ?? "Something went wrong. Please try again.";
}

export function statusMessage(code: string | null): string | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    [STATUS_PROJECT_DELETED]: "Project deleted.",
    [STATUS_LINK_REGENERATED]: "Your link was regenerated — save the new one now.",
    [STATUS_TIMER_STOPPED]: "Timer stopped.",
    [STATUS_ACCOUNT_DELETED]: "Your data and link were permanently deleted.",
    [STATUS_ENTRY_CORRECTED]: "Entry corrected.",
    [STATUS_ENTRY_DELETED]: "Entry deleted.",
  };
  return messages[code] ?? null;
}
