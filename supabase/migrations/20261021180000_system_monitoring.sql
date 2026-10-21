-- task-17-9: results of the watchdog (scripts/prod/watchdog.mjs) for the area "System". One entry per monitored
-- system in system_status.monitoring (task-17-9: "mira"; task-17-8 and task-17-15 add further keys); manager and
-- admin read it through the existing policy of system_status.
alter table public.system_status
  add column monitoring jsonb not null default '{}'::jsonb check (jsonb_typeof(monitoring) = 'object');

-- Replace the entry of one system; checked_at is set by the database
create function public.set_monitoring(system_key text, payload jsonb)
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_status;
begin
  perform private.require_integration();
  if system_key is null or system_key !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'Ungültiger Systemschlüssel' using errcode = 'RW422';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'Ungültige Angaben' using errcode = 'RW422';
  end if;
  update public.system_status s
    set monitoring = s.monitoring || jsonb_build_object(system_key, payload || jsonb_build_object('checked_at', now()))
  where s.id = 1 returning * into result;
  return result;
end;
$$;

-- Calls whose analysis by n8n (rwCallAnalysis26, every 2 minutes) is overdue: not analysed 30 minutes after the call,
-- only the last 7 days, so that a single old row does not warn forever. Demo calls are always analysed.
create function public.monitor_call_analysis()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.require_integration();
  select jsonb_build_object('stale', count(*), 'oldest', min(coalesce(c.ended_at, c.started_at, c.created_at)))
    into result
  from public.phone_calls c
  where c.analyzed_at is null and not c.is_demo
    and coalesce(c.ended_at, c.started_at, c.created_at) < now() - interval '30 minutes'
    and coalesce(c.ended_at, c.started_at, c.created_at) > now() - interval '7 days';
  return result;
end;
$$;

revoke all on function public.set_monitoring(text, jsonb), public.monitor_call_analysis() from public, anon, authenticated;
grant execute on function public.set_monitoring(text, jsonb), public.monitor_call_analysis() to service_role;
