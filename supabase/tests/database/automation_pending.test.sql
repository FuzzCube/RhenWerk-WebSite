-- task-24-1: requests the automation works on right now (analysis, customer reply for workflow 13/14), rights.
-- Run with: supabase test db
begin;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@x.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@x.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'e3@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Dispo E', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000e2', 'Dispo Fremd', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000e3', 'Technik E', 'technician');

-- 1 new (analysis), 2 new but older than 15 minutes, 3..7 processed with a customer reply:
-- 3 waiting, 4 assistant done, 5 workflow 13 moved the visit, 6 answered by staff, 7 bounce
insert into public.requests (id, source_event_key, source, request_number, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, created_at)
select ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'automation-pending-' || n, 'website_form', 'RIS-2099-2000' || n, 'Lauf GmbH', 'Lea Lauf', 'lea@lauf.test', '1',
  'Str. 1', '68159', 'Mannheim', 'pump', 'inspection', current_date + 7, 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3',
  case when n <= 2 then 'new' else 'processed' end::public.intake_status,
  case when n <= 2 then null else now() - interval '1 day' end,
  case when n <= 2 then null else 'manual' end::public.intake_mode, case when n <= 2 then null else 15 end,
  case when n = 2 then now() - interval '20 minutes' when n = 1 then now() else now() - interval '2 days' end
from generate_series(1, 7) n;
insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at)
select ('00000000-0000-0000-0000-0000000000c' || n)::uuid, ('00000000-0000-0000-0000-0000000000a' || n)::uuid, 'incoming', 'customer_reply', 'received',
  case when n = 7 then 'mailer-daemon@googlemail.com' else 'lea@lauf.test' end,
  case when n = 7 then 'Delivery Status Notification (Failure)' else 'Re: Termin' end, 'Frage', now() - interval '2 minutes'
from generate_series(3, 7) n;
insert into public.automation_runs (request_id, message_id, operation_key, step, status, result, finished_at) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c4', 'reply_assist:00000000-0000-0000-0000-0000000000c4', 'reply_assist', 'succeeded', '{}', now()),
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000c5', 'visit_reply:00000000-0000-0000-0000-0000000000c5', 'visit_reply', 'succeeded', '{"action": "moved"}', now());
insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, author_id)
values ('00000000-0000-0000-0000-0000000000a6', 'outgoing', 'other', 'draft', 'lea@lauf.test', 'Re: Termin', 'Antwort', '00000000-0000-0000-0000-0000000000e1');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e1', 'role', 'authenticated')::text, true);
select is((select reason from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a1'), 'analyse', 'new request: analysis running');
select is((select count(*)::int from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a2'), 0, 'older than 15 minutes: no longer shown');
select is((select reason from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a3'), 'antwort', 'customer reply waits for the automation');
select is((select count(*)::int from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a4'), 0, 'assistant has run');
select is((select count(*)::int from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a5'), 0, 'workflow 13 handled it by itself');
select is((select count(*)::int from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a6'), 0, 'staff already started an answer');
select is((select count(*)::int from public.request_automation_pending where request_id = '00000000-0000-0000-0000-0000000000a7'), 0, 'bounce is not waited for');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.request_automation_pending where request_id::text like '00000000-0000-0000-0000-0000000000a%'), 0, 'another dispatcher sees nothing of these requests');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000e3', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.request_automation_pending), 0, 'technician sees nothing');
reset role;

select * from finish();
rollback;
