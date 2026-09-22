begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixed link id so later throws_ok/lives_ok literals don't need interpolation.
insert into links (id, token_hash) values
  ('a0000000-0000-0000-0000-000000000001', 'timer-test-hash');

-- A new project name creates one projects row and one open time_entries row.
create temporary table call1 as
  select * from start_timer('a0000000-0000-0000-0000-000000000001', 'Acme');

select is(
  (select count(*) from call1),
  1::bigint,
  'start_timer returns exactly one row for a new project'
);
select is(
  (select count(*) from projects where link_id = 'a0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'one projects row exists after the first start_timer call'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000001' and ended_at is null),
  1::bigint,
  'one open time_entries row exists after the first start_timer call'
);

-- Close the open entry so a second call for the same link is allowed to
-- succeed (the reuse case below), before the rejection case exercises the
-- one-open-entry-per-link guard.
update time_entries set ended_at = now()
  where link_id = 'a0000000-0000-0000-0000-000000000001' and ended_at is null;

-- Retyping the same name with different case/whitespace reuses the project.
create temporary table call2 as
  select * from start_timer('a0000000-0000-0000-0000-000000000001', '  acme  ');

select is(
  (select project_id from call2),
  (select project_id from call1),
  'a differently-cased/whitespace-padded name reuses the same project_id'
);
select is(
  (select count(*) from projects where link_id = 'a0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'still only one projects row after the reuse call (no duplicate)'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000001' and ended_at is null),
  1::bigint,
  'the reuse call opens a new time_entries row'
);

-- A second start_timer call while an entry is already open is rejected by
-- the partial unique index, regardless of the project name given.
select throws_ok(
  $$ select * from start_timer('a0000000-0000-0000-0000-000000000001', 'Whatever') $$,
  '23505',
  null,
  'start_timer is rejected while the link already has an open entry'
);

-- Grants: only service_role may execute start_timer.
select is(
  has_function_privilege('anon', 'public.start_timer(uuid, text)', 'execute'),
  false,
  'anon cannot execute start_timer'
);
select is(
  has_function_privilege('authenticated', 'public.start_timer(uuid, text)', 'execute'),
  false,
  'authenticated cannot execute start_timer'
);
select is(
  has_function_privilege('service_role', 'public.start_timer(uuid, text)', 'execute'),
  true,
  'service_role can execute start_timer'
);

-- RLS: projects has no policies, so anon/authenticated see zero rows even
-- though rows exist.
set local role anon;
select is(
  (select count(*) from projects),
  0::bigint,
  'anon sees zero rows from projects even when rows exist'
);
reset role;

set local role authenticated;
select is(
  (select count(*) from projects),
  0::bigint,
  'authenticated sees zero rows from projects even when rows exist'
);
reset role;

select * from finish();

rollback;
