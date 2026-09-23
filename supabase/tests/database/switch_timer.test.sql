begin;

create extension if not exists pgtap with schema extensions;

select plan(18);

-- Fixed link ids, distinct from projects_and_timer.test.sql's (…001) and
-- delete_project.test.sql's (…002/…003), so later throws_ok/is literals
-- don't need interpolation and can't collide if tests ever run in the same
-- session.
insert into links (id, token_hash) values
  ('a0000000-0000-0000-0000-000000000004', 'switch-timer-test-hash'),
  ('a0000000-0000-0000-0000-000000000005', 'switch-timer-test-hash-2');

-- Case 1: switching to a different (new) project closes the previously-open
-- entry and opens exactly one new open entry for the target project.
create temporary table start1 as
  select * from start_timer('a0000000-0000-0000-0000-000000000004', 'Acme');

create temporary table switch1 as
  select * from switch_timer('a0000000-0000-0000-0000-000000000004', 'Globex');

select is(
  (select count(*) from switch1),
  1::bigint,
  'switch_timer returns exactly one row when switching to a new project'
);
select isnt(
  (select project_id from switch1),
  (select project_id from start1),
  'switching to a different project name yields a different project_id'
);
select is(
  (select ended_at is not null from time_entries where id = (select entry_id from start1)),
  true,
  'the previously-open entry is closed after switching'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null),
  1::bigint,
  'exactly one open time_entries row exists after the switch'
);
select is(
  (select project_id from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null),
  (select project_id from switch1),
  'the one open entry belongs to the target (Globex) project'
);

-- Case 2: switching to an existing project name (any case/whitespace) reuses
-- that project, same as start_timer.
create temporary table switch2 as
  select * from switch_timer('a0000000-0000-0000-0000-000000000004', '  acme  ');

select is(
  (select project_id from switch2),
  (select project_id from start1),
  'a differently-cased/whitespace-padded name reuses the original (Acme) project_id'
);
select is(
  (select count(*) from projects where link_id = 'a0000000-0000-0000-0000-000000000004'),
  2::bigint,
  'still only two projects rows total (Acme, Globex) after the reuse switch'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null),
  1::bigint,
  'exactly one open time_entries row exists after the reuse switch'
);

-- Case 3: calling switch_timer when no timer is running is rejected with
-- P0001 and no entries change.
update time_entries set ended_at = now()
  where link_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null;

select throws_ok(
  $$ select * from switch_timer('a0000000-0000-0000-0000-000000000004', 'Whatever') $$,
  'P0001',
  null,
  'switch_timer is rejected when no timer is running for the link'
);
select is(
  (select count(*) from time_entries where link_id = 'a0000000-0000-0000-0000-000000000004'),
  3::bigint,
  'no new entry was created by the rejected switch_timer call'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000004' and ended_at is null),
  0::bigint,
  'still no open entry after the rejected switch_timer call'
);

-- Case 4: two consecutive switches to the *same* project name both succeed,
-- producing two closed/open segments for that one project (proves the
-- "harmless" claim from the plan's Implementation Approach).
create temporary table start3 as
  select * from start_timer('a0000000-0000-0000-0000-000000000005', 'Initech');

create temporary table switch3a as
  select * from switch_timer('a0000000-0000-0000-0000-000000000005', 'Initech');

select is(
  (select project_id from switch3a),
  (select project_id from start3),
  'switching to the same project name reuses that project_id (first switch)'
);

create temporary table switch3b as
  select * from switch_timer('a0000000-0000-0000-0000-000000000005', 'Initech');

select is(
  (select project_id from switch3b),
  (select project_id from start3),
  'switching to the same project name reuses that project_id (second switch)'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000005'
       and project_id = (select project_id from start3)),
  3::bigint,
  'three segments exist for the one project (start + two same-project switches)'
);
select is(
  (select count(*) from time_entries
     where link_id = 'a0000000-0000-0000-0000-000000000005' and ended_at is null),
  1::bigint,
  'exactly one of those segments is still open'
);

-- Grants: only service_role may execute switch_timer.
select is(
  has_function_privilege('anon', 'public.switch_timer(uuid, text)', 'execute'),
  false,
  'anon cannot execute switch_timer'
);
select is(
  has_function_privilege('authenticated', 'public.switch_timer(uuid, text)', 'execute'),
  false,
  'authenticated cannot execute switch_timer'
);
select is(
  has_function_privilege('service_role', 'public.switch_timer(uuid, text)', 'execute'),
  true,
  'service_role can execute switch_timer'
);

select * from finish();

rollback;
