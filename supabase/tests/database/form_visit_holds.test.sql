-- task-19-3: the website form holds the wished window (fewest orders of the week, then the load of the month), otherwise the next free
-- one; manual planning queues the same Terminbestätigung. Run with: supabase test db
begin;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test');
-- Only the test technicians and the test dispatcher take part
update public.profiles set is_active = false where role in ('technician', 'dispatcher');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician');
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select t, 'working_hours', d, time '08:00', time '16:00'
from generate_series(1, 5) d, unnest(array['00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b2']::uuid[]) t;

-- Test day: a Tuesday 10 to 16 days ahead whose Monday is in the same month (and the same week)
create function pg_temp.day() returns date language sql as $$
  select d from generate_series((now() at time zone 'Europe/Berlin')::date + 10, (now() at time zone 'Europe/Berlin')::date + 40, interval '1 day') g(d0), lateral (select d0::date d) x
  where extract(isodow from d) = 2 and date_trunc('month', d) = date_trunc('month', d - 1) limit 1;
$$;
create function pg_temp.at(hhmm text, plus integer default 0) returns timestamptz language sql as $$
  select ((pg_temp.day() + plus)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Berlin';
$$;
create function pg_temp.submit(n integer, wish text, urgency text default 'planned') returns public.requests language sql as $$
  select public.ingest_submission(jsonb_build_object('contract_version', '1.0', 'schema_version', '1.0',
    'submission_id', 'ddbb0000-0000-4000-8000-00000000000' || n, 'privacy_consent', true,
    'contact', jsonb_build_object('company_name', 'Wunsch GmbH', 'contact_name', 'Wanda Wunsch', 'business_email', 'wanda@wunsch.test', 'phone', '+49621123456'),
    'site_and_equipment', jsonb_build_object('street_and_number', 'Weg 3', 'postal_code', '68159', 'city', 'Mannheim', 'equipment_type', 'pump'),
    'request', jsonb_build_object('service_type', 'repair', 'urgency', urgency, 'known_safety_hazard', 'no',
      'description', 'Pumpe verliert Druck seit gestern.', 'preferred_service_date', pg_temp.day()::text, 'preferred_time', wish),
    'contract_and_attachments', jsonb_build_object('emergency_sla_24_7', false, 'attachments', '[]'::jsonb)));
$$;
create function pg_temp.hold(n integer) returns public.visit_holds language sql as $$
  select h.* from public.visit_holds h where h.request_id = ('ddbb0000-0000-4000-8000-00000000000' || n)::uuid and h.status = 'open';
$$;

-- Technician 1 is busier this week (Monday before the test day), so technician 2 gets a free window first
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status)
values ('00000000-0000-0000-0000-000000000098', 'wish-block', 'website_form', 'Block GmbH', 'B', 'b@x.test', '1', 'Str. 1', '68159', 'Mannheim',
  'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  'processed', now(), 'manual', 15, 'scheduled');
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by)
values ('00000000-0000-0000-0000-000000000098', '00000000-0000-0000-0000-0000000000b1', pg_temp.at('08:00', -1), pg_temp.at('12:00', -1), '00000000-0000-0000-0000-0000000000d1');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.submit(1, '10:00');
select pg_temp.submit(2, '10:00');
select pg_temp.submit(3, '10:00');
select pg_temp.submit(4, 'afternoon');
select pg_temp.submit(5, 'morning', 'production_stop');
select pg_temp.submit(6, 'kaputt');
reset role;

select ok((select h.starts_at = pg_temp.at('10:00') and h.ends_at = pg_temp.at('12:00') and h.origin = 'form' and h.wish_met
  and h.technician_id = '00000000-0000-0000-0000-0000000000b2' from pg_temp.hold(1) h), 'exact wish held for the technician with the fewest orders of the week, tie: month');
select ok((select h.starts_at = pg_temp.at('10:00') and h.wish_met and h.technician_id = '00000000-0000-0000-0000-0000000000b1' from pg_temp.hold(2) h),
  'second request at the same time: the other technician');
select ok((select h.starts_at = pg_temp.at('08:00') and not h.wish_met from pg_temp.hold(3) h), 'wish taken by both: next free window, marked as not met');
select ok((select h.starts_at = pg_temp.at('12:00') and h.wish_met from pg_temp.hold(4) h), 'afternoon: first free afternoon start');
select is((select count(*)::int from public.visit_holds where request_id = 'ddbb0000-0000-4000-8000-000000000005'), 0, 'emergency: no hold');
select ok((select h.id is not null and h.wish_met from pg_temp.hold(6) h), 'unknown time counts as any time');
select is((select count(*)::int from public.messages where request_id = 'ddbb0000-0000-4000-8000-000000000001' and kind = 'receipt'), 1, 'receipt still queued');
select is((select count(*)::int from public.request_events where request_id = 'ddbb0000-0000-4000-8000-000000000001' and event_type = 'visit_hold_created'), 1, 'hold logged');
-- task-20-6: the receipt names the held window as not yet confirmed; without a hold the wished date and time
select ok((select m.subject like 'Anfrage eingegangen RIS-%' and m.body_text like '%Wunschtermin: ' || to_char(pg_temp.day(), 'DD.MM.YYYY') || ', 10:00–12:00 Uhr (vorgemerkt, noch nicht bestätigt)%'
  and m.body_text like '%noch kein%Termin zugesagt%' and m.body_html like '%10:00–12:00 Uhr (vorgemerkt, noch nicht bestätigt)%'
  from public.messages m where m.request_id = 'ddbb0000-0000-4000-8000-000000000001' and m.kind = 'receipt'), 'receipt: held window, not yet confirmed');
select ok((select m.body_text like '%Wunschtermin: ' || to_char(pg_temp.day(), 'DD.MM.YYYY') || ', vormittags%'
  from public.messages m where m.request_id = 'ddbb0000-0000-4000-8000-000000000005' and m.kind = 'receipt'), 'receipt without hold: wished date and time');

-- One click for the dispatcher: intake done, hold confirmed, customer gets the confirmation
update public.requests set intake_status = 'processed', intake_completed_at = now(), intake_mode = 'manual', manual_minutes_baseline = 15, priority = 'normal'
where id = 'ddbb0000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select lives_ok($$select public.confirm_visit_hold((pg_temp.hold(1)).id, (select version from public.requests where id = 'ddbb0000-0000-4000-8000-000000000001'))$$, 'dispatcher confirms the form hold');
reset role;
select is((select count(*)::int from public.messages where request_id = 'ddbb0000-0000-4000-8000-000000000001' and subject like 'Terminbestätigung%' and status = 'queued'), 1, 'confirmation queued');

-- Manual planning: the planning person queues the same confirmation
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select lives_ok($$select public.queue_visit_confirmation((select id from public.visits where request_id = 'ddbb0000-0000-4000-8000-000000000001'))$$, 'confirmation of a planned visit');
reset role;
select ok((select m.approved_by = '00000000-0000-0000-0000-0000000000d1' and m.to_address = 'wanda@wunsch.test' and m.body_text like '%Dauer etwa 2 Stunden,%'
  from public.messages m where m.request_id = 'ddbb0000-0000-4000-8000-000000000001' and m.subject like 'Terminbestätigung%' order by m.created_at desc limit 1),
  'approved by the planning person, sent to the customer');
select is(private.duration_text(pg_temp.at('10:00'), pg_temp.at('11:30')), '1 Stunde und 30 Minuten', 'length in words');
select is(private.duration_text(pg_temp.at('10:00'), pg_temp.at('10:45')), '45 Minuten', 'short length in words');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.queue_visit_confirmation((select id from public.visits where request_id = 'ddbb0000-0000-4000-8000-000000000001'))$$, '42501', null, 'technician cannot');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.queue_visit_confirmation(gen_random_uuid())$$, '42501', null, 'unknown visit');

-- task-20-2: planning a held request elsewhere on the board closes the hold, without a rejection e-mail
reset role;
update public.requests set intake_status = 'processed', intake_completed_at = now(), intake_mode = 'manual', manual_minutes_baseline = 15, priority = 'normal'
where id = 'ddbb0000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select lives_ok($$select public.schedule_visit('ddbb0000-0000-4000-8000-000000000004', (select version from public.requests where id = 'ddbb0000-0000-4000-8000-000000000004'),
  '00000000-0000-0000-0000-0000000000b1', pg_temp.at('14:00', 1), pg_temp.at('16:00', 1))$$, 'held request planned in another window');
reset role;
select ok((select h.status = 'confirmed' and h.visit_id is not null and h.decided_by = '00000000-0000-0000-0000-0000000000d1'
  from public.visit_holds h where h.request_id = 'ddbb0000-0000-4000-8000-000000000004'), 'hold closed with the planned visit');
select is((select count(*)::int from public.messages where request_id = 'ddbb0000-0000-4000-8000-000000000004' and kind = 'other'), 0, 'no e-mail about the hold');

-- task-20-7: a moved visit tells the customer the new time (old time named), nothing when the time stayed
update public.visits set scheduled_start = pg_temp.at('08:00', 1), scheduled_end = pg_temp.at('09:30', 1)
where request_id = 'ddbb0000-0000-4000-8000-000000000004';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select lives_ok($$select public.queue_visit_change((select id from public.visits where request_id = 'ddbb0000-0000-4000-8000-000000000004'), pg_temp.at('14:00', 1), pg_temp.at('16:00', 1))$$, 'change of a moved visit');
select lives_ok($$select public.queue_visit_change((select id from public.visits where request_id = 'ddbb0000-0000-4000-8000-000000000004'), pg_temp.at('08:00', 1), pg_temp.at('09:30', 1))$$, 'same time: nothing to tell');
reset role;
select ok((select count(*) = 1 and bool_and(m.subject like 'Terminänderung RIS-%' and m.status = 'queued' and m.to_address = 'wanda@wunsch.test'
    and m.body_text like '%Neuer Termin: %um 8 Uhr, Dauer etwa 1 Stunde und 30 Minuten,%' and m.body_text like '%Bisher: %um 14 Uhr, Dauer etwa 2 Stunden.%')
  from public.messages m where m.request_id = 'ddbb0000-0000-4000-8000-000000000004' and m.subject like 'Terminänderung%'), 'one e-mail with new and old time');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.queue_visit_change((select id from public.visits where request_id = 'ddbb0000-0000-4000-8000-000000000004'), now(), now())$$, '42501', null, 'technician cannot');
reset role;

-- task-20-9: the share of the month decides, not the minutes; absences shorten the available time
select is(private.month_capacity_minutes('00000000-0000-0000-0000-0000000000b1', pg_temp.day()),
  (select count(*)::int * 480 from generate_series(date_trunc('month', pg_temp.day()), date_trunc('month', pg_temp.day()) + interval '1 month' - interval '1 day', interval '1 day') g(d)
   where extract(isodow from d) <= 5), 'capacity: working hours of the month');
-- task-20-11/20-15: the orders of the calendar week of the window decide first, not the month. Week A (Monday to Friday)
-- and the following week B lie in the same month, 45 to 110 days ahead, apart from the bookings above.
create function pg_temp.wk(plus integer, hhmm text) returns timestamptz language sql as $$
  select ((x.d + plus)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Berlin'
  from generate_series((now() at time zone 'Europe/Berlin')::date + 45, (now() at time zone 'Europe/Berlin')::date + 110, interval '1 day') g(d0),
    lateral (select d0::date d) x
  where extract(isodow from x.d) = 2 and date_trunc('month', x.d - 1) = date_trunc('month', x.d + 10) limit 1;
$$;
delete from public.employee_availability where employee_id = '00000000-0000-0000-0000-0000000000b2' and kind = 'absence';
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'week-' || n, 'website_form', 'Woche GmbH', 'W', 'w@x.test', '1', 'Str. 1', '68159', 'Mannheim',
  'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', t::uuid,
  'processed', now(), 'manual', 15, 'scheduled'
from (values ('96', '00000000-0000-0000-0000-0000000000b1'), ('97', '00000000-0000-0000-0000-0000000000b2')) v(n, t);
-- Technician 1: three days in week B (busier month); technician 2: two hours on Monday of week A (busier week)
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by) values
  ('00000000-0000-0000-0000-000000000096', '00000000-0000-0000-0000-0000000000b1', pg_temp.wk(6, '08:00'), pg_temp.wk(8, '16:00'), '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000097', '00000000-0000-0000-0000-0000000000b2', pg_temp.wk(-1, '08:00'), pg_temp.wk(-1, '10:00'), '00000000-0000-0000-0000-0000000000d1');
select is(private.week_capacity_minutes('00000000-0000-0000-0000-0000000000b1', (pg_temp.wk(0, '12:00') at time zone 'Europe/Berlin')::date), 2400, 'capacity: working hours of the week');
select is(private.week_booked_minutes('00000000-0000-0000-0000-0000000000b2', (pg_temp.wk(0, '12:00') at time zone 'Europe/Berlin')::date), 120, 'booked minutes of the week only');
select is(private.technician_for_window(pg_temp.wk(0, '10:00'), pg_temp.wk(0, '12:00')), '00000000-0000-0000-0000-0000000000b1'::uuid,
  'technician with a busier month but an emptier week gets the window');

-- task-20-15: tied on the orders of the week (one each), the load of the month decides: technician 1 has the busier month
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status)
values ('00000000-0000-0000-0000-000000000095', 'week-95', 'website_form', 'Woche GmbH', 'W', 'w@x.test', '1', 'Str. 1', '68159', 'Mannheim',
  'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  'processed', now(), 'manual', 15, 'scheduled');
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by)
values ('00000000-0000-0000-0000-000000000095', '00000000-0000-0000-0000-0000000000b1', pg_temp.wk(-1, '13:00'), pg_temp.wk(-1, '14:00'), '00000000-0000-0000-0000-0000000000d1');
select is(private.week_order_count('00000000-0000-0000-0000-0000000000b1', (pg_temp.wk(0, '12:00') at time zone 'Europe/Berlin')::date), 1, 'orders of the week: visits starting in it');
select is(private.technician_for_window(pg_temp.wk(0, '10:00'), pg_temp.wk(0, '12:00')), '00000000-0000-0000-0000-0000000000b2'::uuid,
  'tied on the orders of the week: the lower load of the month wins');

select * from finish();
rollback;
