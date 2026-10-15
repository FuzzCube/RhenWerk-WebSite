-- task-13-2: data for the phone assistant (phone_calls, agent_create_request, agent_find_request, agent_check_area,
-- purge_call_transcripts). Run with: supabase test db
begin;
select plan(38);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');

-- Requests at PLZ 99001 (unique to this test), one per situation
create function pg_temp.req(k text, company text, intake text default 'processed', work text default 'not_planned') returns uuid language sql as $$
  insert into public.requests (source_event_key, source, company_name, contact_name, business_email, phone_number,
    street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
    customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id, intake_status,
    intake_completed_at, intake_mode, manual_minutes_baseline, rejection_reason, cancellation_reason, cancelled_at,
    work_status, completion_summary, completed_at)
  values (k, 'website_form', company, 'Erika', 'e@x.test', '1', 'Testweg 1', '99001', 'Teststadt', 'pump', 'diagnosis_repair',
    date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
    intake::public.intake_status,
    case when intake in ('processed', 'rejected') then now() - interval '5 days' end,
    case when intake in ('processed', 'rejected') then 'manual'::public.intake_mode end,
    case when intake in ('processed', 'rejected') then 15 end,
    case when intake = 'rejected' then 'Außerhalb' end,
    case when intake = 'cancelled' or work = 'cancelled' then 'Kunde' end,
    case when intake = 'cancelled' or work = 'cancelled' then now() end,
    work::public.work_status,
    case when work = 'completed' then 'Erledigt' end,
    case when work = 'completed' then now() - interval '1 day' end)
  returning id;
$$;
create function pg_temp.visit(r uuid, status text, starts timestamptz) returns void language sql as $$
  insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, waiting_reason, created_by)
  values (r, '00000000-0000-0000-0000-0000000000b1', status::public.visit_status, starts, starts + interval '2 hours',
    case when status in ('in_progress', 'waiting_parts') then starts end,
    case when status = 'waiting_parts' then 'Teil bestellt' end, '00000000-0000-0000-0000-0000000000d1');
$$;
select pg_temp.req('pa-geplant', 'Alpha Geplant GmbH', work => 'scheduled');
select pg_temp.visit((select id from public.requests where source_event_key = 'pa-geplant'), 'scheduled', now() + interval '2 days');
select pg_temp.req('pa-ueber', 'Beta Ueberfaellig GmbH', work => 'scheduled');
select pg_temp.visit((select id from public.requests where source_event_key = 'pa-ueber'), 'scheduled', now() - interval '5 minutes');
select pg_temp.req('pa-vorort', 'Gamma Vorort GmbH', work => 'in_progress');
select pg_temp.visit((select id from public.requests where source_event_key = 'pa-vorort'), 'in_progress', now() - interval '3 days');
select pg_temp.req('pa-teile', 'Delta Teile GmbH', work => 'waiting_parts');
select pg_temp.req('pa-kunde', 'Epsilon Kunde GmbH', intake => 'awaiting_customer');
select pg_temp.req('pa-pruef', 'Zeta Pruefung GmbH', intake => 'new');
select pg_temp.req('pa-fertig', 'Eta Fertig GmbH', work => 'completed');
select pg_temp.req('pa-abgelehnt', 'Theta Abgelehnt GmbH', intake => 'rejected');
select pg_temp.req('pa-storno', 'Iota Storno GmbH', intake => 'cancelled');
select pg_temp.req('pa-doppelt-1', 'Kappa Doppelt GmbH');
select pg_temp.req('pa-doppelt-2', 'Kappa Doppelt GmbH');

create function pg_temp.find(company text, plz text default '99001') returns jsonb language sql as $$
  select public.agent_find_request('call-find', null, company, plz, null);
$$;
create function pg_temp.fields() returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Neu GmbH', 'contact_name', 'Max Neu', 'business_email', 'einkauf@neu.test',
    'phone_number', '0621 1', 'street_house_number', 'Weg 2', 'postal_code', '68159', 'city', 'Mannheim',
    'equipment_kind', 'compressor', 'service_kind', 'diagnosis_repair', 'customer_urgency', 'zeitnah', 'safety_risk', 'none_known',
    'description', 'Kompressor schaltet mit Fehler 4711 ab.', 'sla_contract_number', 'SLA-2022-340');
$$;

-- Rights: only the integration (service_role)
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.agent_create_request('call-x', pg_temp.fields())$$, '42501', null, 'employees cannot use the agent functions');
select throws_ok($$select public.agent_find_request('call-x', 'RIS-2026-00001', null, '99001', null)$$, '42501', null, 'find: integration only');
select throws_ok($$select public.agent_check_area('call-x', '68159')$$, '42501', null, 'area: integration only');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- Create a request from a call
select is((public.agent_create_request('call-1', pg_temp.fields() - 'phone_number' - 'equipment_kind') -> 'fehlende_felder'),
  '["equipment_kind", "phone_number"]'::jsonb, 'missing fields are listed for the agent');
select is((public.agent_create_request('call-1', pg_temp.fields() || '{"business_email": "kein-at"}') -> 'fehlende_felder'), '["business_email"]'::jsonb, 'invalid e-mail');
select is((public.agent_create_request('call-1', pg_temp.fields()) ->> 'ok')::boolean, true, 'request created');
select is((public.agent_create_request('call-1', pg_temp.fields()) ->> 'wiederholt')::boolean, true, 'repeated tool call returns the same request');
select is((select count(*)::int from public.requests where source_event_key = 'phone_agent:call-1'), 1, 'one request per call');
reset role;
select ok((select source = 'phone_agent' and intake_status = 'new' and dispatcher_id is not null and request_number like 'RIS-%'
    and requested_visit_date = (now() at time zone 'Europe/Berlin')::date + 7 and sla_contract_number = 'SLA-2022-340' and not human_review_required
  from public.requests where source_event_key = 'phone_agent:call-1'), 'source, number, dispatcher, default date + 7 days, SLA number');
select is((select count(*)::int from public.messages m join public.requests r on r.id = m.request_id
  where r.source_event_key = 'phone_agent:call-1' and m.kind = 'receipt' and m.status = 'queued'), 1, 'receipt queued');
select is((select count(*)::int from public.request_events e join public.requests r on r.id = e.request_id
  where r.source_event_key = 'phone_agent:call-1' and e.event_type = 'request_created_by_agent' and e.actor_type = 'automation'), 1, 'creation logged as automation');
select is((select request_id from public.phone_calls where conversation_id = 'call-1'),
  (select id from public.requests where source_event_key = 'phone_agent:call-1'), 'call linked to the request');
set local role service_role;
select is((public.agent_create_request('call-2', pg_temp.fields() || '{"customer_urgency": "production_stop"}') ->> 'ok')::boolean, true, 'critical request');
reset role;
select ok((select human_review_required from public.requests where source_event_key = 'phone_agent:call-2'), 'production stop needs a human');
set local role service_role;
select throws_ok($$select public.agent_create_request('  ', pg_temp.fields())$$, 'RW422', null, 'call id required');

-- Find a request and its situation
select is(pg_temp.find('Alpha Geplant') ->> 'lage', 'geplant', 'planned visit');
select ok((pg_temp.find('Alpha Geplant') ->> 'termin_ansage') ~ '^(Montag|Dienstag|Mittwoch|Donnerstag|Freitag|Samstag|Sonntag), der \d+\. \S+, um \d+(:\d\d)? Uhr$', 'spoken date');
select is(pg_temp.find('Beta Ueberfaellig') ->> 'lage', 'ueberfaellig', 'visit start passed, not begun');
select ok(pg_temp.find('Beta Ueberfaellig') ? 'einsatz_id', 'overdue visit id for the callback request');
select is(pg_temp.find('Gamma Vorort') ->> 'lage', 'vor_ort', 'visit in progress');
select is(pg_temp.find('Delta Teile') ->> 'lage', 'wartet_auf_teile', 'waiting for parts');
select is(pg_temp.find('Epsilon Kunde') ->> 'lage', 'wartet_auf_kunde', 'awaiting customer');
select is(pg_temp.find('Zeta Pruefung') ->> 'lage', 'in_pruefung', 'in review');
select is(pg_temp.find('Eta Fertig') ->> 'lage', 'abgeschlossen', 'completed');
select is(pg_temp.find('Theta Abgelehnt') ->> 'lage', 'abgelehnt', 'rejected');
select is(pg_temp.find('Iota Storno') ->> 'lage', 'storniert', 'cancelled');
select is((pg_temp.find('Kappa Doppelt') ->> 'treffer')::int, 2, 'two matches: no details');
select ok(not (pg_temp.find('Kappa Doppelt') ? 'anfrage_id'), 'no request data with several matches');
select is((pg_temp.find('Alpha Geplant', '68159') ->> 'treffer')::int, 0, 'wrong postal code: nothing');
select is((public.agent_find_request('call-find', null, 'Alpha Geplant', null, null) ->> 'treffer')::int, 0, 'postal code required');
select is((public.agent_find_request('call-find', 'ris ' || replace(substr((select request_number from public.requests where source_event_key = 'pa-geplant'), 5), '-', ' '), null, '99001', null) ->> 'lage'),
  'geplant', 'spoken request number with postal code');
select ok(not (pg_temp.find('Alpha Geplant') ?| array['technician_id', 'technician', 'internal_notes', 'phone_number', 'business_email']), 'no internal or contact data');
select is(pg_temp.find('Alpha Geplant') ->> 'standort', 'Pumpe, Testweg 1, Teststadt', 'site description');

-- Service area
select is(public.agent_check_area('call-1', '68159') ->> 'ergebnis', 'in_gebiet', 'Mannheim in the area');
select is(public.agent_check_area('call-1', '69190') ->> 'ort', 'Walldorf', 'place name');
select is(public.agent_check_area('call-1', '40210') ->> 'ergebnis', 'nur_mit_vertrag', 'Düsseldorf only with a contract');
select is(public.agent_check_area('call-1', '6815') ->> 'ergebnis', 'ungueltig', 'invalid postal code');
reset role;

-- Transcripts: deleted after 30 days, summary stays
update public.phone_calls set started_at = now() - interval '40 days', ended_at = now() - interval '40 days', transcript = 'Alt', summary = 'Zusammenfassung' where conversation_id = 'call-1';
update public.phone_calls set transcript = 'Neu' where conversation_id = 'call-2';
select public.purge_call_transcripts();
select ok((select transcript is null and transcript_deleted_at is not null and summary = 'Zusammenfassung' from public.phone_calls where conversation_id = 'call-1')
  and (select transcript = 'Neu' from public.phone_calls where conversation_id = 'call-2'), 'only old transcripts are deleted');

select * from finish();
rollback;
