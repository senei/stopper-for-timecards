begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

-- Fixed ids, distinct from the other timer test files' (a…, b…, c…), so the
-- throws_ok/is literals below need no interpolation.
--   links    d0…01 (the person), d0…02 (a bystander)
--   projects d1…01, d1…02
--   entries  d2…01 .. d2…08 (see the comments at the insert)
insert into links (id, token_hash) values
  ('d0000000-0000-0000-0000-000000000001', 'corrections-test-hash'),
  ('d0000000-0000-0000-0000-000000000002', 'corrections-test-hash-2');

insert into projects (id, link_id, name) values
  ('d1000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 'Corr Alpha'),
  ('d1000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', 'Corr Beta');

-- W is the correction window start (yesterday 00:00 UTC), computed with the same
-- expression as the functions. Every timestamp below is W plus a fixed offset
-- (always between yesterday 00:00 and 11:00 UTC, so always in the past and inside
-- the window), which keeps the file independent of the time of day it runs.
create temporary table w as
  select (date_trunc('day', now() at time zone 'utc') - interval '1 day') at time zone 'utc' as ws;

insert into time_entries
  (id, link_id, project_id, project_name, task, type, work_type, started_at, ended_at)
values
  -- e1: closed, W+1h .. W+2h (the person)
  ('d2000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', 'T1', 'Regular', 'WT1',
   (select ws from w) + interval '1 hour', (select ws from w) + interval '2 hours'),
  -- e2: closed, W+3h .. W+4h (the person); the entry most edits target
  ('d2000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', 'T2', 'Overtime', 'WT2',
   (select ws from w) + interval '3 hours', (select ws from w) + interval '4 hours'),
  -- e3: RUNNING, started W+10h (the person)
  ('d2000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', null, 'Regular', '',
   (select ws from w) + interval '10 hours', null),
  -- e4: closed but started before the window (the person)
  ('d2000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', null, 'Regular', '',
   (select ws from w) - interval '2 hours', (select ws from w) - interval '1 hour'),
  -- e5: RUNNING and started before the window (the bystander)
  ('d2000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000002', 'Corr Beta', null, 'Regular', '',
   (select ws from w) - interval '3 hours', null),
  -- e6: closed, W+1h .. W+2h (the bystander)
  ('d2000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000002',
   'd1000000-0000-0000-0000-000000000002', 'Corr Beta', null, 'Regular', '',
   (select ws from w) + interval '1 hour', (select ws from w) + interval '2 hours'),
  -- e7: closed, W+6h .. W+7h (the person); refusals and the delete target
  ('d2000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', null, 'Regular', '',
   (select ws from w) + interval '6 hours', (select ws from w) + interval '7 hours'),
  -- e8: closed, starts exactly at the window start (the person)
  ('d2000000-0000-0000-0000-000000000008', 'd0000000-0000-0000-0000-000000000001',
   'd1000000-0000-0000-0000-000000000001', 'Corr Alpha', null, 'Regular', '',
   (select ws from w), (select ws from w) + interval '30 minutes');

-- Case 1: shortening the end succeeds and returns the edited row.
create temporary table c1 as
  select * from correct_time_entry(
    'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002',
    (select ws from w) + interval '3 hours', (select ws from w) + interval '3 hours 30 minutes');

select is((select count(*) from c1), 1::bigint, 'an edit returns exactly one row');
select is(
  (select entry_id from c1), 'd2000000-0000-0000-0000-000000000002'::uuid,
  'the returned row is the edited entry'
);
select is(
  (select ended_at from time_entries where id = 'd2000000-0000-0000-0000-000000000002'),
  (select ws from w) + interval '3 hours 30 minutes',
  'the end is shortened'
);
select is(
  (select row(project_id, project_name, task, type, work_type, link_id)::text
     from time_entries where id = 'd2000000-0000-0000-0000-000000000002'),
  row('d1000000-0000-0000-0000-000000000001'::uuid, 'Corr Alpha', 'T2', 'Overtime', 'WT2',
      'd0000000-0000-0000-0000-000000000001'::uuid)::text,
  'only started_at and ended_at change; the snapshot columns are untouched'
);
select is(
  (select started_at from time_entries where id = 'd2000000-0000-0000-0000-000000000001'),
  (select ws from w) + interval '1 hour',
  'other entries are left alone'
);

-- Case 2: editing the start succeeds.
select lives_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002',
       (select ws from w) + interval '3 hours 10 minutes',
       (select ws from w) + interval '3 hours 30 minutes') $$,
  'editing the start succeeds'
);
select is(
  (select started_at from time_entries where id = 'd2000000-0000-0000-0000-000000000002'),
  (select ws from w) + interval '3 hours 10 minutes',
  'the start is changed'
);

-- Case 3: a start that touches the previous entry's end (no gap) is allowed.
select lives_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000002',
       (select ws from w) + interval '2 hours',
       (select ws from w) + interval '3 hours 30 minutes') $$,
  'a touching boundary (start equals the previous end) is allowed'
);

-- Case 4: another link's entry is not found, and nothing changes.
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001',
       (select ws from w) + interval '1 hour', (select ws from w) + interval '90 minutes') $$,
  'P0001', 'entry_not_found',
  'a foreign link gets entry_not_found'
);
select is(
  (select ended_at from time_entries where id = 'd2000000-0000-0000-0000-000000000001'),
  (select ws from w) + interval '2 hours',
  'the foreign entry is unchanged'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-0000000000ff',
       (select ws from w) + interval '1 hour', (select ws from w) + interval '90 minutes') $$,
  'P0001', 'entry_not_found',
  'an unknown entry id gets entry_not_found'
);

-- Case 5: the running entry is refused.
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003',
       (select ws from w) + interval '10 hours', (select ws from w) + interval '11 hours') $$,
  'P0001', 'entry_running',
  'the running entry gets entry_running'
);
select is(
  (select ended_at is null from time_entries where id = 'd2000000-0000-0000-0000-000000000003'),
  true,
  'the running entry stays running'
);

-- Case 6: validation order. The earliest failing check wins.
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000005',
       (select ws from w) + interval '1 hour', (select ws from w) + interval '2 hours') $$,
  'P0001', 'entry_not_found',
  'a foreign running entry gets entry_not_found, not entry_running (no state leak)'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000005',
       (select ws from w) + interval '1 hour', (select ws from w) + interval '2 hours') $$,
  'P0001', 'entry_running',
  'a running entry that is also before the window gets entry_running'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004',
       (select ws from w) - interval '90 minutes', (select ws from w) - interval '1 hour') $$,
  'P0001', 'outside_window',
  'an entry that started before the window gets outside_window (current row start)'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) - interval '1 hour', (select ws from w) + interval '7 hours') $$,
  'P0001', 'outside_window',
  'a new start before the window gets outside_window (new start)'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) - interval '1 hour', (select ws from w) - interval '2 hours') $$,
  'P0001', 'bad_range',
  'a new start before the window and an end before the start gets bad_range'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       now() + interval '2 hours', now() + interval '1 hour') $$,
  'P0001', 'bad_range',
  'an end before the start that is also in the future gets bad_range'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '6 hours', now() + interval '1 hour') $$,
  'P0001', 'in_future',
  'an end in the future gets in_future'
);

-- Case 7: ranges that are empty, negative or null.
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '6 hours', (select ws from w) + interval '6 hours') $$,
  'P0001', 'bad_range',
  'an end equal to the start gets bad_range'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '6 hours', (select ws from w) + interval '5 hours') $$,
  'P0001', 'bad_range',
  'an end before the start gets bad_range'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '6 hours', null) $$,
  'P0001', 'bad_range',
  'a null end gets bad_range (a closed entry can never be reopened)'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       null, (select ws from w) + interval '7 hours') $$,
  'P0001', 'bad_range',
  'a null start gets bad_range'
);
select is(
  (select ended_at is not null from time_entries where id = 'd2000000-0000-0000-0000-000000000007'),
  true,
  'the entry is still closed after the null attempts'
);

-- Case 8: overlaps. e2 is now W+2h .. W+3h30m, e7 is W+6h .. W+7h.
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '3 hours', (select ws from w) + interval '7 hours') $$,
  'P0001', 'overlap',
  'an overlap with a closed neighbour gets overlap'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007',
       (select ws from w) + interval '6 hours', (select ws from w) + interval '11 hours') $$,
  'P0001', 'overlap',
  'an overlap with the running entry gets overlap'
);
select is(
  (select ended_at from time_entries where id = 'd2000000-0000-0000-0000-000000000007'),
  (select ws from w) + interval '7 hours',
  'a refused edit changes nothing'
);

-- Case 9: the window boundary is inclusive, and an entry that touches it is fine.
select lives_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000008',
       (select ws from w), (select ws from w) + interval '40 minutes') $$,
  'a start exactly at the window start is allowed'
);
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000008',
       (select ws from w) - interval '1 microsecond', (select ws from w) + interval '40 minutes') $$,
  'P0001', 'outside_window',
  'a start one microsecond before the window start is refused'
);

-- Case 10: the window does not depend on the session time zone.
set local timezone to 'Asia/Tokyo';
select throws_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004',
       (select ws from w) - interval '90 minutes', (select ws from w) - interval '1 hour') $$,
  'P0001', 'outside_window',
  'the window refusal is the same under a non-UTC session time zone'
);
select lives_ok(
  $$ select * from correct_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000008',
       (select ws from w), (select ws from w) + interval '30 minutes') $$,
  'a start at the window start is allowed under a non-UTC session time zone'
);
reset timezone;

-- Case 11: delete.
select is(
  (select delete_time_entry(
     'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000007')),
  'd2000000-0000-0000-0000-000000000007'::uuid,
  'delete_time_entry returns the deleted id'
);
select is(
  (select count(*) from time_entries where id = 'd2000000-0000-0000-0000-000000000007'),
  0::bigint,
  'the deleted entry is gone'
);
select throws_ok(
  $$ select delete_time_entry(
       'd0000000-0000-0000-0000-000000000002', 'd2000000-0000-0000-0000-000000000001') $$,
  'P0001', 'entry_not_found',
  'deleting with a foreign link gets entry_not_found'
);
select is(
  (select count(*) from time_entries where id = 'd2000000-0000-0000-0000-000000000001'),
  1::bigint,
  'the foreign entry survives'
);
select throws_ok(
  $$ select delete_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000003') $$,
  'P0001', 'entry_running',
  'deleting the running entry gets entry_running'
);
select throws_ok(
  $$ select delete_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000004') $$,
  'P0001', 'outside_window',
  'deleting an entry from before the window gets outside_window'
);
select throws_ok(
  $$ select delete_time_entry(
       'd0000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000005') $$,
  'P0001', 'entry_not_found',
  'deleting a foreign running entry gets entry_not_found'
);

-- Case 12: only the service role may execute either function.
select is(
  has_function_privilege('anon', 'correct_time_entry(uuid, uuid, timestamptz, timestamptz)', 'execute'),
  false, 'anon cannot execute correct_time_entry'
);
select is(
  has_function_privilege('authenticated', 'correct_time_entry(uuid, uuid, timestamptz, timestamptz)', 'execute'),
  false, 'authenticated cannot execute correct_time_entry'
);
select is(
  has_function_privilege('service_role', 'correct_time_entry(uuid, uuid, timestamptz, timestamptz)', 'execute'),
  true, 'service_role can execute correct_time_entry'
);
select is(
  has_function_privilege('anon', 'delete_time_entry(uuid, uuid)', 'execute'),
  false, 'anon cannot execute delete_time_entry'
);
select is(
  has_function_privilege('authenticated', 'delete_time_entry(uuid, uuid)', 'execute'),
  false, 'authenticated cannot execute delete_time_entry'
);
select is(
  has_function_privilege('service_role', 'delete_time_entry(uuid, uuid)', 'execute'),
  true, 'service_role can execute delete_time_entry'
);

select * from finish();
rollback;
