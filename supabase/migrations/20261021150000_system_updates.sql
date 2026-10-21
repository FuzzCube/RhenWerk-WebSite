-- task-17-2: data model for updates and warnings (phase 17 "Updates und Überwachung", user decision 21.10.2026).
-- The production copy ~/RheinWerk-Prod (task-17-1) is updated nightly from origin/main by a script on the host; the
-- dashboard only reads and files requests ("update now", "back to release X") that a launchd job picks up. The web
-- app never runs commands. Warnings come from the watchdog and the update script; e-mail recipients are not stored
-- here (ALERT_EMAILS in the environment, the repository is public), the database only decides when to send.
-- Admin and manager read everything, only admin files requests and resolves warnings; the scripts write through
-- service_role functions.

-- Releases built on disk (releases/<commit>/release.json), mirrored by the scripts after every run
create table public.system_releases (
  commit text primary key check (commit ~ '^[0-9a-f]{40}$'),
  subject text not null,
  committed_at timestamptz not null,
  built_at timestamptz not null,
  last_migration text,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index system_releases_one_active on public.system_releases ((true)) where is_active;
create trigger system_releases_set_updated_at
  before update on public.system_releases
  for each row execute function public.set_updated_at();

-- One row: active commit, newest commit on origin/main with the commits not installed yet, and updates of npm
-- packages and n8n that are only shown, never installed (user decision 21.10.2026)
create table public.system_status (
  id smallint primary key default 1 check (id = 1),
  current_commit text check (current_commit ~ '^[0-9a-f]{40}$'),
  available_commit text check (available_commit ~ '^[0-9a-f]{40}$'),
  pending_commits jsonb not null default '[]'::jsonb check (jsonb_typeof(pending_commits) = 'array'),
  dependency_updates jsonb not null default '{}'::jsonb check (jsonb_typeof(dependency_updates) = 'object'),
  checked_at timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.system_status (id) values (1);
create trigger system_status_set_updated_at
  before update on public.system_status
  for each row execute function public.set_updated_at();

-- Requests from the dashboard; at most one waiting or running
create table public.update_requests (
  id uuid primary key default gen_random_uuid(),
  action text not null check (action in ('update', 'rollback')),
  target_commit text check (target_commit ~ '^[0-9a-f]{40}$'),
  requested_by uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  finished_at timestamptz,
  constraint update_requests_target check ((action = 'rollback') = (target_commit is not null)),
  constraint update_requests_picked check ((status = 'pending') = (picked_at is null)),
  constraint update_requests_finished check ((status in ('done', 'failed')) = (finished_at is not null))
);
create unique index update_requests_one_open on public.update_requests ((true)) where status in ('pending', 'running');

-- Log of every run (nightly or requested); at most one running
create table public.system_updates (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('update', 'rollback')),
  -- nightly job, request from the dashboard, or npm run by the operator in the terminal
  trigger text not null check (trigger in ('nightly', 'dashboard', 'cli')),
  request_id uuid references public.update_requests (id) on delete set null,
  requested_by uuid references public.profiles (id) on delete restrict,
  from_commit text check (from_commit ~ '^[0-9a-f]{40}$'),
  to_commit text check (to_commit ~ '^[0-9a-f]{40}$'),
  status text not null default 'running' check (status in ('running', 'succeeded', 'no_change', 'failed', 'rolled_back')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  migrations text[] not null default '{}',
  backup_file text,
  error text,
  log_excerpt text check (length(log_excerpt) <= 20000),
  constraint system_updates_finished check ((status = 'running') = (finished_at is null)),
  constraint system_updates_dashboard check ((trigger = 'dashboard') = (requested_by is not null))
);
create unique index system_updates_one_running on public.system_updates ((true)) where status = 'running';
create index system_updates_started_idx on public.system_updates (started_at desc);

-- Warnings: one open row per alert_key (one incident), repetitions only count up
create table public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('n8n', 'mira', 'update', 'backup', 'app')),
  alert_key text not null check (btrim(alert_key) <> ''),
  severity text not null check (severity in ('warning', 'critical')),
  title text not null check (btrim(title) <> ''),
  detail text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences > 0),
  resolved_at timestamptz,
  resolved_reason text check (resolved_reason in ('auto', 'manual')),
  resolved_by uuid references public.profiles (id) on delete restrict,
  notified_at timestamptz,
  notified_count integer not null default 0 check (notified_count >= 0),
  constraint system_alerts_resolved check ((resolved_at is null) = (resolved_reason is null)),
  constraint system_alerts_resolved_by check (resolved_reason is distinct from 'manual' or resolved_by is not null)
);
create unique index system_alerts_one_open_per_key on public.system_alerts (alert_key) where resolved_at is null;
create index system_alerts_open_idx on public.system_alerts (last_seen_at desc) where resolved_at is null;

create function private.can_read_system()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_employee_role() in ('manager', 'admin'), false);
$$;

alter table public.system_releases enable row level security;
alter table public.system_status enable row level security;
alter table public.update_requests enable row level security;
alter table public.system_updates enable row level security;
alter table public.system_alerts enable row level security;
create policy system_releases_read on public.system_releases for select to authenticated using (private.can_read_system());
create policy system_status_read on public.system_status for select to authenticated using (private.can_read_system());
create policy update_requests_read on public.update_requests for select to authenticated using (private.can_read_system());
create policy system_updates_read on public.system_updates for select to authenticated using (private.can_read_system());
create policy system_alerts_read on public.system_alerts for select to authenticated using (private.can_read_system());
revoke insert, update, delete on public.system_releases, public.system_status, public.update_requests,
  public.system_updates, public.system_alerts from anon, authenticated;

-- A new request only when nothing waits or runs
create function private.require_no_open_update()
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if exists (select 1 from public.update_requests where status in ('pending', 'running'))
    or exists (select 1 from public.system_updates where status = 'running') then
    raise exception 'Ein Update ist bereits angefordert oder läuft' using errcode = 'RW422';
  end if;
end;
$$;

-- "Jetzt aktualisieren": newest origin/main
create function public.request_update()
returns public.update_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  result public.update_requests;
begin
  perform private.require_no_open_update();
  insert into public.update_requests (action, requested_by) values ('update', actor) returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Ein Update ist bereits angefordert oder läuft' using errcode = 'RW422';
end;
$$;

-- "Wiederherstellen": switch back to a release that is still on disk (code only, migrations stay)
create function public.request_rollback(target_commit text)
returns public.update_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  rel public.system_releases;
  result public.update_requests;
begin
  select * into rel from public.system_releases r where r.commit = request_rollback.target_commit;
  if not found then
    raise exception 'Dieses Release ist nicht mehr vorhanden' using errcode = 'RW422';
  end if;
  if rel.is_active then
    raise exception 'Dieses Release ist bereits aktiv' using errcode = 'RW422';
  end if;
  perform private.require_no_open_update();
  insert into public.update_requests (action, target_commit, requested_by) values ('rollback', rel.commit, actor) returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Ein Update ist bereits angefordert oder läuft' using errcode = 'RW422';
end;
$$;

-- "Erledigt": admin closes a warning by hand; if the cause persists, the next check opens a new one
create function public.resolve_alert(alert_id uuid)
returns public.system_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := private.require_role('admin');
  a public.system_alerts;
  result public.system_alerts;
begin
  select * into a from public.system_alerts x where x.id = resolve_alert.alert_id for update;
  if not found then
    raise exception 'Warnung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if a.resolved_at is not null then
    raise exception 'Die Warnung ist bereits erledigt' using errcode = 'RW422';
  end if;
  update public.system_alerts x set resolved_at = now(), resolved_reason = 'manual', resolved_by = actor
  where x.id = a.id returning * into result;
  return result;
end;
$$;

-- Scripts: the oldest waiting request becomes running (null if none)
create function public.claim_update_request()
returns public.update_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.update_requests;
begin
  perform private.require_integration();
  update public.update_requests x set status = 'running', picked_at = now()
  where x.id = (select id from public.update_requests where status = 'pending' order by created_at limit 1 for update skip locked)
  returning * into result;
  return result;
end;
$$;

create function public.finish_update_request(request_id uuid, succeeded boolean)
returns public.update_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.update_requests;
begin
  perform private.require_integration();
  update public.update_requests x set status = case when succeeded then 'done' else 'failed' end, finished_at = now()
  where x.id = finish_update_request.request_id and x.status = 'running' returning * into result;
  if not found then
    raise exception 'Anfrage läuft nicht' using errcode = 'RW422';
  end if;
  return result;
end;
$$;

-- Scripts: a run starts (RW422 while another one runs); the requester is taken from the request
create function public.start_system_update(kind text, trigger text, from_commit text, to_commit text, request_id uuid default null)
returns public.system_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_updates;
begin
  perform private.require_integration();
  insert into public.system_updates (kind, trigger, request_id, requested_by, from_commit, to_commit)
  values (start_system_update.kind, start_system_update.trigger, start_system_update.request_id,
    (select r.requested_by from public.update_requests r where r.id = start_system_update.request_id),
    start_system_update.from_commit, start_system_update.to_commit)
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'Ein anderer Lauf ist aktiv' using errcode = 'RW422';
end;
$$;

-- Scripts: a run ends; the log keeps its last 20 000 characters (the end holds the error)
create function public.finish_system_update(update_id uuid, status text, to_commit text default null, migrations text[] default '{}',
  backup_file text default null, error text default null, log_excerpt text default null)
returns public.system_updates
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_updates;
begin
  perform private.require_integration();
  if finish_system_update.status not in ('succeeded', 'no_change', 'failed', 'rolled_back') then
    raise exception 'Unbekannter Endstatus %', finish_system_update.status using errcode = 'RW422';
  end if;
  update public.system_updates x set
    status = finish_system_update.status,
    finished_at = now(),
    to_commit = coalesce(finish_system_update.to_commit, x.to_commit),
    migrations = coalesce(finish_system_update.migrations, '{}'),
    backup_file = finish_system_update.backup_file,
    error = finish_system_update.error,
    log_excerpt = right(finish_system_update.log_excerpt, 20000)
  where x.id = finish_system_update.update_id and x.status = 'running'
  returning * into result;
  if not found then
    raise exception 'Lauf ist nicht aktiv' using errcode = 'RW422';
  end if;
  return result;
end;
$$;

-- Scripts: mirror of releases/ ([{commit, subject, committed_at, built_at, last_migration}]) and the active commit;
-- releases no longer on disk are removed
create function public.sync_system_releases(releases jsonb, active_commit text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform private.require_integration();
  if jsonb_typeof(releases) <> 'array' then
    raise exception 'releases muss ein Array sein' using errcode = 'RW422';
  end if;
  delete from public.system_releases r
  where not exists (select 1 from jsonb_array_elements(releases) e where e ->> 'commit' = r.commit);
  update public.system_releases set is_active = false where is_active;
  insert into public.system_releases (commit, subject, committed_at, built_at, last_migration, is_active)
  select e ->> 'commit', e ->> 'subject', (e ->> 'committed_at')::timestamptz, (e ->> 'built_at')::timestamptz,
    e ->> 'last_migration', e ->> 'commit' = active_commit
  from jsonb_array_elements(releases) e
  on conflict (commit) do update set subject = excluded.subject, committed_at = excluded.committed_at,
    built_at = excluded.built_at, last_migration = excluded.last_migration, is_active = excluded.is_active;
  update public.system_status set current_commit = active_commit where id = 1;
  select count(*) into n from public.system_releases;
  return n;
end;
$$;

-- Scripts: result of the check against origin/main and of npm outdated / n8n
-- payload {available_commit, pending_commits: [{commit, subject, committed_at}], dependency_updates: {...}}
create function public.set_system_status(payload jsonb)
returns public.system_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_status;
begin
  perform private.require_integration();
  update public.system_status s set
    available_commit = payload ->> 'available_commit',
    pending_commits = coalesce(payload -> 'pending_commits', '[]'::jsonb),
    dependency_updates = coalesce(payload -> 'dependency_updates', s.dependency_updates),
    checked_at = now()
  where s.id = 1 returning * into result;
  return result;
end;
$$;

-- Watchdog and update script: report a problem. Returns {alert_id, notify, reason}: notify is true for a new
-- incident (reason "new") and again 6 hours after the last e-mail (reason "reminder"). The script calls
-- mark_alert_notified only after the e-mail went out, so a failed send is retried on the next check.
create function public.raise_alert(source text, alert_key text, severity text, title text, detail text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.system_alerts;
begin
  perform private.require_integration();
  select * into a from public.system_alerts x where x.alert_key = raise_alert.alert_key and x.resolved_at is null for update;
  if found then
    update public.system_alerts x set last_seen_at = now(), occurrences = x.occurrences + 1, title = raise_alert.title,
      detail = raise_alert.detail, severity = case when 'critical' in (x.severity, raise_alert.severity) then 'critical' else 'warning' end
    where x.id = a.id returning * into a;
  else
    insert into public.system_alerts (source, alert_key, severity, title, detail)
    values (raise_alert.source, raise_alert.alert_key, raise_alert.severity, raise_alert.title, raise_alert.detail)
    returning * into a;
  end if;
  return jsonb_build_object('alert_id', a.id,
    'notify', a.notified_at is null or a.notified_at <= now() - interval '6 hours',
    'reason', case when a.notified_at is null then 'new' when a.notified_at <= now() - interval '6 hours' then 'reminder' end);
end;
$$;

-- Watchdog: the problem is gone. Returns null without an open warning, otherwise {alert_id, notify}: an e-mail
-- "wieder in Ordnung" only if a warning e-mail was sent for this incident
create function public.clear_alert(alert_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.system_alerts;
begin
  perform private.require_integration();
  update public.system_alerts x set resolved_at = now(), resolved_reason = 'auto'
  where x.alert_key = clear_alert.alert_key and x.resolved_at is null returning * into a;
  if not found then
    return null;
  end if;
  return jsonb_build_object('alert_id', a.id, 'notify', a.notified_at is not null);
end;
$$;

create function public.mark_alert_notified(alert_id uuid)
returns public.system_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.system_alerts;
begin
  perform private.require_integration();
  update public.system_alerts x set notified_at = now(), notified_count = x.notified_count + 1
  where x.id = mark_alert_notified.alert_id returning * into result;
  return result;
end;
$$;

-- Nightly: runs without change after 30 days, resolved warnings after 90 days, other finished runs and requests
-- after 12 months
create function public.purge_system_history()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  m integer;
  k integer;
begin
  delete from public.system_updates
  where (status = 'no_change' and started_at < now() - interval '30 days')
     or (status <> 'running' and started_at < now() - interval '12 months');
  get diagnostics n = row_count;
  delete from public.update_requests where status in ('done', 'failed') and created_at < now() - interval '12 months';
  get diagnostics m = row_count;
  delete from public.system_alerts where resolved_at < now() - interval '90 days';
  get diagnostics k = row_count;
  return n + m + k;
end;
$$;
select cron.schedule('system-history-cleanup', '50 2 * * *', 'select public.purge_system_history()');

revoke all on function private.can_read_system(), private.require_no_open_update() from public, anon;
grant execute on function private.can_read_system() to authenticated;
revoke all on function public.request_update(), public.request_rollback(text), public.resolve_alert(uuid) from public, anon;
grant execute on function public.request_update(), public.request_rollback(text), public.resolve_alert(uuid) to authenticated;
revoke all on function public.claim_update_request(), public.finish_update_request(uuid, boolean),
  public.start_system_update(text, text, text, text, uuid),
  public.finish_system_update(uuid, text, text, text[], text, text, text),
  public.sync_system_releases(jsonb, text), public.set_system_status(jsonb),
  public.raise_alert(text, text, text, text, text), public.clear_alert(text), public.mark_alert_notified(uuid),
  public.purge_system_history() from public, anon, authenticated;
grant execute on function public.claim_update_request(), public.finish_update_request(uuid, boolean),
  public.start_system_update(text, text, text, text, uuid),
  public.finish_system_update(uuid, text, text, text[], text, text, text),
  public.sync_system_releases(jsonb, text), public.set_system_status(jsonb),
  public.raise_alert(text, text, text, text, text), public.clear_alert(text), public.mark_alert_notified(uuid),
  public.purge_system_history() to service_role;
notify pgrst, 'reload schema';
