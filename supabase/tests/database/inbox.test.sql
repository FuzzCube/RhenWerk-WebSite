-- task-10-5: inbox of unmatched incoming e-mails (visibility per role, link_message, create_request_from_message).
-- Run with: supabase test db
begin;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');

-- r1 belongs to dispatcher 1
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id)
values ('00000000-0000-0000-0000-000000000001', 'inbox-r1', 'x', 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210',
  'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1');

-- e1 and e2 in the inbox of dispatcher 1, e1 with an attachment
insert into public.messages (id, inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'einkauf@neu.test',
   'Wartung Kompressor', 'Bitte bieten Sie eine Wartung an.', now()),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'e@acme.test',
   'Rückfrage ohne Nummer', 'Wann kommt der Techniker?', now());
insert into public.attachments (message_id, bucket, storage_path, file_name, mime_type, size_bytes)
values ('00000000-0000-0000-0000-0000000000e1', 'dashboard', 'gmail/e1/typenschild.jpg', 'typenschild.jpg', 'image/jpeg', 100);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.fields() returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Neu GmbH', 'contact_name', 'Max Neu', 'business_email', 'einkauf@neu.test',
    'phone_number', '0211 1', 'street_house_number', 'Weg 2', 'postal_code', '40211', 'city', 'Düsseldorf',
    'equipment_kind', 'compressor', 'service_kind', 'scheduled_maintenance', 'requested_visit_date', '2026-11-02',
    'customer_urgency', 'planbar', 'safety_risk', 'none_known', 'description', 'Wartung des Kompressors laut E-Mail.');
$$;
set local role authenticated;

-- Visibility
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is((select count(*)::int from public.messages where request_id is null), 2, 'inbox owner sees both unmatched messages');
select is((select count(*)::int from public.attachments where message_id = '00000000-0000-0000-0000-0000000000e1'), 1, 'inbox owner sees the attachment');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select is((select count(*)::int from public.messages where request_id is null), 0, 'other dispatcher sees no foreign inbox');
select is((select count(*)::int from public.attachments where message_id = '00000000-0000-0000-0000-0000000000e1'), 0, 'other dispatcher sees no foreign attachment');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select is((select count(*)::int from public.messages where request_id is null), 0, 'technician sees no inbox');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((select count(*)::int from public.messages where request_id is null
  and id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2')), 2, 'manager sees every inbox');

-- link_message: only owner, manager, admin
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.link_message('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'other dispatcher cannot link');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.link_message('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null, 'technician cannot link');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$select public.link_message('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 1)$$,
  'inbox owner links to own request');
select is((select request_id from public.messages where id = '00000000-0000-0000-0000-0000000000e2'), '00000000-0000-0000-0000-000000000001'::uuid,
  'message belongs to the request afterwards');
select is((select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'message_linked'), 1,
  'link is logged');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e2', pg_temp.fields())$$,
  'RW422', null, 'linked message cannot create a request');

-- create_request_from_message
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields())$$,
  '42501', null, 'technician cannot create a request from an e-mail');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields())$$,
  '42501', null, 'other dispatcher cannot create from a foreign inbox');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields() - 'phone_number')$$,
  'RW422', null, 'required field missing');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields() || '{"postal_code": "4021"}')$$,
  'RW422', null, 'invalid postal code');
select lives_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields())$$,
  'inbox owner creates a request');
select ok((select source = 'email' and dispatcher_id = '00000000-0000-0000-0000-0000000000d1' and intake_status = 'new' and request_number like 'RIS-%'
  from public.requests where source_event_key = 'email:00000000-0000-0000-0000-0000000000e1'),
  'new request: source email, inbox owner as dispatcher, status new, number assigned');
select ok((select m.request_id = r.id and m.handled_at is not null from public.messages m, public.requests r
  where m.id = '00000000-0000-0000-0000-0000000000e1' and r.source_event_key = 'email:00000000-0000-0000-0000-0000000000e1'),
  'message belongs to the new request');
select ok((select a.request_id is not null from public.attachments a where a.message_id = '00000000-0000-0000-0000-0000000000e1'),
  'attachment moved to the new request');
select is((select array_agg(event_type order by event_type) from public.request_events e join public.requests r on r.id = e.request_id
  where r.source_event_key = 'email:00000000-0000-0000-0000-0000000000e1'), array['message_linked', 'request_created_from_message'],
  'creation and link are logged');
select is((public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields())).id,
  (select id from public.requests where source_event_key = 'email:00000000-0000-0000-0000-0000000000e1'), 'repetition returns the same request');
select is((select count(*)::int from public.requests where source = 'email'), 1, 'no duplicate request');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000e1', pg_temp.fields())$$,
  '42501', null, 'repetition by someone without access does not reveal the request');

select * from finish();
rollback;
