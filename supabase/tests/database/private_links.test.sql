begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Cap boundary: nine links, then the 10th succeeds and the 11th returns null.
select create_link('hash-' || g) from generate_series(1, 9) g;

select isnt(create_link('hash-10'), null, '10th link is created');
select is(create_link('hash-11'), null, '11th create_link returns null');
select is((select count(*) from links), 10::bigint, 'cap leaves exactly 10 links');

select throws_ok(
  $$ insert into links (token_hash) values ('hash-1') $$,
  '23505',
  null,
  'duplicate token_hash is rejected'
);

select is(
  has_function_privilege('anon', 'public.create_link(text)', 'execute'),
  false,
  'anon cannot execute create_link'
);
select is(
  has_function_privilege('authenticated', 'public.create_link(text)', 'execute'),
  false,
  'authenticated cannot execute create_link'
);
select is(
  has_function_privilege('service_role', 'public.create_link(text)', 'execute'),
  true,
  'service_role can execute create_link'
);

-- Rows exist in every table, then anon must see none of them.
insert into projects (id, link_id, name)
  select gen_random_uuid(), id, 'p' from links limit 1;
insert into time_entries (link_id, project_id, project_name, started_at)
  select p.link_id, p.id, p.name, now() from projects p limit 1;
insert into access_log (link_id, outcome) select id, 'success' from links limit 1;
insert into job_runs (job_name, started_at, status) values ('purge', now(), 'success');

set local role anon;

select is(
  (select count(*) from links)
    + (select count(*) from access_log)
    + (select count(*) from time_entries)
    + (select count(*) from job_runs)
    + (select count(*) from projects),
  0::bigint,
  'anon sees zero rows from links, access_log, time_entries, job_runs, projects even when rows exist'
);

reset role;

select lives_ok(
  $$ insert into access_log (link_id, outcome) values (null, 'not_found') $$,
  'access_log accepts a null link_id'
);

select is(
  (select count(*) from access_log where link_id is null),
  1::bigint,
  'null link_id row is stored'
);

select throws_ok(
  $$ insert into access_log (link_id, outcome) values ('00000000-0000-0000-0000-000000000000', 'success') $$,
  '23503',
  null,
  'access_log rejects a link_id that does not exist in links'
);

select lives_ok(
  $$ insert into access_log (link_id, outcome) select id, 'success' from links limit 1 $$,
  'access_log still accepts a link_id that does exist in links'
);

select * from finish();

rollback;
