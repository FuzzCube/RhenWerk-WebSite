-- task-16-1: calls without a request are deleted 12 months after the end of the call (purge_unlinked_calls, nightly
-- pg_cron job); calls with a request and recent calls stay. Run with: supabase test db
begin;
select plan(6);

insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload)
values ('00000000-0000-0000-0000-0000000016a1', 'purge-linked', 'phone', 'Alt GmbH', 'Erika', 'e@x.test', '1', 'Testweg 1', '99016',
  'Teststadt', 'pump', 'diagnosis_repair', current_date, 'Test', 'planbar', 'none_known', '{}');

insert into public.phone_calls (conversation_id, started_at, ended_at, request_id, summary) values
  ('purge-old-unlinked', now() - interval '13 months', now() - interval '13 months', null, 'Alt ohne Anfrage'),
  ('purge-old-no-end', now() - interval '13 months', null, null, 'Alt ohne Ende'),
  ('purge-old-linked', now() - interval '13 months', now() - interval '13 months', '00000000-0000-0000-0000-0000000016a1', 'Alt mit Anfrage'),
  ('purge-recent-unlinked', now() - interval '11 months', now() - interval '11 months', null, 'Frisch ohne Anfrage');

select is(public.purge_unlinked_calls(), 2, 'two old calls without a request deleted');
select is((select count(*)::int from public.phone_calls where conversation_id in ('purge-old-unlinked', 'purge-old-no-end')), 0,
  'old calls without a request are gone (start counts when the end is missing)');
select is((select summary from public.phone_calls where conversation_id = 'purge-old-linked'), 'Alt mit Anfrage', 'old call with a request stays');
select is((select summary from public.phone_calls where conversation_id = 'purge-recent-unlinked'), 'Frisch ohne Anfrage', 'recent call without a request stays');
select is((select command from cron.job where jobname = 'calls-without-request-12-months'), 'select public.purge_unlinked_calls()', 'nightly job registered');
select ok(not has_function_privilege('authenticated', 'public.purge_unlinked_calls()', 'execute'), 'staff cannot call the purge');

select * from finish();
rollback;
