import { classifyKillSwitch } from "./creation-closed";
import { logError, logWarn } from "./log";

export interface SignupConfigInput {
  /** The route template of the page doing the check, for the log line. */
  route: string;
  killSwitch: string | undefined;
  turnstileSiteKey: string | undefined;
  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;
  /** Whether the sign-up form (and with it the Turnstile widget) is shown on this render. */
  formShown: boolean;
}

/**
 * Events this isolate has already written. A configuration problem does not change between renders, so each one is
 * reported once per isolate instead of on every page view (the logger has no de-duplication of its own).
 */
const reported = new Set<string>();

function isMissing(value: string | undefined): boolean {
  return value === undefined || value.trim() === "";
}

function reportOnce(event: string, write: () => void): void {
  if (reported.has(event)) {
    return;
  }
  reported.add(event);
  write();
}

/**
 * Turns wrong or missing sign-up configuration into one log line per problem, at most once per isolate: an unrecognised
 * kill switch (sign-up stays open), a missing Turnstile site key while the form is shown (every visitor would be
 * refused) and missing Supabase secrets. Never changes a response and never writes a configuration value, only names.
 * The values come in as arguments so this module needs no Astro runtime.
 */
export function checkSignupConfig(input: SignupConfigInput): void {
  const { route } = input;

  if (classifyKillSwitch(input.killSwitch) === "unrecognised") {
    reportOnce("creation_closed_unrecognised", () => {
      logWarn("creation_closed_unrecognised", {
        route,
        detail: "LINK_CREATION_CLOSED is set but not recognised, so sign-up stays open; use 1 or true to close it",
      });
    });
  }

  if (input.formShown && isMissing(input.turnstileSiteKey)) {
    reportOnce("turnstile_site_key_missing", () => {
      logError(
        "turnstile_site_key_missing",
        { route },
        { message: "TURNSTILE_SITE_KEY is not set; the sign-up widget cannot challenge and every visitor is refused" },
      );
    });
  }

  const missingSupabase = [
    isMissing(input.supabaseUrl) ? "SUPABASE_URL" : undefined,
    isMissing(input.supabaseServiceRoleKey) ? "SUPABASE_SERVICE_ROLE_KEY" : undefined,
  ].filter((name): name is string => name !== undefined);
  if (missingSupabase.length > 0) {
    reportOnce("supabase_secrets_missing", () => {
      logError(
        "supabase_secrets_missing",
        { route, detail: missingSupabase.join(", ") },
        { message: "Supabase is not configured; sign-up and workspaces cannot work" },
      );
    });
  }
}
