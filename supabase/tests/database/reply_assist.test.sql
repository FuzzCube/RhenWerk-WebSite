-- task-22-3: reply assistant for customer e-mails after the intake: which replies are pending, free windows to a wish,
-- a draft for staff (never queued) and a callback request to the technician of an overdue visit.
-- Run with: supabase test db
begin;
select plan(21);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@x.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Dispo F', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000f2', 'Technik F', 'technician');
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select '00000000-0000-0000-0000-0000000000f2', 'working_hours', d, '07:00', '16:00' from generate_series(1, 5) d;

-- 1 unplanned (asks for a date), 2 overdue visit (where is the technician), 3 coming visit (workflow 13 first),
-- 4 coming visit with a move wish (answered by workflow 13), 5 already answered by staff
insert into public.requests (id, source_event_key, source, request_number, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, priority)
select ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'reply-assist-' || n, 'website_form', 'RIS-2099-1000' || n, 'Antwort GmbH', 'Anna Antwort', 'anna@antwort.test', '+49 621 1234567',
  'Str. 1', '68159', 'Mannheim', 'pump', 'inspection', current_date + 7, 'Pumpe verliert Druck', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', 'processed', now() - interval '1 day', 'manual', 15,
  case when n = 1 or n = 5 then 'not_planned' else 'scheduled' end::public.work_status, 'normal'
from generate_series(1, 5) n;
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by, created_at) values
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000f2', now() - interval '30 minutes', now() + interval '90 minutes', '00000000-0000-0000-0000-0000000000f1', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000f2', date_trunc('day', now()) + interval '9 days 9 hours', date_trunc('day', now()) + interval '9 days 11 hours', '00000000-0000-0000-0000-0000000000f1', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000f2', date_trunc('day', now()) + interval '10 days 9 hours', date_trunc('day', now()) + interval '10 days 11 hours', '00000000-0000-0000-0000-0000000000f1', now() - interval '2 days');
insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at, created_at)
select ('00000000-0000-0000-0000-0000000000d' || n)::uuid, ('00000000-0000-0000-0000-0000000000b' || n)::uuid, 'incoming', 'customer_reply', 'received', 'anna@antwort.test',
  'Re: Ihre Serviceanfrage RIS-2099-1000' || n, 'Frage ' || n, now() - interval '10 minutes', now() - interval '10 minutes'
from generate_series(1, 5) n;
insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, author_id)
values ('00000000-0000-0000-0000-0000000000b5', 'outgoing', 'other', 'draft', 'anna@antwort.test', 'Re: Antwort', 'Schon in Arbeit', '00000000-0000-0000-0000-0000000000f1');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
create temp table pending_ids on commit drop as
  select i ->> 'message_id' as id, i from jsonb_array_elements(public.reply_assist_pending(10) -> 'items') i where i ->> 'message_id' like '00000000-0000-0000-0000-0000000000d%';
select is((select array_agg(right(id, 2) order by id) from pending_ids), array['d1', 'd2'], 'pending: unplanned and overdue; coming visit waits for workflow 13, answered one skipped');
select is((select i -> 'lage' ->> 'lage' from pending_ids where id like '%d2'), 'ueberfaellig', 'context: situation of the request');
select ok((select i -> 'anfrage' ->> 'ansprechpartner' = 'Anna Antwort' and jsonb_array_length(i -> 'einsaetze') = 1 and i -> 'einsaetze' -> 0 ->> 'techniker' = 'Technik F' from pending_ids where id like '%d2'),
  'context: contact and visit with technician');

-- Workflow 13 answered the move wish by itself; the question goes on to the assistant
select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000d3', 'question', 0.9, 'Kunde fragt nach Zugang.') ->> 'action', 'none', 'workflow 13: question, no action');
select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000d4', 'reschedule', 0.9, 'Kunde möchte verschieben.') ->> 'action', 'change_requested', 'workflow 13: change request');
select is((select array_agg(right(i ->> 'message_id', 2) order by i ->> 'message_id') from jsonb_array_elements(public.reply_assist_pending(10) -> 'items') i
  where i ->> 'message_id' like '00000000-0000-0000-0000-0000000000d%'), array['d1', 'd2', 'd3'], 'after workflow 13: question pending, move wish not');

-- Free windows: a free wished hour of the technician's working time and alternatives
select ok((select (s -> 'wunschtermin' ->> 'frei')::boolean and s -> 'wunschtermin' ->> 'termin' like '%um 10 Uhr%' and jsonb_array_length(s -> 'alternativen') = 3
  from public.reply_assist_slots('00000000-0000-0000-0000-0000000000d1', date_trunc('week', current_date + 21)::date, '10:00') s), 'unplanned: wished window free, three alternatives');
select is((select count(distinct split_part(a, ', um', 1))::int from jsonb_array_elements_text(public.reply_assist_slots('00000000-0000-0000-0000-0000000000d1', date_trunc('week', current_date + 21)::date, '10:00') -> 'alternativen') a), 3,
  'alternatives on three different days');
select ok((select not (s -> 'wunschtermin' ->> 'frei')::boolean from public.reply_assist_slots('00000000-0000-0000-0000-0000000000d3', date_trunc('week', current_date + 21)::date, '20:00') s),
  'outside working hours: not free');
select ok((select jsonb_typeof(s -> 'wunschtermin') = 'null' and jsonb_array_length(s -> 'alternativen') between 1 and 3 and s ->> 'geplanter_termin' is not null
  from public.reply_assist_slots('00000000-0000-0000-0000-0000000000d3') s), 'without wish: only alternatives, planned visit named');

-- Results: draft for staff, callback to the technician of the overdue visit, nothing for a thank-you
select is(public.save_reply_assist('00000000-0000-0000-0000-0000000000d1', 'availability', 'Kunde fragt nach einem Termin.', true,
  'Re: Ihre Serviceanfrage', E'Guten Tag Anna Antwort,\n\nder Termin ist frei.\n\nMit freundlichen Grüßen\nRheinWerk Industrieservice · Service Desk',
  'Wunschtermin frei laut Plan.', false, 0.8, 'exec-1') ->> 'action', 'drafted', 'draft created');
select is(public.save_reply_assist('00000000-0000-0000-0000-0000000000d1', 'availability', 'nochmal', true, 'x', 'y') ->> 'action', 'duplicate', 'handled once');
select ok((public.save_reply_assist('00000000-0000-0000-0000-0000000000d2', 'where_is_technician', 'Kunde fragt, wo der Techniker bleibt.', true,
  'Re: Wo bleibt der Techniker?', E'Guten Tag Anna Antwort,\n\nder Techniker ruft Sie an.\n\nMit freundlichen Grüßen\nRheinWerk Industrieservice · Service Desk',
  'Einsatz überfällig.', true, 0.9) ->> 'callback_id') is not null, 'overdue: callback request');
select is(public.save_reply_assist('00000000-0000-0000-0000-0000000000d3', 'thanks', 'Kunde bedankt sich.', false) ->> 'action', 'none', 'thanks: no draft');
select is(public.save_reply_assist('00000000-0000-0000-0000-0000000000d5', 'question', 'Frage', true, 'Re: x', 'Text') ->> 'action', 'answered_meanwhile', 'answered by staff: no second draft');
reset role;

select ok((select m.status = 'draft' and m.approved_at is null and m.to_address = 'anna@antwort.test' and m.author_id is null and m.body_text like 'Guten Tag Anna Antwort,%'
  from public.messages m where m.request_id = '00000000-0000-0000-0000-0000000000b1' and m.direction = 'outgoing'), 'draft, not approved, to the request address');
select ok((select r.step = 'reply_assist' and r.result ->> 'reason' = 'Wunschtermin frei laut Plan.' and (r.result ->> 'draft_id') is not null
  from public.automation_runs r where r.operation_key = 'reply_assist:00000000-0000-0000-0000-0000000000d1'), 'automation run with reason and draft');
select ok((select c.status = 'open' and c.conversation_id = 'email:00000000-0000-0000-0000-0000000000d2' and c.callback_number = '+49 621 1234567' and c.technician_id = '00000000-0000-0000-0000-0000000000f2'
  from public.callback_requests c where c.request_id = '00000000-0000-0000-0000-0000000000b2'), 'callback request for the technician of the visit');
select is((select count(*)::int from public.messages m where m.request_id = '00000000-0000-0000-0000-0000000000b3' and m.direction = 'outgoing'), 0, 'thanks: no message');
select is((select count(*)::int from jsonb_array_elements(public.reply_assist_pending(10) -> 'items') i where i ->> 'message_id' like '00000000-0000-0000-0000-0000000000d%'), 0, 'nothing pending any more');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.reply_assist_pending(5)$$, '42501', null, 'only the integration');
reset role;

select * from finish();
rollback;
