-- task-20-14: unread customer messages per request (view), marking as read, rights.
-- Run with: supabase test db
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');

create function pg_temp.req(k text, dispatcher uuid) returns uuid language sql as $$
  insert into public.requests (source_event_key, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id)
  values (k, 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210', 'Düsseldorf',
    'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', dispatcher,
    '00000000-0000-0000-0000-0000000000b1')
  returning id;
$$;
create function pg_temp.incoming(req uuid, subject text, plus interval default '1 minute', direction public.message_direction default 'incoming')
returns void language sql as $$
  insert into public.messages (request_id, direction, kind, status, from_address, to_address, subject, body_text, received_at, sent_at)
  select req, direction, case when direction = 'incoming' then 'customer_reply'::public.message_kind else 'clarification'::public.message_kind end,
    case when direction = 'incoming' then 'received'::public.message_status else 'sent'::public.message_status end,
    'k@acme.test', 'service@rheinwerk.test', subject, 'x',
    case when direction = 'incoming' then r.created_at + plus end, case when direction = 'outgoing' then r.created_at + plus end
  from public.requests r where r.id = req;
$$;

select pg_temp.req('un-1', '00000000-0000-0000-0000-0000000000d1') as r1 \gset
select pg_temp.req('un-2', '00000000-0000-0000-0000-0000000000d2') as r2 \gset

-- r1: the e-mail the request was created from (before it), two replies, an outgoing mail; r2: one reply
select pg_temp.incoming(:'r1', 'Ursprung', interval '-1 minute');
select pg_temp.incoming(:'r1', 'Stornierung', interval '1 minute');
select pg_temp.incoming(:'r1', 'Verschieben', interval '2 minutes');
select pg_temp.incoming(:'r1', 'Antwort', interval '3 minutes', 'outgoing');
select pg_temp.incoming(:'r2', 'Frage', interval '1 minute');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select is((select unread_count from public.request_unread_messages where request_id = :'r1'), 2, 'two unread customer e-mails, origin and outgoing not counted');
select is((select count(*)::int from public.request_unread_messages), 1, 'dispatcher sees only the unread messages of his requests');
select is((select latest_at > oldest_at from public.request_unread_messages where request_id = :'r1'), true, 'oldest and latest of the unread ones');
select throws_ok(format($$select public.mark_request_messages_read(%L)$$, :'r2'), '42501', null, 'another dispatcher cannot mark');
select is(public.mark_request_messages_read(:'r1'), 3, 'marking returns the number of incoming messages marked (origin included)');
select is((select count(*)::int from public.request_unread_messages where request_id = :'r1'), 0, 'nothing unread afterwards');
select is(public.mark_request_messages_read(:'r1'), 0, 'repeating changes nothing');
select is((select staff_read_by from public.messages where subject = 'Stornierung'), '00000000-0000-0000-0000-0000000000d1'::uuid, 'who read it is kept');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select throws_ok(format($$select public.mark_request_messages_read(%L)$$, :'r2'), '42501', null, 'technician cannot mark');
select is((select count(*)::int from public.request_unread_messages), 0, 'technician sees no messages');
reset role;

-- A conversation linked to a request by a person counts as read
insert into public.messages (inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at)
values ('00000000-0000-0000-0000-0000000000d2', 'incoming', 'other', 'received', 'k@acme.test', 'Posteingang', 'x', now() + interval '1 hour');
select private.move_inbox_conversation((select id from public.messages where subject = 'Posteingang'), :'r2');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.request_unread_messages where request_id = :'r2'), 1, 'only the reply is unread, the linked inbox e-mail counts as read');
reset role;

select * from finish();
rollback;
