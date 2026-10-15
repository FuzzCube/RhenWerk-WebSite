-- task-11-6: growing pause after wrong passwords (login_failed, login_pause_remaining, login_reset).
-- Run with: supabase test db
begin;
select plan(13);

create function pg_temp.h(n integer) returns text language sql as $$ select repeat(n::text, 64)::text; $$;

-- Users have no access; the app server calls with the service role
set local role anon;
select throws_ok($$select public.login_failed(repeat('a', 64))$$, '42501', null, 'anon cannot record failures');
set local role authenticated;
select throws_ok($$select public.login_reset(repeat('a', 64))$$, '42501', null, 'authenticated cannot reset');
select throws_ok($$select count(*) from private.login_attempts$$, '42501', null, 'authenticated cannot read attempts');
reset role;
set local role service_role;

select is((select array_agg(public.login_failed(pg_temp.h(1))) from generate_series(1, 4)), array[0, 0, 0, 0], 'first four failures: no pause');
select is(public.login_pause_remaining(pg_temp.h(1)), 0, 'sign-in still allowed after four failures');
select is(public.login_failed(pg_temp.h(1)), 30, 'fifth failure: 30 s pause');
select ok(public.login_pause_remaining(pg_temp.h(1)) between 29 and 30, 'pause is running');
select is((select array_agg(public.login_failed(pg_temp.h(1))) from generate_series(1, 5)), array[60, 120, 300, 900, 900], 'pause grows to at most 15 min');
select is(public.login_pause_remaining(pg_temp.h(2)), 0, 'other address is not affected');

select lives_ok($$select public.login_reset(pg_temp.h(1))$$, 'reset after success');
select is(public.login_pause_remaining(pg_temp.h(1)), 0, 'no pause after reset');
select is(public.login_failed(pg_temp.h(1)), 0, 'counting starts again at one');

-- 15 minutes without a failure start a new count
reset role;
update private.login_attempts set failures = 8, last_failed_at = now() - interval '16 minutes', blocked_until = null where email_hash = pg_temp.h(1);
set local role service_role;
select is(public.login_failed(pg_temp.h(1)), 0, 'old failures expire after 15 minutes');

select * from finish();
rollback;
