begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- Oracle: PRD FR-010 -- a person can permanently delete all of their own data
-- (every project and logged time entry) and their private link; FR-007 -- that
-- frees a slot in the 10-person cap. Nobody else's data may change.

-- Two people: the one who deletes, and a bystander whose data must survive.
select create_link('da-owner');
select create_link('da-bystander');

-- Each person gets a project, a closed entry, an open entry and access-log rows.
insert into projects (id, link_id, name)
  select gen_random_uuid(), id, 'Acme Widgets' from links where token_hash in ('da-owner', 'da-bystander');

insert into time_entries (link_id, project_id, project_name, started_at, ended_at)
  select l.id, p.id, p.name, now() - interval '3 hours', now() - interval '2 hours'
    from links l join projects p on p.link_id = l.id
   where l.token_hash in ('da-owner', 'da-bystander');
insert into time_entries (link_id, project_id, project_name, started_at)
  select l.id, p.id, p.name, now() - interval '1 hour'
    from links l join projects p on p.link_id = l.id
   where l.token_hash in ('da-owner', 'da-bystander');

insert into access_log (link_id, outcome, ip, user_agent)
  select id, 'success', '203.0.113.7', 'da-agent' from links where token_hash = 'da-owner';
insert into access_log (link_id, outcome, ip, user_agent)
  select id, 'not_found', '203.0.113.7', 'da-agent' from links where token_hash = 'da-owner';
insert into access_log (link_id, outcome, ip, user_agent)
  select id, 'success', '203.0.113.8', 'da-agent' from links where token_hash = 'da-bystander';
-- A miss has no link to reference (link_id is null); it belongs to nobody.
insert into access_log (link_id, outcome, ip, user_agent) values (null, 'not_found', '203.0.113.9', 'da-null');

-- Captured before the call: the owner's id no longer resolves afterwards, and
-- a correlated subquery in the same statement would not see the deletion.
create temporary table t_ids as
  select
    (select id from links where token_hash = 'da-owner') as owner_id,
    (select id from links where token_hash = 'da-bystander') as bystander_id;

select is(
  delete_account((select owner_id from t_ids)),
  true,
  'deleting an existing person returns true'
);

select is(
  (select count(*) from links where id = (select owner_id from t_ids)),
  0::bigint,
  'the deleted person''s link is gone'
);
select is(
  (select count(*) from projects where link_id = (select owner_id from t_ids)),
  0::bigint,
  'the deleted person''s projects are gone'
);
select is(
  (select count(*) from time_entries where link_id = (select owner_id from t_ids)),
  0::bigint,
  'the deleted person''s time entries are gone, open and closed'
);
select is(
  (select count(*) from access_log where link_id = (select owner_id from t_ids)),
  0::bigint,
  'the deleted person''s access-log rows (IP and user agent) are gone'
);

select is(
  (select count(*) from links where id = (select bystander_id from t_ids)),
  1::bigint,
  'the bystander''s link is untouched'
);
select is(
  (select count(*) from projects where link_id = (select bystander_id from t_ids)),
  1::bigint,
  'the bystander''s project is untouched'
);
select is(
  (select count(*) from time_entries where link_id = (select bystander_id from t_ids)),
  2::bigint,
  'the bystander''s time entries are untouched'
);
select is(
  (select count(*) from access_log where link_id = (select bystander_id from t_ids)),
  1::bigint,
  'the bystander''s access-log row is untouched'
);
select is(
  (select count(*) from access_log where link_id is null and user_agent = 'da-null'),
  1::bigint,
  'an access-log row that belongs to nobody (null link id) is untouched'
);

select is(
  delete_account((select owner_id from t_ids)),
  false,
  'deleting the same person again returns false and changes nothing'
);
select is(
  delete_account(gen_random_uuid()),
  false,
  'deleting an unknown id returns false'
);

-- Freed slot (FR-007 / FR-010): at ten people creation is refused; deleting
-- one person makes room for a new one.
select create_link('da-fill-' || g) from generate_series(1, 9) as g;

select is(
  (select count(*) from links),
  10::bigint,
  'the bystander plus nine more people fill the cap'
);
select is(
  create_link('da-over-cap'),
  null,
  'creating an eleventh person is refused while the cap is full'
);

select is(
  delete_account((select id from links where token_hash = 'da-fill-1')),
  true,
  'deleting one of the ten people succeeds'
);
select isnt(
  create_link('da-new-person'),
  null,
  'a slot is free again after the deletion, so a new person can be created'
);

select is(
  has_function_privilege('anon', 'public.delete_account(uuid)', 'execute'),
  false,
  'anon cannot execute delete_account'
);
select is(
  has_function_privilege('authenticated', 'public.delete_account(uuid)', 'execute'),
  false,
  'authenticated cannot execute delete_account'
);
select is(
  has_function_privilege('service_role', 'public.delete_account(uuid)', 'execute'),
  true,
  'service_role can execute delete_account'
);

select * from finish();

rollback;
