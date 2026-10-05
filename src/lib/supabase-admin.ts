import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

/** Service-role client, or null when the Supabase env vars are not configured. */
export function createAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Thrown when the Supabase env vars are missing, so a caller can tell "not configured" from a database failure. */
export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super("Supabase is not configured");
    this.name = "SupabaseNotConfiguredError";
  }
}

/** The service-role client, or throws if Supabase isn't configured. */
export function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw new SupabaseNotConfiguredError();
  }
  return admin;
}
