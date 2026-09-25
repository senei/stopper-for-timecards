begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixed ids, distinct from the other test files' (links …001 to …005,
-- projects b…0001/…0002), so later literals don't need interpolation and
-- can't collide if tests ever run in the same session.
--
-- Everything is built from now() - interval '3 months', the same expression
-- purge_time_entries() uses. now() is fixed for the whole transaction, so an
-- entry set to exactly that value sits exactly on the function's cutoff.
insert into links (id, token_hash) values
  ('a0000000-0000-0000-0000-000000000006', 'purge-test-hash'),
  ('a0000000-0000-0000-0000-000000000007', 'purge-test-hash-2');

insert into projects (id, link_id, name) values
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', 'Purge Alpha'),
  ('b0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000006', 'Purge Beta'),
  ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000006', 'Purge Gamma'),
  ('b0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000007', 'Purge Delta');

-- Link …006: four closed entries around the cutoff. Link …007: one old entry
-- that is still open (the one-open-entry-per-link index means it needs its
-- own link).
insert into time_entries (id, link_id, project_id, project_name, started_at, ended_at) values
  -- e1: one day older than the cutoff -> deleted
  ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000006', 'Purge Alpha',
   now() - interval '3 months' - interval '1 day',
   now() - interval '3 months' - interval '1 day' + interval '1 hour'),
  -- e2: one month old -> kept
  ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000006', 'Purge Alpha',
   now() - interval '1 month',
   now() - interval '1 month' + interval '1 hour'),
  -- e3: one second older than the cutoff, the only entry of Purge Beta -> deleted
  ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000007', 'Purge Beta',
   now() - interval '3 months' - interval '1 second',
   now() - interval '3 months' - interval '1 second' + interval '1 hour'),
  -- e4: exactly on the cutoff -> kept (strict less-than)
  ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000006',
   'b0000000-0000-0000-0000-000000000008', 'Purge Gamma',
   now() - interval '3 months',
   now() - interval '3 months' + interval '1 hour');

insert into time_entries (id, link_id, project_id, project_name, started_at, ended_at) values
  -- e5: far older than the cutoff but still open -> kept
  ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000007',
   'b0000000-0000-0000-0000-000000000009', 'Purge Delta',
   now() - interval '3 months' - interval '10 days',
   null);

create temporary table purge1 as
  select purge_time_entries() as deleted;

select is(
  (select deleted from purge1),
  2,
  'purge_time_entries returns the number of deleted entries (e1 and e3)'
);

select is(
  (select count(*) from time_entries where id = 'c0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'a closed entry older than the cutoff is deleted'
);
select is(
  (select count(*) from time_entries where id = 'c0000000-0000-0000-0000-000000000002'),
  1::bigint,
  'a closed entry newer than the cutoff is kept'
);
select is(
  (select count(*) from time_entries where id = 'c0000000-0000-0000-0000-000000000003'),
  0::bigint,
  'a closed entry one second older than the cutoff is deleted'
);
select is(
  (select count(*) from time_entries where id = 'c0000000-0000-0000-0000-000000000004'),
  1::bigint,
  'a closed entry exactly on the cutoff is kept'
);
select is(
  (select count(*) from time_entries where id = 'c0000000-0000-0000-0000-000000000005'),
  1::bigint,
  'an open entry older than the cutoff is kept'
);

select is(
  (select count(*) from projects where id in (
    'b0000000-0000-0000-0000-000000000006',
    'b0000000-0000-0000-0000-000000000007',
    'b0000000-0000-0000-0000-000000000008',
    'b0000000-0000-0000-0000-000000000009'
  )),
  4::bigint,
  'every project row still exists after the purge'
);
select is(
  (select count(*) from projects where id = 'b0000000-0000-0000-0000-000000000007'),
  1::bigint,
  'a project whose only entry was purged still exists'
);

create temporary table purge2 as
  select purge_time_entries() as deleted;

select is(
  (select deleted from purge2),
  0,
  'a second call deletes nothing and returns 0'
);

-- Grants: only service_role may execute purge_time_entries.
select is(
  has_function_privilege('anon', 'public.purge_time_entries()', 'execute'),
  false,
  'anon cannot execute purge_time_entries'
);
select is(
  has_function_privilege('authenticated', 'public.purge_time_entries()', 'execute'),
  false,
  'authenticated cannot execute purge_time_entries'
);
select is(
  has_function_privilege('service_role', 'public.purge_time_entries()', 'execute'),
  true,
  'service_role can execute purge_time_entries'
);

select * from finish();

rollback;
