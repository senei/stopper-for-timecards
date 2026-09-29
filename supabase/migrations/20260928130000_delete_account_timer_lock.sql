-- Fix for 20260928120000_delete_account.sql, found in the delete-account
-- implementation review: that migration took the advisory lock
-- 'public.start_timer:<id>', but 20260923120000_switch_timer.sql moved
-- start_timer, switch_timer and stop_timer onto 'public.timer:<id>', so the old
-- key excluded nothing. Migrations are never edited, so the function is
-- replaced here with the key the timer functions actually use.
--
-- The row lock on the link is still what makes the delete safe against inserts
-- from other tabs (they need a key-share lock on that row); the advisory lock
-- additionally lets a timer call that is already running finish first, and
-- keeps the acquisition order (advisory lock, then rows) the same as theirs.
create or replace function delete_account(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- The same per-link key start_timer, switch_timer and stop_timer use.
  perform pg_advisory_xact_lock(hashtext('public.timer:' || p_link_id::text));

  -- Locking the link row blocks any concurrent insert that references it
  -- (access_log from a page view in another tab, time_entries and projects from
  -- a timer action): those inserts need a key-share lock on this row. Without
  -- it such a row could land between the child deletes and the link delete and
  -- make that last delete fail its foreign key.
  select id into v_id from public.links where id = p_link_id for update;
  if v_id is null then
    return false;
  end if;

  -- time_entries reference projects, so they go first.
  delete from public.time_entries where link_id = v_id;
  delete from public.projects where link_id = v_id;
  delete from public.access_log where link_id = v_id;
  delete from public.links where id = v_id;

  return true;
end;
$$;

-- create or replace keeps the existing grants, restated so this file stands alone.
revoke execute on function delete_account(uuid) from public, anon, authenticated;
grant execute on function delete_account(uuid) to service_role;
