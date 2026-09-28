begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Two people: the one whose link we regenerate, and a bystander whose link
-- and data must be untouched by the swap.
select create_link('rl-owner-old');
select create_link('rl-bystander');

select is(
  (select token_hash from links where token_hash = 'rl-owner-old'),
  'rl-owner-old',
  'owner link starts on its original hash'
);

-- Give the owner a project and a time entry so we can prove they survive the
-- swap unchanged (they key off links.id, which never changes).
insert into projects (id, link_id, name)
  select gen_random_uuid(), id, 'Acme Widgets' from links where token_hash = 'rl-owner-old';
insert into time_entries (link_id, project_id, project_name, started_at)
  select l.id, p.id, p.name, now()
    from links l join projects p on p.link_id = l.id
   where l.token_hash = 'rl-owner-old';

-- Captured in a temp table (its own statement) rather than compared inline:
-- an inline `is(regenerate_link(...), (select ... from links), ...)` runs both
-- arguments against the same command snapshot, so the correlated subquery
-- can't see the swap the function just performed in that same statement.
create temporary table t_regen as select regenerate_link('rl-owner-old', 'rl-owner-new') as id;

select is(
  (select id from t_regen),
  (select id from links where token_hash = 'rl-owner-new'),
  'regenerating returns the link id, now resolvable by the new hash'
);

select is(
  (select count(*) from links where token_hash = 'rl-owner-old'),
  0::bigint,
  'the old hash no longer matches any row (this is what findLinkByToken relies on for its 404)'
);

select is(
  (select count(*) from links where token_hash = 'rl-bystander'),
  1::bigint,
  'the bystander link is untouched'
);

select is(
  (select count(*) from links),
  2::bigint,
  'regenerating swaps a hash in place; it does not create a new links row'
);

select is(
  (select count(*) from projects p join links l on l.id = p.link_id where l.token_hash = 'rl-owner-new'),
  1::bigint,
  'the owner''s project survives the swap, reachable through the same link id'
);

select is(
  (select count(*) from time_entries t join links l on l.id = t.link_id where l.token_hash = 'rl-owner-new'),
  1::bigint,
  'the owner''s time entry survives the swap, reachable through the same link id'
);

select is(
  regenerate_link('rl-owner-old', 'rl-owner-new-2'),
  null,
  'regenerating an already-superseded (or unknown) old hash returns null and changes nothing'
);

select is(
  (select count(*) from links where token_hash = 'rl-owner-new'),
  1::bigint,
  'a failed regenerate attempt does not touch the row it failed against'
);

select is(
  has_function_privilege('anon', 'public.regenerate_link(text, text)', 'execute'),
  false,
  'anon cannot execute regenerate_link'
);
select is(
  has_function_privilege('authenticated', 'public.regenerate_link(text, text)', 'execute'),
  false,
  'authenticated cannot execute regenerate_link'
);
select is(
  has_function_privilege('service_role', 'public.regenerate_link(text, text)', 'execute'),
  true,
  'service_role can execute regenerate_link'
);

select * from finish();

rollback;
