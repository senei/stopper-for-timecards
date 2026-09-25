import { createClient } from "@supabase/supabase-js";

interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

const JOB_NAME = "purge_time_entries";

export default {
  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Free-tier Workers logs aren't persisted (infrastructure.md risk
    // register), so job_runs is the durable record. Write the `running` row
    // BEFORE purging: if it can't be written the run aborts without deleting
    // anything, so no data is ever purged unrecorded, and a run that dies
    // mid-way leaves a visible stale `running` row.
    const started = await supabase
      .from("job_runs")
      .insert({ job_name: JOB_NAME, started_at: new Date().toISOString(), status: "running" })
      .select("id")
      .single();

    if (started.error) {
      // eslint-disable-next-line no-console
      console.error("Purge job could not record its start; aborting before any delete:", started.error);
      throw new Error(`job_runs start insert failed: ${started.error.message}`);
    }

    // FR-008: the retention rule (3 calendar months, closed entries only) lives
    // in the purge_time_entries() database function, not here.
    const purge = await supabase.rpc("purge_time_entries");

    const finished = await supabase
      .from("job_runs")
      .update({
        finished_at: new Date().toISOString(),
        status: purge.error ? "error" : "success",
        rows_affected: purge.error ? 0 : (purge.data ?? 0),
        error_message: purge.error?.message ?? null,
      })
      .eq("id", started.data.id);

    // Throw after recording so the invocation shows as failed in Cloudflare's
    // cron events. The console.error output is only for a live `wrangler tail`
    // session.
    if (finished.error) {
      // eslint-disable-next-line no-console
      console.error("Purge job could not record its outcome:", finished.error, "purge error:", purge.error);
      throw new Error(`job_runs finish update failed: ${finished.error.message}`);
    }
    if (purge.error) {
      // eslint-disable-next-line no-console
      console.error("Purge job failed:", purge.error);
      throw new Error(`purge_time_entries failed: ${purge.error.message}`);
    }
  },
};
