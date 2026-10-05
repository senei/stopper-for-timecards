-- S-05 (Correct logged time): add correct_time_entry and delete_time_entry, the
-- only ways a closed time_entries row is edited or removed by the person.
--
-- time_entries has no check or exclusion constraint on order or overlap, so
-- these functions are the only guard. Both take the same per-link advisory lock
-- key ('public.timer:') as start_timer, switch_timer and stop_timer, so a
-- correction can never race a start, a switch or a stop for the same link.
--
-- Only closed entries whose start is inside the correction window (yesterday
-- 00:00 UTC onwards) can be touched. The window start is computed in UTC
-- explicitly, not from the session time zone, so it agrees with the app.
--
-- Refusals are P0001 with a stable code as the message. Validation order is
-- fixed (existence and ownership first, so a foreign id never leaks a state):
--   entry_not_found, entry_running, outside_window (the row's current start),
--   bad_range (a null argument, or end <= start), outside_window (the new
--   start), in_future, overlap.
--
-- The return columns (started_at, ended_at) share names with time_entries
-- columns, so every column reference in the body is qualified with a table
-- alias, as stop_timer does; an unqualified one is ambiguous.
create or replace function correct_time_entry(
  p_link_id uuid,
  p_entry_id uuid,
  p_started_at timestamptz,
  p_ended_at timestamptz
)
returns table (entry_id uuid, started_at timestamptz, ended_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz :=
    (date_trunc('day', now() at time zone 'utc') - interval '1 day') at time zone 'utc';
  v_row_started timestamptz;
  v_row_ended timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  select te.started_at, te.ended_at into v_row_started, v_row_ended
    from public.time_entries te
    where te.id = p_entry_id and te.link_id = p_link_id;

  if not found then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  if v_row_ended is null then
    raise exception 'entry_running' using errcode = 'P0001';
  end if;
  if v_row_started < v_window_start then
    raise exception 'outside_window' using errcode = 'P0001';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at then
    raise exception 'bad_range' using errcode = 'P0001';
  end if;
  if p_started_at < v_window_start then
    raise exception 'outside_window' using errcode = 'P0001';
  end if;
  if p_ended_at > now() then
    raise exception 'in_future' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.time_entries other
      where other.link_id = p_link_id
        and other.id <> p_entry_id
        and other.started_at < p_ended_at
        and coalesce(other.ended_at, 'infinity'::timestamptz) > p_started_at
  ) then
    raise exception 'overlap' using errcode = 'P0001';
  end if;

  return query
    update public.time_entries as te
      set started_at = p_started_at, ended_at = p_ended_at
    where te.id = p_entry_id and te.link_id = p_link_id
    returning te.id, te.started_at, te.ended_at;
end;
$$;

-- delete_time_entry: same lookup and refusals as correct_time_entry up to the
-- window check, then removes the row and returns its id.
create or replace function delete_time_entry(p_link_id uuid, p_entry_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window_start timestamptz :=
    (date_trunc('day', now() at time zone 'utc') - interval '1 day') at time zone 'utc';
  v_row_started timestamptz;
  v_row_ended timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  select te.started_at, te.ended_at into v_row_started, v_row_ended
    from public.time_entries te
    where te.id = p_entry_id and te.link_id = p_link_id;

  if not found then
    raise exception 'entry_not_found' using errcode = 'P0001';
  end if;
  if v_row_ended is null then
    raise exception 'entry_running' using errcode = 'P0001';
  end if;
  if v_row_started < v_window_start then
    raise exception 'outside_window' using errcode = 'P0001';
  end if;

  delete from public.time_entries as te
    where te.id = p_entry_id and te.link_id = p_link_id;

  return p_entry_id;
end;
$$;

revoke execute on function correct_time_entry(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function correct_time_entry(uuid, uuid, timestamptz, timestamptz) to service_role;
revoke execute on function delete_time_entry(uuid, uuid) from public, anon, authenticated;
grant execute on function delete_time_entry(uuid, uuid) to service_role;
