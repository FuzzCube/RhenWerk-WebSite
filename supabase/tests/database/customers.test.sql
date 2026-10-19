-- task-13-10: customer master data (customers, customer_sites), staff operations, link to requests, phone assistant
-- (agent_find_customer, agent_create_request with a known customer), demo seed. Run with: supabase test db
begin;
select plan(30);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c0d1', 'kd1@x.test'),
  ('00000000-0000-0000-0000-00000000c0b1', 'kt1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-00000000c0d1', 'Dispo Kunden', 'dispatcher'),
  ('00000000-0000-0000-0000-00000000c0b1', 'Technik Kunden', 'technician');

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', id, 'role', 'authenticated')::text, true);
$$;

-- Technicians neither read nor write
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0b1');
select throws_ok($$select public.create_customer('X GmbH', 'Weg 1', '68159', 'Mannheim')$$, '42501', null, 'technicians cannot create customers');
select is((select count(*) from public.customers)::int, 0, 'technicians see no customers');
reset role;

-- Dispatcher creates and edits
set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0d1');
select ok((select customer_number ~ '^K-2[0-9]{4}$' from public.create_customer('Neu Kunde GmbH', 'Weg 1', '68159', 'Mannheim', 'Eva Neu', 'Einkauf@Neu.test')),
  'customer number assigned automatically');
select is((select business_email from public.customers where company_name = 'Neu Kunde GmbH'), 'einkauf@neu.test', 'e-mail stored in lower case');
select is((select count(*) from public.customer_sites s join public.customers c on c.id = s.customer_id where c.company_name = 'Neu Kunde GmbH')::int, 1, 'first site created');
select lives_ok($$select public.create_customer('Fest GmbH', 'Ring 5', '69115', 'Heidelberg', customer_number => 'k 30001')$$, 'given number normalized');
select is((select customer_number from public.customers where company_name = 'Fest GmbH'), 'K-30001', 'number K-30001');
select throws_ok($$select public.create_customer('Doppelt GmbH', 'Ring 5', '69115', 'Heidelberg', customer_number => 'K-30001')$$, 'RW422', null, 'duplicate number rejected');
select throws_ok($$select public.create_customer('PLZ GmbH', 'Ring 5', '6911', 'Heidelberg')$$, 'RW422', null, 'invalid postal code rejected');
select throws_ok($$select public.create_customer('Mail GmbH', 'Ring 5', '69115', 'Heidelberg', business_email => 'kein-at')$$, 'RW422', null, 'invalid e-mail rejected');

select throws_ok($$select public.update_customer((select id from public.customers where customer_number = 'K-30001'), 99, 'Fest GmbH')$$, 'RW409', null, 'version conflict');
select is((select (public.update_customer(id, version, 'Fest Werke GmbH', phone_number => '06221 1')).version from public.customers where customer_number = 'K-30001'), 2, 'update raises version');
select is((select (public.add_customer_site(id, 'Halle 3, Ring 7', '69115', 'Heidelberg', 'Lager')).label from public.customers where customer_number = 'K-30001'), 'Lager', 'second site');
select is((select (public.update_customer_site(s.id, s.version, 'Ring 9', '69115', 'Heidelberg', 'Lager Nord')).street_house_number
  from public.customer_sites s where s.label = 'Lager'), 'Ring 9', 'site updated');
reset role;

-- A request linked to a customer, data copied from the master data
insert into public.requests (source_event_key, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('kunden-test-1', 'website_form', 'Fest Werk', 'Max', 'falsch@x.test', '0621 1', 'Ring 5', '69115', 'Heidelberg', 'pump',
  'diagnosis_repair', date '2026-10-30', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-00000000c0d1');

set local role authenticated;
select pg_temp.as_user('00000000-0000-0000-0000-00000000c0d1');
select throws_ok($$select public.link_request_customer((select id from public.requests where source_event_key = 'kunden-test-1'), 1, 'K-99999')$$, 'RW422', null, 'unknown number');
select ok((select r.customer_id is not null and r.company_name = 'Fest Werke GmbH' and r.customer_number = 'K-30001' and r.customer_site_id is not null
  from public.link_request_customer((select id from public.requests where source_event_key = 'kunden-test-1'), 1, 'K 30001', copy_data => true) r),
  'linked with the site at the request address, company and number copied');
select is((select business_email from public.requests where source_event_key = 'kunden-test-1'), 'falsch@x.test', 'no stored e-mail: request e-mail kept');
select ok(exists (select 1 from public.request_events e join public.requests r on r.id = e.request_id where r.source_event_key = 'kunden-test-1' and e.event_type = 'customer_linked'), 'link logged');
select ok((select customer_id is null from public.link_request_customer((select id from public.requests where source_event_key = 'kunden-test-1'), 2, '')), 'link removed');
reset role;

-- Phone assistant
insert into public.customers (customer_number, company_name, business_email, is_demo) values ('K-40001', 'Telefon Kunde AG', 'service@telefon-kunde.test', true);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city, is_demo)
  select id, 'Hafenstraße 3', '68159', 'Mannheim', true from public.customers where customer_number = 'K-40001';

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.agent_find_customer('kd-call-1', 'K 40001', '68219') ->> 'treffer', 'false', 'wrong postal code: no hit');
select is(public.agent_find_customer('kd-call-1', '4 0 0 0 1', '68159') ->> 'firma', 'Telefon Kunde AG', 'hit with spoken digits');
select ok(not (public.agent_find_customer('kd-call-1', 'K-40001', '68159') ? 'email'), 'no e-mail in the answer');
select is(public.agent_find_customer('kd-call-1', 'K-40001', '68159') -> 'standorte' -> 0 ->> 'ansage', 'Hafenstraße 3 in Mannheim', 'site as spoken');
select is((public.agent_create_request('kd-call-1', jsonb_build_object('contact_name', 'Herr Test', 'phone_number', '0621 777888',
  'equipment_kind', 'pump', 'service_kind', 'diagnosis_repair', 'customer_urgency', 'planbar', 'safety_risk', 'none_known',
  'description', 'Pumpe läuft nicht an.', 'company_name', 'Falsch verstanden GmbH')) ->> 'ok')::boolean, true, 'request created without address and e-mail');
reset role;
select ok((select r.company_name = 'Telefon Kunde AG' and r.business_email = 'service@telefon-kunde.test' and r.street_house_number = 'Hafenstraße 3'
  and r.customer_number = 'K-40001' and r.customer_id is not null and r.customer_site_id is not null
  from public.requests r where r.source_event_key = 'phone_agent:kd-call-1'), 'request uses the master data');

-- Demo seed replaces demo customers and links requests by number
insert into public.requests (source_event_key, source, company_name, contact_name, business_email, phone_number, customer_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('kunden-test-2', 'website_form', 'Seed GmbH', 'Max', 'a@x.test', '0621 1', 'K-50001', 'Weg 2', '68159', 'Mannheim', 'pump',
  'diagnosis_repair', date '2026-10-30', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-00000000c0d1');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((public.demo_seed_customers('[{"customer_number":"K-50001","company_name":"Seed GmbH","business_email":"a@x.test","sites":[{"street_house_number":"Weg 2","postal_code":"68159","city":"Mannheim"}]}]') ->> 'customers')::int, 1, 'demo customers replaced');
reset role;
select is((select count(*) from public.customers where customer_number = 'K-40001')::int, 0, 'old demo customer removed');
select ok((select customer_id is null from public.requests where source_event_key = 'phone_agent:kd-call-1'), 'link to the removed customer cleared');
select ok((select customer_id is not null and customer_site_id is not null from public.requests where source_event_key = 'kunden-test-2'), 'request linked by number and site');
select is((select count(*) from public.customers where not is_demo)::int, 2, 'customers created by staff stay');

select * from finish();
rollback;
