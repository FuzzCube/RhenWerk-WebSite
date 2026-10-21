-- task-17-9: watchdog results in system_status.monitoring and overdue call analyses. Only service_role writes and
-- asks; manager and admin read through the policy of system_status.
-- Run with: supabase test db
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000019a1', 'admin19@x.test'),
  ('00000000-0000-0000-0000-0000000019a2', 'manager19@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000019a1', 'Admin 19', 'admin'),
  ('00000000-0000-0000-0000-0000000019a2', 'Manager 19', 'manager');

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000019' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;

-- Calls: overdue (40 minutes, not analysed), recent, analysed, demo, older than 7 days
insert into public.phone_calls (conversation_id, started_at, ended_at, analyzed_at, is_demo) values
  ('conv_mon_overdue', now() - interval '45 minutes', now() - interval '40 minutes', null, false),
  ('conv_mon_recent', now() - interval '12 minutes', now() - interval '10 minutes', null, false),
  ('conv_mon_done', now() - interval '2 hours', now() - interval '2 hours', now(), false),
  ('conv_mon_demo', now() - interval '2 hours', now() - interval '2 hours', null, true),
  ('conv_mon_old', now() - interval '8 days', now() - interval '8 days', null, false);

select pg_temp.as_service();
set local role service_role;
select is((public.monitor_call_analysis() ->> 'stale')::int,
  (select count(*)::int from public.phone_calls where analyzed_at is null and not is_demo
     and coalesce(ended_at, started_at) < now() - interval '30 minutes' and coalesce(ended_at, started_at) > now() - interval '7 days'),
  'overdue analyses counted like the rule');
select ok((public.monitor_call_analysis() ->> 'stale')::int >= 1, 'the overdue call is among them');
select ok((select (public.monitor_call_analysis() ->> 'oldest')::timestamptz <= now() - interval '40 minutes'), 'oldest overdue call reported');
select is((public.set_monitoring('mira', '{"state":"ok"}'::jsonb)).monitoring -> 'mira' ->> 'state', 'ok', 'entry stored');
select ok((select (monitoring -> 'mira' ->> 'checked_at')::timestamptz > now() - interval '1 minute' from public.system_status), 'checked_at set by the database');
select public.set_monitoring('n8n', '{"state":"warning"}'::jsonb);
select is((select monitoring -> 'mira' ->> 'state' from public.system_status), 'ok', 'other systems stay');
select throws_ok($$select public.set_monitoring('Mira!', '{}'::jsonb)$$, 'RW422', null, 'invalid key');
select throws_ok($$select public.set_monitoring('mira', '[]'::jsonb)$$, 'RW422', null, 'payload must be an object');
reset role;

set local role authenticated;
select pg_temp.as_user('a2');
select is((select monitoring -> 'n8n' ->> 'state' from public.system_status), 'warning', 'manager reads the monitoring');
select throws_ok($$select public.set_monitoring('mira', '{}'::jsonb)$$, '42501', null, 'staff cannot write');
select throws_ok($$select public.monitor_call_analysis()$$, '42501', null, 'staff cannot ask');
reset role;

select * from finish();
rollback;
