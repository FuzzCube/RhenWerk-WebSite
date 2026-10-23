-- task-20-16: customer wishes to move a visit: change request, acknowledgement, confirmation or offer by the dispatcher,
-- answer of the customer, reminder. Run with: supabase test db
begin;
select plan(31);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'f1@x.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'f2@x.test'),
  ('00000000-0000-0000-0000-0000000000f3', 'f3@x.test'),
  ('00000000-0000-0000-0000-0000000000f4', 'f4@x.test');
update public.profiles set is_active = false where role = 'technician';
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'Dispo F1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000f2', 'Dispo F2', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000f3', 'Technik F3', 'technician'),
  ('00000000-0000-0000-0000-0000000000f4', 'Technik F4', 'technician');
insert into public.employee_availability (employee_id, kind, weekday, local_start, local_end)
select t, 'working_hours', d, time '08:00', time '16:00'
from generate_series(1, 5) d, unnest(array['00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4']::uuid[]) t;

-- Test day: a Tuesday 10 to 16 days ahead; plus n days, local time
create function pg_temp.day() returns date language sql as $$
  select d::date from generate_series((now() at time zone 'Europe/Berlin')::date + 10, (now() at time zone 'Europe/Berlin')::date + 16, interval '1 day') g(d) where extract(isodow from d) = 2 limit 1;
$$;
create function pg_temp.at(plus integer, hhmm text) returns timestamptz language sql as $$
  select ((pg_temp.day() + plus)::text || ' ' || hhmm)::timestamp at time zone 'Europe/Berlin';
$$;
-- Request n of dispatcher f1 with a visit of technician f3 on day + plus from start to end
create function pg_temp.req(n integer, plus integer, start_at text, end_at text, tech text default 'f3') returns uuid language sql as $$
  with r as (
    insert into public.requests (id, source_event_key, source, request_number, company_name, contact_name, business_email, phone_number, street_house_number, postal_code, city,
      equipment_kind, service_kind, requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, technician_id,
      intake_status, intake_completed_at, intake_mode, manual_minutes_baseline, work_status, priority)
    values (('00000000-0000-0000-0000-0000000001' || lpad(n::text, 2, '0'))::uuid, 'change-' || n, 'website_form', 'RIS-2098-' || lpad(n::text, 5, '0'), 'Wunsch GmbH', 'Willi Wunsch', 'willi@wunsch.test', '1',
      'Str. 1', '68159', 'Mannheim', 'pump', 'inspection', current_date + 7, 'Test', 'planbar', 'none_known', '{}',
      '00000000-0000-0000-0000-0000000000f1', ('00000000-0000-0000-0000-0000000000' || tech)::uuid, 'processed', now(), 'manual', 15, 'scheduled', 'normal')
    returning id)
  insert into public.visits (request_id, technician_id, scheduled_start, scheduled_end, created_by, created_at)
  select r.id, ('00000000-0000-0000-0000-0000000000' || tech)::uuid, pg_temp.at(plus, start_at), pg_temp.at(plus, end_at), '00000000-0000-0000-0000-0000000000f1', now() - interval '1 hour' from r
  returning id;
$$;
-- A: visit Tuesday 10-12 of technician f3; B blocks f3 on Wednesday 10-12 (the wished time of A)
select pg_temp.req(1, 0, '10:00', '12:00');
select pg_temp.req(2, 1, '10:00', '12:00');
insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'incoming', 'customer_reply', 'received', 'Willi Wunsch <willi@wunsch.test>', 'Re: Terminbestätigung', 'Können wir den Termin bitte einen Tag später machen?', now()),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000101', 'incoming', 'customer_reply', 'received', 'willi@wunsch.test', 'Re: Ihr Terminwunsch', 'Ja, der Vorschlag passt.', now() + interval '1 second');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.apply_visit_reply('00000000-0000-0000-0000-000000000201', 'reschedule', 0.9, 'Kunde möchte einen Tag später.', null, pg_temp.day() + 1, '10:00') ->> 'action', 'change_requested', 'wish to move: change request');
select ok((select count(*) = 1 from public.claim_queued_messages(20) c where c ->> 'request_id' = '00000000-0000-0000-0000-000000000101' and c ->> 'subject' like 'Ihr Terminwunsch RIS-%Eingang bestätigt' and c ->> 'approved_by' = 'system'),
  'acknowledgement is released for sending');
reset role;
select ok((select c.status = 'open' and c.wished_day = pg_temp.day() + 1 and c.wished_time = '10:00' and c.message_id = '00000000-0000-0000-0000-000000000201' from public.visit_change_requests c where c.request_id = '00000000-0000-0000-0000-000000000101'), 'wish with day and time stored');
select ok((select m.system_template = 'visit_change_received' and m.body_text like '%melden uns bei Ihnen%' from public.messages m where m.request_id = '00000000-0000-0000-0000-000000000101' and m.direction = 'outgoing'), 'acknowledgement text');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f2', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.visit_change_requests), 0, 'another dispatcher does not see the wish');
select throws_ok(format($$select public.visit_change_options(%L)$$, (select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101')), '42501', null, 'another dispatcher cannot work on it');

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.visit_change_requests), 1, 'the dispatcher of the request sees the wish');
select ok((select (o -> 'wished' ->> 'free')::boolean = false from (select public.visit_change_options((select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101')) o) x), 'wished time is taken');
select ok((select jsonb_array_length(o -> 'alternatives') >= 2 and (o -> 'alternatives' -> 0 ->> 'technician_id') = '00000000-0000-0000-0000-0000000000f3' from (select public.visit_change_options((select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101')) o) x), 'alternatives, the same technician first');
select ok((select (o -> 'alternatives' -> 0 ->> 'start')::timestamptz >= pg_temp.at(1, '00:00') and (o -> 'alternatives' -> 0 ->> 'start')::timestamptz < pg_temp.at(2, '00:00') from (select public.visit_change_options((select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101')) o) x), 'nearest alternative on the wished day');

-- Offer: not free at the blocked time, free on Wednesday 13:00
select throws_ok(format($$select public.offer_visit_change(%L, (select version from public.requests where id = '00000000-0000-0000-0000-000000000101'), '00000000-0000-0000-0000-0000000000f3', %L, %L)$$,
  (select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101'), pg_temp.at(1, '10:00'), pg_temp.at(1, '12:00')), 'RW410', null, 'offer in a taken window is refused');
select lives_ok(format($$select public.offer_visit_change(%L, (select version from public.requests where id = '00000000-0000-0000-0000-000000000101'), '00000000-0000-0000-0000-0000000000f3', %L, %L)$$,
  (select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101'), pg_temp.at(1, '13:00'), pg_temp.at(1, '15:00')), 'offer of a free window');
reset role;
select ok((select c.status = 'offered' and c.offered_start = pg_temp.at(1, '13:00') and c.offered_by = '00000000-0000-0000-0000-0000000000f1' from public.visit_change_requests c where c.request_id = '00000000-0000-0000-0000-000000000101'), 'offer stored');
select is((select scheduled_start from public.visits where request_id = '00000000-0000-0000-0000-000000000101'), pg_temp.at(0, '10:00'), 'the visit stays until the customer agrees');
select ok((select count(*) = 1 from public.messages m where m.request_id = '00000000-0000-0000-0000-000000000101' and m.direction = 'outgoing' and m.subject like 'Ihr Terminwunsch RIS-%Vorschlag' and m.body_text like '%mit „Ja“%' and m.approved_by = '00000000-0000-0000-0000-0000000000f1'), 'offer mail approved by the dispatcher');

-- The customer says yes: the visit moves by itself
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok((select jsonb_array_length(i -> 'visits') = 1 and i ->> 'offer' is not null from jsonb_array_elements(public.visit_replies_pending(10) -> 'items') i where i ->> 'message_id' = '00000000-0000-0000-0000-000000000202'), 'the pending reply carries the open offer');
select is(public.apply_visit_reply('00000000-0000-0000-0000-000000000202', 'confirm', 0.95, 'Kunde stimmt zu.') ->> 'action', 'moved', 'yes to the offer moves the visit');
reset role;
select ok((select v.scheduled_start = pg_temp.at(1, '13:00') and v.scheduled_end = pg_temp.at(1, '15:00') from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000101'), 'visit at the offered time');
select is((select status from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000101'), 'accepted', 'wish accepted');
select ok((select count(*) = 1 from public.messages m where m.request_id = '00000000-0000-0000-0000-000000000101' and m.system_template = 'visit_change_accepted' and m.body_text like '%Ihr neuer Termin%'), 'confirmation to the customer');
select ok((select count(*) = 1 from public.request_events e where e.request_id = '00000000-0000-0000-0000-000000000101' and e.event_type = 'visit_rescheduled' and e.actor_type = 'automation'), 'logged as automation');

-- C: offer, the customer says no; D: dispatcher confirms the wish; E: reminder; F: the visit is cancelled otherwise
select pg_temp.req(11, 0, '08:00', '10:00');
select pg_temp.req(21, 0, '08:00', '10:00', 'f4');
select pg_temp.req(31, 0, '12:00', '14:00', 'f4');
select pg_temp.req(41, 0, '14:00', '16:00', 'f4');
insert into public.visit_change_requests (request_id, visit_id, status, wished_day, wished_time, offered_technician_id, offered_start, offered_end, offered_at)
select '00000000-0000-0000-0000-000000000111', v.id, 'offered', pg_temp.day() + 2, 'any', '00000000-0000-0000-0000-0000000000f3', pg_temp.at(2, '08:00'), pg_temp.at(2, '10:00'), now() from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000111';
insert into public.visit_change_requests (request_id, visit_id, status, wished_day, wished_time, wish_summary)
select '00000000-0000-0000-0000-000000000121', v.id, 'open', pg_temp.day() + 1, 'any', 'Einen Tag später' from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000121';
insert into public.visit_change_requests (request_id, visit_id, status, wished_day, wished_time, offered_technician_id, offered_start, offered_end, offered_at)
select '00000000-0000-0000-0000-000000000131', v.id, 'offered', null, 'any', '00000000-0000-0000-0000-0000000000f4', pg_temp.at(3, '12:00'), pg_temp.at(3, '14:00'), now() - interval '3 days' from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000131';
insert into public.visit_change_requests (request_id, visit_id, status, wished_day, wished_time)
select '00000000-0000-0000-0000-000000000141', v.id, 'open', pg_temp.day() + 1, 'any' from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000141';
insert into public.messages (id, request_id, direction, kind, status, from_address, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000211', '00000000-0000-0000-0000-000000000111', 'incoming', 'customer_reply', 'received', 'willi@wunsch.test', 'Re: Ihr Terminwunsch', 'Nein, der Vorschlag passt leider nicht.', now());

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.apply_visit_reply('00000000-0000-0000-0000-000000000211', 'decline', 0.9, 'Kunde lehnt ab.') ->> 'action', 'declined', 'no to the offer');
reset role;
select ok((select status = 'declined' from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000111')
  and (select scheduled_start = pg_temp.at(0, '08:00') from public.visits where request_id = '00000000-0000-0000-0000-000000000111'), 'visit stays, wish declined');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000f1', 'role', 'authenticated')::text, true);
select ok((select (o -> 'wished' ->> 'free')::boolean and (o -> 'wished' ->> 'start')::timestamptz = pg_temp.at(1, '08:00') from (select public.visit_change_options((select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000121')) o) x), 'free wished window: the same time of day on the wished day');
select lives_ok(format($$select public.confirm_visit_change(%L, (select version from public.requests where id = '00000000-0000-0000-0000-000000000121'), '00000000-0000-0000-0000-0000000000f4', %L, %L)$$,
  (select id from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000121'), pg_temp.at(1, '08:00'), pg_temp.at(1, '10:00')), 'the dispatcher confirms the wish');
reset role;
select ok((select v.scheduled_start = pg_temp.at(1, '08:00') from public.visits v where v.request_id = '00000000-0000-0000-0000-000000000121') and (select status = 'done' from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000121'), 'visit moved, wish done');
select ok((select count(*) = 1 from public.messages m where m.request_id = '00000000-0000-0000-0000-000000000121' and m.subject like 'Terminänderung bestätigt RIS-%' and m.body_text like '%gern haben wir Ihren Terminwunsch%' and m.approved_by = '00000000-0000-0000-0000-0000000000f1'), 'confirmation mail');

-- Reminder: offer older than two days, once
select is(public.run_visit_change_reminders(), 1, 'one reminder: offer older than two days');
select is(public.run_visit_change_reminders(), 0, 'only once');
select ok((select count(*) = 1 from public.messages m where m.request_id = '00000000-0000-0000-0000-000000000131' and m.system_template = 'visit_change_reminder' and m.body_text like '%Ohne Antwort bleibt Ihr bisheriger Termin bestehen%'), 'reminder mail');

-- A visit that is cancelled otherwise closes the wish
update public.visits set status = 'cancelled', cancellation_reason = 'Test' where request_id = '00000000-0000-0000-0000-000000000141';
select is((select status from public.visit_change_requests where request_id = '00000000-0000-0000-0000-000000000141'), 'done', 'cancelled visit closes the wish');

select * from finish();
rollback;
