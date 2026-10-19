-- task-13-7: figures of the phone assistant for the analysis page (area "Telefon"). Only evaluated calls count
-- (analyzed_at set), by start of the call in the period of analytics_window. Definitions (docs/database.md):
--   calls          evaluated calls
--   resolved       calls without a callback by a human (callback_needed false)
--   requests       calls that created a request (source phone_agent, key phone_agent:<conversation id>)
--   outside_hours  calls outside the service hours (in_service_hours false)
--   emergencies    category notfall or urgent callback
--   callbacks      calls with a callback, callbacks_open of them not yet done
-- Security invoker: phone_calls RLS (dispatcher, manager, admin) and analytics_require_access (manager, admin) apply.

create function public.analytics_phone(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (period text, calls integer, resolved integer, requests integer, outside_hours integer, emergencies integer,
  callbacks integer, callbacks_open integer, total_seconds integer, avg_seconds integer, cost_cents integer, credits integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  w record;
begin
  perform private.analytics_require_access();
  select * into w from public.analytics_window(analytics_phone.kind, analytics_phone.anchor, analytics_phone.as_of);
  return query
  select x.period, count(p.id)::int,
    count(p.id) filter (where not p.callback_needed)::int,
    count(p.id) filter (where r.id is not null)::int,
    count(p.id) filter (where p.in_service_hours = false)::int,
    count(p.id) filter (where p.category = 'notfall' or p.callback_urgent)::int,
    count(p.id) filter (where p.callback_needed)::int,
    count(p.id) filter (where p.callback_needed and p.callback_done_at is null)::int,
    coalesce(sum(p.duration_seconds), 0)::int,
    coalesce(round(avg(p.duration_seconds)), 0)::int,
    coalesce(sum(p.cost_cents), 0)::int,
    coalesce(sum(p.credits), 0)::int
  from (values ('current', w.current_start, w.current_end), ('previous', w.previous_start, w.previous_end)) as x(period, from_at, to_at)
  left join public.phone_calls p on p.analyzed_at is not null and p.started_at >= x.from_at and p.started_at < x.to_at
  left join public.requests r on r.id = p.request_id and r.source = 'phone_agent' and r.source_event_key = 'phone_agent:' || p.conversation_id
  group by x.period
  order by x.period;
end;
$$;

-- Calls per category in the current period
create function public.analytics_phone_categories(kind text default 'month', anchor date default null, as_of timestamptz default now())
returns table (category text, calls integer, callbacks integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  w record;
begin
  perform private.analytics_require_access();
  select * into w from public.analytics_window(analytics_phone_categories.kind, analytics_phone_categories.anchor, analytics_phone_categories.as_of);
  return query
  select coalesce(p.category, 'sonstiges'), count(*)::int, count(*) filter (where p.callback_needed)::int
  from public.phone_calls p
  where p.analyzed_at is not null and p.started_at >= w.current_start and p.started_at < w.current_end
  group by 1
  order by 2 desc, 1;
end;
$$;

-- Calls per local day between two days (both included), for the chart
create function public.analytics_phone_days(from_date date, to_date date)
returns table (day date, calls integer, resolved integer, requests integer)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  tz text := coalesce((select s.timezone from public.settings s where s.id = 1), 'Europe/Berlin');
begin
  perform private.analytics_require_access();
  if analytics_phone_days.to_date < analytics_phone_days.from_date or analytics_phone_days.to_date - analytics_phone_days.from_date > 400 then
    raise exception 'Ungültiger Zeitraum' using errcode = 'RW422';
  end if;
  return query
  select d::date, count(p.id)::int, count(p.id) filter (where not p.callback_needed)::int, count(r.id)::int
  from generate_series(analytics_phone_days.from_date, analytics_phone_days.to_date, interval '1 day') d
  left join public.phone_calls p on p.analyzed_at is not null and (p.started_at at time zone tz)::date = d::date
  left join public.requests r on r.id = p.request_id and r.source = 'phone_agent' and r.source_event_key = 'phone_agent:' || p.conversation_id
  group by d
  order by d;
end;
$$;

comment on function public.analytics_phone(text, date, timestamptz) is 'Analytik (task-13-7): Kennzahlen des Telefonassistenten, aktueller und Vorzeitraum.';
comment on function public.analytics_phone_categories(text, date, timestamptz) is 'Analytik (task-13-7): Anrufe je Kategorie im Zeitraum.';
comment on function public.analytics_phone_days(date, date) is 'Analytik (task-13-7): Anrufe je Tag.';

revoke all on function public.analytics_phone(text, date, timestamptz), public.analytics_phone_categories(text, date, timestamptz),
  public.analytics_phone_days(date, date) from public, anon;
grant execute on function public.analytics_phone(text, date, timestamptz), public.analytics_phone_categories(text, date, timestamptz),
  public.analytics_phone_days(date, date) to authenticated;
notify pgrst, 'reload schema';
