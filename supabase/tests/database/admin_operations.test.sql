-- task-8-1: administration (employees, deactivation with reassignment, rates, working hours, absences, settings).
-- Run with: supabase test db. Dates in March 2027 (2027-03-01 is a Monday, Europe/Berlin = UTC+1).
begin;
select plan(47);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@x.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test'),
  ('00000000-0000-0000-0000-0000000000b3', 't3@x.test'),
  ('00000000-0000-0000-0000-0000000000b4', 't4@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Admin 1', 'admin'),
  ('00000000-0000-0000-0000-0000000000a2', 'Admin 2', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician'),
  ('00000000-0000-0000-0000-0000000000b3', 'Technik 3', 'technician'),
  ('00000000-0000-0000-0000-0000000000b4', 'Technik 4', 'technician');

insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select t, 'working_hours', d, '07:00', '16:00'
from unnest(array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2',
  '00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b4']::uuid[]) as t,
     generate_series(1, 5) as d;
insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
values ('00000000-0000-0000-0000-0000000000b2', 'absence', '2027-03-01 00:00+01', '2027-03-02 00:00+01', 'Urlaub');

-- r1: processed, d1 + t1 with a scheduled visit; r2: new, d1; r3: cancelled, d1 (not active); r4: t4 visit in progress
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'r' || n, 'x', 'demo_seed', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2027-03-01', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1'
from generate_series(1, 4) as n;
update public.requests set intake_status = 'processed', priority = 'normal', intake_completed_at = now(), intake_mode = 'manual',
  manual_minutes_baseline = 15
where id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000004');
update public.requests set technician_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-000000000001';
update public.requests set technician_id = '00000000-0000-0000-0000-0000000000b4', dispatcher_id = '00000000-0000-0000-0000-0000000000d2'
where id = '00000000-0000-0000-0000-000000000004';
update public.requests set intake_status = 'cancelled', cancellation_reason = 'Test', cancelled_at = now()
where id = '00000000-0000-0000-0000-000000000003';
insert into public.visits (id, request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, created_by) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1',
   'scheduled', '2027-03-01 08:00+01', '2027-03-01 10:00+01', null, '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000b4',
   'in_progress', '2027-03-01 08:00+01', '2027-03-01 10:00+01', '2027-03-01 08:05+01', '00000000-0000-0000-0000-0000000000d2');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Not an admin
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select throws_ok($$select public.admin_update_employee('00000000-0000-0000-0000-0000000000d2', 'X', 'dispatcher')$$, '42501', null, 'dispatcher cannot edit employees');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d2')$$, '42501', null, 'dispatcher cannot deactivate');
select throws_ok($$select public.admin_update_settings(20, 19, 14, '{}')$$, '42501', null, 'dispatcher cannot change settings');
select throws_ok($$select public.admin_save_service_rate(null, 'X', 'inspection', 'X', 'fixed', 1, 19, true)$$, '42501', null, 'dispatcher cannot create rates');
select throws_ok($$select * from public.admin_employee_assignments('00000000-0000-0000-0000-0000000000d1')$$, '42501', null, 'dispatcher cannot list assignments');
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;

-- Tables stay read-only for clients, also for admins
select throws_ok($$update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000d2'$$, '42501', null, 'no direct profile writes');
select throws_ok($$update public.settings set manual_intake_minutes = 1$$, '42501', null, 'no direct settings writes');

-- Assignments: open requests and active visits only (r3 is cancelled)
select is((select count(*)::int from public.admin_employee_assignments('00000000-0000-0000-0000-0000000000d1')), 2, 'd1: two open requests');
select is((select array_agg(assignment order by assignment) from public.admin_employee_assignments('00000000-0000-0000-0000-0000000000b1')),
  array['technician', 'visit'], 't1: request and scheduled visit');

-- Name and role
select is((public.admin_update_employee('00000000-0000-0000-0000-0000000000d2', '  Dispo Zwei ', 'dispatcher')).display_name, 'Dispo Zwei', 'name trimmed');
select throws_ok($$select public.admin_update_employee('00000000-0000-0000-0000-0000000000d2', ' ', 'dispatcher')$$, 'RW422', null, 'empty name rejected');
select throws_ok($$select public.admin_update_employee('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'manager')$$, 'RW422', null, 'no role change with active assignments');
select throws_ok($$select public.admin_update_employee('00000000-0000-0000-0000-0000000000a1', 'Admin 1', 'manager')$$, 'RW422', null, 'own role cannot change');
select is((public.admin_update_employee('00000000-0000-0000-0000-0000000000a2', 'Admin 2', 'manager')).role, 'manager'::public.employee_role, 'role of another admin changed');
select throws_ok($$select public.admin_update_employee('00000000-0000-0000-0000-0000000000ff', 'X', 'manager')$$, 'RW404', null, 'unknown employee');

-- Deactivation of a dispatcher
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000a1')$$, 'RW422', null, 'own account cannot be deactivated');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d1')$$, 'RW422', 'Aktive Zuweisungen vorhanden: bitte eine Vertretung für die Neuzuweisung wählen', 'replacement required');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b3')$$, 'RW422', null, 'replacement must have the same role');
select is(public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2'),
  '{"reassigned_requests": 2, "reassigned_visits": 0, "reassigned_inbox": 0}'::jsonb, 'd1 deactivated, two requests moved');
select is((select count(*)::int from public.requests where dispatcher_id = '00000000-0000-0000-0000-0000000000d2'), 3, 'r1, r2 now with d2 (r4 already)');
select is((select dispatcher_id from public.requests where id = '00000000-0000-0000-0000-000000000003'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'cancelled request keeps its history');
select is((select count(*)::int from public.request_events where event_type = 'dispatcher_assigned' and to_value = '00000000-0000-0000-0000-0000000000d2' and note like 'Neuzuweisung wegen Deaktivierung%'), 2, 'reassignment logged');
select is((select is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000d1'), false, 'd1 inactive, not deleted');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d1')$$, 'RW422', null, 'already inactive');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d1')$$, 'RW422', null, 'inactive replacement rejected');

-- Deactivation of a technician with a scheduled visit
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2')$$, 'RW422', null, 'replacement absent at the visit');
select is((select is_active from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), true, 'failed deactivation changes nothing');
select is(public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b3'),
  '{"reassigned_requests": 1, "reassigned_visits": 1, "reassigned_inbox": 0}'::jsonb, 't1 deactivated, request and visit moved');
select is((select technician_id from public.visits where id = '00000000-0000-0000-0000-0000000000f1'), '00000000-0000-0000-0000-0000000000b3'::uuid, 'visit with t3');
select is((select technician_id from public.requests where id = '00000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-0000000000b3'::uuid, 'request with t3');
select is((select count(*)::int from public.request_events where event_type = 'visit_reassigned' and visit_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'visit reassignment logged');
select throws_ok($$select public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b2')$$, 'RW422', 'Ein laufender Einsatz muss zuerst abgeschlossen werden', 'running visit blocks');

-- Reactivation
select is((public.admin_reactivate_employee('00000000-0000-0000-0000-0000000000d1')).is_active, true, 'd1 reactivated');
select throws_ok($$select public.admin_reactivate_employee('00000000-0000-0000-0000-0000000000d1')$$, 'RW422', null, 'already active');

-- Service rates
select is((public.admin_save_service_rate(null, ' TST-1 ', 'inspection', 'Prüfung Test', 'fixed', 120.456, 19, true)).unit_price, 120.46::numeric, 'rate created, price rounded');
select throws_ok($$select public.admin_save_service_rate(null, 'TST-1', 'inspection', 'Doppelt', 'fixed', 1, 19, true)$$, 'RW422', 'Kürzel TST-1 ist bereits vergeben', 'code unique');
select throws_ok($$select public.admin_save_service_rate(null, 'TST-2', 'inspection', 'Negativ', 'fixed', -1, 19, true)$$, 'RW422', null, 'negative price rejected');
select is((public.admin_save_service_rate((select id from public.service_rates where code = 'TST-1'), 'TST-1', 'inspection', 'Prüfung Test', 'fixed', 130, 19, false)).is_active,
  false, 'rate deactivated');

-- Working hours (t3 has the visit on Monday 2027-03-01 08:00-10:00)
select throws_ok($$select public.admin_set_working_hours('00000000-0000-0000-0000-0000000000b3', '[{"weekday": 1, "local_start": "10:00", "local_end": "09:00"}]')$$, 'RW422', null, 'end before start rejected');
select throws_ok($$select public.admin_set_working_hours('00000000-0000-0000-0000-0000000000b3', '[{"weekday": 2, "local_start": "07:00", "local_end": "16:00"}]')$$, 'RW422', null, 'removing Monday collides with the booked visit');
select is((select count(*)::int from public.admin_set_working_hours('00000000-0000-0000-0000-0000000000b3',
  '[{"weekday": 1, "local_start": "06:00", "local_end": "14:00"}, {"weekday": 3, "local_start": "08:00", "local_end": "12:00"}]')), 2, 'weekly hours replaced');

-- Absences
select throws_ok($$select public.admin_add_absence('00000000-0000-0000-0000-0000000000b3', '2027-03-01 00:00+01', '2027-03-02 00:00+01', 'Krank')$$, 'RW422', null, 'absence over a booked visit rejected');
select is((public.admin_add_absence('00000000-0000-0000-0000-0000000000b3', '2027-03-03 00:00+01', '2027-03-04 00:00+01', ' Schulung ')).label, 'Schulung', 'absence added');
select lives_ok($$select public.admin_delete_absence((select id from public.employee_availability where label = 'Schulung'))$$, 'absence deleted');

-- Settings apply only to later initial processing
select is((public.admin_update_settings(20, 19, 30, '{"company_name": "RheinWerk Test"}')).updated_by, '00000000-0000-0000-0000-0000000000a1'::uuid, 'settings saved with author');
select is((select manual_minutes_baseline from public.requests where id = '00000000-0000-0000-0000-000000000001'), 15.00::numeric, 'completed request keeps its baseline');
select is((public.complete_intake('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), 'normal')).manual_minutes_baseline,
  20.00::numeric, 'later initial processing uses the new baseline');
reset role;

select * from finish();
rollback;
