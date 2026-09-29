-- S-07 (Regenerate own link): atomic token swap for a person's existing
-- link. Follows the create_link / start_timer pattern exactly (security
-- definer, advisory-locked, service_role-only grant).

-- regenerate_link: looks the link up by its *old* token hash, then swaps
-- token_hash to the new value in one statement. Returns the link's stable id
-- on success; null when the old hash no longer resolves to any row (already
-- regenerated, mistyped, or never existed) -- same "null means the caller's
-- precondition failed" convention create_link uses for its cap-reached case.
--
-- The advisory lock is scoped by the resolved link id, the same key space
-- start_timer already uses for that link. It isn't strictly required for
-- correctness (a second concurrent regenerate naturally loses because its
-- `where token_hash = p_old_token_hash` no longer matches once the first
-- commits), but it closes the narrow window between the lookup and the
-- update and keeps this function's shape consistent with the other two.
create or replace function regenerate_link(p_old_token_hash text, p_new_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.links where token_hash = p_old_token_hash;
  if v_id is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('public.regenerate_link:' || v_id::text));

  update public.links
     set token_hash = p_new_token_hash
   where id = v_id and token_hash = p_old_token_hash
   returning id into v_id;

  return v_id; -- null if a concurrent regenerate already won between the lookup and the lock
end;
$$;

revoke execute on function regenerate_link(text, text) from public, anon, authenticated;
grant execute on function regenerate_link(text, text) to service_role;
