-- task-17-8: queues of n8n for the watchdog and warnings whose e-mail is due. Only service_role.
-- Run with: supabase test db
begin;
select plan(10);

update public.messages set status = 'sent', sent_at = now() where direction = 'outgoing' and status = 'queued';

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000018a1', 'admin18@x.test');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000018a1', 'Admin 18', 'admin');
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.queues() returns jsonb language sql as $$ select public.monitor_n8n_queues() $$;

-- Baseline of other live requests waiting for the analysis
select pg_temp.as_service();
set local role service_role;
create temp table base as select (pg_temp.queues() ->> 'analysis_waiting')::int as analysis;
grant select on base to service_role;
reset role;

-- r1 real request 20 minutes old (overdue), r2 real 5 minutes old, r3 demo 20 minutes old
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, is_demo, created_at)
select ('00000000-0000-0000-0000-0000000018b' || n)::uuid, 'n8nmon-r' || n, 'n8nmon' || n, 'website_form', 'ACME', 'Erika', 'e@acme.test', '1',
  'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', n = 3,
  now() - case when n = 2 then interval '5 minutes' else interval '20 minutes' end
from generate_series(1, 3) as n;
insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at) values
  ('00000000-0000-0000-0000-0000000018b1', 'outgoing', 'receipt', 'queued', 'e@acme.test', 'Eingang', 'Danke', now() - interval '15 minutes'),
  ('00000000-0000-0000-0000-0000000018b2', 'outgoing', 'receipt', 'queued', 'e@acme.test', 'Eingang', 'Danke', now() - interval '5 minutes');

select pg_temp.as_service();
set local role service_role;
select is((pg_temp.queues() ->> 'send_waiting')::int, 1, 'e-mail waiting longer than 10 minutes');
select ok((pg_temp.queues() ->> 'send_oldest')::timestamptz <= now() - interval '14 minutes', 'oldest waiting e-mail');
select is((pg_temp.queues() ->> 'analysis_waiting')::int, (select analysis from base) + 1, 'only the real request older than 15 minutes waits for the analysis');

-- Warnings: new without e-mail, mailed recently, mailed 7 hours ago, resolved
select public.raise_alert('n8n', 'n8n:fehler:test-a', 'warning', 'A');
select public.raise_alert('n8n', 'n8n:fehler:test-b', 'warning', 'B');
select public.mark_alert_notified((select id from public.system_alerts where alert_key = 'n8n:fehler:test-b'));
select public.raise_alert('n8n', 'n8n:fehler:test-c', 'warning', 'C');
select public.mark_alert_notified((select id from public.system_alerts where alert_key = 'n8n:fehler:test-c'));
reset role;
update public.system_alerts set notified_at = now() - interval '7 hours' where alert_key = 'n8n:fehler:test-c';
select pg_temp.as_service();
set local role service_role;
select public.raise_alert('n8n', 'n8n:fehler:test-d', 'warning', 'D');
select public.clear_alert('n8n:fehler:test-d');
select ok((select bool_or(alert_key = 'n8n:fehler:test-a') from public.alerts_to_notify()), 'never mailed warning is due');
select ok((select not bool_or(alert_key = 'n8n:fehler:test-b') from public.alerts_to_notify()), 'recently mailed warning is not due');
select ok((select bool_or(alert_key = 'n8n:fehler:test-c') from public.alerts_to_notify()), 'reminder after 6 hours');
select ok((select not bool_or(alert_key = 'n8n:fehler:test-d') from public.alerts_to_notify()), 'resolved warning is not due');
select is((select count(*)::int from public.open_alerts('n8n:fehler:test-')), 3, 'open warnings of a prefix');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000018a1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.monitor_n8n_queues()$$, '42501', null, 'staff cannot read the queues');
select throws_ok($$select * from public.alerts_to_notify()$$, '42501', null, 'staff cannot list due e-mails');
reset role;

select * from finish();
rollback;
