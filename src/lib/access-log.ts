import { logError } from "./log";
import { createAdminClient } from "./supabase-admin";

export type AccessOutcome = "success" | "not_found" | "error";

/**
 * Records a private-link access attempt to the `access_log` table.
 *
 * Security audit trail per infrastructure.md's Role-Rotation Check: since
 * the private-link identity model has no accounts/passwords, this is the
 * only way to reconstruct "who accessed this link, when, from where" if a
 * leak is ever suspected. `linkId` is null for a miss (unknown token).
 *
 * Never throws: a logging failure must not break the request being logged.
 */
export async function logAccess(linkId: string | null, request: Request, outcome: AccessOutcome): Promise<void> {
  const context = { route: "lib/access-log", linkId: linkId ?? undefined, op: outcome };

  try {
    const supabase = createAdminClient();
    if (!supabase) {
      return;
    }

    const { error } = await supabase.from("access_log").insert({
      link_id: linkId,
      ip: request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for"),
      user_agent: request.headers.get("user-agent"),
      outcome,
    });

    if (error) {
      logError("access_log_failed", context, error);
    }
  } catch (err) {
    logError("access_log_failed", context, err);
  }
}
