-- task-10-2: payment reminders (stages, daily run, manual send, pause, settings). Run with: supabase test db
begin;
select plan(34);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000a9', 'admin@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager'),
  ('00000000-0000-0000-0000-0000000000a9', 'Admin', 'admin'),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
update public.settings set reminder_stage1_days = 7, reminder_stage2_days = 14, reminder_stage3_days = 14;

-- r1, r3 live and overdue by 10 days, r2 demo and overdue, r4 live and not yet due
insert into public.requests (
  id, source_event_key, request_number, source, is_demo, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
  intake_status, priority, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, completed_at, completion_summary)
select ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'pr' || n, 'x', case when n = 2 then 'demo_seed' else 'website_form' end, n = 2,
  'Kunde ' || n || ' GmbH', 'Erika <Muster>', 'e' || n || '@kunde.test', '1', 'Str. 1', '40210', 'Düsseldorf', 'pump', 'diagnosis_repair',
  date '2026-10-20', 'Test', 'planbar', 'none_known', '{}', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1',
  'processed', 'normal', now(), 'manual', 5, 'completed', now(), 'Erledigt'
from generate_series(1, 4) as n;

insert into public.invoices (id, request_id, invoice_number, status, created_by, issued_by, issue_date, payment_due_date, issued_at, sent_at,
  subtotal, tax_total, total, currency, seller_snapshot, customer_snapshot)
select ('00000000-0000-0000-0000-0000000001f' || n)::uuid, ('00000000-0000-0000-0000-00000000000' || n)::uuid, 'RE-TEST-' || n, 'sent',
  '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1',
  private.local_today() - (case when n = 4 then 1 else 24 end), private.local_today() - (case when n = 4 then -13 else 10 end),
  now() - interval '24 days', now() - interval '23 days', 1000, 190, 1190, 'EUR',
  '{"company_name": "RheinWerk Industrieservice GmbH", "iban": "DE00 1234", "bank": "Testbank"}',
  '{"contact_name": "Erika <Muster>", "business_email": "rechnung@kunde.test"}'
from generate_series(1, 4) as n;

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.version(n integer) returns integer language sql as $$
  select version from public.requests where id = ('00000000-0000-0000-0000-00000000000' || n)::uuid;
$$;

-- Due dates from the view
select is((select next_stage from public.invoice_reminder_states where invoice_id = '00000000-0000-0000-0000-0000000001f1'), 1::smallint,
  'overdue invoice without reminder: next stage 1');
select is((select next_due_on from public.invoice_reminder_states where invoice_id = '00000000-0000-0000-0000-0000000001f1'), private.local_today() - 3,
  'stage 1 is due 7 days after the due date');

-- Pause r3 before the run
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.pause_payment_reminders('00000000-0000-0000-0000-0000000001f3', pg_temp.version(3), ' ')$$,
  'RW422', null, 'pause needs a reason');
select lives_ok($$select public.pause_payment_reminders('00000000-0000-0000-0000-0000000001f3', pg_temp.version(3), 'Ratenzahlung vereinbart')$$,
  'manager pauses reminders');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.resume_payment_reminders('00000000-0000-0000-0000-0000000001f3', pg_temp.version(3))$$,
  '42501', null, 'dispatcher cannot resume reminders');
select set_config('request.jwt.claims', '', true);

-- Daily run: only live, overdue, not paused invoices; one reminder per stage
select is(public.run_payment_reminders(), 1, 'run creates one reminder (demo, paused and not yet due invoices skipped)');
select is(public.run_payment_reminders(), 0, 'second run creates nothing');
select is((select count(*)::integer from public.invoice_reminders where invoice_id = '00000000-0000-0000-0000-0000000001f2'), 0, 'no reminder for demo invoice');
select is((select count(*)::integer from public.invoice_reminders where invoice_id = '00000000-0000-0000-0000-0000000001f4'), 0, 'no reminder before the stage is due');

select is((select status::text from public.messages where invoice_id = '00000000-0000-0000-0000-0000000001f1' and kind = 'payment_reminder'), 'queued', 'reminder is queued');
select ok((select approved_by is null and approved_at is not null from public.messages where invoice_id = '00000000-0000-0000-0000-0000000001f1' and kind = 'payment_reminder'),
  'automatic reminder is approved by the system');
select is((select to_address from public.messages where invoice_id = '00000000-0000-0000-0000-0000000001f1' and kind = 'payment_reminder'), 'rechnung@kunde.test',
  'reminder goes to the invoice address');
select is((select subject from public.messages where invoice_id = '00000000-0000-0000-0000-0000000001f1' and kind = 'payment_reminder'),
  'Zahlungserinnerung zu Rechnung RE-TEST-1', 'stage 1 subject');
select ok((select position('1.190,00 €' in body_text) > 0 and position('Erika &lt;Muster&gt;' in body_html) > 0 and position('{{' in body_html || body_text) = 0
  from public.messages where invoice_id = '00000000-0000-0000-0000-0000000001f1' and kind = 'payment_reminder'),
  'text and HTML filled, customer data escaped in HTML');
select is((select count(*)::integer from public.request_events where request_id = '00000000-0000-0000-0000-000000000001' and event_type = 'payment_reminder_queued'), 1,
  'audit event for the reminder');
select is((select next_due_on from public.invoice_reminder_states where invoice_id = '00000000-0000-0000-0000-0000000001f1'), private.local_today() + 14,
  'stage 2 is due 14 days after stage 1');
select throws_ok($$insert into public.invoice_reminders (invoice_id, stage, message_id, trigger)
  select invoice_id, 1, message_id, 'automatic' from public.invoice_reminders where invoice_id = '00000000-0000-0000-0000-0000000001f1'$$,
  '23505', null, 'at most one reminder per stage');
select throws_ok($$insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at)
  values ('00000000-0000-0000-0000-000000000001', 'outgoing', 'other', 'queued', 'x@kunde.test', 'x', 'x', now())$$,
  '23514', null, 'system approval only for receipts and reminders');

-- Sending picks up the reminder
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((select m ->> 'approved_by' from public.claim_queued_messages(20, 180) m where m ->> 'kind' = 'payment_reminder'), 'system',
  'send workflow claims the reminder');
select set_config('request.jwt.claims', '', true);

-- Manual send of the next stage
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.send_payment_reminder('00000000-0000-0000-0000-0000000001f1', pg_temp.version(1))$$,
  '42501', null, 'dispatcher cannot send reminders');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((public.send_payment_reminder('00000000-0000-0000-0000-0000000001f1', pg_temp.version(1))).stage, 2::smallint, 'manager sends stage 2 now');
select ok((select r.trigger = 'manual' and m.approved_by = '00000000-0000-0000-0000-0000000000a1' and m.subject = '1. Mahnung zu Rechnung RE-TEST-1'
  from public.invoice_reminders r join public.messages m on m.id = r.message_id where r.invoice_id = '00000000-0000-0000-0000-0000000001f1' and r.stage = 2),
  'manual reminder is approved by the manager');
select throws_ok($$select public.send_payment_reminder('00000000-0000-0000-0000-0000000001f2', pg_temp.version(2))$$,
  'RW422', null, 'no reminders for demo requests');
select throws_ok($$select public.send_payment_reminder('00000000-0000-0000-0000-0000000001f4', pg_temp.version(4))$$,
  'RW422', null, 'no manual reminder before the due date');
select throws_ok($$select public.send_payment_reminder('00000000-0000-0000-0000-0000000001f3', pg_temp.version(3))$$,
  'RW422', null, 'no manual reminder while paused');

-- Payment between the stages ends the reminders
select lives_ok($$select public.record_payment('00000000-0000-0000-0000-0000000001f1', pg_temp.version(1))$$, 'payment recorded');
select is((select next_stage from public.invoice_reminder_states where invoice_id = '00000000-0000-0000-0000-0000000001f1'), null::smallint,
  'no next stage after payment');
select throws_ok($$select public.send_payment_reminder('00000000-0000-0000-0000-0000000001f1', pg_temp.version(1))$$,
  'RW422', null, 'no reminder for paid invoice');

-- Resume r3: the next run sends its stage 1
select lives_ok($$select public.resume_payment_reminders('00000000-0000-0000-0000-0000000001f3', pg_temp.version(3))$$, 'manager resumes reminders');
select set_config('request.jwt.claims', '', true);
select is(public.run_payment_reminders(), 1, 'run after resume sends the due stage');

-- Settings: admin only, stages in order, only future reminders change
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$select public.admin_update_reminder_settings(5, 10, 10)$$, '42501', null, 'manager cannot change reminder settings');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a9');
select throws_ok($$select public.admin_update_reminder_settings(null, 10, null)$$, 'RW422', null, 'a stage needs the previous one');
select lives_ok($$select public.admin_update_reminder_settings(7, null, null)$$, 'admin switches stages 2 and 3 off');
select ok((select next_stage is null and last_stage = 1 from public.invoice_reminder_states where invoice_id = '00000000-0000-0000-0000-0000000001f3')
  and (select count(*) from public.invoice_reminders where invoice_id = '00000000-0000-0000-0000-0000000001f3') = 1,
  'existing reminders stay, later stages follow the new settings');

select * from finish();
rollback;
