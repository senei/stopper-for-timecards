-- S-02 (First timer start): replace time_entries's placeholder `project` text
-- column with a real projects table plus a denormalized snapshot of the
-- project's fields at entry-creation time, and add the atomic start_timer
-- function that finds-or-creates the project and starts its timer in one
-- advisory-locked transaction.
--
-- Also closes the access_log F1 finding's deferred half: time_entries.link_id
-- gets its FK to links now that this table's real shape has landed (see
-- 20260922100433_access_log_link_fk.sql's comment).

-- projects: one row per (link, project name). RLS on, no policies, same as
-- every other table in this app — the service role is the only reader/writer.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references links (id),
  name text not null,
  task text,
  type text not null default 'Regular',
  work_type text not null default '',
  created_at timestamptz not null default now()
);

-- Case-insensitive per-person uniqueness: retyping an existing project's name
-- (in any case) must reuse it rather than create a duplicate. lower() is
-- locale/collation-dependent server-side; fine for this app's single-tenant,
-- Latin-script usage, but a non-default collation could in theory fold two
-- names together (or apart) differently than expected.
create unique index if not exists projects_link_id_lower_name_idx
  on projects (link_id, lower(name));

alter table projects enable row level security;

-- time_entries: drop the placeholder `project` text column, add the real
-- project reference plus the denormalized snapshot (name/task/type/work_type
-- as they were at entry-creation time), and add the link_id FK that F1
-- deferred to this slice.
alter table time_entries drop column project;

-- time_entries has no production rows yet (see the plan's Migration Notes),
-- so the not-null columns below need no backfill/default.
alter table time_entries
  add column project_id uuid not null references projects (id),
  add column project_name text not null,
  add column task text,
  add column type text not null default 'Regular',
  add column work_type text not null default '';

alter table time_entries
  add constraint time_entries_link_id_fkey
  foreign key (link_id) references links (id);

create index if not exists time_entries_project_id_idx on time_entries (project_id);

-- At most one open (ended_at is null) entry per link: the database-level
-- guarantee behind "one running timer per link", same belt-and-suspenders
-- style as create_link's cap.
create unique index if not exists time_entries_link_id_open_idx
  on time_entries (link_id)
  where ended_at is null;

-- start_timer: does both jobs atomically — find-or-create the project by
-- case-insensitive/trimmed name, then start its timer. The advisory lock
-- (scoped per link_id) serializes concurrent callers for the same link so a
-- double-submit can't create two projects with the same name or two open
-- entries; the partial unique index above is the backstop if it ever did.
create or replace function start_timer(p_link_id uuid, p_project_name text)
returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_name text;
  v_task text;
  v_type text;
  v_work_type text;
begin
  perform pg_advisory_xact_lock(hashtext('public.start_timer:' || p_link_id::text));

  select id, name, task, type, work_type
    into v_project_id, v_name, v_task, v_type, v_work_type
    from public.projects
    where link_id = p_link_id and lower(name) = lower(trim(p_project_name));

  if v_project_id is null then
    insert into public.projects (link_id, name)
    values (p_link_id, trim(p_project_name))
    returning id, name, task, type, work_type
      into v_project_id, v_name, v_task, v_type, v_work_type;
  end if;

  return query
    insert into public.time_entries as te (link_id, project_id, project_name, task, type, work_type, started_at)
    values (p_link_id, v_project_id, v_name, v_task, v_type, v_work_type, now())
    returning te.id, te.project_id, te.project_name, te.started_at;
end;
$$;

revoke execute on function start_timer(uuid, text) from public, anon, authenticated;
grant execute on function start_timer(uuid, text) to service_role;
