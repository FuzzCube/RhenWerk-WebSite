-- task-10-3: experience counts for planning suggestions (public.technician_experience). Run with: supabase test db
begin;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000007d1', 'x-d1@x.test'),
  ('00000000-0000-0000-0000-0000000007d2', 'x-d2@x.test'),
  ('00000000-0000-0000-0000-0000000007a1', 'x-m1@x.test'),
  ('00000000-0000-0000-0000-0000000007b1', 'x-t1@x.test'),
  ('00000000-0000-0000-0000-0000000007b2', 'x-t2@x.test'),
  ('00000000-0000-0000-0000-0000000007b3', 'x-t3@x.test');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000007d1', 'Exp Dispo 1', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000007d2', 'Exp Dispo 2', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000007a1', 'Exp Manager', 'manager', true),
  ('00000000-0000-0000-0000-0000000007b1', 'Exp Technik 1', 'technician', true),
  ('00000000-0000-0000-0000-0000000007b2', 'Exp Technik 2', 'technician', true),
  ('00000000-0000-0000-0000-0000000007b3', 'Exp Technik inaktiv', 'technician', false);

create function pg_temp.r(n integer) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-000000000' || lpad(n::text, 3, '0'))::uuid;
$$;
create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Customer numbers count only through the link to the customer master data (task-15-2)
insert into public.customers (id, customer_number, company_name) values
  ('00000000-0000-0000-0000-0000000007c1', 'K-70001', 'Ziel GmbH'),
  ('00000000-0000-0000-0000-0000000007c9', 'K-70009', 'Andere AG');

insert into public.requests (
  id, source_event_key, request_number, source, company_name, customer_id, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, manufacturer, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, created_at, intake_status, work_status)
select pg_temp.r(n), 'exp:' || n, 'x', 'demo_seed', company,
  case customer when 'K-1' then '00000000-0000-0000-0000-0000000007c1'::uuid when 'K-9' then '00000000-0000-0000-0000-0000000007c9'::uuid end, 'Erika', 'e@x.test', '1', 'Str. 1', '40210', 'Düsseldorf',
  equipment::public.equipment_kind, manufacturer, 'diagnosis_repair', date '2031-02-01', 'Test', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000007d1', timestamptz '2031-01-01 08:00+01', 'processed', 'not_planned'
from (values
  -- n, company, customer number, equipment, manufacturer, work status
  (701, 'Ziel GmbH', 'K-1', 'compressor', 'Atlas', 'not_planned'),   -- target with customer number
  (702, 'Ziel GmbH Werk 2', 'K-1', 'pump', null, 'completed'),        -- same customer (by number), T1
  (703, 'Andere AG', 'K-9', 'compressor', ' atlas ', 'completed'),    -- same manufacturer + type, T2
  (704, 'Dritte KG', null, 'compressor', null, 'completed'),          -- same type only, T2
  (705, 'Ziel GmbH', 'K-1', 'compressor', 'Atlas', 'cancelled'),      -- cancelled visit, T1: not counted
  (706, 'Muster AG', null, 'pump', null, 'not_planned'),              -- target without customer number
  (707, ' muster ag', null, 'ventilation', null, 'completed')         -- same company by name, T1
) as f(n, company, customer, equipment, manufacturer, work);

insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, actual_start, actual_end, cancellation_reason, created_by)
select pg_temp.r(n), tech::uuid, status::public.visit_status, start, start + interval '2 hours',
  case when status = 'completed' then start end, case when status = 'completed' then start + interval '2 hours' end,
  case when status = 'cancelled' then 'Test' end, '00000000-0000-0000-0000-0000000007d1'
from (values
  (702, '00000000-0000-0000-0000-0000000007b1', 'completed', timestamptz '2031-01-05 08:00+01'),
  (703, '00000000-0000-0000-0000-0000000007b2', 'completed', timestamptz '2031-01-06 08:00+01'),
  (704, '00000000-0000-0000-0000-0000000007b2', 'completed', timestamptz '2031-01-07 08:00+01'),
  (705, '00000000-0000-0000-0000-0000000007b1', 'cancelled', timestamptz '2031-01-08 08:00+01'),
  (707, '00000000-0000-0000-0000-0000000007b1', 'completed', timestamptz '2031-01-09 08:00+01')
) as v(n, tech, status, start);

create function pg_temp.exp(request integer, tech text) returns int[] language sql as $$
  select array[e.customer_visits, e.manufacturer_visits, e.equipment_visits]
  from public.technician_experience(pg_temp.r(request)) e where e.technician_id = ('00000000-0000-0000-0000-0000000007' || tech)::uuid;
$$;

set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000007a1');
select is(pg_temp.exp(701, 'b1'), array[1, 0, 0], 'Manager: T1 kennt die Firma (Kundennummer), stornierter Einsatz zählt nicht');
select is(pg_temp.exp(701, 'b2'), array[0, 1, 2], 'Manager: T2 kennt Hersteller (ohne Groß-/Leerzeichen) und Anlagentyp');
select is(pg_temp.exp(706, 'b1'), array[1, 0, 1], 'Ohne Kundennummer zählt der Firmenname (ohne Groß-/Leerzeichen); Pumpe aus 702 zählt als Anlagentyp');
select is((select count(*)::int from public.technician_experience(pg_temp.r(701)) e where e.technician_id = '00000000-0000-0000-0000-0000000007b3'), 0, 'Inaktive Techniker erscheinen nicht');
select ok((select count(*) from public.technician_experience(pg_temp.r(701))) >= 2, 'Alle aktiven Techniker erscheinen, auch ohne Erfahrung');
select is((select count(*)::int from public.technician_experience(pg_temp.r(701)) e where e.technician_id = '00000000-0000-0000-0000-0000000007b1' and e.customer_visits + e.manufacturer_visits + e.equipment_visits >= 0), 1, 'Eine Zeile je Techniker');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007d1');
select is(pg_temp.exp(701, 'b1'), array[1, 0, 0], 'Dispatcher der Anfrage sieht die Zähler (auch über fremde Anfragen)');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007d2');
select is((select count(*)::int from public.technician_experience(pg_temp.r(701))), 0, 'Fremder Dispatcher bekommt nichts');

select pg_temp.act_as('00000000-0000-0000-0000-0000000007b1');
select is((select count(*)::int from public.technician_experience(pg_temp.r(701))), 0, 'Techniker bekommen nichts');
reset role;

select ok(not has_function_privilege('anon', 'public.technician_experience(uuid)', 'execute'), 'anon darf die Funktion nicht ausführen');
select ok(has_function_privilege('authenticated', 'public.technician_experience(uuid)', 'execute'), 'authenticated darf die Funktion ausführen');

select * from finish();
rollback;
