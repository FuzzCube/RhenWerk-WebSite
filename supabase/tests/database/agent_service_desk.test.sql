-- task-13-5: service hours with public holidays in Baden-Württemberg, callback by the service desk.
-- Run with: supabase test db
begin;
select plan(14);

create function pg_temp.at(t text) returns timestamptz language sql as $$ select t::timestamp at time zone 'Europe/Berlin'; $$;

-- Holidays 2026: Easter Sunday 5 April
select ok(private.is_bw_holiday('2026-04-03') and private.is_bw_holiday('2026-04-06') and private.is_bw_holiday('2026-05-14')
  and private.is_bw_holiday('2026-05-25') and private.is_bw_holiday('2026-06-04'), 'Good Friday, Easter Monday, Ascension, Whit Monday, Corpus Christi');
select ok(private.is_bw_holiday('2026-01-06') and private.is_bw_holiday('2026-10-03') and private.is_bw_holiday('2026-11-01') and private.is_bw_holiday('2026-12-26'), 'fixed holidays');
select ok(not private.is_bw_holiday('2026-10-15') and not private.is_bw_holiday('2026-04-05') and not private.is_bw_holiday('2026-08-15'), 'no holiday on normal days');
select ok(private.is_bw_holiday('2027-03-26') and private.is_bw_holiday('2027-03-29'), '2027: Easter on 28 March');

select is(private.in_service_hours(pg_temp.at('2026-10-15 07:00')), true, 'Thursday 07:00 open');
select is(private.in_service_hours(pg_temp.at('2026-10-15 18:00')), false, '18:00 closed');
select is(private.in_service_hours(pg_temp.at('2026-10-17 10:00')), false, 'Saturday closed');
select is(private.in_service_hours(pg_temp.at('2026-06-04 10:00')), false, 'holiday closed');
select is(private.next_service_start(pg_temp.at('2026-10-16 19:30')), pg_temp.at('2026-10-19 07:00'), 'Friday evening → Monday 07:00');
select is(private.next_service_start(pg_temp.at('2026-04-02 18:30')), pg_temp.at('2026-04-07 07:00'), 'before Easter → Tuesday after Easter Monday');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select ok((select r ? 'in_servicezeit' and r ->> 'jetzt' like '%Uhr' and r ->> 'heute' ~ '^\d{4}-\d{2}-\d{2}$' from public.agent_service_hours('sd-call-1') r), 'tool servicezeit');
select is(public.agent_request_service_callback('sd-call-1', 'Stillstand Kompressor', '12') ->> 'fehler', 'rueckrufnummer_ungueltig', 'callback number needed');
select is(public.agent_request_service_callback('sd-call-1', 'Stillstand Kompressor', '0621 99887766', true) ->> 'ok', 'true', 'callback requested');
reset role;
select ok((select callback_needed and callback_urgent and callback_reason = 'Stillstand Kompressor' and callback_number = '0621 99887766' and in_service_hours is not null
  from public.phone_calls where conversation_id = 'sd-call-1'), 'call marked for an urgent callback');

select * from finish();
rollback;
