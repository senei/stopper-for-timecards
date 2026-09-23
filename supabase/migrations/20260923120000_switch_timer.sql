-- S-03 (Switch timer between projects): generalize start_timer's advisory
-- lock key from 'public.start_timer:' to 'public.timer:' so it's shared with
-- the new switch_timer below — the two functions now serialize against each
-- other per link_id, not just against themselves, which matters once a
-- switch and a start could otherwise race for the same link. Pure
-- create-or-replace, no signature/return-shape/caller-visible change.
--
-- switch_timer closes the link's currently-open time_entries row (raising
-- P0001 if none exists — a race backstop, same philosophy as start_timer's
-- 23505 on double-start) and then reuses the exact same find-or-create-project
-- + insert-new-entry logic start_timer already uses.
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
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

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

create or replace function switch_timer(p_link_id uuid, p_project_name text)
returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_id uuid;
  v_project_id uuid;
  v_name text;
  v_task text;
  v_type text;
  v_work_type text;
begin
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  select id into v_open_id
    from public.time_entries
    where link_id = p_link_id and ended_at is null;

  if v_open_id is null then
    raise exception 'no active timer to switch' using errcode = 'P0001';
  end if;

  update public.time_entries set ended_at = now() where id = v_open_id;

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

revoke execute on function switch_timer(uuid, text) from public, anon, authenticated;
grant execute on function switch_timer(uuid, text) to service_role;
