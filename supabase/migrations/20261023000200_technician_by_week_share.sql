-- task-20-11 (user request 23.10.2026): the technician for a held window is the one with the lowest share of the
-- calendar week (Monday to Sunday) of the window booked, no longer of the month. A technician with a full week but an
-- empty rest of the month otherwise kept getting new visits. The planning board still shows the share of the month.

-- Booked minutes of a technician in the calendar week of a local day (visits and open holds, as month_booked_minutes)
create function private.week_booked_minutes(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from least(x.e, b.d1) - greatest(x.s, b.d0)) / 60), 0)::integer
  from (
    select v.scheduled_start s, v.scheduled_end e from public.visits v
    where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress', 'waiting_parts', 'completed')
    union all
    select h.starts_at, h.ends_at from public.visit_holds h where h.technician_id = target_technician_id and h.status = 'open'
  ) x,
  lateral (select (date_trunc('week', local_day)::timestamp at time zone 'Europe/Berlin') d0,
                  ((date_trunc('week', local_day) + interval '1 week')::timestamp at time zone 'Europe/Berlin') d1) b
  where x.s < b.d1 and x.e > b.d0;
$$;

-- Working minutes of the calendar week of the local day, minus absences within them (as month_capacity_minutes)
create function private.week_capacity_minutes(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with days as (
    select d::date as d
    from generate_series(date_trunc('week', local_day), date_trunc('week', local_day) + interval '6 days', interval '1 day') g(d)
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
  order by private.week_booked_minutes(p.id, x.day)::numeric / nullif(private.week_capacity_minutes(p.id, x.day), 0) nulls last,
    private.booked_minutes(p.id, x.day), p.id
  limit 1;
$$;

revoke all on function private.week_booked_minutes(uuid, date), private.week_capacity_minutes(uuid, date),
  private.technician_for_window(timestamptz, timestamptz) from public, anon, authenticated;
