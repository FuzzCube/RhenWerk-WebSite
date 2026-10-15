-- task-11-7: unmatched e-mails go to the least-loaded active dispatcher (open intakes + open inbox e-mails);
-- deactivation moves open inbox e-mails. Run with: supabase test db
begin;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'admin@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'd3@x.test');
-- Only the test dispatchers take part
update public.profiles set is_active = false where role = 'dispatcher';
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a9', 'Admin', 'admin', true),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d3', 'Dispo 3', 'dispatcher', true);

-- Load: d1 two open intakes, d2 one open inbox e-mail plus an archived and a linked one (not counted), d3 one
-- completed intake (not counted) and a demo intake (not counted)
create function pg_temp.req(k text, dispatcher uuid, completed boolean default false, demo boolean default false) returns uuid language sql as $$
  insert into public.requests (source_event_key, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload, dispatcher_id, is_demo, intake_status, intake_mode, intake_completed_at, priority, manual_minutes_baseline)
  values (k, case when demo then 'demo_seed' else 'website_form' end, 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210', 'Düsseldorf',
    'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', dispatcher, demo,
    case when completed then 'processed'::public.intake_status else 'new'::public.intake_status end,
    case when completed then 'manual'::public.intake_mode end, case when completed then now() end,
    case when completed then 'normal'::public.request_priority end, case when completed then 15 end)
  returning id;
$$;
select pg_temp.req('lb-1', '00000000-0000-0000-0000-0000000000d1');
select pg_temp.req('lb-2', '00000000-0000-0000-0000-0000000000d1');
select pg_temp.req('lb-3', '00000000-0000-0000-0000-0000000000d3', completed => true);
select pg_temp.req('lb-4', '00000000-0000-0000-0000-0000000000d3', demo => true);
insert into public.messages (inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-0000000000d2', 'incoming', 'other', 'received', 'a@x.test', 'offen', 'x', now());
insert into public.messages (inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at, archived_at, archived_by, archive_reason) values
  ('00000000-0000-0000-0000-0000000000d3', 'incoming', 'other', 'received', 'b@x.test', 'archiviert', 'x', now(), now(), '00000000-0000-0000-0000-0000000000a9', 'advertising');
insert into public.messages (request_id, direction, kind, status, from_address, subject, body_text, received_at)
  select r.id, 'incoming', 'customer_reply', 'received', 'c@x.test', 'zugeordnet', 'x', now() from public.requests r where r.source_event_key = 'lb-1';

create function pg_temp.mail(n integer) returns jsonb language sql as $$
  select public.record_incoming_message(jsonb_build_object('contract_version', '1.0', 'mailbox_key', 'rheinwerk.industrieservice@gmail.com',
    'gmail_message_id', 'lb-mail-' || n, 'gmail_thread_id', 'lb-thread-' || n, 'from_address', 'neu' || n || '@kunde.test',
    'subject', 'Anfrage ohne Nummer ' || n, 'body_text', 'Bitte um Angebot.'));
$$;
create function pg_temp.owner(n integer) returns uuid language sql as $$
  select inbox_dispatcher_id from public.messages where gmail_message_id = 'lb-mail-' || n;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
-- Loads: d1 = 2, d2 = 1, d3 = 0 → d3
select pg_temp.mail(1);
select is(pg_temp.owner(1), '00000000-0000-0000-0000-0000000000d3'::uuid, 'least-loaded dispatcher gets the e-mail (completed, demo and archived not counted)');
-- Loads: d1 = 2, d2 = 1, d3 = 1 → tie d2/d3, lower id wins
select pg_temp.mail(2);
select is(pg_temp.owner(2), '00000000-0000-0000-0000-0000000000d2'::uuid, 'tie: lower id');
-- Loads: d1 = 2, d2 = 2, d3 = 1 → d3
select pg_temp.mail(3);
select is(pg_temp.owner(3), '00000000-0000-0000-0000-0000000000d3'::uuid, 'open inbox e-mails count as load');
select is((select count(distinct inbox_dispatcher_id)::int from public.messages where gmail_message_id like 'lb-mail-%'), 2, 'e-mails are spread, not all on one person');
select is((pg_temp.mail(1) ->> 'duplicate')::boolean, true, 'repeated e-mail stays a duplicate');
reset role;

-- Inactive dispatcher gets nothing
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000d3';
set local role service_role;
select pg_temp.mail(4);
select isnt(pg_temp.owner(4), '00000000-0000-0000-0000-0000000000d3'::uuid, 'inactive dispatcher gets no e-mail');
reset role;
update public.profiles set is_active = true where id = '00000000-0000-0000-0000-0000000000d3';

-- Deactivation: open inbox e-mails of d3 go to the replacement; without one to the least-loaded other dispatcher
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000a9', 'role', 'authenticated')::text, true);
set local role authenticated;
select is((public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d1') ->> 'reassigned_inbox')::int, 2,
  'deactivation reports two moved inbox e-mails');
reset role;
select is((select count(*)::int from public.messages where inbox_dispatcher_id = '00000000-0000-0000-0000-0000000000d1' and gmail_message_id in ('lb-mail-1', 'lb-mail-3')), 2,
  'open inbox e-mails now with the replacement');
select is((select inbox_dispatcher_id from public.messages where subject = 'archiviert'), '00000000-0000-0000-0000-0000000000d3'::uuid,
  'archived e-mail keeps its owner');
set local role authenticated;
select is((public.admin_deactivate_employee('00000000-0000-0000-0000-0000000000d2') ->> 'reassigned_inbox')::int, 2,
  'without replacement the e-mails go to the remaining dispatcher');

select * from finish();
rollback;
