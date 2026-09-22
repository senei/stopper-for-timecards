import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

// FR-008: purge time entries older than 3 months.
const PURGE_AFTER_DAYS = 90;

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
    const startedAt = new Date().toISOString();
    const cutoff = new Date(Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { error, count } = await supabase.from("time_entries").delete({ count: "exact" }).lt("started_at", cutoff);

    const finishedAt = new Date().toISOString();

    await supabase.from("job_runs").insert({
      job_name: "purge_time_entries",
      started_at: startedAt,
      finished_at: finishedAt,
      status: error ? "error" : "success",
      rows_affected: count ?? 0,
      error_message: error?.message ?? null,
    });

    if (error) {
      // Free-tier Workers logs aren't persisted (infrastructure.md risk
      // register) — the job_runs row above is the durable record; this is
      // only for a live `wrangler tail` session.
      console.error("Purge job failed:", error);
    }
  },
};
