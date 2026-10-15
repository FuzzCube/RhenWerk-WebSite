-- task-12-3: reply to an inbox e-mail without a request; conversation (inbox_root_id) with later customer e-mails;
-- sending through the n8n queue; assigning, creating and archiving act on the whole conversation.
-- Run with: supabase test db
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.requests (id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('00000000-0000-0000-0000-000000000001', 'reply-r1', 'x', 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210',
  'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1');

-- f1: from the real mailbox (thread t-1); f2: a test/demo row without mailbox; f3: for creating a request; f4: to archive
insert into public.messages (id, inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at,
  mailbox_key, gmail_message_id, gmail_thread_id, mime_message_id, references_header) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'kunde@acme.test',
   'Frage zu unserem Auftrag', 'Wann kommt Ihr Techniker?', now() - interval '1 hour',
   'rheinwerk.industrieservice@gmail.com', 'g-f1', 't-1', '<f1@acme.test>', '{<alt@acme.test>}'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'demo@example.com',
   'Demo', 'Demo', now() - interval '1 hour', 'service', 'demo-f2', 'demo-thread', '<f2@example.com>', null),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'einkauf@neu.test',
   'Wartung', 'Bitte Wartung anbieten.', now() - interval '1 hour', 'rheinwerk.industrieservice@gmail.com', 'g-f3', 't-3', '<f3@neu.test>', null),
  ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'news@werbung.test',
   'Angebot', 'Newsletter', now() - interval '1 hour', 'rheinwerk.industrieservice@gmail.com', 'g-f4', 't-4', '<f4@werbung.test>', null);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.reply(target uuid, body text default 'Bitte nennen Sie uns Ihre Anfragenummer.') returns public.messages language sql as $$
  select public.reply_to_inbox_message(target, 'AW: Frage zu unserem Auftrag', body);
$$;
create function pg_temp.incoming(n text, thread text, in_reply_to text default null) returns jsonb language sql as $$
  select public.record_incoming_message(jsonb_build_object('contract_version', '1.0', 'mailbox_key', 'rheinwerk.industrieservice@gmail.com',
    'gmail_message_id', 'g-' || n, 'gmail_thread_id', thread, 'mime_message_id', '<' || n || '@acme.test>', 'in_reply_to', in_reply_to,
    'from_address', 'kunde@acme.test', 'subject', 'Re: Frage', 'body_text', 'Antwort ' || n));
$$;
create function pg_temp.fields() returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Neu GmbH', 'contact_name', 'Max Neu', 'business_email', 'einkauf@neu.test',
    'phone_number', '0211 1', 'street_house_number', 'Weg 2', 'postal_code', '40211', 'city', 'Düsseldorf',
    'equipment_kind', 'compressor', 'service_kind', 'scheduled_maintenance', 'requested_visit_date', '2026-11-02',
    'customer_urgency', 'planbar', 'safety_risk', 'none_known', 'description', 'Wartung des Kompressors laut E-Mail.');
$$;

-- Rights and input
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f1')$$, '42501', null, 'technician cannot reply');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f1')$$, '42501', null, 'other dispatcher cannot reply to a foreign inbox');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f1', '  ')$$, 'RW422', null, 'empty text is refused');
select throws_ok($$select public.reply_to_inbox_message('00000000-0000-0000-0000-0000000000f1', 'x', repeat('a', 10001))$$, 'RW422', null, 'too long text is refused');

-- Reply: queued, approved by the sender, in the thread of the customer e-mail
select lives_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f1')$$, 'inbox owner replies');
select ok((select status = 'queued' and kind = 'clarification' and request_id is null and inbox_root_id = '00000000-0000-0000-0000-0000000000f1'
    and inbox_dispatcher_id = '00000000-0000-0000-0000-0000000000d1' and to_address = 'kunde@acme.test'
    and approved_by = '00000000-0000-0000-0000-0000000000d1' and author_id = approved_by and approved_at is not null
  from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'),
  'reply queued, approved by the sender, addressed to the customer');
select ok((select gmail_thread_id = 't-1' and in_reply_to = '<f1@acme.test>' and references_header = '{<alt@acme.test>,<f1@acme.test>}'
  from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'), 'reply in the Gmail thread');
select is((pg_temp.reply('00000000-0000-0000-0000-0000000000f1')).id,
  (select id from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'), 'double click sends once');
select is((select count(*)::int from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1'), 1, 'one reply only');
select lives_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f2', 'Demo-Antwort')$$, 'reply to a demo row is stored');
select is((select count(*)::int from public.messages where id = '00000000-0000-0000-0000-0000000000f1' and request_id is null and handled_at is null), 1,
  'the e-mail stays open after the reply');
reset role;

-- Sending through the n8n queue: only conversations of the real mailbox
select pg_temp.as_service();
set local role service_role;
select ok(exists(select 1 from public.claim_queued_messages(20, 180) c
  where (c ->> 'inbox_root_id')::uuid = '00000000-0000-0000-0000-0000000000f1' and c ->> 'gmail_thread_id' = 't-1' and c ->> 'in_reply_to' = '<f1@acme.test>'),
  'n8n claims the reply with thread and In-Reply-To');
select ok(not exists(select 1 from public.claim_queued_messages(20, 180) c where (c ->> 'inbox_root_id')::uuid = '00000000-0000-0000-0000-0000000000f2'),
  'a demo or test row is never sent');
select lives_ok($$select public.mark_message_failed((select id from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'), 'Zeitüberschreitung')$$,
  'temporary failure without a request');
select lives_ok($$select public.confirm_message_sent((select id from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'),
  now(), 'rheinwerk.industrieservice@gmail.com', 'g-reply', 't-1', '<reply@rheinwerk.test>')$$, 'confirmation without a request');
select ok((select status = 'sent' and sent_at is not null and mime_message_id = '<reply@rheinwerk.test>'
  from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing'), 'reply marked as sent');
select is((select status::text from public.automation_runs where operation_key = 'email_send:' ||
  (select id from public.messages where inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and direction = 'outgoing')), 'succeeded', 'send run succeeded');

-- The customer answers in the thread (or to our reply): same conversation, same inbox
select pg_temp.incoming('c1', 't-1');
select ok((select inbox_root_id = '00000000-0000-0000-0000-0000000000f1' and inbox_dispatcher_id = '00000000-0000-0000-0000-0000000000d1'
    and kind = 'customer_reply' and request_id is null from public.messages where gmail_message_id = 'g-c1'),
  'answer in the thread joins the conversation in the same inbox');
select pg_temp.incoming('c2', 'other-thread', '<reply@rheinwerk.test>');
select is((select inbox_root_id from public.messages where gmail_message_id = 'g-c2'), '00000000-0000-0000-0000-0000000000f1'::uuid,
  'answer to our reply in another thread joins as well');
reset role;

-- Assigning a later message assigns the whole conversation; later e-mails in the thread go to the request
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select lives_ok($$select public.link_message((select id from public.messages where gmail_message_id = 'g-c1'), '00000000-0000-0000-0000-000000000001',
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))$$, 'link via a later message of the conversation');
reset role;
select is((select count(*)::int from public.messages where request_id = '00000000-0000-0000-0000-000000000001'
  and (id = '00000000-0000-0000-0000-0000000000f1' or inbox_root_id = '00000000-0000-0000-0000-0000000000f1')), 4,
  'root, reply and both answers belong to the request');
select is((select (data ->> 'conversation_messages')::int from public.request_events
  where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'message_linked'), 4, 'link logged with the size of the conversation');
select pg_temp.as_service();
set local role service_role;
select pg_temp.incoming('c3', 't-1');
reset role;
select is((select request_id from public.messages where gmail_message_id = 'g-c3'), '00000000-0000-0000-0000-000000000001'::uuid,
  'the next answer in the thread goes straight to the request');

-- Creating a request takes the conversation along
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select pg_temp.reply('00000000-0000-0000-0000-0000000000f3', 'Bitte Standort nennen.');
select lives_ok($$select public.create_request_from_message('00000000-0000-0000-0000-0000000000f3', pg_temp.fields())$$, 'request from the conversation');
reset role;
select is((select count(*)::int from public.messages m join public.requests r on r.id = m.request_id
  where r.source_event_key = 'email:00000000-0000-0000-0000-0000000000f3'), 2, 'e-mail and reply belong to the new request');

-- Archived: no reply; a later e-mail in its thread starts a new conversation
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.archive_message('00000000-0000-0000-0000-0000000000f4', 'advertising');
select throws_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f4')$$, 'RW422', null, 'archived e-mail: restore first');
reset role;
select pg_temp.as_service();
set local role service_role;
select pg_temp.incoming('c4', 't-4');
reset role;
select ok((select inbox_root_id is null and request_id is null from public.messages where gmail_message_id = 'g-c4'),
  'a new e-mail in an archived thread is a new conversation');

-- Load counts conversations, not their messages; no direct insert of an outgoing row without a conversation
-- d2 has nothing, d1 has one open conversation (f2 with its reply): the reply does not count as load
update public.profiles set is_active = false where role = 'dispatcher' and id not in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2');
update public.messages set inbox_dispatcher_id = '00000000-0000-0000-0000-0000000000d2' where gmail_message_id = 'g-c4';
update public.requests set dispatcher_id = '00000000-0000-0000-0000-0000000000d2' where id <> '00000000-0000-0000-0000-000000000001' and dispatcher_id = '00000000-0000-0000-0000-0000000000d1';
select is(private.least_loaded_dispatcher(), '00000000-0000-0000-0000-0000000000d1'::uuid, 'load counts conversations, not replies (d1: f2 + r1 = 2, d2: c4 + new request = 2, tie by id; with the reply d1 would lose)');
select throws_ok($$insert into public.messages (inbox_dispatcher_id, direction, kind, status, to_address, subject, body_text)
  values ('00000000-0000-0000-0000-0000000000d1', 'outgoing', 'other', 'draft', 'a@b.test', 'x', 'x')$$, '23514', null,
  'outgoing without request needs a conversation');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select pg_temp.reply('00000000-0000-0000-0000-0000000000f1')$$, 'RW422', null, 'assigned conversation: reply under the request');

select * from finish();
rollback;
