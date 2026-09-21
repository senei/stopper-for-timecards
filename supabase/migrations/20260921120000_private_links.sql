-- Private-link access: person/link table, atomic capped creation, RLS on all
-- tables, and a nullable access_log.link_id so a miss can be logged.

-- links: one row per person. `id` is the stable person id referenced by
-- time_entries.link_id and access_log.link_id; only token_hash changes when a
-- link is regenerated. Only the SHA-256 hash of the token is stored.
create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_at timestamptz not null default now()
);

-- create_link: creates a person capped at 10. The advisory lock serializes
-- concurrent callers so the count check and insert are atomic. Returns null
-- when the cap is reached.
create or replace function create_link(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('public.create_link'));

  if (select count(*) from public.links) >= 10 then
    return null;
  end if;

  insert into public.links (token_hash) values (p_token_hash) returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function create_link(text) from public, anon, authenticated;
grant execute on function create_link(text) to service_role;

-- A miss (unknown token) has no link to reference.
alter table access_log alter column link_id drop not null;

-- Close anon/authenticated access: RLS on with no policies. The service role
-- bypasses RLS.
alter table links enable row level security;
alter table access_log enable row level security;
alter table time_entries enable row level security;
alter table job_runs enable row level security;
