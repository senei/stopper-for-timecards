begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- Fixed link ids, distinct from the other timer test files' (…001 through …005),
-- so later throws_ok/is literals don't need interpolation and can't collide if
-- tests ever run in the same session.
insert into links (id, token_hash) values
  ('a0000000-0000-0000-0000-000000000006', 'stop-timer-test-hash'),
  ('a0000000-0000-0000-0000-000000000007', 'stop-timer-test-hash-2');

-- Case 1: stopping closes the open entry and returns it; nothing else changes.
create temporary table start1 as
  select * from start_timer('a0000000-0000-0000-0000-000000000006', 'Acme');

create temporary table stop1 as
  select * from stop_timer('a0000000-0000-0000-0000-000000000006');

select is(
  (select count(*) from stop1),
  1::bigint,
  'stop_timer returns exactly one row'
);
select is(
  (select entry_id from stop1),
  (select entry_id from start1),
  'the returned row is the entry that was started'
);
select is(
  (select ended_at is not null from time_entries where id = (select entry_id from start1)),
  true,
  'the entry is closed after stopping'
);
select is(
  (select ended_at >= started_at from time_entries where id = (select entry_id from start1)),
  true,
  'the entry ends no earlier than it started'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000006' and ended_at is null),
  0::bigint,
  'no open entry remains after stopping'
);
select is(
  (select count(*) from projects where link_id = 'a0000000-0000-0000-0000-000000000006'),
  1::bigint,
  'stopping does not touch the projects table'
);

-- Case 2: stopping when nothing is running is rejected with P0001 and no
-- entries change.
select throws_ok(
  $$ select * from stop_timer('a0000000-0000-0000-0000-000000000006') $$,
  'P0001',
  null,
  'stop_timer is rejected when no timer is running for the link'
);
select is(
  (select count(*) from time_entries where link_id = 'a0000000-0000-0000-0000-000000000006'),
  1::bigint,
  'no entry was created or removed by the rejected stop_timer call'
);

-- Case 3: after a stop, starting again works (stopping is not "day closed").
create temporary table start2 as
  select * from start_timer('a0000000-0000-0000-0000-000000000006', 'Acme');

select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000006' and ended_at is null),
  1::bigint,
  'exactly one open entry exists after starting again'
);
select is(
  (select count(*) from time_entries where link_id = 'a0000000-0000-0000-0000-000000000006'),
  2::bigint,
  'two entries exist for the link: the closed one and the new open one'
);

-- Case 4: stopping one link leaves another link's open entry untouched.
create temporary table start3 as
  select * from start_timer('a0000000-0000-0000-0000-000000000007', 'Initech');

create temporary table stop2 as
  select * from stop_timer('a0000000-0000-0000-0000-000000000006');

select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000007' and ended_at is null),
  1::bigint,
  'the other link still has its open entry'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000006' and ended_at is null),
  0::bigint,
  'the stopped link has no open entry'
);

-- Grants: only service_role may execute stop_timer.
select is(
  has_function_privilege('anon', 'public.stop_timer(uuid)', 'execute'),
  false,
  'anon cannot execute stop_timer'
);
select is(
  has_function_privilege('authenticated', 'public.stop_timer(uuid)', 'execute'),
  false,
  'authenticated cannot execute stop_timer'
);
select is(
  has_function_privilege('service_role', 'public.stop_timer(uuid)', 'execute'),
  true,
  'service_role can execute stop_timer'
);

select * from finish();

rollback;
