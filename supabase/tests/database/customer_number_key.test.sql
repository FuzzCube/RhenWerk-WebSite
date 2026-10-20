-- task-15-2: customer number as fixed key. requests.customer_number only follows the link; the stated number is kept
-- apart and checked at the end of the intake (fits → link, exists but does not fit → suggestion, unknown → event);
-- create_customer always assigns the next number.
-- Run with: supabase test db
begin;
select plan(24);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test');
insert into public.profiles (id, display_name, role) values ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher');

insert into public.customers (id, customer_number, company_name, business_email, is_active, is_demo) values
  ('00000000-0000-0000-0000-0000000000c1', 'K-90001', 'Neckar Pumpen GmbH', 'info@neckar-pumpen.de', true, false),
  ('00000000-0000-0000-0000-0000000000c2', 'K-90002', 'Alt AG', 'service@alt-ag.de', false, false);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-0000000000c1', 'Hafenstraße 12', '68159', 'Mannheim'),
  ('00000000-0000-0000-0000-0000000000c2', 'Altweg 1', '70173', 'Stuttgart');

-- r1..r6 with a stated number (n, stated, company, e-mail, postal code)
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number, customer_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, intake_status, is_demo)
select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'cust-key-' || n, 'x', 'website_form', company, 'Erika Muster', email, '+49 621 1',
  stated, 'Werkstraße 1', plz, 'Mannheim', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt an der Gleitringdichtung', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1', 'needs_review', false
from (values
  (1, 'k 90001', 'Ganz Andere GmbH', 'erika@andere.de', '68159'),
  (2, 'K-90001', 'Ganz Andere GmbH', 'erika@andere.de', '99999'),
  (3, 'K-90001', 'Ganz Andere GmbH', 'info@neckar-pumpen.de', '99999'),
  (4, 'K-99999', 'Unbekannt GmbH', 'kontakt@unbekannt.de', '55555'),
  (5, 'K-90002', 'Alt AG', 'neu@alt-ag.de', '70173'),
  (6, null, 'Ohne Nummer GmbH', 'a@ohne-nummer.de', '44444')
) as t(n, stated, company, email, plz);

create function pg_temp.r(n int) returns public.requests language sql as $$
  select * from public.requests where id = ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
$$;
create function pg_temp.suggested(n int) returns text language sql as $$
  select string_agg(c.customer_number || ':' || s.reason, ',' order by c.customer_number)
  from public.request_customer_suggestions s join public.customers c on c.id = s.customer_id where s.request_id = (pg_temp.r(n)).id;
$$;

-- Insert: stated number kept apart (normalized), no customer number without link
select is((pg_temp.r(1)).stated_customer_number, 'K-90001', 'insert: stated number normalized into stated_customer_number');
select is((pg_temp.r(1)).customer_number, null, '  customer_number empty without link');

-- Nobody can write a customer number by hand
update public.requests set customer_number = 'K-12345' where id = (pg_temp.r(6)).id;
select is((pg_temp.r(6)).customer_number, null, 'update: customer_number cannot be set without link');

select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
select public.complete_intake((pg_temp.r(n)).id, (pg_temp.r(n)).version, 'normal', null) from generate_series(1, 5) as n;
reset role;

-- Stated number + postal code of an active site → linked
select is((pg_temp.r(1)).customer_id, '00000000-0000-0000-0000-0000000000c1'::uuid, 'stated number + postal code links the customer');
select is((pg_temp.r(1)).customer_number, 'K-90001', '  customer number from the customer');
select is((select (data ->> 'by_customer_number')::boolean from public.request_events where request_id = (pg_temp.r(1)).id and event_type = 'customer_auto_linked'), true,
  '  event marks the link by customer number');

-- Stated number exists, but neither postal code nor e-mail fit → nothing automatic, suggestion
select is((pg_temp.r(2)).customer_id, null, 'stated number without fitting data: not linked');
select is(pg_temp.suggested(2), 'K-90001:nummer_passt_nicht', '  suggestion "nummer_passt_nicht"');
select is((select count(*)::int from public.customers where company_name = 'Ganz Andere GmbH'), 0, '  no new customer created');
select is((pg_temp.r(2)).customer_number, null, '  customer_number stays empty');
select is((pg_temp.r(2)).stated_customer_number, 'K-90001', '  stated number kept');

-- Stated number + stored e-mail → linked
select is((pg_temp.r(3)).customer_id, '00000000-0000-0000-0000-0000000000c1'::uuid, 'stated number + e-mail of the customer links');

-- Unknown number: event, then the normal rules (here: new customer with its own number)
select is((select count(*)::int from public.request_events where request_id = (pg_temp.r(4)).id and event_type = 'stated_customer_number_unknown'), 1,
  'unknown stated number: event stated_customer_number_unknown');
select isnt((pg_temp.r(4)).customer_id, null, '  normal rules: new customer created and linked');
select ok((pg_temp.r(4)).customer_number ~ '^K-[0-9]+$' and (pg_temp.r(4)).customer_number <> 'K-99999', '  request carries the new number, not the stated one');
select is((pg_temp.r(4)).stated_customer_number, 'K-99999', '  stated number kept for reference');

-- Stated number of an inactive customer → suggestion "kunde_inaktiv"
select is((pg_temp.r(5)).customer_id, null, 'inactive customer by number: not linked');
select is(pg_temp.suggested(5), 'K-90002:kunde_inaktiv', '  suggestion "kunde_inaktiv"');

-- Manual link and unlink: the number follows
set local role authenticated;
select public.link_request_customer((pg_temp.r(2)).id, (pg_temp.r(2)).version, 'K-90001');
reset role;
select is((pg_temp.r(2)).customer_number, 'K-90001', 'manual link: customer number of the customer');
set local role authenticated;
select public.link_request_customer((pg_temp.r(2)).id, (pg_temp.r(2)).version, null);
reset role;
select is((pg_temp.r(2)).customer_number, null, 'unlink: customer number empty again');

-- Insert already linked (phone assistant after kunde_finden)
insert into public.requests (id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number, customer_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, customer_id)
values ('00000000-0000-0000-0000-000000000007', 'cust-key-7', 'x', 'phone', 'Neckar Pumpen GmbH', 'Erika Muster', 'info@neckar-pumpen.de', '+49 621 1', 'K-1',
  'Hafenstraße 12', '68159', 'Mannheim', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt an der Gleitringdichtung', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000c1');
select is((pg_temp.r(7)).customer_number, 'K-90001', 'insert with link: customer number of the linked customer, not the passed one');

-- create_customer: no customer number parameter, number from the sequence
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'create_customer' and pg_get_function_identity_arguments(p.oid) like '%customer_number%'),
  'create_customer has no customer_number parameter');
set local role authenticated;
create temporary table created as select * from public.create_customer('Neu Anlage GmbH', 'Weg 1', '68159', 'Mannheim');
reset role;
select ok((select customer_number from created) ~ '^K-[0-9]{5,}$', 'create_customer assigns K-number from the sequence');
select is((select count(*)::int from public.customer_sites s join created c on c.id = s.customer_id), 1, '  with first site');

select * from finish();
rollback;
