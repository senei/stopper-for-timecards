import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";

export type AccessOutcome = "success" | "not_found" | "error";

/**
 * Records a private-link access attempt to the `access_log` table.
 *
 * Security audit trail per infrastructure.md's Role-Rotation Check: since
 * the private-link identity model has no accounts/passwords, this is the
 * only way to reconstruct "who accessed this link, when, from where" if a
 * leak is ever suspected. Not yet called from anywhere — the private-link
 * lookup route it should hook into (FR-007) doesn't exist yet.
 *
 * // TODO(FR-007): call this from the private-link lookup route once built.
 */
export async function logAccess(
  linkId: string,
  request: Request,
  outcome: AccessOutcome
): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  await supabase.from("access_log").insert({
    link_id: linkId,
    ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for"),
    user_agent: request.headers.get("user-agent"),
    outcome,
  });
}
