-- task-17-2: updates, releases, status and warnings. Admin and manager read, only admin files requests and resolves
-- warnings, scripts write as service_role; one request/run at a time, one open warning per key with e-mail decision.
-- Run with: supabase test db
begin;
select plan(45);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000017a1', 'admin17@x.test'),
  ('00000000-0000-0000-0000-0000000017a2', 'manager17@x.test'),
  ('00000000-0000-0000-0000-0000000017a3', 'dispo17@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000017a1', 'Admin 17', 'admin'),
  ('00000000-0000-0000-0000-0000000017a2', 'Manager 17', 'manager'),
  ('00000000-0000-0000-0000-0000000017a3', 'Dispo 17', 'dispatcher');

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000017' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.c(n int) returns text language sql as $$ select repeat(n::text, 40) $$;

-- Releases and status from the scripts
select pg_temp.as_service();
set local role service_role;
select is(public.sync_system_releases(jsonb_build_array(
  jsonb_build_object('commit', pg_temp.c(1), 'subject', 'Alt', 'committed_at', '2026-10-20T10:00:00Z', 'built_at', '2026-10-20T11:00:00Z', 'last_migration', 'a.sql'),
  jsonb_build_object('commit', pg_temp.c(2), 'subject', 'Neu', 'committed_at', '2026-10-21T10:00:00Z', 'built_at', '2026-10-21T11:00:00Z', 'last_migration', 'b.sql')),
  pg_temp.c(2)), 2, 'two releases mirrored');
select is((select commit from public.system_releases where is_active), pg_temp.c(2), 'active release marked');
select is((select current_commit from public.system_status), pg_temp.c(2), 'status carries the active commit');
select is((public.set_system_status(jsonb_build_object('available_commit', pg_temp.c(3),
  'pending_commits', jsonb_build_array(jsonb_build_object('commit', pg_temp.c(3), 'subject', 'Neuer'))))).available_commit, pg_temp.c(3), 'status stores the available commit');
reset role;

-- Reading: admin and manager, nobody else
set local role authenticated;
select pg_temp.as_user('a3');
select is((select count(*)::int from public.system_status), 0, 'dispatcher sees no status');
select is((select count(*)::int from public.system_releases), 0, 'dispatcher sees no releases');
select throws_ok($$select public.request_update()$$, '42501', null, 'dispatcher cannot request an update');
select pg_temp.as_user('a2');
select is((select count(*)::int from public.system_status), 1, 'manager reads the status');
select is((select count(*)::int from public.system_releases), 2, 'manager reads the releases');
select throws_ok($$select public.request_update()$$, '42501', null, 'manager cannot request an update');
select throws_ok($$select public.request_rollback(repeat('1', 40))$$, '42501', null, 'manager cannot request a rollback');
select throws_ok($$insert into public.update_requests (action, requested_by) values ('update', '00000000-0000-0000-0000-0000000017a2')$$,
  '42501', null, 'no direct insert');
select throws_ok($$select public.raise_alert('app', 'x', 'warning', 'x')$$, '42501', null, 'staff cannot raise warnings');

-- Requests: not from the dashboard any more (task-17-12); the functions stay for the owner, one at a time
select pg_temp.as_user('a1');
select throws_ok($$select public.request_update()$$, '42501', null, 'admin cannot request an update (task-17-12)');
select throws_ok($$select public.request_rollback(repeat('1', 40))$$, '42501', null, 'admin cannot request a rollback (task-17-12)');
reset role;
select is((public.request_update()).status, 'pending', 'update requested as owner');
select throws_ok($$select public.request_update()$$, 'RW422', null, 'second request while one waits');
select throws_ok($$select public.request_rollback(repeat('1', 40))$$, 'RW422', null, 'no rollback while an update waits');
reset role;

-- Scripts pick up and run it
select pg_temp.as_service();
set local role service_role;
select is((select status from public.claim_update_request()), 'running', 'request claimed');
select ok((select r.id is null from public.claim_update_request() r), 'nothing else to claim');
create temp table run as
  select * from public.start_system_update('update', 'dashboard', pg_temp.c(2), pg_temp.c(3),
    (select id from public.update_requests where status = 'running'));
grant select on run to service_role;
select is((select requested_by from run), '00000000-0000-0000-0000-0000000017a1'::uuid, 'requester taken from the request');
select throws_ok($$select public.start_system_update('update', 'nightly', null, null)$$, 'RW422', null, 'only one run at a time');
select throws_ok($$select public.start_system_update('update', 'dashboard', null, null)$$, '23514', null, 'dashboard run needs a requester');
select is((select length(log_excerpt) from public.finish_system_update((select id from run), 'succeeded', null, array['b.sql'], 'x.enc', null,
  repeat('a', 25000) || 'ENDE')), 20000, 'log keeps 20 000 characters');
select is((select right(log_excerpt, 4) from public.system_updates where id = (select id from run)), 'ENDE', 'the end of the log stays');
select throws_ok($$select public.finish_system_update((select id from run), 'failed')$$, 'RW422', null, 'finished run cannot end twice');
select is((public.finish_update_request((select id from public.update_requests where status = 'running'), true)).status, 'done', 'request done');
reset role;

-- Rollback to an existing, inactive release
select pg_temp.as_user('a1');
select throws_ok($$select public.request_rollback(repeat('2', 40))$$, 'RW422', null, 'active release is not a rollback target');
select throws_ok($$select public.request_rollback(repeat('9', 40))$$, 'RW422', null, 'unknown release');
select is((public.request_rollback(pg_temp.c(1))).target_commit, pg_temp.c(1), 'rollback requested');
reset role;

-- Warnings: one per key, e-mail for new incidents, reminder after 6 hours, recovery only after a warning e-mail
select pg_temp.as_service();
set local role service_role;
select is(public.raise_alert('n8n', 'n8n:down', 'warning', 'n8n nicht erreichbar') ->> 'reason', 'new', 'new incident is mailed');
select public.mark_alert_notified((select id from public.system_alerts where alert_key = 'n8n:down'));
select ok(not (public.raise_alert('n8n', 'n8n:down', 'critical', 'n8n nicht erreichbar', 'seit 10 min') ->> 'notify')::boolean, 'repetition is not mailed');
select ok((select occurrences = 2 and severity = 'critical' from public.system_alerts where alert_key = 'n8n:down'), 'repetition counts and keeps the higher severity');
update public.system_alerts set notified_at = now() - interval '7 hours' where alert_key = 'n8n:down';
select is(public.raise_alert('n8n', 'n8n:down', 'warning', 'n8n nicht erreichbar') ->> 'reason', 'reminder', 'reminder after 6 hours');
select ok((public.clear_alert('n8n:down') ->> 'notify')::boolean, 'recovery is mailed after a warning e-mail');
select ok(public.clear_alert('n8n:down') is null, 'nothing open any more');
select public.raise_alert('mira', 'mira:credit', 'warning', 'Guthaben niedrig');
reset role;

set local role authenticated;
select pg_temp.as_user('a2');
select throws_ok($$select public.resolve_alert((select id from public.system_alerts where alert_key = 'mira:credit'))$$, '42501', null, 'manager cannot resolve');
select pg_temp.as_user('a1');
select is((select resolved_reason from public.resolve_alert((select id from public.system_alerts where alert_key = 'mira:credit'))), 'manual', 'admin resolves');
select throws_ok($$select public.resolve_alert((select id from public.system_alerts where alert_key = 'mira:credit'))$$, 'RW422', null, 'already resolved');
reset role;

-- Leftovers of a crashed run (task-17-6): request and run in running are closed as failed
select pg_temp.as_service();
set local role service_role;
create temp table stale as select * from public.start_system_update('update', 'nightly', null, null);
grant select on stale to service_role;
select ok((select status = 'running' from public.claim_update_request()), 'rollback request claimed and left running');
select is(public.abandon_stale_runs(), 2, 'stale run and request closed');
select ok((select status = 'failed' and finished_at is not null and error like 'Lauf abgebrochen%' from public.system_updates where id = (select id from stale)), 'run failed with reason');
reset role;
set local role authenticated;
select pg_temp.as_user('a1');
select throws_ok($$select public.abandon_stale_runs()$$, '42501', null, 'staff cannot close runs');
reset role;

-- Cleanup
insert into public.system_updates (kind, trigger, status, started_at, finished_at) values
  ('update', 'nightly', 'no_change', now() - interval '31 days', now() - interval '31 days'),
  ('update', 'nightly', 'no_change', now() - interval '29 days', now() - interval '29 days');
update public.system_alerts set resolved_at = now() - interval '91 days' where alert_key = 'n8n:down';
select is(public.purge_system_history(), 2, 'old no_change run and old resolved warning removed');
select is((select command from cron.job where jobname = 'system-history-cleanup'), 'select public.purge_system_history()', 'nightly cleanup registered');

select * from finish();
rollback;
