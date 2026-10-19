-- task-13-8: minute budget of the web widget (widget_budget, widget_session_start, widget_session_bind).
-- 3 minutes per conversation, 10 minutes per day, 3 sessions per client and hour. Run with: supabase test db
begin;
select plan(14);

-- Only today's sessions of this test count: earlier sessions of the day are moved to yesterday
update public.widget_sessions set created_at = created_at - interval '1 day' where created_at::date >= current_date - 1;

set local role anon;
select throws_ok($$select public.widget_session_start(repeat('a', 64))$$, '42501', null, 'anon cannot start sessions');
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.widget_budget() ->> 'verfuegbar', 'true', 'budget available');
select throws_ok($$select public.widget_session_start('kein-hash')$$, 'RW422', null, 'invalid client key');

create temporary table s (n int, r jsonb) on commit drop;
insert into s values (1, public.widget_session_start(repeat('a', 64)));
insert into s values (2, public.widget_session_start(repeat('a', 64)));
insert into s values (3, public.widget_session_start(repeat('a', 64)));
select is((select (r ->> 'ok')::boolean from s where n = 1), true, 'first session');
select is((select (r ->> 'rest_sekunden')::int from s where n = 3), 60, 'three reservations: 60 seconds left');
-- Fourth conversation does not fit into 10 minutes
select is(public.widget_session_start(repeat('b', 64)) ->> 'grund', 'tageslimit', 'day limit');
select is(public.widget_budget() ->> 'verfuegbar', 'false', 'no budget left');

-- Bound and evaluated conversation: the real duration replaces the reservation
select is(public.widget_session_bind((select (r ->> 'sitzung_id')::uuid from s where n = 1), 'ws-conv-1'), true, 'bind conversation');
select is(public.widget_session_bind((select (r ->> 'sitzung_id')::uuid from s where n = 1), 'ws-conv-x'), false, 'session bound only once');
select is(public.widget_session_bind((select (r ->> 'sitzung_id')::uuid from s where n = 2), 'ws-conv-1'), false, 'conversation bound only once');
reset role;
insert into public.phone_calls (conversation_id, duration_seconds, analyzed_at) values ('ws-conv-1', 40, now());
-- An overlong conversation counts at most with its reservation
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((public.widget_budget() ->> 'rest_sekunden')::int, 200, 'real duration counts: 600 - 40 - 180 - 180');
select is(public.widget_session_start(repeat('a', 64)) ->> 'grund', 'zu_viele', 'fourth session of the same client within an hour');
select is((public.widget_session_start(repeat('c', 64)) ->> 'ok')::boolean, true, 'another client gets the freed minutes');
reset role;
update public.phone_calls set duration_seconds = 900 where conversation_id = 'ws-conv-1';
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is((public.widget_budget() ->> 'rest_sekunden')::int, 0, 'overlong conversation counts with 180 seconds');
reset role;

select * from finish();
rollback;
