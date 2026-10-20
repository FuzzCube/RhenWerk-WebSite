-- task-12-9: send_backlog counts e-mails that n8n should have sent, waiting longer than min_minutes.
-- Run with: supabase test db
begin;
select plan(9);

-- Only the e-mails of this test count
update public.messages set status = 'sent', sent_at = now() where direction = 'outgoing' and status = 'queued';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');

-- r1..r3 real requests, r4 demo request; none belongs to dispatcher 1
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, is_demo)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'backlog-r' || n, 'x' || n, 'website_form', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', n = 4
from generate_series(1, 4) as n;

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.waiting(min_minutes integer default 10) returns integer language sql as $$
  select waiting from public.send_backlog(min_minutes);
$$;
set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.send_backlog()$$, '42501', null, 'technician cannot read the backlog');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(pg_temp.waiting(), 0, 'nothing waiting');

reset role;
-- Receipt approved 15 minutes ago (counts), receipt 5 minutes ago (too young), receipt of a demo request (never sent),
-- clarification without approval (n8n does not send it)
insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at) values
  ('00000000-0000-0000-0000-000000000001', 'outgoing', 'receipt', 'queued', 'e@acme.test', 'Eingang', 'Danke', now() - interval '15 minutes'),
  ('00000000-0000-0000-0000-000000000002', 'outgoing', 'receipt', 'queued', 'e@acme.test', 'Eingang', 'Danke', now() - interval '5 minutes'),
  ('00000000-0000-0000-0000-000000000004', 'outgoing', 'receipt', 'queued', 'e@acme.test', 'Eingang', 'Danke', now() - interval '30 minutes');
insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, created_at) values
  ('00000000-0000-0000-0000-000000000003', 'outgoing', 'clarification', 'queued', 'e@acme.test', 'Frage', 'Typenschild?', now() - interval '30 minutes');
set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(pg_temp.waiting(), 1, 'only the approved real e-mail older than 10 minutes counts, also for a foreign request');
select ok((select oldest_at between now() - interval '16 minutes' and now() - interval '14 minutes' from public.send_backlog()), 'oldest waiting time');
select is(pg_temp.waiting(3), 2, 'shorter threshold also counts the younger e-mail');
select is(pg_temp.waiting(0), 2, 'threshold at least one minute');

reset role;
update public.messages set approved_by = '00000000-0000-0000-0000-0000000000d1', approved_at = now() - interval '20 minutes'
where request_id = '00000000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(pg_temp.waiting(), 2, 'approved clarification counts');

reset role;
update public.messages set status = 'sent', sent_at = now() where request_id in ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select is(pg_temp.waiting(), 0, 'sent e-mails no longer count');
select is((select oldest_at from public.send_backlog()), null, 'no oldest time without backlog');

select * from finish();
rollback;
