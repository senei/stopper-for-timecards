-- S-04 (Stop timer and flag long-running timers): add stop_timer, the only way
-- a running timer is ended without starting another one.
--
-- stop_timer closes the link's currently-open time_entries row at now() and
-- returns it, raising P0001 if none exists — a race backstop, same philosophy as
-- switch_timer's P0001 and start_timer's 23505. It takes the same per-link
-- advisory lock key ('public.timer:') as start_timer and switch_timer, so a
-- stop can never race a start or a switch for the same link.
--
-- The return columns (project_id, project_name, started_at) share names with
-- time_entries columns, so every column reference in the body is qualified with
-- a table alias, as switch_timer does; an unqualified one is ambiguous.
create or replace function stop_timer(p_link_id uuid)
returns table (entry_id uuid, project_id uuid, project_name text, started_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_open_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  select te.id into v_open_id
    from public.time_entries te
    where te.link_id = p_link_id and te.ended_at is null;

  if v_open_id is null then
    raise exception 'no active timer to stop' using errcode = 'P0001';
  end if;

  return query
    update public.time_entries as te set ended_at = now()
    where te.id = v_open_id
    returning te.id, te.project_id, te.project_name, te.started_at;
end;
$$;

revoke execute on function stop_timer(uuid) from public, anon, authenticated;
grant execute on function stop_timer(uuid) to service_role;
