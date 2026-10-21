-- task-17-15: "System prüfen". Only admin files a request (manager 42501), at most one at a time (RW422) unless the
-- service did not finish it within 10 minutes; only service_role picks it up and finishes it. New source "system".
-- Run with: supabase test db
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000015a1', 'admin15@x.test'),
  ('00000000-0000-0000-0000-0000000015a2', 'manager15@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000015a1', 'Admin 15', 'admin'),
  ('00000000-0000-0000-0000-0000000015a2', 'Manager 15', 'manager');
update public.system_status set check_requested_at = null, check_requested_by = null, check_started_at = null;

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000015' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

set local role authenticated;
select pg_temp.as_user('a2');
select throws_ok($$select public.request_system_check()$$, '42501', null, 'manager cannot request a check');
select throws_ok($$select public.claim_system_check()$$, '42501', null, 'staff cannot claim');
select throws_ok($$select public.finish_system_check()$$, '42501', null, 'staff cannot finish');
select pg_temp.as_user('a1');
select is((public.request_system_check()).check_requested_by, '00000000-0000-0000-0000-0000000015a1'::uuid, 'admin files a request');
select throws_ok($$select public.request_system_check()$$, 'RW422', null, 'second request while one waits');
select pg_temp.as_user('a2');
select ok((select check_requested_at is not null from public.system_status), 'manager reads the pending request');
reset role;

select pg_temp.as_service();
set local role service_role;
select is(public.claim_system_check(), true, 'service picks the request up');
select is(public.claim_system_check(), false, 'nothing more to pick up');
select ok((select check_started_at is not null from public.system_status), 'request marked as running');
select is((public.finish_system_check()).check_requested_at, null, 'finished request is cleared');
reset role;

-- A request the service never finished may be filed again after 10 minutes
update public.system_status set check_requested_at = now() - interval '11 minutes', check_started_at = now() - interval '11 minutes';
set local role authenticated;
select pg_temp.as_user('a1');
select ok((public.request_system_check()).check_started_at is null, 'stale request replaced');
reset role;

select pg_temp.as_service();
set local role service_role;
select ok((public.raise_alert('system', 'system:speicher-test', 'warning', 'Wenig Speicherplatz') ->> 'alert_id') is not null, 'source system accepted');
reset role;
select throws_ok($$insert into public.system_alerts (source, alert_key, severity, title) values ('rechner', 'x', 'warning', 'x')$$, '23514', null, 'unknown source rejected');

select * from finish();
rollback;
