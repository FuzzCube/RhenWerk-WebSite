-- task-18-7: restore the whole database, the Storage files and n8n from a checked backup in the area "System" (user
-- decision 21.10.2026: only admin, only everything at once, no single records). Admin files a request with the
-- confirmation word, the service rheinwerk-systemcheck on the VPS picks it up (scripts/ops/restore-run.mjs): backup of
-- the current state first (reason pre_restore), n8n stopped, restore, health check, back to the state before on a
-- failure, e-mail to the admin. Only backups with the same migration state as the database can be restored this way
-- (contents.migration, written by scripts/backup.mjs since this task); older ones by hand (docs/betrieb.md 4.5).
-- The service keeps the rows of backups, restores, system_alerts and system_status across a restore, so the list, the
-- request and the warnings do not go back in time.

alter table public.backups drop constraint backups_reason_check;
alter table public.backups add constraint backups_reason_check check (reason in ('daily', 'manual', 'migration', 'pre_restore'));

create table public.restores (
  id uuid primary key default gen_random_uuid(),
  backup_id uuid not null,
  file_name text not null,
  backup_finished_at timestamptz not null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'running', 'ok', 'failed', 'rolled_back')),
  pre_backup_file text,
  error text check (error is null or length(error) <= 4000),
  check (status in ('requested', 'running', 'ok') or error is not null)
);
create index restores_requested_at_idx on public.restores (requested_at desc);
-- At most one restore requested or running
create unique index restores_one_active on public.restores ((true)) where status in ('requested', 'running');
comment on table public.restores is 'Wiederherstellungen aus einer Sicherung (task-18-7); rolled_back: fehlgeschlagen, Stand davor wiederhergestellt';

alter table public.restores enable row level security;
create policy restores_read on public.restores for select to authenticated using (private.can_read_system());
revoke all on public.restores from anon, authenticated;
grant select on public.restores to authenticated;

-- Newest applied migration; a backup can be restored from the dashboard only with the same one
create function public.current_migration()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.can_read_system() and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Keine Berechtigung' using errcode = '42501';
  end if;
  return (select max(m.version) from supabase_migrations.schema_migrations m);
end;
$$;

create function public.request_restore(backup_id uuid, confirmation text)
returns public.restores
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  source public.backups;
  result public.restores;
begin
  if upper(btrim(coalesce(confirmation, ''))) <> 'WIEDERHERSTELLEN' then
    raise exception 'Zur Bestätigung WIEDERHERSTELLEN eingeben' using errcode = 'RW422';
  end if;
  select * into source from public.backups b where b.id = request_restore.backup_id;
  if not found then
    raise exception 'Sicherung nicht gefunden' using errcode = 'RW404';
  end if;
  if source.status <> 'ok' or source.verified is not true or source.reason not in ('daily', 'manual', 'pre_restore') or source.file_name is null then
    raise exception 'Nur eine vollständige, geprüfte Sicherung kann wiederhergestellt werden' using errcode = 'RW422';
  end if;
  if source.finished_at < now() - interval '14 days' then
    raise exception 'Die Sicherung ist älter als 14 Tage und liegt nicht mehr auf dem Server' using errcode = 'RW422';
  end if;
  if source.contents ->> 'migration' is distinct from (select max(m.version) from supabase_migrations.schema_migrations m) then
    raise exception 'Die Sicherung stammt von einem anderen Stand der Datenbank (Migration); Wiederherstellung nur von Hand (docs/betrieb.md 4.5)' using errcode = 'RW422';
  end if;
  -- A request the service did not finish within an hour is given up (a restore takes a few minutes)
  update public.restores r set status = 'failed', finished_at = now(), error = 'Vom Dienst nicht abgeschlossen (Zeitüberschreitung)'
  where r.status in ('requested', 'running') and r.requested_at < now() - interval '1 hour';
  if exists (select 1 from public.restores r where r.status in ('requested', 'running')) then
    raise exception 'Eine Wiederherstellung ist bereits angefordert' using errcode = 'RW422';
  end if;
  insert into public.restores (backup_id, file_name, backup_finished_at, requested_by)
  values (source.id, source.file_name, source.finished_at, actor)
  returning * into result;
  return result;
end;
$$;

-- Service: the waiting request, now marked as running; null without one
create function public.claim_restore_request()
returns public.restores
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.restores;
begin
  perform private.require_integration();
  update public.restores r set status = 'running', started_at = now()
  where r.status = 'requested'
  returning * into result;
  return result;
end;
$$;

create function public.finish_restore_request(restore_id uuid, status text, pre_backup_file text, error text)
returns public.restores
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.restores;
begin
  perform private.require_integration();
  if finish_restore_request.status not in ('ok', 'failed', 'rolled_back') then
    raise exception 'Ungültiger Status' using errcode = 'RW422';
  end if;
  update public.restores r set status = finish_restore_request.status, finished_at = now(),
    pre_backup_file = finish_restore_request.pre_backup_file, error = left(finish_restore_request.error, 4000)
  where r.id = finish_restore_request.restore_id
  returning * into result;
  delete from public.restores r where r.finished_at < now() - interval '90 days';
  return result;
end;
$$;

revoke all on function public.current_migration(), public.request_restore(uuid, text) from public, anon;
grant execute on function public.current_migration(), public.request_restore(uuid, text) to authenticated, service_role;
revoke all on function public.claim_restore_request(), public.finish_restore_request(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_restore_request(), public.finish_restore_request(uuid, text, text, text) to service_role;
