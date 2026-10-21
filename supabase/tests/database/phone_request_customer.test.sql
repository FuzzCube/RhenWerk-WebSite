-- task-15-4: phone request for an existing customer chosen on the form (create_phone_request with customer_id):
-- direct link, site only when the address fits, no new customer, inactive or unknown customer rejected; without
-- customer_id the typed number stays a stated number. Run with: supabase test db
begin;
select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true);

insert into public.customers (id, customer_number, company_name, contact_name, business_email) values
  ('00000000-0000-0000-0000-00000000c001', 'K-90001', 'Bestand GmbH', 'Erika Bestand', 'technik@bestand.test');
insert into public.customers (id, customer_number, company_name, is_active) values
  ('00000000-0000-0000-0000-00000000c002', 'K-90002', 'Alt GmbH', false);
insert into public.customer_sites (id, customer_id, label, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-00000000e001', '00000000-0000-0000-0000-00000000c001', 'Werk 1', 'Hafenstraße 5', '47119', 'Duisburg'),
  ('00000000-0000-0000-0000-00000000e002', '00000000-0000-0000-0000-00000000c001', 'Lager', 'Ringweg 9', '40211', 'Düsseldorf');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
-- Address of the second site, as the form fills it after choosing that suggestion
create function pg_temp.fields() returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Bestand GmbH', 'contact_name', 'Max Anrufer', 'business_email', 'technik@bestand.test',
    'phone_number', '0211 12345', 'street_house_number', 'ringweg 9 ', 'postal_code', '40211', 'city', 'Düsseldorf',
    'customer_number', 'K-90001', 'equipment_kind', 'compressor', 'service_kind', 'diagnosis_repair', 'requested_visit_date', '2026-10-28',
    'customer_urgency', 'zeitnah', 'safety_risk', 'none_known', 'description', 'Kompressor schaltet nach zehn Minuten ab.');
$$;
create function pg_temp.req(k text) returns public.requests language sql as $$
  select * from public.requests where source_event_key = 'phone:' || k;
$$;
create temporary table customers_before as select count(*)::int as n from public.customers;
grant select on customers_before to authenticated;
grant execute on function pg_temp.act_as(uuid), pg_temp.fields(), pg_temp.req(text) to authenticated;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');

-- Chosen customer, address of one of its sites
select lives_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f101', pg_temp.fields(), false,
  null, '00000000-0000-0000-0000-00000000c001')$$, 'phone request with a chosen customer');
select ok((select customer_id = '00000000-0000-0000-0000-00000000c001' and customer_site_id = '00000000-0000-0000-0000-00000000e002'
  from pg_temp.req('00000000-0000-0000-0000-00000000f101')), 'linked to the customer and the site with the same address');
select ok((select customer_number = 'K-90001' and stated_customer_number = 'K-90001'
  from pg_temp.req('00000000-0000-0000-0000-00000000f101')), 'customer number from the master data');
select is((select count(*)::int from public.request_events e where e.request_id = (pg_temp.req('00000000-0000-0000-0000-00000000f101')).id
  and e.event_type = 'customer_linked' and e.data ->> 'by' = 'phone_form'), 1, 'link is logged');

-- Chosen customer, address changed on the form: link without site
select lives_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f102',
  pg_temp.fields() || '{"street_house_number": "Neue Straße 1", "postal_code": "50667", "city": "Köln"}', false,
  null, '00000000-0000-0000-0000-00000000c001')$$, 'phone request with a chosen customer and a new address');
select ok((select customer_id = '00000000-0000-0000-0000-00000000c001' and customer_site_id is null
  from pg_temp.req('00000000-0000-0000-0000-00000000f102')), 'linked, site left open for the intake');
select is((select count(*)::int from public.customers) - (select n from customers_before), 0, 'no new customer created');

-- Rejected customers
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f103', pg_temp.fields(), false,
  null, '00000000-0000-0000-0000-00000000c002')$$, 'RW422', null, 'inactive customer is rejected');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f104', pg_temp.fields(), false,
  null, '00000000-0000-0000-0000-00000000c999')$$, 'RW422', null, 'unknown customer is rejected');
select is((select count(*)::int from public.requests where source_event_key in ('phone:00000000-0000-0000-0000-00000000f103',
  'phone:00000000-0000-0000-0000-00000000f104')), 0, 'rejected requests are not created');

-- Without a chosen customer the typed number is only stated, checked at the end of the intake as before
select lives_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f105', pg_temp.fields(), false)$$,
  'phone request without a chosen customer');
select ok((select customer_id is null and customer_number is null and stated_customer_number = 'K-90001'
  from pg_temp.req('00000000-0000-0000-0000-00000000f105')), 'typed number kept as stated number, no link');

select * from finish();
rollback;
