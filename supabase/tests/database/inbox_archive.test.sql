-- task-10-10: archive and restore inbox e-mails (rights, repetition, open inbox, no assignment while archived).
-- Run with: supabase test db
begin;
select plan(16);

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

insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('00000000-0000-0000-0000-000000000001', 'archive-r1', 'x', 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210',
  'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1');

-- e1 advertising, e2 a later customer e-mail, both in the inbox of dispatcher 1
insert into public.messages (id, inbox_dispatcher_id, direction, kind, status, from_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'news@werbung.test',
   'Sonderangebot Arbeitskleidung', 'Nur diese Woche 20 % Rabatt.', now()),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'incoming', 'other', 'received', 'e@acme.test',
   'Rückfrage', 'Wann kommt der Techniker?', now());

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.open_ids() returns setof uuid language sql as $$
  select id from public.messages where direction = 'incoming' and request_id is null and archived_at is null
    and id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
$$;
set local role authenticated;

-- Rights
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.archive_message('00000000-0000-0000-0000-0000000000e1', 'advertising')$$, '42501', null, 'technician cannot archive');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.archive_message('00000000-0000-0000-0000-0000000000e1', 'advertising')$$, '42501', null, 'other dispatcher cannot archive a foreign inbox');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.archive_message('00000000-0000-0000-0000-0000000000e1', 'spam')$$, 'RW422', null, 'unknown reason rejected');

-- Archive by the inbox owner
select ok((select archived_at is not null and archived_by = '00000000-0000-0000-0000-0000000000d1' and archive_reason = 'advertising' and handled_at is not null
  from public.archive_message('00000000-0000-0000-0000-0000000000e1', 'advertising')), 'owner archives with reason, person and time');
select is((select array_agg(x) from pg_temp.open_ids() x), array['00000000-0000-0000-0000-0000000000e2'::uuid], 'archived e-mail leaves the open inbox');
select is((select archive_reason from public.archive_message('00000000-0000-0000-0000-0000000000e1', 'other')), 'advertising', 'repetition changes nothing');
select is((select count(*)::int from public.messages where id = '00000000-0000-0000-0000-0000000000e1'), 1, 'archived e-mail stays readable for the owner');

-- No assignment while archived
select throws_ok($$select public.link_message('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000001', 1)$$,
  'RW422', null, 'archived e-mail cannot be linked');
select is((select request_id from public.messages where id = '00000000-0000-0000-0000-0000000000e1'), null, 'still unmatched');

-- Assigned e-mails cannot be archived
select lives_ok($$select public.link_message('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000001', 1)$$, 'customer e-mail linked');
select throws_ok($$select public.archive_message('00000000-0000-0000-0000-0000000000e2', 'other')$$, 'RW422', null, 'assigned e-mail cannot be archived');

-- Restore: other dispatcher no, manager yes
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.restore_message('00000000-0000-0000-0000-0000000000e1')$$, '42501', null, 'other dispatcher cannot restore');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select ok((select archived_at is null and archived_by is null and archive_reason is null and handled_at is null
  from public.restore_message('00000000-0000-0000-0000-0000000000e1')), 'manager restores');
select is((select array_agg(x) from pg_temp.open_ids() x), array['00000000-0000-0000-0000-0000000000e1'::uuid], 'restored e-mail is open again');
select ok((select archived_at is null from public.restore_message('00000000-0000-0000-0000-0000000000e1')), 'restoring twice changes nothing');

-- Direct writes stay closed (no update grant on messages)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$update public.messages set archived_at = now(), archived_by = '00000000-0000-0000-0000-0000000000d1', archive_reason = 'other'
  where id = '00000000-0000-0000-0000-0000000000e1'$$, '42501', null, 'no direct archive via table update');

select * from finish();
rollback;
