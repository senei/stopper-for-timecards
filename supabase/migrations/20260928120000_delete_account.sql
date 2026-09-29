-- S-10 (Delete all data, FR-010): remove one person's projects, time entries,
-- access-log rows and their link in a single transaction. Follows the
-- create_link / regenerate_link pattern (security definer, advisory-locked,
-- service_role-only grant).
--
-- Deliberately an explicit child-before-parent delete, not ON DELETE CASCADE:
-- a cascade would make any future delete of a link silently wipe data and would
-- rule out an archive feature. Every table that references links.id is listed
-- here; a future table with a link_id must be added or this delete fails loudly
-- on its foreign key.
--
-- Returns true when the link existed and was deleted, false when p_link_id
-- matches no link (already deleted, or never existed) -- the same "false/null
-- means the precondition failed" convention the other link functions use.
create or replace function delete_account(p_link_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- The same per-link key start_timer uses, so a timer start that is already
  -- running finishes first.
  perform pg_advisory_xact_lock(hashtext('public.start_timer:' || p_link_id::text));

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

revoke execute on function delete_account(uuid) from public, anon, authenticated;
grant execute on function delete_account(uuid) to service_role;

-- 20260922100433_access_log_link_fk.sql says links are never deleted by any code
-- path. That is no longer true (FR-010); migrations are never edited, so the
-- refreshed note lives on the constraint.
comment on constraint access_log_link_id_fkey on access_log is
  'NO ACTION on purpose: a link is deleted only through delete_account(), which removes access_log rows first; any other delete of a referenced link fails loudly.';
