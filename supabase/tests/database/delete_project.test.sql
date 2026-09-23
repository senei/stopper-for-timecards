begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixed link ids, distinct from projects_and_timer.test.sql's, so later
-- throws_ok/is literals don't need interpolation and can't collide if tests
-- ever run in the same session.
insert into links (id, token_hash) values
  ('a0000000-0000-0000-0000-000000000002', 'delete-project-test-hash'),
  ('a0000000-0000-0000-0000-000000000003', 'delete-project-test-hash-2');

-- Case 1: a directly-inserted project with zero time_entries rows deletes
-- cleanly (this feature's delete is a plain scoped DELETE, not a function).
insert into projects (id, link_id, name) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'Unused Project');

select lives_ok(
  $$ delete from projects where id = 'b0000000-0000-0000-0000-000000000001' and link_id = 'a0000000-0000-0000-0000-000000000002' $$,
  'deleting an unused project succeeds'
);
select is(
  (select count(*) from projects where id = 'b0000000-0000-0000-0000-000000000001'),
  0::bigint,
  'the deleted project row is gone'
);

-- Case 2: a project with an open time_entries row is protected.
create temporary table call1 as
  select * from start_timer('a0000000-0000-0000-0000-000000000002', 'Open Timer Project');

select throws_ok(
  $$ delete from projects where id = (select project_id from call1) and link_id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23503',
  null,
  'deleting a project with an open time_entries row is rejected'
);
select is(
  (select count(*) from projects where id = (select project_id from call1)),
  1::bigint,
  'the project with an open entry still exists after the rejected delete'
);

-- Case 3: a project with only closed (ended_at set) time_entries rows is
-- still protected — the FK doesn't care whether the entry is open or closed.
update time_entries set ended_at = now()
  where project_id = (select project_id from call1);

select throws_ok(
  $$ delete from projects where id = (select project_id from call1) and link_id = 'a0000000-0000-0000-0000-000000000002' $$,
  '23503',
  null,
  'deleting a project with a closed time_entries row is also rejected'
);
select is(
  (select count(*) from projects where id = (select project_id from call1)),
  1::bigint,
  'the project with a closed entry still exists after the rejected delete'
);

-- Case 4: ownership scoping. The real project belongs to link 2; a delete
-- scoped to link 3's id (a different, real link) must affect zero rows
-- rather than deleting across links.
insert into projects (id, link_id, name) values
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Another Unused Project');

with deleted as (
  delete from projects
    where id = 'b0000000-0000-0000-0000-000000000002' and link_id = 'a0000000-0000-0000-0000-000000000003'
    returning id
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'a delete scoped to a different link''s id removes zero rows'
);
select is(
  (select count(*) from projects where id = 'b0000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the project scoped to the wrong link still exists'
);

-- RLS: only service_role can actually delete a row from projects.
-- projects_and_timer.test.sql already proves the analogous SELECT case (anon/
-- authenticated see zero rows). The same must hold for DELETE, but
-- has_table_privilege is the wrong tool to prove it: anon/authenticated hold
-- the table-level DELETE grant by default in this project, same as SELECT —
-- RLS-with-no-policies is what makes the delete affect zero rows, not a
-- missing grant. So this proves the actual behavior (zero rows affected, row
-- survives), the same way the SELECT case is proven by observed row count.
set local role anon;
with deleted as (
  delete from projects where id = 'b0000000-0000-0000-0000-000000000002' returning id
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'anon''s delete affects zero rows despite a matching row existing'
);
reset role;

set local role authenticated;
with deleted as (
  delete from projects where id = 'b0000000-0000-0000-0000-000000000002' returning id
)
select is(
  (select count(*) from deleted),
  0::bigint,
  'authenticated''s delete affects zero rows despite a matching row existing'
);
reset role;

select is(
  (select count(*) from projects where id = 'b0000000-0000-0000-0000-000000000002'),
  1::bigint,
  'the project survives both blocked delete attempts'
);

select lives_ok(
  $$ delete from projects where id = 'b0000000-0000-0000-0000-000000000002' $$,
  'service_role can actually delete the row'
);

select * from finish();

rollback;
