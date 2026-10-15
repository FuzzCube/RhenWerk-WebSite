-- task-13-4: callback request to the technician of an overdue visit, acknowledgement, escalation after 15 minutes.
-- Run with: supabase test db
begin;
select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test'),
  ('00000000-0000-0000-0000-0000000000b2', 't2@x.test');
update public.profiles set is_active = false where role in ('technician', 'dispatcher');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician'),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik 2', 'technician');

-- Request 91: visit started 30 minutes ago (overdue). Request 92: visit tomorrow. Request 93: overdue, dispatcher d2.
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status)
select ('00000000-0000-0000-0000-0000000000' || n)::uuid, 'callback-' || n, 'website_form', 'Rückruf ' || n || ' GmbH', 'R', 'r@x.test', '1', 'Hafenstraße 12', '68159', 'Mannheim',
  'pump', 'diagnosis_repair', current_date, 'Test', 'planbar', 'none_known', '{}',
  case n when 93 then '00000000-0000-0000-0000-0000000000d2' else '00000000-0000-0000-0000-0000000000d1' end::uuid,
  case n when 93 then '00000000-0000-0000-0000-0000000000b2' else '00000000-0000-0000-0000-0000000000b1' end::uuid,
  'processed', now(), 'manual', 15, 'scheduled'
from unnest(array[91, 92, 93]) n;
insert into public.visits (id, request_id, technician_id, scheduled_start, scheduled_end, created_by) values
  ('00000000-0000-0000-0000-000000000191', '00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-0000000000b1',
   now() - interval '30 minutes', now() + interval '90 minutes', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000192', '00000000-0000-0000-0000-000000000092', '00000000-0000-0000-0000-0000000000b1',
   now() + interval '1 day', now() + interval '1 day 2 hours', '00000000-0000-0000-0000-0000000000d1'),
  ('00000000-0000-0000-0000-000000000193', '00000000-0000-0000-0000-000000000093', '00000000-0000-0000-0000-0000000000b2',
   now() - interval '10 minutes', now() + interval '110 minutes', '00000000-0000-0000-0000-0000000000d1');

create function pg_temp.ask(k text, req text, num text default '0621 123456') returns jsonb language sql as $$
  select public.agent_request_callback(k, ('00000000-0000-0000-0000-0000000000' || req)::uuid, num);
$$;
create function pg_temp.cb(req text) returns uuid language sql as $$
  select id from public.callback_requests where request_id = ('00000000-0000-0000-0000-0000000000' || req)::uuid and status = 'open';
$$;
create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000' || id, 'role', 'authenticated')::text, true);
$$;

-- Only the integration may ask
set local role authenticated;
select pg_temp.as_user('d1');
select throws_ok($$select pg_temp.ask('cb-call-1', '91')$$, '42501', null, 'staff cannot call the agent tool');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(pg_temp.ask('cb-call-1', '91', '12 3') ->> 'fehler', 'rueckrufnummer_ungueltig', 'callback number needed');
select is(public.agent_request_callback('cb-call-1', gen_random_uuid(), '0621 123456') ->> 'fehler', 'anfrage_unbekannt', 'unknown request');
select ok((select r ->> 'fehler' = 'nicht_ueberfaellig' and r ->> 'lage' = 'geplant' from pg_temp.ask('cb-call-1', '92') r), 'only for an overdue visit');
select is((pg_temp.ask('cb-call-1', '91') ->> 'bereits_offen')::boolean, false, 'callback requested');
select ok((select r ->> 'bereits_offen' = 'true' and (r ->> 'rueckrufbitte_id')::uuid = pg_temp.cb('91') from pg_temp.ask('cb-call-2', '91') r), 'repetition returns the open request');
select is(pg_temp.ask('cb-call-3', '93') ->> 'ok', 'true', 'second request');
reset role;

select ok((select c.technician_id = '00000000-0000-0000-0000-0000000000b1' and c.visit_id = '00000000-0000-0000-0000-000000000191'
    and c.callback_number = '0621 123456' and c.company_name = 'Rückruf 91 GmbH' and c.site = 'Hafenstraße 12, 68159 Mannheim'
    and c.conversation_id = 'cb-call-1' and c.escalated_at is null
  from public.callback_requests c where c.id = pg_temp.cb('91')), 'callback row with copied details');
select is((select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000091' and event_type = 'callback_requested'), 1, 'requested once in the history');
select is((select request_id from public.phone_calls where conversation_id = 'cb-call-1'), '00000000-0000-0000-0000-000000000091'::uuid, 'call linked to the request');

-- Who sees it
set local role authenticated;
select pg_temp.as_user('b1');
select is((select count(*)::int from public.callback_requests), 1, 'technician sees own callback');
select pg_temp.as_user('b2');
select is((select count(*)::int from public.callback_requests), 1, 'other technician sees only their own');
select throws_ok($$select public.acknowledge_callback(pg_temp.cb('91'))$$, '42501', null, 'other technician cannot acknowledge');
select pg_temp.as_user('d2');
select is((select count(*)::int from public.callback_requests where id = pg_temp.cb('91')), 0, 'other dispatcher does not see it before escalation');
reset role;

-- Escalation after 15 minutes: to the dispatcher of the request, to all dispatchers if that one is inactive
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is(public.escalate_callbacks(), 0, 'nothing to escalate within 15 minutes');
update public.callback_requests set created_at = now() - interval '16 minutes';
update public.profiles set is_active = false where id = '00000000-0000-0000-0000-0000000000d2';
select is(public.escalate_callbacks(), 2, 'escalated after 15 minutes');
select ok((select escalated_at is not null and escalated_to = '00000000-0000-0000-0000-0000000000d1' from public.callback_requests where id = pg_temp.cb('91')), 'to the dispatcher of the request');
select ok((select escalated_at is not null and escalated_to is null from public.callback_requests where id = pg_temp.cb('93')), 'to all dispatchers when the dispatcher is inactive');
select is(public.escalate_callbacks(), 0, 'escalated only once');
select is((select count(*)::int from public.request_events where event_type = 'callback_escalated' and request_id in ('00000000-0000-0000-0000-000000000091', '00000000-0000-0000-0000-000000000093')), 2, 'escalation in the history');

set local role authenticated;
select pg_temp.as_user('d1');
select is((select count(*)::int from public.callback_requests where escalated_at is not null), 2, 'dispatcher sees own and unaddressed escalations');

-- Acknowledgement
select pg_temp.as_user('b1');
select lives_ok($$select public.acknowledge_callback(pg_temp.cb('91'))$$, 'technician acknowledges "Kunde angerufen"');
reset role;
select ok((select status = 'done' and closed_reason = 'acknowledged' and closed_by = '00000000-0000-0000-0000-0000000000b1' and closed_at is not null
  from public.callback_requests where request_id = '00000000-0000-0000-0000-000000000091'), 'closed by the technician');
set local role authenticated;
select pg_temp.as_user('b1');
select throws_ok($$select public.acknowledge_callback((select id from public.callback_requests where request_id = '00000000-0000-0000-0000-000000000091'))$$,
  'RW422', null, 'acknowledged only once');
select pg_temp.as_user('d1');
select lives_ok($$select public.acknowledge_callback(pg_temp.cb('93'))$$, 'dispatcher acknowledges an escalation');
reset role;

-- Starting the visit closes an open request
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select pg_temp.ask('cb-call-4', '91');
reset role;
update public.visits set status = 'in_progress', actual_start = now() where id = '00000000-0000-0000-0000-000000000191';
select public.escalate_callbacks();
select ok((select count(*) = 2 and bool_and(status = 'done') and count(*) filter (where closed_reason = 'visit_started') = 1
  from public.callback_requests where request_id = '00000000-0000-0000-0000-000000000091'), 'visit start closes the open request');

select * from finish();
rollback;
