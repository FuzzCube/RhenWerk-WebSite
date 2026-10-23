-- task-20-10: a customer cancels a planned visit by replying to an e-mail; unclear wishes are only flagged.
-- Run with: supabase test db
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@x.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Dispo E', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000e2', 'Technik E', 'technician');

-- Three planned requests with a visit in a week: cancel, move wish, cancel from a foreign address
insert into public.requests (id, source_event_key, source, request_number, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, priority)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'visit-reply-' || n, 'website_form', 'RIS-2099-0000' || n, 'Storno GmbH', 'Stefan Storno', 'stefan@storno.test', '1',
  'Str. 1', '68159', 'Mannheim', 'pump', 'inspection', current_date + 7, 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2', 'processed', now(), 'manual', 15, 'scheduled', 'normal'
from generate_series(1, 3) n;
insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by, created_at)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, '00000000-0000-0000-0000-0000000000e2',
  date_trunc('day', now()) + interval '7 days' + (3 * n || ' hours')::interval + interval '2 hours',
  date_trunc('day', now()) + interval '7 days' + (3 * n || ' hours')::interval + interval '4 hours',
  '00000000-0000-0000-0000-0000000000e1', now() - interval '1 hour'
from generate_series(1, 3) n;
insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at)
values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'incoming', 'customer_reply', 'received', 'Stefan Storno <Stefan@storno.test>',
    'Re: Terminbestätigung RIS-2099-00001', 'Ich möchte meinen Termin stornieren.', now()),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000a2', 'incoming', 'customer_reply', 'received', 'stefan@storno.test',
    'Re: Terminbestätigung RIS-2099-00002', 'Geht es auch eine Woche später?', now()),
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000a3', 'incoming', 'customer_reply', 'received', 'fremd@andere.test',
    'Re: Terminbestätigung RIS-2099-00003', 'Bitte Termin stornieren.', now());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok((select count(*) = 3 from jsonb_array_elements(public.visit_replies_pending(10) -> 'items') i
  where i ->> 'message_id' like '00000000-0000-0000-0000-0000000000c%' and jsonb_array_length(i -> 'visits') = 1), 'replies after planning are pending, with the coming visit');

select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000c1', 'cancel_visit', 0.95, 'Kunde storniert den Termin.') ->> 'action', 'cancelled', 'clear cancellation');
select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000c1', 'cancel_visit', 0.95, 'nochmal') ->> 'action', 'duplicate', 'evaluated once');
select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000c2', 'reschedule', 0.9, 'Kunde bittet um eine Woche später.') ->> 'action', 'change_requested', 'move wish: change request with acknowledgement');
select is(public.apply_visit_reply('00000000-0000-0000-0000-0000000000c3', 'cancel_visit', 0.95, 'Storno von fremder Adresse.') ->> 'action', 'flagged', 'foreign sender: flagged only');
select is((select count(*)::int from jsonb_array_elements(public.visit_replies_pending(10) -> 'items') i where i ->> 'message_id' like '00000000-0000-0000-0000-0000000000c%'), 0, 'nothing pending any more');
select ok((select count(*) = 1 from public.claim_queued_messages(20) c where c ->> 'request_id' = '00000000-0000-0000-0000-0000000000a1' and c ->> 'subject' like 'Stornierung Ihres Termins RIS-%' and c ->> 'approved_by' = 'system'),
  'cancellation mail is released for sending');
reset role;

select is((select status::text from public.visits where request_id = '00000000-0000-0000-0000-0000000000a1'), 'cancelled', 'visit cancelled');
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-0000000000a1'), 'not_planned', 'request back to planning, not cancelled');
select is((select intake_status::text from public.requests where id = '00000000-0000-0000-0000-0000000000a1'), 'processed', 'request itself stays open');
select ok((select m.system_template = 'visit_cancelled' and m.to_address = 'stefan@storno.test' and m.body_text like '%wie gewünscht haben wir Ihren Termin%storniert%'
  from public.messages m where m.request_id = '00000000-0000-0000-0000-0000000000a1' and m.direction = 'outgoing'), 'confirmation to the customer');
select is((select status::text from public.visits where request_id = '00000000-0000-0000-0000-0000000000a2'), 'scheduled', 'move wish: visit stays');
select is((select status::text from public.visits where request_id = '00000000-0000-0000-0000-0000000000a3'), 'scheduled', 'foreign sender: visit stays');
select ok((select count(*) = 3 from public.request_events where event_type = 'visit_reply_analyzed' and request_id::text like '00000000-0000-0000-0000-0000000000a%'), 'every reply logged for the dispatcher');
select ok((select r.step = 'visit_reply' and r.result ->> 'intent' = 'cancel_visit' from public.automation_runs r where r.operation_key = 'visit_reply:00000000-0000-0000-0000-0000000000c1'), 'own automation run');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.apply_visit_reply('00000000-0000-0000-0000-0000000000c2', 'cancel_visit', 1, 'x')$$, '42501', null, 'only the integration');
reset role;

select * from finish();
rollback;
