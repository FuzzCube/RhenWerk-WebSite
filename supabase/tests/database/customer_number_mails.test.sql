-- task-15-3: e-mails to customers name the customer number ("Ihre Kundennummer: … – bitte bei Rückfragen und Anrufen
-- angeben") only when the request is linked to a customer: receipt (text and HTML), payment reminders (number of the
-- invoice snapshot, else of the request) and appointment mails (private.queue_hold_mail). Run with: supabase test db
begin;
select plan(13);

create function pg_temp.req(customer_number text) returns public.requests language sql as $$
  select jsonb_populate_record(null::public.requests, jsonb_build_object('request_number', 'RIS-2026-09999', 'contact_name', 'Erika Muster',
    'company_name', 'Muster GmbH', 'street_house_number', 'Hafenstraße 5', 'postal_code', '68159', 'city', 'Mannheim',
    'service_kind', 'inspection', 'customer_number', customer_number));
$$;
create function pg_temp.inv(snapshot_number text) returns public.invoices language sql as $$
  select jsonb_populate_record(null::public.invoices, jsonb_build_object('invoice_number', 'RE-2026-9999', 'issue_date', '2026-09-01',
    'payment_due_date', '2026-09-15', 'total', 119, 'currency', 'EUR', 'seller_snapshot', '{}'::jsonb,
    'customer_snapshot', jsonb_strip_nulls(jsonb_build_object('contact_name', 'Erika Muster', 'customer_number', snapshot_number))));
$$;

-- Receipt
select ok(private.receipt_text(pg_temp.req('K-90011')) like E'%im Betreff.\n\nIhre Kundennummer: K-90011 – bitte bei Rückfragen und Anrufen\nangeben.\n\nMit freundlichen Grüßen%',
  'receipt text: note before the greeting for a linked request');
select ok(private.receipt_text(pg_temp.req(null)) like E'%im Betreff.\n\nMit freundlichen Grüßen%' and private.receipt_text(pg_temp.req(null)) not like '%Kundennummer%',
  'receipt text: no note without customer');
select ok(private.receipt_html(pg_temp.req('K-90011')) like '%>K-90011</span> – bitte bei Rückfragen und Anrufen angeben.</p>%',
  'receipt HTML: note with the number');
select ok(private.receipt_html(pg_temp.req(null)) not like '%Kundennummer%' and private.receipt_html(pg_temp.req(null)) not like '%{{%',
  'receipt HTML: no note and no placeholder left without customer');
select ok(private.customer_number_note_html('<b>') like '%&lt;b&gt;%' and private.customer_number_note_text('  ') = '',
  'note: HTML-escaped, empty for a blank number');

-- Payment reminders
select ok(private.reminder_text(pg_temp.inv('K-90012'), pg_temp.req('K-90011'), 1::smallint) like '%Ihre Kundennummer: K-90012 –%',
  'reminder: number from the invoice snapshot');
select ok(private.reminder_text(pg_temp.inv(null), pg_temp.req('K-90011'), 2::smallint) like '%Ihre Kundennummer: K-90011 –%',
  'reminder: number of the request when the snapshot has none');
select ok(private.reminder_html(pg_temp.inv('K-90012'), pg_temp.req('K-90011'), 3::smallint) like '%>K-90012</span> – bitte bei Rückfragen und Anrufen angeben.</p>%',
  'reminder HTML: note with the number');
select ok(private.reminder_text(pg_temp.inv(null), pg_temp.req(null), 1::smallint) not like '%Kundennummer%'
  and private.reminder_html(pg_temp.inv(null), pg_temp.req(null), 1::smallint) not like '%Kundennummer%'
  and private.reminder_html(pg_temp.inv(null), pg_temp.req(null), 1::smallint) not like '%{{%',
  'reminder: no note and no placeholder left without customer');

-- Appointment mails (confirmation and rejection of a window hold)
insert into public.customers (id, customer_number, company_name, contact_name, business_email) values
  ('00000000-0000-0000-0000-00000000c011', 'K-90011', 'Muster GmbH', 'Erika Muster', 'technik@muster.test');
insert into public.requests (id, source_event_key, source, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
  equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, customer_id)
values
  ('00000000-0000-0000-0000-0000000001a1', 'mail-linked', 'website_form', 'Muster GmbH', 'Erika Muster', 'technik@muster.test', '1', 'Hafenstraße 5', '68159', 'Mannheim',
    'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-00000000c011'),
  ('00000000-0000-0000-0000-0000000001a2', 'mail-new', 'website_form', 'Neu GmbH', 'Nina Neu', 'nina@neu.test', '1', 'Ringweg 9', '68159', 'Mannheim',
    'pump', 'inspection', current_date, 'Test', 'planbar', 'none_known', '{}', null);
select is((select customer_number from public.requests where id = '00000000-0000-0000-0000-0000000001a1'), 'K-90011', 'linked request carries the number');

-- The dispatcher who confirms the hold approves the mail
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test');
insert into public.profiles (id, display_name, role, is_active) values ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true);
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select private.queue_hold_mail(r,'Terminbestätigung', concat_ws(E'\n', 'Guten Tag,', '', 'wir bestätigen Ihren Termin.', '', 'Mit freundlichen Grüßen', 'Service Desk'))
from public.requests r where r.id in ('00000000-0000-0000-0000-0000000001a1', '00000000-0000-0000-0000-0000000001a2');
select is((select body_text from public.messages where request_id = '00000000-0000-0000-0000-0000000001a1' and kind = 'other'),
  E'Guten Tag,\n\nwir bestätigen Ihren Termin.\n\nIhre Kundennummer: K-90011 – bitte bei Rückfragen und Anrufen\nangeben.\n\nMit freundlichen Grüßen\nService Desk',
  'appointment mail: note before the greeting for a linked request');
select is((select body_text from public.messages where request_id = '00000000-0000-0000-0000-0000000001a2' and kind = 'other'),
  E'Guten Tag,\n\nwir bestätigen Ihren Termin.\n\nMit freundlichen Grüßen\nService Desk',
  'appointment mail: unchanged without customer');
select ok((select count(*) = 0 from public.messages where request_id = '00000000-0000-0000-0000-0000000001a2' and kind = 'receipt' and body_text like '%Kundennummer%'),
  'receipt of a new request without customer names no number');

select * from finish();
rollback;
