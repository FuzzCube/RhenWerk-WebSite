-- task-11-4: requests taken over the phone (create_phone_request): rights, field checks, idempotency,
-- dispatcher assignment, receipt on request. Run with: supabase test db
begin;
select plan(18);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'm@x.test'),
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'd2@x.test'),
  ('00000000-0000-0000-0000-0000000000d3', 'd3@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
-- Only the test dispatchers count for the automatic assignment
update public.profiles set is_active = false where role = 'dispatcher';
insert into public.profiles (id, display_name, role, is_active) values
  ('00000000-0000-0000-0000-0000000000a1', 'Managerin', 'manager', true),
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d2', 'Dispo 2', 'dispatcher', true),
  ('00000000-0000-0000-0000-0000000000d3', 'Dispo inaktiv', 'dispatcher', false),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician', true);

-- Dispatcher 1 already has an open intake, so dispatcher 2 is the least loaded
insert into public.requests (
  source_event_key, source, company_name, contact_name, business_email, phone_number,
  street_house_number, postal_code, city, equipment_kind, service_kind, requested_visit_date, description,
  customer_urgency, safety_risk, raw_payload, dispatcher_id)
values ('phone-test-open', 'website_form', 'ACME', 'Erika', 'e@acme.test', '1', 'Str. 1', '40210',
  'Düsseldorf', 'pump', 'diagnosis_repair', date '2026-10-20', 'Offene Erstbearbeitung', 'planbar', 'none_known', '{}',
  '00000000-0000-0000-0000-0000000000d1');

create function pg_temp.act_as(user_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.fields() returns jsonb language sql as $$
  select jsonb_build_object('company_name', 'Anruf GmbH', 'contact_name', 'Max Anruf', 'business_email', 'einkauf@anruf.test',
    'phone_number', '0211 12345', 'street_house_number', 'Weg 2', 'postal_code', '40211', 'city', 'Düsseldorf',
    'site_label', 'Halle 3', 'equipment_kind', 'compressor', 'service_kind', 'diagnosis_repair', 'requested_visit_date', '2026-10-22',
    'customer_urgency', 'zeitnah', 'safety_risk', 'none_known', 'description', 'Kompressor schaltet nach zehn Minuten ab.');
$$;
create function pg_temp.req(k text) returns public.requests language sql as $$
  select * from public.requests where source_event_key = 'phone:' || k;
$$;
grant execute on function pg_temp.act_as(uuid), pg_temp.fields(), pg_temp.req(text) to anon, authenticated;

-- Rights
set local role anon;
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields())$$,
  '42501', null, 'anon cannot create a phone request');
set local role authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b1');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields())$$,
  '42501', null, 'technician cannot create a phone request');

-- Field checks (shared with the e-mail inbox)
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields() - 'business_email')$$,
  'RW422', null, 'e-mail address is required');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields() || '{"requested_visit_date": "2026-13-40"}')$$,
  'RW422', null, 'invalid date is rejected');

-- Dispatcher: request goes to the caller, receipt queued by default
select lives_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields())$$,
  'dispatcher creates a phone request');
select ok((select source = 'phone' and dispatcher_id = '00000000-0000-0000-0000-0000000000d1' and intake_status = 'new'
    and request_number like 'RIS-%' and not human_review_required and site_label = 'Halle 3'
  from pg_temp.req('00000000-0000-0000-0000-00000000f001')),
  'source phone, caller as dispatcher, status new, number assigned, no review flag');
select is((select count(*)::int from public.request_events e where e.request_id = (pg_temp.req('00000000-0000-0000-0000-00000000f001')).id
  and e.event_type = 'request_created_by_phone'), 1, 'creation is logged');
select is((select count(*)::int from public.messages m where m.request_id = (pg_temp.req('00000000-0000-0000-0000-00000000f001')).id
  and m.kind = 'receipt' and m.status = 'queued' and m.to_address = 'einkauf@anruf.test'), 1, 'receipt queued to the customer');
select is((public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields())).id,
  (pg_temp.req('00000000-0000-0000-0000-00000000f001')).id, 'repetition returns the same request');
select is((select count(*)::int from public.requests where source = 'phone'), 1, 'no duplicate request');
select is((select count(*)::int from public.messages m where m.request_id = (pg_temp.req('00000000-0000-0000-0000-00000000f001')).id
  and m.kind = 'receipt'), 1, 'no second receipt');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d2');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f001', pg_temp.fields())$$,
  '42501', null, 'repetition by someone without access does not reveal the request');

-- Manager: least-loaded dispatcher, chosen dispatcher, no receipt on request
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is((public.create_phone_request('00000000-0000-0000-0000-00000000f002', pg_temp.fields(), false)).dispatcher_id,
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'manager without choice: least-loaded active dispatcher');
select is((select count(*)::int from public.messages m where m.request_id = (pg_temp.req('00000000-0000-0000-0000-00000000f002')).id),
  0, 'no receipt when not requested');
select is((public.create_phone_request('00000000-0000-0000-0000-00000000f003', pg_temp.fields(), true, '00000000-0000-0000-0000-0000000000d1')).dispatcher_id,
  '00000000-0000-0000-0000-0000000000d1'::uuid, 'manager chooses the dispatcher');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f004', pg_temp.fields(), true, '00000000-0000-0000-0000-0000000000d3')$$,
  'RW422', null, 'inactive dispatcher cannot be chosen');
select throws_ok($$select public.create_phone_request('00000000-0000-0000-0000-00000000f004', pg_temp.fields(), true, '00000000-0000-0000-0000-0000000000b1')$$,
  'RW422', null, 'technician cannot be chosen as dispatcher');
select ok((public.create_phone_request('00000000-0000-0000-0000-00000000f005', pg_temp.fields() || '{"safety_risk": "unclear"}')).human_review_required,
  'unclear safety risk requires human review');

select * from finish();
rollback;
