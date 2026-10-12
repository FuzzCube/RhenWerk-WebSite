-- task-2-5: end-to-end verification scenarios 1, 2, 3, 4 and 7 of the specification (section 10).
-- Concurrent bookings and direct REST calls are covered by scripts/test-api.mjs (npm run test:api).
-- Run with: supabase test db
begin;
select plan(63);

-- Staff
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'manager@example.com'),
  ('00000000-0000-0000-0000-0000000000d1', 'dispo-a@example.com'),
  ('00000000-0000-0000-0000-0000000000d2', 'dispo-b@example.com'),
  ('00000000-0000-0000-0000-0000000000d9', 'dispo-inaktiv@example.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'technik-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'technik-b@example.com');
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager', true),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo A', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo B', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d9', 'Dispo inaktiv', 'dispatcher', false),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik A', 'technician', true),
  ('00000000-0000-0000-0000-0000000000b2', 'Technik B', 'technician', true);

-- Mon-Fri 07:00-16:00; technician B absent on Tuesday 2027-03-02
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select t, 'working_hours', d, '07:00', '16:00'
from unnest(array['00000000-0000-0000-0000-0000000000b1'::uuid, '00000000-0000-0000-0000-0000000000b2'::uuid]) as t,
     generate_series(1, 5) as d;
insert into public.employee_availability (employee_id, kind, starts_at, ends_at, label)
values ('00000000-0000-0000-0000-0000000000b2', 'absence', '2027-03-02 00:00+01', '2027-03-03 00:00+01', 'Arzttermin');

insert into public.service_rates (id, code, service_kind, display_name, billing_model, unit_price, tax_rate) values
  ('00000000-0000-0000-0000-0000000000e1', 'REP-H', 'diagnosis_repair', 'Reparatur je Stunde', 'hourly', 95, 19),
  ('00000000-0000-0000-0000-0000000000e2', 'WART', 'scheduled_maintenance', 'Wartung pauschal', 'fixed', 250, 19);

-- Requests: 1 repair (Dispo A), 2 maintenance (Dispo A), 3 repair of Dispo B with technician B
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
select r.id, r.key, 'x', 'website_form', r.company, 'Erika Muster', 'service@' || r.key || '.example.com', '+49 211 000',
  'Werkstr. 1', '40210', 'Düsseldorf', 'pump', r.kind, date '2027-03-01', 'Pumpe undicht', 'zeitnah', 'none_known', '{}', r.disp
from (values
  ('00000000-0000-0000-0000-000000000001'::uuid, 'kunde1', 'Kunde Eins GmbH', 'diagnosis_repair'::public.service_kind, '00000000-0000-0000-0000-0000000000d1'::uuid),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'kunde2', 'Kunde Zwei AG', 'scheduled_maintenance'::public.service_kind, '00000000-0000-0000-0000-0000000000d1'::uuid),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'kunde3', 'Kunde Drei KG', 'diagnosis_repair'::public.service_kind, '00000000-0000-0000-0000-0000000000d2'::uuid)
) as r(id, key, company, kind, disp);

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;

-- Preparation: both dispatchers complete intake and plan visits
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.complete_intake('00000000-0000-0000-0000-000000000001', 1, 'high');
select public.complete_intake('00000000-0000-0000-0000-000000000002', 1, 'normal');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select public.complete_intake('00000000-0000-0000-0000-000000000003', 1, 'normal');
select public.schedule_visit('00000000-0000-0000-0000-000000000003', 2, '00000000-0000-0000-0000-0000000000b2', '2027-03-01 13:00+01', '2027-03-01 15:00+01');
reset role;
insert into public.attachments (request_id, bucket, storage_path, file_name, mime_type, size_bytes)
values ('00000000-0000-0000-0000-000000000003', 'dashboard', 'kunde3/plan.pdf', 'plan.pdf', 'application/pdf', 10);
insert into storage.objects (bucket_id, name) values ('dashboard', 'kunde3/plan.pdf');

------------------------------------------------------------------------------
-- Scenario 2: dispatcher schedules, technician sees it; conflicts rejected
------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (public.schedule_visit('00000000-0000-0000-0000-000000000001', 2, '00000000-0000-0000-0000-0000000000b1', '2027-03-01 08:00+01', '2027-03-01 10:00+01')).status::text,
  'scheduled', 'S2: dispatcher A schedules visit for technician A'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000002', 2, '00000000-0000-0000-0000-0000000000b2', '2027-03-01 14:00+01', '2027-03-01 16:00+01')$$,
  'RW410', null, 'S2: overlap with another dispatcher''s booking rejected'
);
select throws_ok(
  $$select public.schedule_visit('00000000-0000-0000-0000-000000000002', 2, '00000000-0000-0000-0000-0000000000b2', '2027-03-02 08:00+01', '2027-03-02 10:00+01')$$,
  'RW422', null, 'S2: absence conflict rejected'
);
select is(
  (select count(*)::int from public.technician_busy_intervals('2027-03-01', '2027-03-03') where technician_id = '00000000-0000-0000-0000-0000000000b2'),
  2, 'S2: dispatcher sees busy interval and absence of technician B'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select results_eq(
  $$select scheduled_start, scheduled_end, status::text from public.visits where id::text not like 'x' and request_id::text like '00000000-0000-0000-0000-%'$$,
  $$values ('2027-03-01 08:00+01'::timestamptz, '2027-03-01 10:00+01'::timestamptz, 'scheduled')$$,
  'S2: technician A sees exactly the new visit in the calendar'
);
reset role;

select throws_ok(
  $$insert into public.employee_availability (employee_id, kind, starts_at, ends_at) values ('00000000-0000-0000-0000-0000000000b1', 'absence', '2027-03-01 09:00+01', '2027-03-01 12:00+01')$$,
  'RW422', null, 'S2: availability change cannot invalidate the booking'
);

------------------------------------------------------------------------------
-- Scenario 1: authorization
------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select count(*) from public.requests$$, '42501', null, 'S1: anon cannot read requests');
select throws_ok($$select count(*) from public.visits$$, '42501', null, 'S1: anon cannot read visits');
select throws_ok($$select count(*) from public.invoices$$, '42501', null, 'S1: anon cannot read invoices');
select throws_ok($$select count(*) from public.messages$$, '42501', null, 'S1: anon cannot read messages');
select throws_ok($$select count(*) from public.attachments$$, '42501', null, 'S1: anon cannot read attachments');
select throws_ok($$select public.complete_intake('00000000-0000-0000-0000-000000000001', 1)$$, '42501', null, 'S1: anon cannot call operations');
reset role;

-- Technician A vs. technician B's request 3
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is((select count(*)::int from public.requests where id = '00000000-0000-0000-0000-000000000003'), 0, 'S1: technician A cannot read B''s request');
select is((select count(*)::int from public.attachments where request_id = '00000000-0000-0000-0000-000000000003'), 0, 'S1: technician A cannot read B''s document metadata');
select is((select count(*)::int from storage.objects where name = 'kunde3/plan.pdf'), 0, 'S1: technician A cannot download B''s document');
select throws_ok(
  $$select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'), 3)$$,
  '42501', null, 'S1: technician A cannot change B''s visit'
);
select throws_ok(
  $$select public.add_work_entry('00000000-0000-0000-0000-000000000003', 3, 'labor', 'X', 1, unit_price => 95)$$,
  '42501', null, 'S1: technician A cannot record work on B''s request'
);
select throws_ok($$update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1'$$, '42501', null, 'S1: technician cannot promote self');
select throws_ok($$update public.requests set priority = 'critical' where id = '00000000-0000-0000-0000-000000000001'$$, '42501', null, 'S1: no direct table writes');
reset role;

-- Dispatcher A vs. dispatcher B
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is((select count(*)::int from public.requests where id = '00000000-0000-0000-0000-000000000003'), 0, 'S1: dispatcher A cannot read B''s request');
select is((select count(*)::int from public.visits where request_id = '00000000-0000-0000-0000-000000000003'), 0, 'S1: dispatcher A sees B''s booking only as busy interval');
select throws_ok(
  $$select public.change_deadline('00000000-0000-0000-0000-000000000003', 3, 'service', now() + interval '3 days', 'x')$$,
  '42501', null, 'S1: dispatcher A cannot change B''s request'
);
reset role;

-- Inactive profile
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d9');
set local role authenticated;
select is((select count(*)::int from public.requests), 0, 'S1: inactive profile reads nothing');
select throws_ok(
  $$select public.mark_needs_review('00000000-0000-0000-0000-000000000001', 3)$$,
  '42501', null, 'S1: inactive profile cannot act'
);
reset role;

------------------------------------------------------------------------------
-- Scenario 3: waiting for parts, used part, repeat visit, closure without manager
------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'));
select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
  'labor', 'Fehlersuche', 1.5, 'performed', visit_id => (select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
  service_rate_id => '00000000-0000-0000-0000-0000000000e1');
select public.add_work_entry('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
  'part', 'Gleitringdichtung', 1, 'ordered', unit_price => 48);
select is(
  (public.wait_for_parts((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'Gleitringdichtung bestellt')).status::text,
  'waiting_parts', 'S3: technician records waiting for parts'
);
select is(
  (public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 90, 'Weiterer Einsatz nötig')).status::text,
  'completed', 'S3: first visit finished'
);
reset role;
select is((select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'waiting_parts', 'S3: finishing the first visit does not close the request');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (public.schedule_visit('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     '00000000-0000-0000-0000-0000000000b1', '2027-03-03 08:00+01', '2027-03-03 10:00+01')).status::text,
  'scheduled', 'S3: dispatcher schedules the repeat visit'
);
reset role;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'scheduled'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'));
select is(
  (public.set_work_entry_status((select id from public.work_entries where description = 'Gleitringdichtung'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 'used')).item_status::text,
  'used', 'S3: technician records the used part'
);
select public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000001' and status = 'in_progress'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'), 60, 'Dichtung eingebaut');
select is(
  (public.close_request('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
     'Gleitringdichtung ersetzt, Probelauf dicht')).work_status::text,
  'completed', 'S3: technician closes the request without manager approval'
);
reset role;
select is((select count(*)::int from public.visits where request_id = '00000000-0000-0000-0000-000000000001'), 2, 'S3: same request number for both visits');

------------------------------------------------------------------------------
-- Scenario 1 (cont.): historical technician read access grants no closure/invoice rights
------------------------------------------------------------------------------
-- Request 3 changes from technician B to A; B keeps history only
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'), (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'));
select public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000003'), (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), 120, 'Diagnose');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select public.schedule_visit('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), '00000000-0000-0000-0000-0000000000b1', '2027-03-04 08:00+01', '2027-03-04 10:00+01');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
set local role authenticated;
select is((select count(*)::int from public.requests where id = '00000000-0000-0000-0000-000000000003'), 1, 'S1: former technician keeps read access');
select throws_ok(
  $$select public.close_request('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'), 'Fertig')$$,
  '42501', null, 'S1: history grants no closure right'
);
select throws_ok(
  $$select public.create_invoice('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'))$$,
  '42501', null, 'S1: history grants no invoice right'
);
reset role;

------------------------------------------------------------------------------
-- Scenario 4: billing, maintenance, rate changes, e-mail queue, sending after payment
------------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.create_invoice('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'));
select is(
  (public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'issued', 'S4: technician issues the invoice without manager approval'
);
reset role;
select results_eq(
  $$select kind::text, quantity, unit::text, net_amount from public.invoice_items
    where invoice_id = (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001') order by kind$$,
  $$values ('labor', 1.500::numeric, 'hour', 142.50::numeric), ('part', 1.000::numeric, 'piece', 48.00::numeric)$$,
  'S4: repair billed with hours and used parts'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select is(
  (public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).invoice_number,
  (select invoice_number from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
  'S4: repeated issue returns the same invoice'
);
reset role;
select is((select count(*)::int from public.invoices where request_id::text like '00000000-0000-0000-0000-%'), 1, 'S4: no duplicate invoice');

-- Rate change after issue
update public.service_rates set unit_price = 110 where id = '00000000-0000-0000-0000-0000000000e1';
select is(
  (select unit_price from public.invoice_items where invoice_id = (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001') and kind = 'labor'),
  95.00::numeric, 'S4: rate change leaves issued invoice unchanged'
);
select is(
  (select total from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
  226.70::numeric, 'S4: issued total unchanged (190.50 net + 36.20 tax)'
);

-- Maintenance: fixed price only even with 180 working minutes
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.schedule_visit('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
  '00000000-0000-0000-0000-0000000000b1', '2027-03-05 08:00+01', '2027-03-05 11:00+01');
reset role;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
set local role authenticated;
select public.start_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000002'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'));
select public.add_work_entry('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'),
  'fixed_service', 'Wartung Pumpe', 1, 'performed', service_rate_id => '00000000-0000-0000-0000-0000000000e2');
select public.complete_visit((select id from public.visits where request_id = '00000000-0000-0000-0000-000000000002'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), 180, 'Wartung durchgeführt');
select public.close_request('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'), 'Wartung ohne Befund');
select public.create_invoice('00000000-0000-0000-0000-000000000002', (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'));
select results_eq(
  $$select status::text, total from public.issue_invoice((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000002'),
      (select version from public.requests where id = '00000000-0000-0000-0000-000000000002'))$$,
  $$values ('issued', 297.50::numeric)$$,
  'S4: maintenance billed at fixed price without hourly surcharge'
);
reset role;
select is(
  (select count(*)::int from public.invoice_items where invoice_id = (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000002')),
  1, 'S4: maintenance invoice has exactly one item'
);

-- E-mail queue does not set sent, paid or first response
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.create_message_draft('00000000-0000-0000-0000-000000000001', (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'),
  'invoice', 'service@kunde1.example.com', 'Ihre Rechnung', 'Anbei Ihre Rechnung.',
  (select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'));
select is(
  (public.queue_message((select id from public.messages where request_id = '00000000-0000-0000-0000-000000000001' and kind = 'invoice'),
     (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'))).status::text,
  'queued', 'S4: invoice e-mail queued'
);
reset role;
select results_eq(
  $$select m.sent_at is null, i.status::text, i.sent_at is null, i.paid_at is null, r.first_substantive_response_at is null
    from public.messages m join public.invoices i on i.id = m.invoice_id join public.requests r on r.id = m.request_id
    where m.request_id = '00000000-0000-0000-0000-000000000001' and m.kind = 'invoice'$$,
  $$values (true, 'issued', true, true, true)$$,
  'S4: queued e-mail sets neither sent, paid nor first response'
);

-- Payment first, then confirmed delivery: invoice stays paid
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
set local role authenticated;
select public.record_payment((select id from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'),
  (select version from public.requests where id = '00000000-0000-0000-0000-000000000001'));
select throws_ok(
  $$select public.confirm_message_sent((select id from public.messages where kind = 'invoice' and request_id = '00000000-0000-0000-0000-000000000001'))$$,
  '42501', null, 'S4: dashboard users cannot confirm delivery'
);
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (public.confirm_message_sent((select id from public.messages where request_id = '00000000-0000-0000-0000-000000000001' and kind = 'invoice'),
     mailbox_key => 'service', gmail_message_id => 'gmail-1')).status::text,
  'sent', 'S4: integration confirms delivery'
);
reset role;
select results_eq(
  $$select status::text, sent_at is not null, paid_at is not null from public.invoices where request_id = '00000000-0000-0000-0000-000000000001'$$,
  $$values ('paid', true, true)$$,
  'S4: sending after payment does not downgrade the invoice'
);
select is(
  (select first_substantive_response_at from public.requests where id = '00000000-0000-0000-0000-000000000001'),
  null, 'S4: invoice e-mail is no substantive response'
);

-- Clarification sets first response only on confirmed delivery; receipt never
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
set local role authenticated;
select public.create_message_draft('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'),
  'receipt', 'service@kunde3.example.com', 'Eingangsbestätigung', 'Wir haben Ihre Anfrage erhalten.');
select public.create_message_draft('00000000-0000-0000-0000-000000000003', (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'),
  'clarification', 'service@kunde3.example.com', 'Rückfrage', 'Bitte senden Sie die Typenschildangaben.');
select public.queue_message((select id from public.messages where kind = 'receipt' and request_id = '00000000-0000-0000-0000-000000000003'), (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'));
select public.queue_message((select id from public.messages where kind = 'clarification' and request_id = '00000000-0000-0000-0000-000000000003'), (select version from public.requests where id = '00000000-0000-0000-0000-000000000003'));
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.confirm_message_sent((select id from public.messages where kind = 'receipt' and request_id = '00000000-0000-0000-0000-000000000003'));
reset role;
select is((select first_substantive_response_at from public.requests where id = '00000000-0000-0000-0000-000000000003'), null, 'S4: receipt does not count as first response');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.confirm_message_sent((select id from public.messages where kind = 'clarification' and request_id = '00000000-0000-0000-0000-000000000003'), sent_at => '2027-03-01 09:30+01');
reset role;
select is((select first_substantive_response_at from public.requests where id = '00000000-0000-0000-0000-000000000003'),
  '2027-03-01 09:30+01'::timestamptz, 'S4: confirmed clarification sets first response');

------------------------------------------------------------------------------
-- Scenario 7: history from events, deadlines, closure vs payment, reopening, cancellation
------------------------------------------------------------------------------
-- Event chain of request 1 reconstructs the intake status history
select is(
  (select bool_and(e.from_value = e.prev_to)
   from (select from_value, lag(to_value) over (order by occurred_at, seq) as prev_to
         from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'work_status_changed') e
   where e.prev_to is not null),
  true, 'S7: work status events form a gapless chain'
);
select is(
  (select string_agg(to_value, ' > ' order by occurred_at, seq) from public.request_events
   where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'work_status_changed'),
  'scheduled > in_progress > waiting_parts > scheduled > in_progress > completed', 'S7: work status history reconstructed from events'
);
select is(
  (select to_value from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'work_status_changed'
   order by occurred_at desc, seq desc limit 1),
  (select work_status::text from public.requests where id = '00000000-0000-0000-0000-000000000001'),
  'S7: last event matches current state'
);
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'visit_status_changed'),
  5, 'S7: each visit transition is an event (3 + 2 transitions)'
);

-- Closure did not mark payment; payment is its own event
select results_eq(
  $$select (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000002' and event_type = 'invoice_paid'),
           (select status::text from public.invoices where request_id = '00000000-0000-0000-0000-000000000002')$$,
  $$values (0, 'issued')$$,
  'S7: closing work does not mark payment'
);

-- Deadlines: moving an elapsed one keeps old value and breach
insert into public.requests (
  id, source_event_key, request_number, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('00000000-0000-0000-0000-000000000004', 'kunde4', 'x', 'website_form', 'Kunde Vier GmbH', 'Max', 'service@kunde4.example.com', '1',
  'Str. 4', '50667', 'Köln', 'compressor', 'inspection', date '2027-03-10', 'Inspektion', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1');
select is((select response_due_at from public.requests where id = '00000000-0000-0000-0000-000000000004'), null,
  'S7: desired visit date is not an agreed deadline');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.change_deadline('00000000-0000-0000-0000-000000000004', 1, 'response', now() - interval '2 hours', 'Rückruf zugesagt');
select public.change_deadline('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'), 'response', now() + interval '1 day', 'Kunde nicht erreichbar');
reset role;
select results_eq(
  $$select (data ->> 'old_due_at') is not null, (data ->> 'breach_recorded')::boolean, note from public.request_events
    where request_id = '00000000-0000-0000-0000-000000000004' and event_type = 'deadline_changed' order by seq desc limit 1$$,
  $$values (true, true, 'Kunde nicht erreichbar')$$,
  'S7: moved deadline keeps previous value and existing breach'
);

-- Reopening preserves the first completion
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.complete_intake('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'), 'normal');
reset role;
create temporary table first_completion as
  select intake_completed_at, intake_mode, manual_minutes_baseline from public.requests where id = '00000000-0000-0000-0000-000000000004';
update public.settings set manual_intake_minutes = 7;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.reopen_intake('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'), 'needs_review', 'Typ unklar');
select public.complete_intake('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'));
reset role;
select results_eq(
  $$select intake_completed_at, intake_mode::text, manual_minutes_baseline from public.requests where id = '00000000-0000-0000-0000-000000000004'$$,
  $$select intake_completed_at, intake_mode::text, manual_minutes_baseline from first_completion$$,
  'S7: reopening and baseline change preserve the first completion snapshot'
);
select is(
  (select count(*)::int from public.request_events where request_id = '00000000-0000-0000-0000-000000000004' and event_type = 'intake_completed'),
  1, 'S7: only one intake completion event'
);

-- Cancellation resolves active visits
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select public.schedule_visit('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'), '00000000-0000-0000-0000-0000000000b1', '2027-03-08 08:00+01', '2027-03-08 09:00+01');
select is((public.cancel_request('00000000-0000-0000-0000-000000000004', (select version from public.requests where id = '00000000-0000-0000-0000-000000000004'), 'Kunde hat storniert')).intake_status::text, 'cancelled', 'S7: request cancelled');
reset role;
select results_eq(
  $$select status::text, cancellation_reason from public.visits where request_id = '00000000-0000-0000-0000-000000000004'$$,
  $$values ('cancelled', 'Anfrage storniert: Kunde hat storniert')$$,
  'S7: cancellation resolves the active visit'
);
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
set local role authenticated;
select is(
  (select count(*)::int from public.technician_busy_intervals('2027-03-08', '2027-03-09') where technician_id::text like '00000000-0000-0000-0000-%'),
  0, 'S7: cancelled visit no longer blocks the calendar'
);
reset role;

-- Append-only history
select throws_ok($$delete from public.request_events where request_id = '00000000-0000-0000-0000-000000000004'$$, '42501', null, 'S7: history cannot be deleted');

select * from finish();
rollback;
