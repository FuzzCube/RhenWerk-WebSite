-- task-12-1: visit intervals for the monthly load on the planning board (technician_load_intervals).
-- Run with: supabase test db
begin;
select plan(5);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id)
values ('00000000-0000-0000-0000-000000000001', 'load-r1', 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210',
  'Düsseldorf', 'pump', 'diagnosis_repair', date '2031-03-01', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1');
-- One visit per status in March 2031; counts only for this technician, local demo data may have visits then too
insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, waiting_reason, cancellation_reason, created_by)
select '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', s.status::public.visit_status,
  s.starts, s.starts + interval '2 hours',
  case when s.status <> 'scheduled' and s.status <> 'cancelled' then s.starts end,
  case when s.status = 'completed' then s.starts + interval '2 hours' end,
  case when s.status = 'waiting_parts' then 'Teil bestellt' end,
  case when s.status = 'cancelled' then 'Kunde abgesagt' end,
  '00000000-0000-0000-0000-0000000000d1'
from (values ('scheduled', timestamptz '2031-03-03 08:00+01'), ('completed', timestamptz '2031-03-04 08:00+01'),
             ('waiting_parts', timestamptz '2031-03-05 08:00+01'), ('cancelled', timestamptz '2031-03-06 08:00+01'),
             ('in_progress', timestamptz '2031-03-07 08:00+01')) as s(status, starts);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

set local role anon;
select throws_ok($$select * from public.technician_load_intervals('2031-03-01', '2031-04-01')$$, '42501', null, 'anon has no access');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.technician_load_intervals('2031-03-01', '2031-04-01') i where i.technician_id = '00000000-0000-0000-0000-0000000000b1'), 4,
  'scheduled, in progress, waiting for parts and completed count; cancelled does not');
-- A dispatcher of other requests sees the times as well (only technician and time, like the busy intervals)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.technician_load_intervals('2031-03-01', '2031-04-01') i where i.technician_id = '00000000-0000-0000-0000-0000000000b1'), 4, 'other dispatcher sees the intervals');
select is((select count(*)::int from public.technician_load_intervals('2031-03-04', '2031-03-05')), 1, 'only the requested range');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.technician_load_intervals('2031-03-01', '2031-04-01')), 0, 'technicians get nothing');

select * from finish();
rollback;
