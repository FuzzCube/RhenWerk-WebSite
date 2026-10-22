-- task-18-6: backups on the VPS in the area "System". Every backup is a row: time, reason (daily at 03:00, by hand
-- from the dashboard, before a migration of the deployment), size, contents (row counts, files, n8n workflows), the
-- result of the restore check and an error. Admin and manager read the list (RLS like system_alerts); only admin files
-- "Jetzt sichern", which the service rheinwerk-systemcheck on the VPS picks up (same pattern as "System prüfen",
-- task-17-15). The services write with service_role (scripts/ops/backup-run.mjs, ops/vps/migrate.sh).

create table public.backups (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null default now(),
  reason text not null check (reason in ('daily', 'manual', 'migration')),
  status text not null check (status in ('ok', 'failed')),
  file_name text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  contents jsonb not null default '{}'::jsonb check (jsonb_typeof(contents) = 'object'),
  verified boolean,
  error text check (error is null or length(error) <= 4000),
  requested_by uuid references public.profiles (id) on delete set null,
  check (status = 'ok' or error is not null)
);
create index backups_finished_at_idx on public.backups (finished_at desc);
comment on table public.backups is 'Sicherungen auf dem VPS (task-18-6); verified: Probewiederherstellung bestanden, null = nicht geprüft (Sicherung vor einer Migration)';

alter table public.backups enable row level security;
create policy backups_read on public.backups for select to authenticated using (private.can_read_system());
grant select on public.backups to authenticated;

-- At most one "Jetzt sichern": requested or running; a request the service did not finish within 30 minutes may be
-- filed again (a backup with restore check takes about a minute)
alter table public.system_status
  add column backup_requested_at timestamptz,
  add column backup_requested_by uuid references public.profiles (id) on delete set null,
  add column backup_started_at timestamptz,
  add constraint system_status_backup_started check (backup_started_at is null or backup_requested_at is not null);

create function public.request_backup()
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  result public.system_status;
begin
  update public.system_status s set backup_requested_at = now(), backup_requested_by = actor, backup_started_at = null
  where s.id = 1 and (s.backup_requested_at is null or s.backup_requested_at < now() - interval '30 minutes')
  returning * into result;
  if not found then
    raise exception 'Eine Sicherung ist bereits angefordert' using errcode = 'RW422';
  end if;
  return result;
end;
$$;

-- Service: the requesting admin when a request waits (it is then marked as running), otherwise null
create function public.claim_backup_request()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid;
begin
  perform private.require_integration();
  update public.system_status s set backup_started_at = now()
  where s.id = 1 and s.backup_requested_at is not null and s.backup_started_at is null
  returning s.backup_requested_by into requester;
  if not found then
    return null;
  end if;
  return coalesce(requester, '00000000-0000-0000-0000-000000000000'::uuid);
end;
$$;

create function public.finish_backup_request()
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_status;
begin
  perform private.require_integration();
  update public.system_status s set backup_requested_at = null, backup_requested_by = null, backup_started_at = null
  where s.id = 1 returning * into result;
  return result;
end;
$$;

-- Service: one finished backup; rows older than 90 days are removed (archives are kept 14 days)
create function public.record_backup(
  reason text, status text, started_at timestamptz, file_name text, size_bytes bigint, contents jsonb,
  verified boolean, error text, requested_by uuid default null
)
returns public.backups
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.backups;
begin
  perform private.require_integration();
  insert into public.backups (started_at, reason, status, file_name, size_bytes, contents, verified, error, requested_by)
  values (record_backup.started_at, record_backup.reason, record_backup.status, record_backup.file_name, record_backup.size_bytes,
    coalesce(record_backup.contents, '{}'::jsonb), record_backup.verified, left(record_backup.error, 4000),
    (select p.id from public.profiles p where p.id = record_backup.requested_by))
  returning * into result;
  delete from public.backups b where b.finished_at < now() - interval '90 days';
  return result;
end;
$$;

revoke all on function public.request_backup() from public, anon;
grant execute on function public.request_backup() to authenticated;
revoke all on function public.claim_backup_request(), public.finish_backup_request(),
  public.record_backup(text, text, timestamptz, text, bigint, jsonb, boolean, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_backup_request(), public.finish_backup_request(),
  public.record_backup(text, text, timestamptz, text, bigint, jsonb, boolean, text, uuid) to service_role;
