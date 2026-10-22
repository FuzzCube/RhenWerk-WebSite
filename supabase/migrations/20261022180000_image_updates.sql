-- task-18-8: system updates of Supabase, n8n and the tunnel on the VPS (image versions in ops/vps/docker-compose.yml,
-- new ones come as Dependabot PRs). After the merge the area "System" shows the images whose version in the repository
-- differs from the running one; admin files "Update einspielen", the service rheinwerk-systemcheck runs it
-- (scripts/ops/update-run.mjs): backup (reason pre_update), snapshot of the volumes, new images, read-only self test,
-- on a failure back to images and data from before, e-mail. Each run is a row of image_updates (history in "System").
-- The table system_updates of task-17-2 belongs to the code updates of the development folder (no longer used).

alter table public.backups drop constraint backups_reason_check;
alter table public.backups add constraint backups_reason_check check (reason in ('daily', 'manual', 'migration', 'pre_restore', 'pre_update'));

create table public.image_updates (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null default 'requested' check (status in ('requested', 'running', 'ok', 'no_change', 'failed', 'rolled_back')),
  -- [{service, from, to}]
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),
  pre_backup_file text,
  error text check (error is null or length(error) <= 4000),
  check (status in ('requested', 'running', 'ok', 'no_change') or error is not null)
);
create index image_updates_requested_at_idx on public.image_updates (requested_at desc);
create unique index image_updates_one_active on public.image_updates ((true)) where status in ('requested', 'running');
comment on table public.image_updates is 'Systemupdates der Images auf dem VPS (task-18-8); rolled_back: Selbsttest gescheitert, Images und Daten von vorher';

alter table public.image_updates enable row level security;
create policy image_updates_read on public.image_updates for select to authenticated using (private.can_read_system());
revoke all on public.image_updates from anon, authenticated;
grant select on public.image_updates to authenticated;

create function public.request_image_update()
returns public.image_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  result public.image_updates;
begin
  -- A request the service did not finish within an hour is given up (an update takes a few minutes)
  update public.image_updates u set status = 'failed', finished_at = now(), error = 'Vom Dienst nicht abgeschlossen (Zeitüberschreitung)'
  where u.status in ('requested', 'running') and u.requested_at < now() - interval '1 hour';
  if exists (select 1 from public.image_updates u where u.status in ('requested', 'running'))
    or exists (select 1 from public.restores r where r.status in ('requested', 'running') and r.requested_at > now() - interval '1 hour') then
    raise exception 'Ein Update oder eine Wiederherstellung ist bereits angefordert' using errcode = 'RW422';
  end if;
  insert into public.image_updates (requested_by) values (actor) returning * into result;
  return result;
end;
$$;

-- Service: the waiting request, now marked as running; null without one
create function public.claim_image_update()
returns public.image_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.image_updates;
begin
  perform private.require_integration();
  update public.image_updates u set status = 'running', started_at = now()
  where u.status = 'requested'
  returning * into result;
  return result;
end;
$$;

create function public.finish_image_update(update_id uuid, status text, changes jsonb, pre_backup_file text, error text)
returns public.image_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.image_updates;
begin
  perform private.require_integration();
  if finish_image_update.status not in ('ok', 'no_change', 'failed', 'rolled_back') then
    raise exception 'Ungültiger Status' using errcode = 'RW422';
  end if;
  update public.image_updates u set status = finish_image_update.status, finished_at = now(),
    changes = coalesce(finish_image_update.changes, '[]'::jsonb), pre_backup_file = finish_image_update.pre_backup_file,
    error = left(finish_image_update.error, 4000)
  where u.id = finish_image_update.update_id
  returning * into result;
  delete from public.image_updates u where u.finished_at < now() - interval '1 year';
  return result;
end;
$$;

-- A restore must not start while an update waits or runs (and the other way round, request_image_update)
create or replace function public.request_restore(backup_id uuid, confirmation text)
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
  if source.status <> 'ok' or source.verified is not true or source.reason not in ('daily', 'manual', 'pre_restore', 'pre_update') or source.file_name is null then
    raise exception 'Nur eine vollständige, geprüfte Sicherung kann wiederhergestellt werden' using errcode = 'RW422';
  end if;
  if source.finished_at < now() - interval '14 days' then
    raise exception 'Die Sicherung ist älter als 14 Tage und liegt nicht mehr auf dem Server' using errcode = 'RW422';
  end if;
  if source.contents ->> 'migration' is distinct from (select max(m.version) from supabase_migrations.schema_migrations m) then
    raise exception 'Die Sicherung stammt von einem anderen Stand der Datenbank (Migration); Wiederherstellung nur von Hand (docs/betrieb.md 4.5)' using errcode = 'RW422';
  end if;
  update public.restores r set status = 'failed', finished_at = now(), error = 'Vom Dienst nicht abgeschlossen (Zeitüberschreitung)'
  where r.status in ('requested', 'running') and r.requested_at < now() - interval '1 hour';
  if exists (select 1 from public.restores r where r.status in ('requested', 'running'))
    or exists (select 1 from public.image_updates u where u.status in ('requested', 'running') and u.requested_at > now() - interval '1 hour') then
    raise exception 'Eine Wiederherstellung oder ein Update ist bereits angefordert' using errcode = 'RW422';
  end if;
  insert into public.restores (backup_id, file_name, backup_finished_at, requested_by)
  values (source.id, source.file_name, source.finished_at, actor)
  returning * into result;
  return result;
end;
$$;

revoke all on function public.request_image_update() from public, anon;
grant execute on function public.request_image_update() to authenticated;
revoke all on function public.claim_image_update(), public.finish_image_update(uuid, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.claim_image_update(), public.finish_image_update(uuid, text, jsonb, text, text) to service_role;
