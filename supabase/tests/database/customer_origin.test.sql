-- task-14-4: origin of a customer (origin_request_id) and the duplicate check before manual creation (find_similar_customers).
-- Run with: supabase test db
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.customers (id, customer_number, company_name, business_email, is_demo, is_active) values
  ('00000000-0000-0000-0000-0000000000c1', 'K-93001', 'Ursprung Pumpen GmbH', 'info@ursprung-pumpen.de', false, true),
  ('00000000-0000-0000-0000-0000000000c2', 'K-93002', 'Alt Werke KG', 'info@alt-werke.de', false, false);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-0000000000c1', 'Altweg 1', '70173', 'Stuttgart'),
  ('00000000-0000-0000-0000-0000000000c2', 'Altweg 2', '20095', 'Hamburg');

-- 1 completed by the trigger (new customer), 2 created with the button
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, intake_status, is_demo)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'org-' || n, 'x', 'website_form', 'Herkunft ' || n || ' GmbH', 'Erika Muster', 'erika@herkunft-' || n || '.de', '+49 711 1',
  'Neuer Weg ' || n, '70174', 'Stuttgart', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', status::public.intake_status, false
from (values (1, 'needs_review'), (2, 'processed')) as t(n, status);
update public.requests set intake_status = 'processed' where id = '00000000-0000-0000-0000-000000000001';

create function pg_temp.r(n int) returns public.requests language sql as $$
  select * from public.requests where id = ('00000000-0000-0000-0000-00000000000' || n)::uuid;
$$;
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

select is((select origin_request_id from public.customers where id = (pg_temp.r(1)).customer_id), (pg_temp.r(1)).id, 'automatic creation stores the request');

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.create_customer_from_request((pg_temp.r(2)).id, (pg_temp.r(2)).version);
select is((select origin_request_id from public.customers where id = (pg_temp.r(2)).customer_id), (pg_temp.r(2)).id, '"Neuen Kunden anlegen" stores the request');
select is((public.create_customer('Manuell AG', 'Handweg 1', '70173', 'Stuttgart')).origin_request_id, null, 'manual creation has no origin');

-- Duplicate check
select is((select string_agg(customer_number || ':' || reason, ',') from public.find_similar_customers('Ursprung Pumpen', null, '70173')), 'K-93001:gleiche_firma',
  'same company and postal code');
select is((select reason from public.find_similar_customers('Ursprung Pumpen AG', null, '10115')), 'gleiche_firma_anderswo', 'same company elsewhere');
select is((select reason from public.find_similar_customers('Ganz Anders', 'INFO@ursprung-pumpen.de', '10115')), 'gleiche_email', 'same e-mail, case-insensitive');
select is((select reason from public.find_similar_customers('Ganz Anders', 'technik@ursprung-pumpen.de', '10115')), 'gleiche_domain', 'same company domain');
select is((select count(*)::int from public.find_similar_customers('Ganz Anders', 'jemand@gmail.com', '10115')), 0, 'free mail is no hint');
select is((select row(reason, is_active)::text from public.find_similar_customers('Alt Werke', null, '20095')), row('gleiche_firma', false)::text, 'inactive customer found and marked');
select is((select count(*)::int from public.find_similar_customers('Völlig Neu', 'neu@voellig-neu.de', '10115')), 0, 'no hint for a new company');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select * from public.find_similar_customers('Ursprung Pumpen')$$, '42501', null, 'technician cannot search');

select * from finish();
rollback;
