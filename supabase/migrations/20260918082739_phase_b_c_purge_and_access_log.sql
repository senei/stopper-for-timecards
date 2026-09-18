-- Phase B (FR-008 purge job) and Phase C (private-link access audit log)
-- support tables, per context/deployment/deploy-plan.md.

-- time_entries: MINIMAL PLACEHOLDER, not the final FR-001-006 data model.
-- Exists only so the FR-008 purge job (Phase B) has a real table to operate
-- against ahead of the full timecard feature. Needs to be reconciled/extended
-- (task, type, work_type columns; corrections; project references) when
-- FR-001-006 are actually implemented.
create table if not exists time_entries (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  project text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists time_entries_started_at_idx on time_entries (started_at);
create index if not exists time_entries_link_id_idx on time_entries (link_id);

-- job_runs: outcome log for scheduled jobs (currently just the FR-008 purge
-- job). Doubles as the observability mitigation from infrastructure.md's
-- risk register, since Cloudflare's free-tier logs aren't persisted.
create table if not exists job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'error')),
  rows_affected integer,
  error_message text
);

create index if not exists job_runs_job_name_started_at_idx on job_runs (job_name, started_at desc);

-- access_log: private-link access audit trail (infrastructure.md's
-- Role-Rotation Check security finding). Table is created now; nothing
-- writes to it yet, since the private-link lookup route it should log
-- (FR-007) doesn't exist. See src/lib/access-log.ts's logAccess() helper
-- and the // TODO(FR-007) marker for the eventual call site.
create table if not exists access_log (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null,
  accessed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  outcome text not null check (outcome in ('success', 'not_found', 'error'))
);

create index if not exists access_log_link_id_accessed_at_idx on access_log (link_id, accessed_at desc);
