-- task-13-3: free windows for the phone assistant, holds, confirmation, rejection, expiry. Run with: supabase test db
begin;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
-- Only the test technician and the test dispatchers take part
update public.profiles set is_active = false where role in ('technician', 'dispatcher');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select '00000000-0000-0000-0000-0000000000b1', 'working_hours', d, time '08:00', time '16:00' from generate_series(1, 5) d;

-- Test day: first Monday at least 10 days ahead; local times in Europe/Berlin
create function pg_temp.day() returns date language sql as $$
  select d from generate_series((now() at time zone 'Europe/Berlin')::date + 10, (now() at time zone 'Europe/Berlin')::date + 16, interval '1 day') g(d0), lateral (select d0::date d) x
  where extract(isodow from d) = 1 limit 1;
$$;
create function pg_temp.at(hhmm text, plus integer default 0) returns timestamptz language sql as $$
  select ((pg_temp.day() + plus)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Berlin';
$$;
create function pg_temp.slots(leistung text default 'diagnosis_repair') returns jsonb language sql as $$
  select public.agent_free_slots('hold-probe', pg_temp.day(), pg_temp.day(), leistung, '68159') -> 'fenster';
$$;
create function pg_temp.fields(urgency text default 'planbar') returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Halte GmbH', 'contact_name', 'Max Halt', 'business_email', 'max@halte.test',
    'phone_number', '0621 1', 'street_house_number', 'Weg 2', 'postal_code', '68159', 'city', 'Mannheim',
    'equipment_kind', 'pump', 'service_kind', 'diagnosis_repair', 'customer_urgency', urgency, 'safety_risk', 'none_known',
    'description', 'Pumpe leckt an der Gleitringdichtung.');
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
-- Free windows: morning and afternoon of the day, 2 h for repair, 3 h for maintenance
select ok((pg_temp.slots() -> 0 ->> 'ansage') like 'Montag, der %, um 8 Uhr' and (pg_temp.slots() -> 0 ->> 'beginn')::timestamptz = pg_temp.at('08:00'), 'first window: 8 o''clock with spoken date');
select is((pg_temp.slots() -> 1 ->> 'beginn')::timestamptz, pg_temp.at('12:00'), 'second window: afternoon');
select is((pg_temp.slots('scheduled_maintenance') -> 0 ->> 'dauer_minuten')::int, 180, 'maintenance lasts 3 hours');
select is(jsonb_array_length(public.agent_free_slots('hold-probe', pg_temp.day(), pg_temp.day() + 4, 'diagnosis_repair', '68159') -> 'fenster'), 3, 'at most three windows');
select is(public.agent_free_slots('hold-probe', null, null, 'kaputt', null) ->> 'fehler', 'leistung_ungueltig', 'invalid service');
reset role;

-- A visit and an absence block windows
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status)
values ('00000000-0000-0000-0000-000000000099', 'hold-block', 'website_form', 'Block GmbH', 'B', 'b@x.test', '1', 'Str. 1', '68159', 'Mannheim',
  'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  'processed', now(), 'manual', 15, 'scheduled');
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by)
values ('00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-0000000000b1', pg_temp.at('08:00'), pg_temp.at('10:00'), '00000000-0000-0000-0000-0000000000d1');
insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
values ('00000000-0000-0000-0000-0000000000b1', 'absence', pg_temp.at('12:00'), pg_temp.at('16:00'), 'Arzt');
set local role service_role;
select is((pg_temp.slots() -> 0 ->> 'beginn')::timestamptz, pg_temp.at('10:00'), 'visit blocks the morning start');
select is(jsonb_array_length(pg_temp.slots()), 1, 'absence blocks the afternoon');

-- Hold the window with the new request
select is((public.agent_create_request('hold-call-1', pg_temp.fields(), pg_temp.at('10:00')) ->> 'termin_vorgemerkt')::boolean, true, 'window held');
select ok((public.agent_create_request('hold-call-1', pg_temp.fields(), pg_temp.at('10:00')) ->> 'termin_ansage') like 'Montag, der %, um 10 Uhr', 'repetition reports the same hold');
select is(jsonb_array_length(pg_temp.slots()), 0, 'held window is no longer offered');
select is(public.agent_create_request('hold-call-2', pg_temp.fields(), pg_temp.at('10:00')) ->> 'termin_hinweis', 'fenster_nicht_mehr_frei', 'second caller: request without hold');
select is((select count(*)::int from public.requests where source_event_key = 'phone_agent:hold-call-2'), 1, 'request created anyway');
select is(public.agent_create_request('hold-call-3', pg_temp.fields('production_stop'), pg_temp.at('10:00', 1)) ->> 'termin_hinweis', 'notfall_ohne_vormerkung', 'emergency gets no hold');
select is(public.agent_find_request('hold-call-1', (select request_number from public.requests where source_event_key = 'phone_agent:hold-call-1'), null, '68159', null) ->> 'lage',
  'vorgemerkt', 'situation "vorgemerkt"');
reset role;
select ok((select h.status = 'open' and h.technician_id = '00000000-0000-0000-0000-0000000000b1' and h.ends_at = pg_temp.at('12:00')
    and h.expires_at <= h.starts_at and h.expires_at > now() and h.conversation_id = 'hold-call-1'
  from public.visit_holds h join public.requests r on r.id = h.request_id where r.source_event_key = 'phone_agent:hold-call-1'), 'hold row');
select is((select count(*)::int from public.request_events e join public.requests r on r.id = e.request_id
  where r.source_event_key = 'phone_agent:hold-call-1' and e.event_type = 'visit_hold_created'), 1, 'hold logged');
select throws_ok($$insert into public.visit_holds (request_id, technician_id, starts_at, ends_at, expires_at)
  select id, '00000000-0000-0000-0000-0000000000b1', $$ || quote_literal(pg_temp.at('10:30')) || $$, $$ || quote_literal(pg_temp.at('11:30')) || $$, now() + interval '1 day'
  from public.requests where source_event_key = 'phone_agent:hold-call-2'$$, '23P01', null, 'open holds of one technician never overlap');

-- Decisions: dispatcher of the request (d1), manager; not the technician or another dispatcher
update public.requests set dispatcher_id = '00000000-0000-0000-0000-0000000000d1' where source_event_key like 'phone_agent:hold-call-%';
create function pg_temp.hold(k text) returns uuid language sql as $$
  select h.id from public.visit_holds h join public.requests r on r.id = h.request_id where r.source_event_key = 'phone_agent:' || k;
$$;
create function pg_temp.version(k text) returns integer language sql as $$
  select version from public.requests where source_event_key = 'phone_agent:' || k;
$$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.confirm_visit_hold(pg_temp.hold('hold-call-1'), pg_temp.version('hold-call-1'))$$, '42501', null, 'technician cannot confirm');
select is((select count(*)::int from public.visit_holds), 0, 'technician sees no holds');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d2', 'role', 'authenticated')::text, true);
select throws_ok($$select public.confirm_visit_hold(pg_temp.hold('hold-call-1'), pg_temp.version('hold-call-1'))$$, '42501', null, 'other dispatcher cannot confirm');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.visit_holds), 1, 'dispatcher of the request sees its hold');
select throws_ok($$select public.confirm_visit_hold(pg_temp.hold('hold-call-1'), pg_temp.version('hold-call-1'))$$, 'RW422', null, 'intake first');
reset role;
update public.requests set intake_status = 'processed', intake_completed_at = now(), intake_mode = 'manual', manual_minutes_baseline = 15
where source_event_key = 'phone_agent:hold-call-1';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select lives_ok($$select public.confirm_visit_hold(pg_temp.hold('hold-call-1'), pg_temp.version('hold-call-1'))$$, 'dispatcher confirms');
reset role;
select ok((select h.status = 'confirmed' and h.decided_by = '00000000-0000-0000-0000-0000000000d1' and v.scheduled_start = pg_temp.at('10:00')
    and v.technician_id = '00000000-0000-0000-0000-0000000000b1' and v.status = 'scheduled'
  from public.visit_holds h join public.visits v on v.id = h.visit_id where h.id = pg_temp.hold('hold-call-1')), 'visit planned in the held window');
select ok((select m.status = 'queued' and m.approved_by = '00000000-0000-0000-0000-0000000000d1' and m.to_address = 'max@halte.test'
    and m.subject like 'Terminbestätigung RIS-%' and position(private.spoken_datetime(pg_temp.at('10:00')) in m.body_text) > 0
  from public.messages m join public.requests r on r.id = m.request_id where r.source_event_key = 'phone_agent:hold-call-1' and m.kind = 'other'), 'confirmation e-mail queued');

-- Reject and expire (fresh holds on the next day)
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.agent_create_request('hold-call-4', pg_temp.fields(), pg_temp.at('08:00', 2));
select public.agent_create_request('hold-call-5', pg_temp.fields(), pg_temp.at('12:00', 2));
reset role;
update public.requests set dispatcher_id = '00000000-0000-0000-0000-0000000000d1' where source_event_key in ('phone_agent:hold-call-4', 'phone_agent:hold-call-5');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.reject_visit_hold(pg_temp.hold('hold-call-4'), '  ')$$, 'RW422', null, 'reason required');
select lives_ok($$select public.reject_visit_hold(pg_temp.hold('hold-call-4'), 'Techniker auf Schulung', 'Donnerstag ab 10 Uhr')$$, 'dispatcher rejects');
reset role;
select ok((select h.status = 'rejected' and h.reject_reason = 'Techniker auf Schulung' and h.alternative = 'Donnerstag ab 10 Uhr'
  from public.visit_holds h join public.requests r on r.id = h.request_id where r.source_event_key = 'phone_agent:hold-call-4'), 'rejection stored');
select ok((select position('Techniker auf Schulung' in m.body_text) > 0 and position('Donnerstag ab 10 Uhr' in m.body_text) > 0
  from public.messages m join public.requests r on r.id = m.request_id where r.source_event_key = 'phone_agent:hold-call-4' and m.kind = 'other'), 'rejection e-mail with reason and alternative');
update public.visit_holds set expires_at = now() - interval '1 minute' where request_id = (select id from public.requests where source_event_key = 'phone_agent:hold-call-5');
select is(public.expire_visit_holds(), 1, 'one hold expired');
select ok((select h.status = 'expired' from public.visit_holds h join public.requests r on r.id = h.request_id where r.source_event_key = 'phone_agent:hold-call-5')
  and exists (select 1 from public.request_events e join public.requests r on r.id = e.request_id where r.source_event_key = 'phone_agent:hold-call-5' and e.event_type = 'visit_hold_expired'),
  'expired with event');

select * from finish();
rollback;
