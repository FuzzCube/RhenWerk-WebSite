-- task-17-15: state of the systems on the host and their versions. The watchdog (scripts/ops/systems.mjs) writes
-- website, database, tunnel, SMTP, Docker and disk space to system_status.monitoring, the nightly run and every
-- requested check the installed and available versions to system_status.dependency_updates (only shown, never
-- installed; user decision 21.10.2026). "System prüfen" (admin) files a request that the service
-- online.rheinwerk.systemcheck picks up within 20 seconds; the web app never runs commands.

-- At most one request: requested (check_started_at null) or running; a request the service did not finish within
-- 10 minutes may be filed again
alter table public.system_status
  add column check_requested_at timestamptz,
  add column check_requested_by uuid references public.profiles (id) on delete set null,
  add column check_started_at timestamptz,
  add constraint system_status_check_started check (check_started_at is null or check_requested_at is not null);

-- Warnings of the system checks
alter table public.system_alerts drop constraint system_alerts_source_check;
alter table public.system_alerts add constraint system_alerts_source_check
  check (source in ('n8n', 'mira', 'update', 'backup', 'app', 'system'));

create function public.request_system_check()
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  result public.system_status;
begin
  update public.system_status s set check_requested_at = now(), check_requested_by = actor, check_started_at = null
  where s.id = 1 and (s.check_requested_at is null or s.check_requested_at < now() - interval '10 minutes')
  returning * into result;
  if not found then
    raise exception 'Eine Prüfung ist bereits angefordert' using errcode = 'RW422';
  end if;
  return result;
end;
$$;

-- Service: true when a request waits; it is then marked as running
create function public.claim_system_check()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  update public.system_status s set check_started_at = now()
  where s.id = 1 and s.check_requested_at is not null and s.check_started_at is null;
  return found;
end;
$$;

create function public.finish_system_check()
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_status;
begin
  perform private.require_integration();
  update public.system_status s set check_requested_at = null, check_requested_by = null, check_started_at = null
  where s.id = 1 returning * into result;
  return result;
end;
$$;

revoke all on function public.request_system_check() from public, anon;
grant execute on function public.request_system_check() to authenticated;
revoke all on function public.claim_system_check(), public.finish_system_check() from public, anon, authenticated;
grant execute on function public.claim_system_check(), public.finish_system_check() to service_role;
