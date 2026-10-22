-- task-18-8: system updates of the images on the VPS. Only admin files "Update einspielen" (manager 42501, dispatcher
-- reads nothing), at most one at a time and not while a restore waits (RW422) unless the service did not finish it
-- within an hour; only service_role picks it up and finishes it. A restore cannot be requested while an update waits.
-- Run with: supabase test db
begin;
select plan(15);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000018d1', 'admin188@x.test'),
  ('00000000-0000-0000-0000-0000000018d2', 'manager188@x.test'),
  ('00000000-0000-0000-0000-0000000018d3', 'dispo188@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000018d1', 'Admin 188', 'admin'),
  ('00000000-0000-0000-0000-0000000018d2', 'Manager 188', 'manager'),
  ('00000000-0000-0000-0000-0000000018d3', 'Dispo 188', 'dispatcher');
delete from public.image_updates;
delete from public.restores;
insert into public.backups (started_at, reason, status, file_name, verified, contents)
select now(), 'pre_update', 'ok', 'rheinwerk-u.tar.gz.enc', true, jsonb_build_object('migration', max(version)) from supabase_migrations.schema_migrations;

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000018' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

set local role authenticated;
select pg_temp.as_user('d2');
select throws_ok($$select public.request_image_update()$$, '42501', null, 'manager cannot request an update');
select throws_ok($$select public.claim_image_update()$$, '42501', null, 'staff cannot claim');
select throws_ok($$select public.finish_image_update(gen_random_uuid(), 'ok', '[]', null, null)$$, '42501', null, 'staff cannot finish');
select throws_ok($$insert into public.image_updates (requested_by) values (null)$$, '42501', null, 'no direct writes');
select pg_temp.as_user('d1');
select is((public.request_image_update()).requested_by, '00000000-0000-0000-0000-0000000018d1'::uuid, 'admin files a request');
select throws_ok($$select public.request_image_update()$$, 'RW422', null, 'second request while one waits');
select throws_ok($$select public.request_restore((select id from public.backups where file_name = 'rheinwerk-u.tar.gz.enc'), 'WIEDERHERSTELLEN')$$,
  'RW422', null, 'no restore while an update waits');
reset role;

select pg_temp.as_service();
set local role service_role;
select is((public.claim_image_update()).status, 'running', 'service picks the request up');
select is((public.claim_image_update()).id, null, 'nothing more to pick up');
select throws_ok($$select public.finish_image_update((select id from public.image_updates limit 1), 'rolled_back', '[]', null, null)$$, '23514', null, 'rollback needs an error');
select is((public.finish_image_update((select id from public.image_updates limit 1), 'ok',
  '[{"service": "n8n", "from": "2.40.7", "to": "2.44.4"}]', 'rheinwerk-u.tar.gz.enc', null)).changes -> 0 ->> 'to', '2.44.4', 'service finishes the update');
reset role;

set local role authenticated;
select pg_temp.as_user('d2');
select is((select count(*) from public.image_updates)::int, 1, 'manager reads the history');
select pg_temp.as_user('d3');
select is((select count(*) from public.image_updates)::int, 0, 'dispatcher reads nothing');
select pg_temp.as_user('d1');
select is((public.request_restore((select id from public.backups where file_name = 'rheinwerk-u.tar.gz.enc'), 'WIEDERHERSTELLEN')).status, 'requested', 'backup before an update can be restored');
select throws_ok($$select public.request_image_update()$$, 'RW422', null, 'no update while a restore waits');
reset role;

select * from finish();
rollback;
