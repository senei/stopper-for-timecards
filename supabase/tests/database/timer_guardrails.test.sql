begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixed link ids, distinct from every other test file's a0000000-… range
-- (projects_and_timer.test.sql's …001, switch_timer.test.sql's …004/…005,
-- stop_timer.test.sql's …006/…007): this file uses a new b0000000-… prefix
-- so later throws_ok/is literals don't need interpolation and can't collide
-- if tests ever run in the same session. One link per case keeps setup
-- order-independent, matching switch_timer.test.sql/stop_timer.test.sql.
-- …0001-…0003 are Phase 1's cases; …0004/…0005 are Phase 2's canonicalization
-- and Unicode-snapshot cases.
insert into links (id, token_hash) values
  ('b0000000-0000-0000-0000-000000000001', 'timer-guardrails-test-hash-1'),
  ('b0000000-0000-0000-0000-000000000002', 'timer-guardrails-test-hash-2'),
  ('b0000000-0000-0000-0000-000000000003', 'timer-guardrails-test-hash-3'),
  ('b0000000-0000-0000-0000-000000000004', 'timer-guardrails-test-hash-4'),
  ('b0000000-0000-0000-0000-000000000005', 'timer-guardrails-test-hash-5');

-- Case 1: segment-boundary chaining. start -> switch -> switch -> stop on one
-- link must write the identical timestamp for each closed segment's ended_at
-- and the next segment's started_at (switch_timer's close-then-open pair is
-- atomic within one now()-scoped transaction), leave no segment dropped or
-- dangling, and attribute the final segment to the final project.
create temporary table start1 as
  select * from start_timer('b0000000-0000-0000-0000-000000000001', 'Project A');

create temporary table switch1 as
  select * from switch_timer('b0000000-0000-0000-0000-000000000001', 'Project B');

create temporary table switch2 as
  select * from switch_timer('b0000000-0000-0000-0000-000000000001', 'Project C');

create temporary table stop1 as
  select * from stop_timer('b0000000-0000-0000-0000-000000000001');

select is(
  (select ended_at from time_entries where id = (select entry_id from start1)),
  (select started_at from switch1),
  'segment 1 ends at the exact instant segment 2 starts'
);
select is(
  (select ended_at from time_entries where id = (select entry_id from switch1)),
  (select started_at from switch2),
  'segment 2 ends at the exact instant segment 3 starts'
);
select is(
  (select ended_at from time_entries where id = (select entry_id from switch2)) is not null,
  true,
  'segment 3 is closed after the final stop_timer call'
);
select is(
  (select count(*) from time_entries where link_id = 'b0000000-0000-0000-0000-000000000001'),
  3::bigint,
  'exactly three segments exist for the link after the full chain'
);
select is(
  (select count(*) from time_entries
     where link_id = 'b0000000-0000-0000-0000-000000000001' and ended_at is null),
  0::bigint,
  'no segment is left open after the chain stops'
);
select is(
  (select te.project_id from time_entries te where te.id = (select entry_id from switch2)),
  (select project_id from switch2),
  'segment 3''s persisted project_id matches the project_id switch_timer returned for it'
);
select isnt(
  (select project_id from switch2),
  (select project_id from start1),
  'segment 3 is attributed to a different project than segment 1'
);
select isnt(
  (select project_id from switch2),
  (select project_id from switch1),
  'segment 3 is attributed to a different project than segment 2'
);

-- Case 2: time_entries' open-row index is the actual backstop. switch_timer
-- and stop_timer both raise P0001 from an app-level lookup before any write
-- that could violate time_entries_link_id_open_idx, so a direct insert that
-- bypasses all three RPC functions is the only way to prove the index itself
-- rejects a second open row for the same link.
create temporary table start2 as
  select * from start_timer('b0000000-0000-0000-0000-000000000002', 'Acme');

select throws_ok(
  $$
    insert into time_entries (link_id, project_id, project_name, type, work_type, started_at)
    select link_id, project_id, project_name, type, work_type, now()
    from time_entries
    where link_id = 'b0000000-0000-0000-0000-000000000002' and ended_at is null
  $$,
  '23505',
  null,
  'a direct insert of a second open time_entries row for the same link is rejected'
);
select is(
  (select count(*) from time_entries
     where link_id = 'b0000000-0000-0000-0000-000000000002' and ended_at is null),
  1::bigint,
  'the rejected direct insert leaves the link with exactly one open entry'
);

-- Case 3: projects' case-insensitive index is the actual backstop.
-- start_timer/switch_timer never attempt a duplicate insert in normal
-- operation (they select first and only insert on a genuine miss), so a
-- direct insert that bypasses the RPC's find-or-create logic is the only way
-- to prove the index itself rejects a case-colliding duplicate name.
create temporary table start3 as
  select * from start_timer('b0000000-0000-0000-0000-000000000003', 'Acme');

select throws_ok(
  $$ insert into projects (link_id, name) values ('b0000000-0000-0000-0000-000000000003', 'ACME') $$,
  '23505',
  null,
  'a direct insert of a case-colliding project name for the same link is rejected'
);
select is(
  (select count(*) from projects where link_id = 'b0000000-0000-0000-0000-000000000003'),
  1::bigint,
  'the rejected direct insert leaves the link with exactly one projects row'
);

-- Case 4: casing-canonicalization contract. Reusing an existing project
-- under different casing must resolve to (and keep) the project's original,
-- first-seen casing — lower(trim()) drives the lookup, but only trim()
-- drives the insert, so the stored name never gets overwritten by a later
-- differently-cased retype. This documents that behavior explicitly instead
-- of leaving it an unasserted accident.
create temporary table start4 as
  select * from start_timer('b0000000-0000-0000-0000-000000000004', 'Acme');

create temporary table switch4 as
  select * from switch_timer('b0000000-0000-0000-0000-000000000004', 'ACME');

select is(
  (select project_name from switch4),
  'Acme',
  'switch_timer returns the project''s original first-seen casing (Acme), not the newly-typed casing (ACME)'
);
select is(
  (select name from projects where id = (select project_id from start4)),
  'Acme',
  'the stored projects.name is unchanged at the original casing (Acme) after the case-varied reuse'
);

-- Case 5: non-ASCII case-fold snapshot. Pins today's collation-dependent
-- lower() behavior for one accented example, so a future collation/locale
-- change would be caught. This documents current behavior for this one
-- example, not a correctness claim about every script.
create temporary table start5a as
  select * from start_timer('b0000000-0000-0000-0000-000000000005', 'Café');

select * from stop_timer('b0000000-0000-0000-0000-000000000005');

create temporary table start5b as
  select * from start_timer('b0000000-0000-0000-0000-000000000005', 'CAFÉ');

select is(
  (select project_id from start5b),
  (select project_id from start5a),
  'reusing an accented name under different casing resolves via server-side lower() (documents current collation behavior)'
);
select is(
  (select count(*) from projects where link_id = 'b0000000-0000-0000-0000-000000000005'),
  1::bigint,
  'reusing the accented name creates no duplicate projects row (documents current collation behavior)'
);

select * from finish();

rollback;
