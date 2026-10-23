-- task-20-12: new requests go to the dispatcher with the fewest requests of the calendar month (unprocessed ones
-- count, cancelled/rejected, demo and earlier months do not); on a tie the one longest without a new request.
-- Run with: supabase test db
begin;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'd3@x.test');
-- Only the test dispatchers take part
update public.profiles set is_active = false where role = 'dispatcher';
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000d3', 'Dispo 3', 'dispatcher');

create function pg_temp.month_start() returns timestamptz language sql as $$
  select date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin';
$$;
-- Request n for a dispatcher, created at the given time with the given intake status
create function pg_temp.req(n integer, dispatcher text, created timestamptz, status text default 'new', demo boolean default false)
returns void language sql as $$
  insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number,
    postal_code, city, equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload,
    dispatcher_id, intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, rejection_reason, cancellation_reason, cancelled_at,
    is_demo, created_at)
  values (('dddd0000-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'balance-' || n, 'website_form', 'Last GmbH', 'L', 'l@x.test', '1',
    'Str. 1', '68159', 'Mannheim', 'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}',
    ('00000000-0000-0000-0000-0000000000' || dispatcher)::uuid, status::public.intake_status,
    case when status = 'processed' then created end, case when status = 'processed' then 'manual'::public.intake_mode end,
    case when status = 'processed' then 15 end,
    case when status = 'rejected' then 'Spam' end, case when status = 'cancelled' then 'Test' end, case when status = 'cancelled' then created end,
    demo, created);
$$;

-- d1: two requests this month, one of them already processed
select pg_temp.req(1, 'd1', pg_temp.month_start() + interval '1 minute');
select pg_temp.req(2, 'd1', pg_temp.month_start() + interval '2 minutes', 'processed');
-- d2: one request this month; cancelled, rejected and last month's requests do not count
select pg_temp.req(3, 'd2', pg_temp.month_start() + interval '4 minutes');
select pg_temp.req(4, 'd2', pg_temp.month_start() + interval '5 minutes', 'cancelled');
select pg_temp.req(5, 'd2', pg_temp.month_start() + interval '6 minutes', 'rejected');
select pg_temp.req(6, 'd2', pg_temp.month_start() - interval '2 days');
select pg_temp.req(7, 'd2', pg_temp.month_start() - interval '3 days');
-- d3: one request this month, earlier than d2's; demo requests do not count
select pg_temp.req(8, 'd3', pg_temp.month_start() + interval '3 minutes');
select pg_temp.req(9, 'd3', pg_temp.month_start() + interval '1 minute', 'new', true);
select pg_temp.req(10, 'd3', pg_temp.month_start() + interval '2 minutes', 'new', true);

select is(private.least_loaded_dispatcher(), '00000000-0000-0000-0000-0000000000d3'::uuid,
  'tie of one request each: the dispatcher longest without a new request (cancelled one counts as last request of d2)');
select is(private.least_loaded_dispatcher('00000000-0000-0000-0000-0000000000d3'), '00000000-0000-0000-0000-0000000000d2'::uuid,
  'excluded dispatcher is skipped');

select pg_temp.req(11, 'd3', pg_temp.month_start() + interval '7 minutes');
select is(private.least_loaded_dispatcher(), '00000000-0000-0000-0000-0000000000d2'::uuid, 'fewest requests of the month wins');

-- An open intake of d1 no longer makes d1 busier than the month count says: processed requests count as well
select pg_temp.req(12, 'd2', pg_temp.month_start() + interval '8 minutes', 'processed');
select is(private.least_loaded_dispatcher(), '00000000-0000-0000-0000-0000000000d1'::uuid, 'two each: the one longest without a new request');

-- The website form uses the same rule
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.ingest_submission(jsonb_build_object('contract_version', '1.0', 'schema_version', '1.0',
  'submission_id', 'dddd0000-0000-4000-8000-000000000099', 'privacy_consent', true,
  'contact', jsonb_build_object('company_name', 'Form GmbH', 'contact_name', 'Fritz Form', 'business_email', 'fritz@form.test', 'phone', '+49621123456'),
  'site_and_equipment', jsonb_build_object('street_and_number', 'Weg 3', 'postal_code', '68159', 'city', 'Mannheim', 'equipment_type', 'pump'),
  'request', jsonb_build_object('service_type', 'repair', 'urgency', 'planned', 'known_safety_hazard', 'no',
    'description', 'Pumpe verliert Druck seit gestern.', 'preferred_service_date', (current_date + 20)::text, 'preferred_time', 'any'),
  'contract_and_attachments', jsonb_build_object('emergency_sla_24_7', false, 'attachments', '[]'::jsonb)));
reset role;
select is((select dispatcher_id from public.requests where id = 'dddd0000-0000-4000-8000-000000000099'),
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'website form request goes to the dispatcher chosen by the month rule');
select is(private.least_loaded_dispatcher(), '00000000-0000-0000-0000-0000000000d3'::uuid, 'next one after the form request');

select * from finish();
rollback;
