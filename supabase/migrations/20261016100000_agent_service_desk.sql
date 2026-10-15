-- task-13-5: two tools of the phone assistant that the agent platform cannot answer itself.
-- servicezeit: whether a human is reachable now (Mo–Fr 07:00–18:00 Europe/Berlin, without public holidays in
-- Baden-Württemberg; docs/telefonassistent/regeln.md: computed by the system, not by the language model).
-- rueckruf_service_desk: in the web widget there is no phone transfer, so instead of "weiterleiten" the call is
-- marked for a callback by the service desk (urgent for emergencies); the dashboard (task-13-7) lists these calls.

alter table public.phone_calls
  add column callback_reason text,
  add column callback_number text,
  add column callback_urgent boolean not null default false;

-- Public holidays in Baden-Württemberg (Easter date after Gauss/Lichtenberg)
create function private.is_bw_holiday(day date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  y integer := extract(year from day);
  a integer := y % 19;
  b integer := y / 100;
  c integer := y % 100;
  d integer := b / 4;
  e integer := b % 4;
  f integer := (b + 8) / 25;
  g integer := (b - f + 1) / 3;
  h integer := (19 * a + b - d - g + 15) % 30;
  i integer := c / 4;
  k integer := c % 4;
  l integer := (32 + 2 * e + 2 * i - h - k) % 7;
  m integer := (a + 11 * h + 22 * l) / 451;
  easter date := make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
begin
  return to_char(day, 'MM-DD') in ('01-01', '01-06', '05-01', '10-03', '11-01', '12-25', '12-26')
    or day in (easter - 2, easter + 1, easter + 39, easter + 50, easter + 60);
end;
$$;

create function private.in_service_hours(at_time timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select extract(isodow from l) <= 5 and l::time >= time '07:00' and l::time < time '18:00' and not private.is_bw_holiday(l::date)
  from (select at_time at time zone 'Europe/Berlin' as l) x;
$$;

-- Next start of the service hours after at_time (at most four weeks ahead)
create function private.next_service_start(at_time timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((d::date)::text || ' 07:00')::timestamp at time zone 'Europe/Berlin'
  from generate_series((at_time at time zone 'Europe/Berlin')::date, (at_time at time zone 'Europe/Berlin')::date + 28, interval '1 day') d
  where extract(isodow from d) <= 5 and not private.is_bw_holiday(d::date)
    and ((d::date)::text || ' 07:00')::timestamp at time zone 'Europe/Berlin' > at_time
  order by d limit 1;
$$;

-- Tool servicezeit: current time as spoken text, whether the service desk is reachable, next opening
create function public.agent_service_hours(call_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  open_now boolean := private.in_service_hours(now());
begin
  perform private.require_integration();
  c := private.call_for(agent_service_hours.call_id);
  update public.phone_calls p set in_service_hours = open_now where p.id = c.id;
  return jsonb_build_object('ok', true, 'in_servicezeit', open_now, 'jetzt', private.spoken_datetime(now()),
    'heute', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'))
    || case when open_now then '{}'::jsonb
       else jsonb_build_object('naechste_servicezeit', private.spoken_datetime(private.next_service_start(now()))) end;
end;
$$;

-- Tool rueckruf_service_desk: callback by a human instead of a transfer (web widget); repetition updates the note
create function public.agent_request_service_callback(call_id text, grund text, rueckrufnummer text, dringend boolean default false, anfrage_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  reason text := nullif(btrim(coalesce(grund, '')), '');
  number_value text := btrim(regexp_replace(coalesce(rueckrufnummer, ''), '\s+', ' ', 'g'));
  open_now boolean := private.in_service_hours(now());
begin
  perform private.require_integration();
  c := private.call_for(agent_request_service_callback.call_id);
  if reason is null then
    return jsonb_build_object('ok', false, 'fehler', 'grund_fehlt');
  end if;
  if length(regexp_replace(number_value, '[^0-9]', '', 'g')) < 6 then
    return jsonb_build_object('ok', false, 'fehler', 'rueckrufnummer_ungueltig');
  end if;
  update public.phone_calls p set callback_needed = true, callback_reason = left(reason, 500), callback_number = number_value,
    callback_urgent = coalesce(dringend, false), in_service_hours = open_now,
    request_id = coalesce(p.request_id, (select r.id from public.requests r where r.id = agent_request_service_callback.anfrage_id))
  where p.id = c.id;
  return jsonb_build_object('ok', true, 'in_servicezeit', open_now)
    || case when open_now then '{}'::jsonb
       else jsonb_build_object('naechste_servicezeit', private.spoken_datetime(private.next_service_start(now()))) end;
end;
$$;

revoke all on function private.is_bw_holiday(date), private.in_service_hours(timestamptz), private.next_service_start(timestamptz) from public, anon, authenticated;
revoke all on function public.agent_service_hours(text), public.agent_request_service_callback(text, text, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.agent_service_hours(text), public.agent_request_service_callback(text, text, text, boolean, uuid) to service_role;
notify pgrst, 'reload schema';
