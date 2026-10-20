-- task-14-1: customers from processed requests (trigger requests_link_customer). Sure match links, no match creates a
-- customer with first site, uncertain matches only store suggestions; demo requests stay untouched; staff and n8n path.
-- Run with: supabase test db
begin;
select plan(29);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher');

-- Existing customers: c1 active with site in Mannheim, c2 inactive, c3/c4 same company and postal code, c5 free mail, d demo
insert into public.customers (id, customer_number, company_name, business_email, is_active, is_demo) values
  ('00000000-0000-0000-0000-0000000000c1', 'K-90001', 'Neckar Pumpen GmbH', 'info@neckar-pumpen.de', true, false),
  ('00000000-0000-0000-0000-0000000000c2', 'K-90002', 'Alt AG', 'service@alt-ag.de', false, false),
  ('00000000-0000-0000-0000-0000000000c3', 'K-90003', 'Doppel GmbH', null, true, false),
  ('00000000-0000-0000-0000-0000000000c4', 'K-90004', 'Doppel KG', null, true, false),
  ('00000000-0000-0000-0000-0000000000c5', 'K-90005', 'Anna Technik', 'anna@gmail.com', true, false),
  ('00000000-0000-0000-0000-0000000000c9', 'K-90009', 'Demo Firma GmbH', 'demo@demo-firma.de', true, true);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-0000000000c1', 'Hafenstraße 12', '68159', 'Mannheim'),
  ('00000000-0000-0000-0000-0000000000c2', 'Altweg 1', '70173', 'Stuttgart'),
  ('00000000-0000-0000-0000-0000000000c3', 'Werkstr. 1', '40210', 'Düsseldorf'),
  ('00000000-0000-0000-0000-0000000000c4', 'Werkstr. 2', '40210', 'Düsseldorf'),
  ('00000000-0000-0000-0000-0000000000c5', 'Ring 3', '10115', 'Berlin'),
  ('00000000-0000-0000-0000-0000000000c9', 'Demoweg 9', '12345', 'Demostadt');

-- r1..r10: requests in review of dispatcher 1 (n, company, e-mail, street, postal code, city, demo)
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, intake_status, is_demo)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'auto-cust-' || n, 'x', 'website_form', company, 'Erika Muster', email, '+49 621 1',
  street, plz, city, 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt am Gleitringdichtung', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', 'needs_review', demo
from (values
  (1, 'Neckar Pumpen GmbH & Co. KG', 'erika@gmail.com', 'Hafenstr. 12', '68159', 'Mannheim', false),
  (2, 'Irgendein Name', 'INFO@neckar-pumpen.de', 'Rheinstraße 5', '68163', 'Mannheim', false),
  (3, 'Neckar Pumpen GmbH', 'x@web.de', 'Hauptstraße 1', '69117', 'Heidelberg', false),
  (4, 'Neue Firma KG', 'kontakt@neue-firma.de', 'Industriestraße 7', '67059', 'Ludwigshafen', false),
  (5, 'Doppel GmbH', 'doppel@gmx.de', 'Werkstr. 3', '40210', 'Düsseldorf', false),
  (6, 'Fremd GmbH', 'einkauf@neckar-pumpen.de', 'Fremdweg 1', '76131', 'Karlsruhe', false),
  (7, 'Alt AG', 'neu@alt-ag.de', 'Altweg 1', '70173', 'Stuttgart', false),
  (8, 'Solo Service', 'bob@gmail.com', 'Solostraße 8', '10117', 'Berlin', false),
  (9, 'Demo Firma GmbH', 'demo@demo-firma.de', 'Demoweg 9', '12345', 'Demostadt', true),
  (10, 'Neckar Pumpen GmbH', 'info@neckar-pumpen.de', 'Lagerweg 4', '68219', 'Mannheim', false)
) as t(n, company, email, street, plz, city, demo);
-- r10 was already linked by hand, without site
update public.requests set customer_id = '00000000-0000-0000-0000-0000000000c1' where id = '00000000-0000-0000-0000-000000000010';

create function pg_temp.r(n int) returns public.requests language sql as $$
  select * from public.requests where id = ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$$;
create function pg_temp.done(n int) returns public.requests language sql as $$
  select * from public.complete_intake((pg_temp.r(n)).id, (pg_temp.r(n)).version, 'normal', null);
$$;
create function pg_temp.events(n int, code text) returns int language sql as $$
  select count(*)::int from public.request_events where request_id = (pg_temp.r(n)).id and event_type = code;
$$;
create function pg_temp.suggested(n int) returns text language sql as $$
  select string_agg(c.customer_number || ':' || s.reason, ',' order by c.customer_number)
  from public.request_customer_suggestions s join public.customers c on c.id = s.customer_id where s.request_id = (pg_temp.r(n)).id;
$$;

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
create temporary table versions as select n, (pg_temp.r(n)).version as before from generate_series(1, 10) as n;
grant all on versions to authenticated;
set local role authenticated;
select pg_temp.done(n) from generate_series(1, 8) as n;
select pg_temp.done(10);
reset role;

-- Sure match by normalized company + postal code; the address is the existing site
select is((pg_temp.r(1)).customer_id, '00000000-0000-0000-0000-0000000000c1'::uuid, 'company without legal form + postal code links the customer');
select is((select street_house_number from public.customer_sites where id = (pg_temp.r(1)).customer_site_id), 'Hafenstraße 12', '  "Hafenstr. 12" is the existing site "Hafenstraße 12"');
select is(pg_temp.events(1, 'customer_auto_linked'), 1, '  event customer_auto_linked');
select is((pg_temp.r(1)).version, (select before + 1 from versions where n = 1), '  one version step only (no second update)');
select is((pg_temp.r(1)).customer_number, 'K-90001', '  customer number taken over into the request');

-- Sure match by e-mail (case-insensitive); the new address becomes a further site
select is((pg_temp.r(2)).customer_id, '00000000-0000-0000-0000-0000000000c1'::uuid, 'same e-mail links the customer');
select is((select street_house_number from public.customer_sites where id = (pg_temp.r(2)).customer_site_id), 'Rheinstraße 5', '  new address added as site');
select is((select data ->> 'site_added' from public.request_events where request_id = (pg_temp.r(2)).id and event_type = 'customer_auto_linked'), 'true', '  event notes the new site');

-- Uncertain: same company, other postal code → suggestion only
select is((pg_temp.r(3)).customer_id, null, 'same company elsewhere: no automatic link');
select is(pg_temp.suggested(3), 'K-90001:gleiche_firma', '  suggestion "gleiche_firma"');
select is(pg_temp.events(3, 'customer_suggested'), 1, '  event customer_suggested');

-- No match: new customer with first site
select ok((pg_temp.r(4)).customer_id is not null and (select customer_number from public.customers where id = (pg_temp.r(4)).customer_id) ~ '^K-[0-9]+$', 'no match creates a customer');
select is((select row(company_name, contact_name, business_email, phone_number, is_demo)::text from public.customers where id = (pg_temp.r(4)).customer_id),
  row('Neue Firma KG', 'Erika Muster', 'kontakt@neue-firma.de', '+49 621 1', false)::text, '  company, contact, e-mail and phone from the request');
select is((select row(street_house_number, postal_code, city)::text from public.customer_sites where id = (pg_temp.r(4)).customer_site_id),
  row('Industriestraße 7', '67059', 'Ludwigshafen')::text, '  request address is the first site');
select is(pg_temp.events(4, 'customer_auto_created'), 1, '  event customer_auto_created');

-- Uncertain: two sure matches, same company domain, inactive customer
select is(pg_temp.suggested(5), 'K-90003:mehrere_treffer,K-90004:mehrere_treffer', 'two matches: both suggested, nothing linked');
select is((pg_temp.r(5)).customer_id, null, '  no link');
select is(pg_temp.suggested(6), 'K-90001:gleiche_domain', 'same company domain: suggestion only');
select is(pg_temp.suggested(7), 'K-90002:kunde_inaktiv', 'inactive customer: suggestion only');

-- Free mail domain says nothing about the company
select ok((pg_temp.r(8)).customer_id is not null and pg_temp.suggested(8) is null, 'gmail address of another customer is no hint: new customer');

-- Already linked: only the site is added
select ok((pg_temp.r(10)).customer_site_id is not null and pg_temp.events(10, 'customer_auto_linked') = 0 and pg_temp.events(10, 'customer_auto_created') = 0,
  'already linked request: site added, no event');

-- Demo request: untouched (also when completed by a direct update like the demo seed)
update public.requests set intake_status = 'processed', priority = 'normal', intake_completed_at = now(), intake_mode = 'manual', manual_minutes_baseline = 5
  where id = (pg_temp.r(9)).id;
select ok((pg_temp.r(9)).customer_id is null and pg_temp.suggested(9) is null, 'demo request: no customer, no suggestion');

-- Reopened and completed again: no second customer
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.reopen_intake((pg_temp.r(4)).id, (pg_temp.r(4)).version, 'needs_review', 'Test');
select pg_temp.done(4);
reset role;
select is((select count(*)::int from public.customers where company_name = 'Neue Firma KG'), 1, 'reopened and completed again: still one customer');
select is(pg_temp.events(4, 'customer_auto_created'), 1, '  no second event');

-- n8n path: apply_analysis_result also creates the customer
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('00000000-0000-0000-0000-000000000011', 'auto-cust-11', 'x', 'website_form', 'Analyse Werke GmbH', 'Max Muster', 'max@analyse-werke.de', '+49 30 2',
  'Analyseweg 11', '10115', 'Berlin', 'compressor', 'scheduled_maintenance', date '2026-10-30', 'Wartung des Kompressors, keine Störung bekannt.',
  'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
create temporary table run_result as select public.start_automation_run('auto-cust:11', 'intake_analysis', (pg_temp.r(11)).id, null, (pg_temp.r(11)).version, 'test') as run;
select public.finish_automation_run((select (run ->> 'id')::uuid from run_result), 'succeeded', 'ready_for_planning', 0.9,
  jsonb_build_object('contract_version', '1.0', 'request_id', (pg_temp.r(11)).id, 'expected_version', (pg_temp.r(11)).version, 'decision', 'ready_for_planning',
    'confidence', 0.9, 'priority', 'normal', 'service_kind', 'scheduled_maintenance', 'summary', 'Wartung', 'missing_information', '[]'::jsonb,
    'catalog_match', jsonb_build_object('status', 'listed_model'), 'equipment', jsonb_build_object('manufacturer', 'KAESER', 'model', 'SM 13')),
  null, null, 'test');
select public.apply_analysis_result((select (run ->> 'id')::uuid from run_result), (pg_temp.r(11)).id, (pg_temp.r(11)).version,
  (select result from public.automation_runs where id = (select (run ->> 'id')::uuid from run_result)));
reset role;
select is((pg_temp.r(11)).intake_status::text, 'processed', 'n8n: analysis completes the intake');
select is((select company_name from public.customers where id = (pg_temp.r(11)).customer_id), 'Analyse Werke GmbH', '  and creates the customer');
select is((select actor_type::text from public.request_events where request_id = (pg_temp.r(11)).id and event_type = 'customer_auto_created'), 'automation', '  event by the automation');

-- A failure inside the matching never blocks the intake
create function pg_temp.broken_site() returns void language plpgsql as $$
begin
  alter table public.customer_sites add constraint test_no_new_sites check (postal_code <> '99999') not valid;
end;
$$;
select pg_temp.broken_site();
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, intake_status)
values ('00000000-0000-0000-0000-000000000012', 'auto-cust-12', 'x', 'website_form', 'Kaputt GmbH', 'Kai', 'kai@kaputt.de', '1',
  'Bruchweg 1', '99999', 'Nirgendwo', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt am Gleitring', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', 'needs_review');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.done(12);
reset role;
select is((pg_temp.r(12)).intake_status::text, 'processed', 'error in the matching: intake still completed');
select ok((pg_temp.r(12)).customer_id is null and not exists (select 1 from public.customers where company_name = 'Kaputt GmbH'), '  no half-created customer');

select * from finish();
rollback;
