-- task-13-7: figures of the phone assistant (analytics_phone, analytics_phone_categories, analytics_phone_days).
-- Calls in March 2030 (period up to 20 March) and February 2030 (previous period), away from demo data.
-- Run with: supabase test db
begin;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000fd0a1', 'pd-m@x.test'), ('00000000-0000-0000-0000-0000000fd0d1', 'pd-d@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000fd0a1', 'Leitung Telefon', 'manager'),
  ('00000000-0000-0000-0000-0000000fd0d1', 'Dispo Telefon', 'dispatcher');

-- Request created by the assistant in call pd-1, another request only named in call pd-2
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, created_at)
values
  ('00000000-0000-0000-0000-0000000fd001', 'phone_agent:pd-1', 'phone_agent', 'Telefon GmbH', 'Max', 'm@x.test', '0621 1', 'Weg 1', '68159', 'Mannheim',
   'pump', 'diagnosis_repair', date '2030-03-10', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000fd0d1', '2030-03-05 09:05+01'),
  ('00000000-0000-0000-0000-0000000fd002', 'pd-web', 'website_form', 'Web GmbH', 'Max', 'w@x.test', '0621 2', 'Weg 2', '68159', 'Mannheim',
   'pump', 'diagnosis_repair', date '2030-03-10', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000fd0d1', '2030-02-01 09:00+01');

insert into public.phone_calls (conversation_id, started_at, ended_at, duration_seconds, in_service_hours, category, callback_needed,
  callback_urgent, callback_done_at, callback_done_by, request_id, cost_cents, credits, analyzed_at) values
  ('pd-1', '2030-03-05 09:00+01', '2030-03-05 09:05+01', 300, true, 'neue_anfrage', false, false, null, null, '00000000-0000-0000-0000-0000000fd001', 9, 2400, '2030-03-05 09:07+01'),
  ('pd-2', '2030-03-05 19:00+01', '2030-03-05 19:01+01', 60, false, 'status', false, false, null, null, '00000000-0000-0000-0000-0000000fd002', 1, 480, '2030-03-05 19:03+01'),
  ('pd-3', '2030-03-06 10:00+01', '2030-03-06 10:02+01', 120, true, 'notfall', true, true, '2030-03-06 10:20+01', '00000000-0000-0000-0000-0000000fd0d1', null, 3, 960, '2030-03-06 10:04+01'),
  ('pd-4', '2030-03-07 11:00+01', '2030-03-07 11:01+01', 90, true, 'beschwerde', true, false, null, null, null, 2, 720, '2030-03-07 11:03+01'),
  -- not evaluated: does not count
  ('pd-5', '2030-03-07 12:00+01', null, null, true, null, false, false, null, null, null, null, null, null),
  -- after the cutoff of the running period (20 March): does not count
  ('pd-6', '2030-03-25 12:00+01', '2030-03-25 12:01+01', 60, true, 'frage', false, false, null, null, null, 1, 480, '2030-03-25 12:03+01'),
  -- previous period
  ('pd-7', '2030-02-10 12:00+01', '2030-02-10 12:02+01', 120, true, 'frage', false, false, null, null, null, 2, 960, '2030-02-10 12:03+01');

-- Rights: manager and admin only (like the other figures)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000fd0d1', 'role', 'authenticated')::text, true);
select throws_ok($$select * from public.analytics_phone('month', '2030-03-01', '2030-03-20 12:00+01')$$, '42501', null, 'dispatcher has no figures');
select throws_ok($$select * from public.analytics_phone_days('2030-03-01', '2030-03-20')$$, '42501', null, 'dispatcher has no daily figures');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000fd0a1', 'role', 'authenticated')::text, true);
create temporary table f on commit drop as select * from public.analytics_phone('month', '2030-03-01', '2030-03-20 12:00+01');
select is((select calls from f where period = 'current'), 4, 'evaluated calls in the period');
select is((select resolved from f where period = 'current'), 2, 'calls without callback');
select is((select requests from f where period = 'current'), 1, 'only the request created in the call counts');
select is((select outside_hours from f where period = 'current'), 1, 'outside service hours');
select is((select emergencies from f where period = 'current'), 1, 'emergencies');
select is((select callbacks from f where period = 'current'), 2, 'callbacks');
select is((select callbacks_open from f where period = 'current'), 1, 'open callbacks');
select is((select total_seconds from f where period = 'current'), 570, 'total duration');
select is((select avg_seconds from f where period = 'current'), 143, 'average duration (rounded)');
select is((select cost_cents || '/' || credits from f where period = 'current'), '15/4560', 'cost and credits');
select is((select calls from f where period = 'previous'), 1, 'previous period');

select is((select array_agg(category || ':' || calls order by category) from public.analytics_phone_categories('month', '2030-03-01', '2030-03-20 12:00+01')),
  array['beschwerde:1', 'neue_anfrage:1', 'notfall:1', 'status:1'], 'calls per category');
select is((select calls || '/' || resolved || '/' || requests from public.analytics_phone_days('2030-03-01', '2030-03-20') where day = '2030-03-05'),
  '2/2/1', 'calls per local day');
select is((select count(*)::int from public.analytics_phone_days('2030-03-01', '2030-03-20')), 20, 'one row per day');
select throws_ok($$select * from public.analytics_phone_days('2030-03-20', '2030-03-01')$$, 'RW422', null, 'invalid range');
reset role;

select * from finish();
rollback;
