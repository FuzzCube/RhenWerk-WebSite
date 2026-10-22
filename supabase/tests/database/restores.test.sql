-- task-18-7: restore from a backup in the area "System". Only admin files a request (manager 42501, dispatcher reads
-- nothing), with the confirmation word, only from a complete checked backup of the last 14 days with the current
-- migration state, at most one at a time (RW422) unless the service did not finish it within an hour; only
-- service_role picks it up and finishes it.
-- Run with: supabase test db
begin;
select plan(20);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000018c1', 'admin187@x.test'),
  ('00000000-0000-0000-0000-0000000018c2', 'manager187@x.test'),
  ('00000000-0000-0000-0000-0000000018c3', 'dispo187@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000018c1', 'Admin 187', 'admin'),
  ('00000000-0000-0000-0000-0000000018c2', 'Manager 187', 'manager'),
  ('00000000-0000-0000-0000-0000000018c3', 'Dispo 187', 'dispatcher');
delete from public.restores;

create temp table ids (name text primary key, id uuid);
grant all on ids to public;
with current as (select max(version) as migration from supabase_migrations.schema_migrations),
inserted as (
  insert into public.backups (started_at, finished_at, reason, status, file_name, verified, contents)
  select now(), now() - (v.age || ' days')::interval, v.reason, 'ok', v.file_name, v.verified,
    case when v.same then jsonb_build_object('migration', current.migration) else '{"migration": "20200101000000"}'::jsonb end
  from current, (values
    ('daily', 'rheinwerk-a.tar.gz.enc', true, true, 0),
    ('migration', 'pre.dump', null, true, 0),
    ('manual', 'rheinwerk-b.tar.gz.enc', false, true, 0),
    ('daily', 'rheinwerk-c.tar.gz.enc', true, false, 0),
    ('daily', 'rheinwerk-d.tar.gz.enc', true, true, 15)
  ) as v(reason, file_name, verified, same, age)
  returning id, file_name
)
insert into ids select file_name, id from inserted;

create function pg_temp.as_user(id text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000018' || id, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create function pg_temp.backup(name text) returns uuid language sql as $$ select id from ids where ids.name = backup.name $$;

set local role authenticated;
select pg_temp.as_user('c2');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('rheinwerk-a.tar.gz.enc')), '42501', null, 'manager cannot restore');
select ok(public.current_migration() is not null, 'manager reads the migration state');
select throws_ok($$select public.claim_restore_request()$$, '42501', null, 'staff cannot claim');
select throws_ok($$select public.finish_restore_request(gen_random_uuid(), 'ok', null, null)$$, '42501', null, 'staff cannot finish');
select throws_ok($$insert into public.restores (backup_id, file_name, backup_finished_at) values (gen_random_uuid(), 'x', now())$$, '42501', null, 'no direct writes');
select pg_temp.as_user('c3');
select throws_ok($$select public.current_migration()$$, '42501', null, 'dispatcher cannot read the migration state');

select pg_temp.as_user('c1');
select throws_ok(format($$select public.request_restore(%L, 'ja')$$, pg_temp.backup('rheinwerk-a.tar.gz.enc')), 'RW422', null, 'wrong confirmation word');
select throws_ok($$select public.request_restore(gen_random_uuid(), 'WIEDERHERSTELLEN')$$, 'RW404', null, 'unknown backup');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('pre.dump')), 'RW422', null, 'backup before a migration (Postgres only)');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('rheinwerk-b.tar.gz.enc')), 'RW422', null, 'backup without passed restore check');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('rheinwerk-c.tar.gz.enc')), 'RW422', null, 'backup of another migration state');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('rheinwerk-d.tar.gz.enc')), 'RW422', null, 'backup older than 14 days');
select is((public.request_restore(pg_temp.backup('rheinwerk-a.tar.gz.enc'), ' wiederherstellen ')).requested_by,
  '00000000-0000-0000-0000-0000000018c1'::uuid, 'admin files a request (word case-insensitive)');
select throws_ok(format($$select public.request_restore(%L, 'WIEDERHERSTELLEN')$$, pg_temp.backup('rheinwerk-a.tar.gz.enc')), 'RW422', null, 'second request while one waits');
reset role;

select pg_temp.as_service();
set local role service_role;
select is((public.claim_restore_request()).file_name, 'rheinwerk-a.tar.gz.enc', 'service picks the request up');
select is((public.claim_restore_request()).id, null, 'nothing more to pick up');
select throws_ok($$select public.finish_restore_request((select id from public.restores limit 1), 'failed', null, null)$$, '23514', null, 'failure needs an error');
select is((public.finish_restore_request((select id from public.restores limit 1), 'ok', 'rheinwerk-p.tar.gz.enc', null)).status, 'ok', 'service finishes the restore');
reset role;

set local role authenticated;
select pg_temp.as_user('c3');
select is((select count(*) from public.restores)::int, 0, 'dispatcher reads nothing');
reset role;

-- A request the service never finished may be filed again after an hour
update public.restores set status = 'running', finished_at = null, requested_at = now() - interval '61 minutes';
set local role authenticated;
select pg_temp.as_user('c1');
select is((public.request_restore(pg_temp.backup('rheinwerk-a.tar.gz.enc'), 'WIEDERHERSTELLEN')).status, 'requested', 'stale request given up, new one filed');
reset role;

select * from finish();
rollback;
