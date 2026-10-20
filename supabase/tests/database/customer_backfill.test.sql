-- task-14-3: back-fill of processed live requests without customer (private.backfill_request_customers).
-- Run with: supabase test db
begin;
select plan(17);

-- Only the test's own rows count: everything else already in the database is put out of reach
create temp table before_ids as select id from public.requests where intake_status = 'processed' and customer_id is null and not is_demo;
update public.requests set intake_status = 'needs_review' where id in (select id from before_ids);

insert into public.customers (id, customer_number, company_name, business_email, is_demo) values
  ('00000000-0000-0000-0000-0000000000c1', 'K-92001', 'Bestand Pumpen GmbH', 'info@bestand-pumpen.de', false),
  ('00000000-0000-0000-0000-0000000000c2', 'K-92002', 'Ferne Werke AG', 'info@ferne-werke.de', false);
insert into public.customer_sites (customer_id, street_house_number, postal_code, city) values
  ('00000000-0000-0000-0000-0000000000c1', 'Altweg 1', '70173', 'Stuttgart'),
  ('00000000-0000-0000-0000-0000000000c2', 'Fernweg 9', '20095', 'Hamburg');

-- 1 no match → anlegen, 2 same e-mail → verknuepfen, 3 same company other postal code → vorschlag,
-- 4 demo, 5 cancelled, 6 already has a suggestion (waits for a human), 7 already linked
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, intake_status, is_demo, customer_id, cancellation_reason, cancelled_at)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'bf-' || n, 'x', 'website_form', company, 'Erika Muster', email, '+49 711 1',
  'Neuer Weg ' || n, plz, 'Stuttgart', 'pump', 'diagnosis_repair', date '2026-10-30', 'Pumpe leckt', 'planbar', 'none_known', '{}',
  status::public.intake_status, demo, cust,
  case when status = 'cancelled' then 'Kunde hat abgesagt' end, case when status = 'cancelled' then now() end
from (values
  (1, 'Ganz Neu KG', 'kontakt@ganz-neu.de', '70174', 'processed', false, null::uuid),
  (2, 'Bestand Pumpen', 'INFO@bestand-pumpen.de', '70173', 'processed', false, null),
  (3, 'Ferne Werke', 'werk@ferne-werke-sued.de', '70174', 'processed', false, null),
  (4, 'Demo Firma', 'demo@demo-firma.de', '70174', 'processed', true, null),
  (5, 'Storno GmbH', 'x@storno.de', '70174', 'cancelled', false, null),
  (6, 'Wartet GmbH', 'x@wartet.de', '70174', 'processed', false, null),
  (7, 'Verknuepft GmbH', 'x@verknuepft.de', '70173', 'processed', false, '00000000-0000-0000-0000-0000000000c1')) as t(n, company, email, plz, status, demo, cust);
insert into public.request_customer_suggestions (request_id, customer_id, reason) values
  ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000c2', 'gleiche_domain');

create temp table counts_before as select
  (select count(*) from public.customers) as customers, (select count(*) from public.customer_sites) as sites,
  (select count(*) from public.request_events) as events, (select last_value from private.customer_number_seq) as seq,
  (select sum(version) from public.requests) as versions;
create function pg_temp.counts() returns text language sql as $$
  select row((select count(*) from public.customers), (select count(*) from public.customer_sites), (select count(*) from public.request_events),
    (select last_value from private.customer_number_seq), (select sum(version) from public.requests))::text;
$$;
create function pg_temp.r(n int) returns public.requests language sql as $$
  select * from public.requests where id = ('00000000-0000-0000-0000-00000000000' || n)::uuid;
$$;

-- Dry run
create temp table dry as select * from private.backfill_request_customers();
select is((select string_agg(outcome, ',' order by request_number) from dry), 'anlegen,verknuepfen,vorschlag', 'dry run reports the three candidates');
select is((select customer_number from dry where outcome = 'verknuepfen'), 'K-92001', '  link target named');
select ok((select detail from dry where outcome = 'vorschlag') like 'K-92002 Ferne Werke AG (gleiche_firma)%', '  suggestion with reason');
select is((select customer_number from dry where outcome = 'anlegen'), null, '  no number for a customer not yet created');
select is(pg_temp.counts(), (select row(customers, sites, events, seq, versions)::text from counts_before), '  nothing changed, sequence reset');
select is((select count(*)::int from public.request_customer_suggestions where request_id = (pg_temp.r(3)).id), 0, '  no suggestion stored');

-- Apply
create temp table done as select * from private.backfill_request_customers(apply => true);
select is((select string_agg(outcome, ',' order by request_number) from done), 'anlegen,verknuepfen,vorschlag', 'apply handles the same three');
select is((select company_name from public.customers where id = (pg_temp.r(1)).customer_id), 'Ganz Neu KG', '  new customer from the request');
select is((pg_temp.r(1)).customer_number, (select customer_number from done where outcome = 'anlegen'), '  its number in request and report');
select is((pg_temp.r(2)).customer_id, '00000000-0000-0000-0000-0000000000c1'::uuid, '  same e-mail linked to the customer');
select is((select street_house_number from public.customer_sites where id = (pg_temp.r(2)).customer_site_id), 'Neuer Weg 2', '  request address added as site');
select is((select customer_id from public.request_customer_suggestions where request_id = (pg_temp.r(3)).id), '00000000-0000-0000-0000-0000000000c2'::uuid, '  suggestion stored, no customer');
select is((select count(*)::int from public.request_events where request_id in ((pg_temp.r(1)).id, (pg_temp.r(2)).id, (pg_temp.r(3)).id)
  and event_type in ('customer_auto_created', 'customer_auto_linked', 'customer_suggested') and actor_type = 'automation'), 3, '  one automation event each');
select ok((pg_temp.r(1)).version > 1, '  request version raised');
select is((select array_agg(customer_id) from public.requests where id in ((pg_temp.r(4)).id, (pg_temp.r(5)).id, (pg_temp.r(6)).id)), array[null, null, null]::uuid[],
  'demo, cancelled and waiting requests untouched');
select is((pg_temp.r(7)).customer_site_id, null, '  linked request not touched');

-- Second run
select is((select count(*)::int from private.backfill_request_customers(apply => true)), 0, 'second run finds nothing');

select * from finish();
rollback;
