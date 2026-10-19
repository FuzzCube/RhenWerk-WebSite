-- task-13-5: servicezeit returns a calendar of the next 21 days, so the agent looks dates up instead of computing them
-- (test call 19.10.2026: "nächste Woche Mittwoch" became a Monday). Entries: "Mittwoch, der 28. Oktober (KW 44) = 2026-10-28",
-- public holidays in Baden-Württemberg marked.

create function private.agent_calendar(from_day date, days integer default 21)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    (array['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])[extract(isodow from d)::int]
    || ', der ' || extract(day from d)::int || '. '
    || (array['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'])[extract(month from d)::int]
    || ' (KW ' || extract(week from d)::int || ')'
    || case when d = from_day then ', heute' when d = from_day + 1 then ', morgen' else '' end
    || case when private.is_bw_holiday(d) then ', Feiertag' else '' end
    || ' = ' || to_char(d, 'YYYY-MM-DD')
    order by d), '[]'::jsonb)
  from generate_series(from_day, from_day + (days - 1), interval '1 day') g(day), lateral (select g.day::date as d) x;
$$;

create or replace function public.agent_service_hours(call_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  open_now boolean := private.in_service_hours(now());
  today date := (now() at time zone 'Europe/Berlin')::date;
begin
  perform private.require_integration();
  c := private.call_for(agent_service_hours.call_id);
  update public.phone_calls p set in_service_hours = open_now where p.id = c.id;
  return jsonb_build_object('ok', true, 'in_servicezeit', open_now, 'jetzt', private.spoken_datetime(now()),
    'heute', to_char(today, 'YYYY-MM-DD'), 'kalender', private.agent_calendar(today))
    || case when open_now then '{}'::jsonb
       else jsonb_build_object('naechste_servicezeit', private.spoken_datetime(private.next_service_start(now()))) end;
end;
$$;

revoke all on function private.agent_calendar(date, integer) from public, anon, authenticated;
notify pgrst, 'reload schema';
