-- task-14-2: "Neuen Kunden anlegen" from a request (create_customer_from_request) and settling suggestions on linking.
-- Run with: supabase test db
begin;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.customers (id, customer_number, company_name, is_demo) values
  ('00000000-0000-0000-0000-0000000000c1', 'K-91001', 'Vorschlag GmbH', false);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-0000000000c1', 'Altweg 1', '70173', 'Stuttgart');

-- r1 live with a suggestion, r2 demo, r3 rejected, r4 live with a suggestion (linked by number later)
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, intake_status, is_demo, rejection_reason)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'cfr-' || n, 'x', 'website_form', 'Vorschlag GmbH', 'Erika Muster', 'erika@vorschlag.de', '+49 711 1',
  'Neuer Weg ' || n, '70174', 'Stuttgart', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', status::public.intake_status, demo, case when status = 'rejected' then 'Spam' end
from (values (1, 'processed', false), (2, 'processed', true), (3, 'rejected', false), (4, 'processed', false)) as t(n, status, demo);
insert into public.request_customer_suggestions (request_id, customer_id, reason) values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000c1', 'gleiche_firma'),
  ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000c1', 'gleiche_firma');

create function pg_temp.r(n int) returns public.requests language sql as $$
  select * from public.requests where id = ('00000000-0000-0000-0000-00000000000' || n)::uuid;
$$;
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.create_customer_from_request('00000000-0000-0000-0000-000000000001', 1)$$, '42501', null, 'technician cannot create customers');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.create_customer_from_request('00000000-0000-0000-0000-000000000001', 99)$$, 'RW409', null, 'stale version');

select lives_ok($$select public.create_customer_from_request((pg_temp.r(1)).id, (pg_temp.r(1)).version)$$, 'dispatcher creates the customer from the request');
select is((select row(company_name, contact_name, business_email, phone_number, is_demo)::text from public.customers where id = (pg_temp.r(1)).customer_id),
  row('Vorschlag GmbH', 'Erika Muster', 'erika@vorschlag.de', '+49 711 1', false)::text, '  data from the request, live customer');
select is((select street_house_number from public.customer_sites where id = (pg_temp.r(1)).customer_site_id), 'Neuer Weg 1', '  request address is the first site');
select is((pg_temp.r(1)).customer_number, (select customer_number from public.customers where id = (pg_temp.r(1)).customer_id), '  customer number in the request');
select is((select count(*)::int from public.request_customer_suggestions where request_id = (pg_temp.r(1)).id), 0, '  suggestions settled');
select is((select actor_id from public.request_events where request_id = (pg_temp.r(1)).id and event_type = 'customer_created_from_request'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, '  event by the dispatcher');
select throws_ok($$select public.create_customer_from_request((pg_temp.r(1)).id, (pg_temp.r(1)).version)$$, 'RW422', null, 'already linked: no second customer');

select lives_ok($$select public.create_customer_from_request((pg_temp.r(2)).id, (pg_temp.r(2)).version)$$, 'demo request');
select is((select is_demo from public.customers where id = (pg_temp.r(2)).customer_id), true, '  gives a demo customer');
select throws_ok($$select public.create_customer_from_request((pg_temp.r(3)).id, (pg_temp.r(3)).version)$$, 'RW422', null, 'rejected request: no customer');

-- Linking by customer number also settles the suggestions
select public.link_request_customer((pg_temp.r(4)).id, (pg_temp.r(4)).version, 'K-91001');
select is((select count(*)::int from public.request_customer_suggestions where request_id = (pg_temp.r(4)).id), 0, 'linking by number settles the suggestions');

select * from finish();
rollback;
