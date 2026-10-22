-- task-18-6: backups in the area "System". Admin and manager read the list, dispatcher not; only admin files
-- "Jetzt sichern" (manager 42501), at most one at a time (RW422) unless the service did not finish it within
-- 30 minutes; only service_role picks it up, finishes it and records backups.
-- Run with: supabase test db
begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000018b1', 'admin18@x.test'),
  ('00000000-0000-0000-0000-0000000018b2', 'manager18@x.test'),
  ('00000000-0000-0000-0000-0000000018b3', 'dispo18@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000018b1', 'Admin 18', 'admin'),
  ('00000000-0000-0000-0000-0000000018b2', 'Manager 18', 'manager'),
  ('00000000-0000-0000-0000-0000000018b3', 'Dispo 18', 'dispatcher');
update public.system_status set backup_requested_at = null, backup_requested_by = null, backup_started_at = null;

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000018' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

set local role authenticated;
select pg_temp.as_user('b2');
select throws_ok($$select public.request_backup()$$, '42501', null, 'manager cannot request a backup');
select throws_ok($$select public.claim_backup_request()$$, '42501', null, 'staff cannot claim');
select throws_ok($$select public.finish_backup_request()$$, '42501', null, 'staff cannot finish');
select throws_ok($$select public.record_backup('manual', 'ok', now(), 'x', 1, '{}', true, null)$$, '42501', null, 'staff cannot record');
select throws_ok($$insert into public.backups (started_at, reason, status) values (now(), 'manual', 'ok')$$, '42501', null, 'no direct writes');
select pg_temp.as_user('b1');
select is((public.request_backup()).backup_requested_by, '00000000-0000-0000-0000-0000000018b1'::uuid, 'admin files a request');
select throws_ok($$select public.request_backup()$$, 'RW422', null, 'second request while one waits');
reset role;

select pg_temp.as_service();
set local role service_role;
select is(public.claim_backup_request(), '00000000-0000-0000-0000-0000000018b1'::uuid, 'service picks the request up with the requester');
select is(public.claim_backup_request(), null, 'nothing more to pick up');
select is((public.record_backup('manual', 'ok', now() - interval '1 minute', 'rheinwerk-x.tar.gz.enc', 1024,
  '{"public.requests": 3}', true, null, '00000000-0000-0000-0000-0000000018b1')).requested_by,
  '00000000-0000-0000-0000-0000000018b1'::uuid, 'service records the backup');
select is((public.finish_backup_request()).backup_requested_at, null, 'finished request is cleared');
select throws_ok($$select public.record_backup('daily', 'failed', now(), null, null, '{}', false, null)$$, '23514', null, 'failed backup needs an error');
select throws_ok($$select public.record_backup('weekly', 'ok', now(), null, null, '{}', true, null)$$, '23514', null, 'unknown reason rejected');
reset role;

set local role authenticated;
select pg_temp.as_user('b2');
select is((select count(*) from public.backups where file_name = 'rheinwerk-x.tar.gz.enc')::int, 1, 'manager reads the list');
select pg_temp.as_user('b3');
select is((select count(*) from public.backups)::int, 0, 'dispatcher reads nothing');
reset role;

-- A request the service never finished may be filed again after 30 minutes
update public.system_status set backup_requested_at = now() - interval '31 minutes', backup_started_at = now() - interval '31 minutes';
set local role authenticated;
select pg_temp.as_user('b1');
select ok((public.request_backup()).backup_started_at is null, 'stale request replaced');
reset role;

-- Rows older than 90 days are removed with the next record
insert into public.backups (started_at, finished_at, reason, status, verified) values (now() - interval '100 days', now() - interval '100 days', 'daily', 'ok', true);
select pg_temp.as_service();
set local role service_role;
select public.record_backup('daily', 'ok', now(), 'rheinwerk-y.tar.gz.enc', 2048, '{}', true, null);
reset role;
select is((select count(*) from public.backups where finished_at < now() - interval '90 days')::int, 0, 'old rows removed');

select * from finish();
rollback;
