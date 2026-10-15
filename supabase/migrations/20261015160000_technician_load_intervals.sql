-- task-12-1: visit intervals of all active technicians for the monthly load on the planning board, including
-- visits that are completed or waiting for parts (technician_busy_intervals only returns blocking visits).
-- Same data level as technician_busy_intervals: technician and time only, no customer or address.

create function public.technician_load_intervals(range_start timestamptz, range_end timestamptz)
returns table (technician_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.technician_id, v.scheduled_start, v.scheduled_end
  from public.visits v
  join public.profiles p on p.id = v.technician_id and p.is_active and p.role = 'technician'
  where private.current_employee_role() in ('dispatcher', 'manager', 'admin')
    and v.status in ('scheduled', 'in_progress', 'waiting_parts', 'completed')
    and v.scheduled_start < range_end and v.scheduled_end > range_start
  order by 1, 2;
$$;

revoke all on function public.technician_load_intervals(timestamptz, timestamptz) from public, anon;
grant execute on function public.technician_load_intervals(timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
