-- task-20-15 (user request 23.10.2026): the technician for a held window is chosen in two steps.
-- 1. Among the technicians free for the window, the one with the fewest orders (visits and open holds) in the calendar
--    week (Monday to Sunday) of the window. If one technician has strictly fewer than all others, he gets it.
-- 2. Only if several are tied on the fewest orders of the week, the load of the month decides among them (booked
--    minutes divided by the working hours of the month minus absences, as the planning board shows it), then the
--    minutes of the day, then the id.
-- Before (task-20-11), the share of the week in minutes decided alone.

-- Orders of a technician in the calendar week of a local day: visits starting in it (planned, running, waiting for
-- parts, completed) and open holds
create function private.week_order_count(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select (date_trunc('week', local_day)::timestamp at time zone 'Europe/Berlin') d0,
           ((date_trunc('week', local_day) + interval '1 week')::timestamp at time zone 'Europe/Berlin') d1
  )
  select (
    (select count(*) from public.visits v, b
      where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress', 'waiting_parts', 'completed')
        and v.scheduled_start >= b.d0 and v.scheduled_start < b.d1)
    + (select count(*) from public.visit_holds h, b
      where h.technician_id = target_technician_id and h.status = 'open' and h.starts_at >= b.d0 and h.starts_at < b.d1)
  )::integer;
$$;

create or replace function private.technician_for_window(range_start timestamptz, range_end timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  with day as (select (range_start at time zone 'Europe/Berlin')::date as d),
  free as (
    select p.id, private.week_order_count(p.id, day.d) as orders
    from public.profiles p, day
    where p.role = 'technician' and p.is_active and private.window_free(p.id, range_start, range_end)
  )
  select f.id from free f, day
  where f.orders = (select min(orders) from free)
  order by private.month_booked_minutes(f.id, day.d)::numeric / nullif(private.month_capacity_minutes(f.id, day.d), 0) nulls last,
    private.booked_minutes(f.id, day.d), f.id
  limit 1;
$$;

revoke all on function private.week_order_count(uuid, date), private.technician_for_window(timestamptz, timestamptz) from public, anon, authenticated;
