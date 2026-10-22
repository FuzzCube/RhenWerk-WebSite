-- task-20-9: the technician for a held window is the one with the lowest share of the month booked, as the planning
-- board shows it ("Okt. · 15 % belegt"): booked minutes divided by the working hours of the month minus absences.
-- Before, plain booked minutes decided, so a technician with absence days counted as less loaded than he is.

-- Working minutes of the calendar month of the local day, minus absences within them (as lib/technician-load.ts)
create or replace function private.month_capacity_minutes(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d::date as d
    from generate_series(date_trunc('month', local_day), date_trunc('month', local_day) + interval '1 month' - interval '1 day', interval '1 day') g(d)
  ), shifts as (
    select (x.d + a.local_start) at time zone 'Europe/Berlin' as s, (x.d + a.local_end) at time zone 'Europe/Berlin' as e
    from days x
    join public.employee_availability a on a.employee_id = target_technician_id and a.kind = 'working_hours'
      and a.weekday = extract(isodow from x.d) and (a.valid_from is null or x.d >= a.valid_from) and (a.valid_to is null or x.d <= a.valid_to)
  )
  select greatest(0, coalesce(sum(extract(epoch from sh.e - sh.s) / 60
    - coalesce((select sum(extract(epoch from least(sh.e, ab.ends_at) - greatest(sh.s, ab.starts_at)) / 60)
        from public.employee_availability ab
        where ab.employee_id = target_technician_id and ab.kind = 'absence' and ab.starts_at < sh.e and ab.ends_at > sh.s), 0)), 0))::integer
  from shifts sh;
$$;

create or replace function private.technician_for_window(range_start timestamptz, range_end timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  cross join lateral (select (range_start at time zone 'Europe/Berlin')::date as day) x
  where p.role = 'technician' and p.is_active and private.window_free(p.id, range_start, range_end)
  order by private.month_booked_minutes(p.id, x.day)::numeric / nullif(private.month_capacity_minutes(p.id, x.day), 0) nulls last,
    private.booked_minutes(p.id, x.day), p.id
  limit 1;
$$;

revoke all on function private.month_capacity_minutes(uuid, date), private.technician_for_window(timestamptz, timestamptz) from public, anon, authenticated;
