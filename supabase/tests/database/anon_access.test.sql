begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

-- Oracle: PRD Access Control, "no public access" — an unauthenticated (anon)
-- caller must never read any row from any table. Expected values come from
-- that rule, not from reading the policies. Fresh link-id prefix c0000000-…
-- (a0…/b0… are taken by other files).
insert into links (id, token_hash) values
  ('c0000000-0000-0000-0000-000000000001', 'anon-access-test-hash-1');

insert into projects (id, link_id, name) values
  ('c0000000-0000-0000-0000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', 'Anon Probe');

insert into time_entries (link_id, project_id, project_name, started_at) values
  ('c0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-0000000000a1', 'Anon Probe', now());

insert into access_log (link_id, outcome) values
  ('c0000000-0000-0000-0000-000000000001', 'success');

insert into job_runs (job_name, started_at, status) values
  ('anon-access-test', now(), 'success');

-- Supabase's default privileges give anon table-level SELECT on public tables
-- and nothing in the migrations revokes it, so with RLS enabled and no
-- policies these reads return 0 rows (RLS filtering) rather than a 42501
-- permission error. If a future migration revokes the grant instead, these
-- reads would throw and the test would fail loudly, which is also a signal to
-- revisit it. Filters on the seeded ids so pre-existing rows can't mask a leak.
set local role anon;

select is(
  (select count(*) from links where id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'anon reads no rows from links'
);
select is(
  (select count(*) from projects where link_id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'anon reads no rows from projects'
);
select is(
  (select count(*) from time_entries where link_id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'anon reads no rows from time_entries'
);
select is(
  (select count(*) from access_log where link_id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'anon reads no rows from access_log'
);
select is(
  (select count(*) from job_runs where job_name = 'anon-access-test'),
  0::bigint,
  'anon reads no rows from job_runs'
);

reset role;

-- Control: prove the assertions above would notice a regression. anon holds
-- the table-level SELECT grant on links (default privileges; granted
-- explicitly here so the control never depends on that default), so the only
-- thing hiding the seeded row is RLS. Disabling RLS inside this transaction
-- must therefore expose it to anon.
grant select on links to anon;
alter table links disable row level security;

set local role anon;

select is(
  (select count(*) from links where id = 'c0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'control: with RLS disabled on links, anon can read the seeded row (the test detects the regression)'
);

reset role;

-- The same control for the other four tables, so each zero-row assertion above is
-- shown to depend on RLS and not on a seed row that anon could never see anyway.
grant select on projects, time_entries, access_log, job_runs to anon;
alter table projects disable row level security;
alter table time_entries disable row level security;
alter table access_log disable row level security;
alter table job_runs disable row level security;

set local role anon;

select is(
  (select count(*) from projects where link_id = 'c0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'control: with RLS disabled on projects, anon can read the seeded row'
);
select is(
  (select count(*) from time_entries where link_id = 'c0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'control: with RLS disabled on time_entries, anon can read the seeded row'
);
select is(
  (select count(*) from access_log where link_id = 'c0000000-0000-0000-0000-000000000001'),
  1::bigint,
  'control: with RLS disabled on access_log, anon can read the seeded row'
);
select is(
  (select count(*) from job_runs where job_name = 'anon-access-test'),
  1::bigint,
  'control: with RLS disabled on job_runs, anon can read the seeded row'
);

reset role;

select * from finish();

rollback;
