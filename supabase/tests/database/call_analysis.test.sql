-- task-13-6: evaluation after the call (agent_calls_pending, agent_record_call, acknowledge_call_callback).
-- Run with: supabase test db
begin;
select plan(19);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000ca0d1', 'ca-d1@x.test'), ('00000000-0000-0000-0000-0000000ca0b1', 'ca-t1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000ca0d1', 'Dispo Anrufe', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000ca0b1', 'Technik Anrufe', 'technician');

create function pg_temp.analysis(kategorie text, extra jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('kategorie', kategorie, 'dringlichkeit', 'planbar', 'sicherheitsgefahr', 'none_known', 'firma', 'Test GmbH',
    'kontakt', 'Herr Test', 'rueckrufnummer', '0621 123456', 'anfrage_nummer', null, 'zusammenfassung', 'Kunde fragt nach Preisen.',
    'rueckruf_noetig', false, 'stimmung', 'neutral') || extra;
$$;

-- Rights: only the integration records, staff acknowledge
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000ca0d1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.agent_record_call('ca-x', now(), 10, 'x', '{}')$$, '42501', null, 'staff cannot record calls');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
-- A call that used a tool (row exists) and one without any tool call (row created here)
select public.agent_service_hours('ca-call-1');
select is(public.agent_calls_pending(array['ca-call-1', 'ca-call-2']), '{"ids": ["ca-call-1", "ca-call-2"]}'::jsonb, 'both pending');
select is((public.agent_record_call('ca-call-1', '2026-10-19 08:00+00', 125, 'Mira: Guten Tag', pg_temp.analysis('frage'), 300, 4) ->> 'wiederholt')::boolean, false, 'first evaluation');
select is((public.agent_record_call('ca-call-1', '2026-10-19 08:00+00', 999, 'anders', pg_temp.analysis('notfall'), 1, 1) ->> 'wiederholt')::boolean, true, 'repetition is ignored');
select is(public.agent_calls_pending(array['ca-call-1', 'ca-call-2']), '{"ids": ["ca-call-2"]}'::jsonb, 'evaluated call no longer pending');
select ok((public.agent_record_call('ca-call-2', '2026-10-19 09:00+00', 40, 'Mira: Hallo', pg_temp.analysis('kaputt')) ->> 'ok')::boolean, 'call without tool calls recorded');
reset role;

select ok((select duration_seconds = 125 and ended_at = '2026-10-19 08:02:05+00' and category = 'frage' and summary = 'Kunde fragt nach Preisen.'
  and transcript = 'Mira: Guten Tag' and sentiment = 'neutral' and credits = 300 and cost_cents = 4 and not callback_needed
  and analysis ? 'ausserhalb_servicezeit' and analyzed_at is not null from public.phone_calls where conversation_id = 'ca-call-1'), 'fields and facts stored, first version kept');
select is((select category from public.phone_calls where conversation_id = 'ca-call-2'), 'sonstiges', 'unknown category becomes sonstiges');

-- Urgent: danger or production stop marks an urgent callback with the number from the call
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((public.agent_record_call('ca-call-3', now() - interval '5 minutes', 60, 't', pg_temp.analysis('notfall', '{"sicherheitsgefahr":"known","zusammenfassung":"Gasgeruch an der Anlage."}')) ->> 'dringend')::boolean, true, 'danger is urgent');
select is((public.agent_record_call('ca-call-4', now() - interval '4 minutes', 60, 't', pg_temp.analysis('neue_anfrage', '{"dringlichkeit":"production_stop"}')) ->> 'dringend')::boolean, true, 'production stop is urgent');
select is((public.agent_record_call('ca-call-5', '2026-10-19 10:10+00', 60, 't', pg_temp.analysis('frage', '{"rueckruf_noetig":true}')) ->> 'dringend')::boolean, false, 'callback wish is not urgent');
-- An old emergency (evaluated late) is kept as a normal callback; a placeholder number is no number
select is((public.agent_record_call('ca-call-7', now() - interval '3 days', 60, 't', pg_temp.analysis('notfall', '{"rueckrufnummer":"unbekannt 000000"}')) ->> 'dringend')::boolean, false, 'old emergency not urgent');
-- Request named in a status call is linked
select is((public.agent_record_call('ca-call-6', '2026-10-19 10:15+00', 60, 't',
  pg_temp.analysis('status', jsonb_build_object('anfrage_nummer', replace((select request_number from public.requests where request_number is not null limit 1), '-', ' ')))) ->> 'anfrage_nummer'),
  (select request_number from public.requests where request_number is not null limit 1), 'request linked by spoken number');
reset role;
select ok((select callback_needed and callback_urgent and callback_reason = 'Gasgeruch an der Anlage.' and callback_number = '0621 123456'
  from public.phone_calls where conversation_id = 'ca-call-3'), 'urgent callback with reason and number');
select ok((select callback_needed and not callback_urgent from public.phone_calls where conversation_id = 'ca-call-5'), 'normal callback');
select ok((select callback_needed and not callback_urgent and callback_number is null from public.phone_calls where conversation_id = 'ca-call-7'), 'old emergency: normal callback without placeholder number');
select ok((select request_id is not null from public.phone_calls where conversation_id = 'ca-call-6'), 'request id stored');

-- Acknowledgement by a dispatcher, not by a technician
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000ca0b1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.acknowledge_call_callback((select id from public.phone_calls where conversation_id = 'ca-call-3'))$$, '42501', null, 'technicians cannot acknowledge');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000ca0d1', 'role', 'authenticated')::text, true);
select is((select callback_done_by from public.acknowledge_call_callback((select id from public.phone_calls where conversation_id = 'ca-call-3'))),
  '00000000-0000-0000-0000-0000000ca0d1'::uuid, 'dispatcher acknowledges');
reset role;

select * from finish();
rollback;
