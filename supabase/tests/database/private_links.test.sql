begin;

create extension if not exists pgtap with schema extensions;

select plan(10);

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
insert into time_entries (link_id, project, started_at)
  select id, 'p', now() from links limit 1;
insert into access_log (link_id, outcome) select id, 'success' from links limit 1;
insert into job_runs (job_name, started_at, status) values ('purge', now(), 'success');

set local role anon;

select is(
  (select count(*) from links)
    + (select count(*) from access_log)
    + (select count(*) from time_entries)
    + (select count(*) from job_runs),
  0::bigint,
  'anon sees zero rows from links, access_log, time_entries, job_runs even when rows exist'
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

select * from finish();

rollback;
