-- S-08 (Automatic purge of old time entries, PRD FR-008): move the purge
-- delete out of the Worker's PostgREST call and into a security-definer
-- function, so pgTAP can test the exact rule the scheduled Worker runs.
--
-- Rules (agreed in the change's plan):
--   * Cutoff is now() - interval '3 months' (calendar months, not 90 days), so
--     an entry is never purged before 3 months have passed, per the PRD's
--     "retained for at least 3 months" NFR. The month step uses the session
--     time zone; Supabase sessions default to UTC.
--   * Strict less-than: an entry whose started_at is exactly on the cutoff is
--     kept.
--   * Only closed entries (ended_at is not null) are eligible, so a running
--     timer is never deleted. Accepted consequence: a timer left open past
--     the cutoff and stopped later becomes eligible immediately and is
--     purged at the next scheduled run.
--
-- Only time_entries is touched. projects is never read or written, and
-- time_entries.project_id references projects, so purging entries can never
-- cascade to a project (PRD: project definitions persist indefinitely).
-- Returns the number of entries deleted; the Worker records it in job_runs.
create or replace function purge_time_entries()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.time_entries
    where ended_at is not null
      and started_at < now() - interval '3 months';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function purge_time_entries() from public, anon, authenticated;
grant execute on function purge_time_entries() to service_role;
