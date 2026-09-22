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

/** The service-role client, or throws if Supabase isn't configured. */
export function adminOrThrow() {
  const admin = createAdminClient();
  if (!admin) {
    throw new Error("Supabase is not configured");
  }
  return admin;
}
