-- task-2-2: visit planning and visit status operations. Run with: supabase test db
-- Dates in March 2027 (2027-03-01 is a Monday, Europe/Berlin = UTC+1).
begin;
select plan(44);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician');

-- Mon-Fri 07:00-16:00 for both technicians; t2 absent on Tuesday 2027-03-02
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select t, 'working_hours', d, '07:00', '16:00'
from unnest(array['00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid]) as t,
     generate_series(1, 5) as d;
insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
values ('00000000-0000-0000-0000-0000000000b2', 'absence', '2027-03-02 00:00+01', '2027-03-03 00:00+01', 'Schulung');

insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'r' || n, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2027-03-01', 'Test', 'planbar',
  (case when n = 4 then 'known' else 'none_known' end)::public.safety_risk, '{}', '00000000-0000-0000-0000-0000000000d1'
from generate_series(1, 4) as n;

-- r1, r3: processed by a human; r2: new; r4: processed automatically despite a known hazard
update public.requests set intake_status = 'processed', priority = 'normal', intake_completed_at = now(),
  intake_mode = (case when id = '00000000-0000-0000-0000-000000000004' then 'automatic' else 'manual' end)::public.intake_mode,
  manual_minutes_baseline = 5
where id::text like '00000000-0000-0000-0000-%' and id <> '00000000-0000-0000-0000-000000000002';

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- As technician 1
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')$$,
  '42501', null, 'technician cannot schedule'
);
reset role;

-- As dispatcher 1: validation
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000002', 1, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')$$,
  'RW422', null, 'only processed requests can be scheduled'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 9, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')$$,
  'RW409', null, 'stale request version rejected'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2020-03-02 08:00+01', '2020-03-02 10:00+01')$$,
  'RW422', null, 'no scheduling in the past'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 15:00+01', '2027-03-01 17:00+01')$$,
  'RW422', null, 'outside working hours rejected'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-06 08:00+01', '2027-03-06 10:00+01')$$,
  'RW422', null, 'no working hours on Saturday'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b2', '2027-03-02 08:00+01', '2027-03-02 10:00+01')$$,
  'RW422', null, 'absence rejected'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000d2', '2027-03-01 08:00+01', '2027-03-01 10:00+01')$$,
  'RW422', null, 'only active technicians can be booked'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000004', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')$$,
  'RW422', null, 'known hazard after automatic processing needs human review first'
);

-- Successful booking
select is(
  (public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')).status::text,
  'scheduled', 'visit scheduled'
);
reset role;
select results_eq(
  $$select work_status::text, technician_id from public.requests where id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('scheduled', '00000000-0000-0000-0000-0000000000b1'::uuid)$$,
  'request scheduled and technician assigned'
);
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001'
     and event_type in ('visit_scheduled', 'technician_assigned', 'work_status_changed')),
  3, 'booking audited'
);

-- Conflicts and adjacency
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000003', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 09:00+01', '2027-03-01 11:00+01')$$,
  'RW410', null, 'overlapping booking rejected'
);
select is(
  (public.schedule_visit('00000000-0000-0000-0000-000000000003', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 10:00+01', '2027-03-01 12:00+01')).status::text,
  'scheduled', 'adjacent booking accepted'
);

-- Rescheduling keeps the old interval in the audit trail
select throws_ok(
  $$select public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2027-03-03 08:00+01', '2027-03-03 10:00+01', '')$$,
  'RW422', null, 'rescheduling requires reason'
);
select is(
  (public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2027-03-03 08:00+01', '2027-03-03 10:00+01', 'Kunde verschiebt')).scheduled_start,
  '2027-03-03 08:00+01'::timestamptz, 'visit rescheduled'
);
reset role;
select results_eq(
  $$select (data ->> 'old_start')::timestamptz, (data ->> 'new_start')::timestamptz, note from public.request_events
    where request_id = '00000000-0000-0000-0000-000000000003' and event_type = 'visit_rescheduled'$$,
  $$values ('2027-03-01 10:00+01'::timestamptz, '2027-03-03 08:00+01'::timestamptz, 'Kunde verschiebt')$$,
  'old and new interval recorded'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok(
  $$select public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2027-03-02 08:00+01', '2027-03-02 10:00+01', 'Tausch', '00000000-0000-0000-0000-0000000000b2')$$,
  'RW422', null, 'rescheduling to an absent technician rejected'
);
-- task-10-8 (drag on the planning board): stale version, overlap and past are rejected by the database
select throws_ok(
  $$select public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version - 1 from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2027-03-04 08:00+01', '2027-03-04 10:00+01', 'Verschoben auf der Plantafel')$$,
  'RW409', null, 'rescheduling with a stale version rejected'
);
select throws_ok(
  $$select public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2027-03-01 09:00+01', '2027-03-01 11:00+01', 'Verschoben auf der Plantafel')$$,
  'RW410', null, 'rescheduling onto another visit rejected'
);
select throws_ok(
  $$select public.reschedule_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '2020-01-06 08:00+01', '2020-01-06 10:00+01', 'Verschoben auf der Plantafel')$$,
  'RW422', null, 'rescheduling into the past rejected'
);
reset role;
-- Id read without RLS: the callers below must fail on their rights, not on not seeing the visit
select set_config('test.visit3', (select id::text from public.visits where request_id = '00000000-0000-0000-0000-000000000003'), true);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select throws_ok(
  $$select public.reschedule_visit(current_setting('test.visit3')::uuid, 1, '2027-03-04 08:00+01', '2027-03-04 10:00+01', 'Fremd')$$,
  '42501', null, 'other dispatcher cannot reschedule'
);
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.reschedule_visit(current_setting('test.visit3')::uuid, 1, '2027-03-04 08:00+01', '2027-03-04 10:00+01', 'Technik')$$,
  '42501', null, 'technician cannot reschedule'
);
reset role;

-- Technician actions on r1
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select throws_ok(
  $$select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'), 1)$$,
  '42501', null, 'other technician cannot start the visit'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  (public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'in_progress', 'technician starts own visit'
);
select throws_ok(
  $$select public.wait_for_parts((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), ' ')$$,
  'RW422', null, 'waiting for parts requires reason'
);
select is(
  (public.wait_for_parts((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'Dichtungssatz bestellt')).status::text,
  'waiting_parts', 'visit waits for parts'
);
reset role;
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'waiting_parts', 'request waits for parts');
select is((select actual_start is not null from public.visits where request_id = '00000000-0000-0000-0000-000000000001'), true, 'actual start recorded');

-- Waiting does not reserve: the same slot can be booked for a repeat visit
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (public.schedule_visit('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')).status::text,
  'scheduled', 'waiting visit does not block the slot'
);
reset role;
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'scheduled', 'repeat visit sets request to scheduled');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select throws_ok(
  $$select public.resume_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'waiting_parts'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))$$,
  'RW410', null, 'resuming into a taken slot is a booking conflict'
);
select throws_ok(
  $$select public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'waiting_parts'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), null)$$,
  'RW422', null, 'completion requires working minutes'
);
select is(
  (public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'waiting_parts'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 90, 'Leck lokalisiert')).status::text,
  'completed', 'waiting visit completed explicitly'
);
select throws_ok(
  $$select public.cancel_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'scheduled'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'x')$$,
  '42501', null, 'technician cannot cancel visits'
);
reset role;
select results_eq(
  $$select actual_work_minutes, summary, actual_end is not null from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'completed'$$,
  $$values (90, 'Leck lokalisiert', true)$$,
  'completion data stored'
);
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'scheduled', 'visit completion does not close the request');

-- Cancel the repeat visit: back to planning
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (public.cancel_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'scheduled'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'Teil verspätet')).status::text,
  'cancelled', 'visit cancelled'
);
reset role;
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'not_planned', 'request back to planning without active visits');
select is(
  (select count(*)::int from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
  2, 'cancelled and completed visits stay in history'
);

-- Availability changes cannot invalidate active bookings (r3 visit on Wed 2027-03-03 08:00-10:00, t1)
select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at) values ('00000000-0000-0000-0000-0000000000b1', 'absence', '2027-03-03 09:00+01', '2027-03-03 12:00+01')$$,
  'RW422', null, 'absence over an active booking rejected'
);
select throws_ok(
  $$delete from public.employee_availability where employee_id = '00000000-0000-0000-0000-0000000000b1' and kind = 'working_hours' and weekday = 3$$,
  'RW422', null, 'removing working hours under an active booking rejected'
);
select lives_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at) values ('00000000-0000-0000-0000-0000000000b1', 'absence', '2027-03-04 00:00+01', '2027-03-05 00:00+01')$$,
  'absence without booking accepted'
);
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'visit_status_changed'),
  4, 'every visit status change audited'
);

select * from finish();
rollback;
