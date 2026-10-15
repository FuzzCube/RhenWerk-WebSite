-- task-11-6: growing pause after repeated wrong passwords, per e-mail address. No hard lock: the pause is at most
-- 15 minutes, so a third party cannot lock someone out for long. Counted for every address (known or not), so the
-- pause reveals no accounts. Only the SHA-256 hash of the normalised address is stored. Called by the app server
-- with the service role; users have no access.
--
-- Schedule (failures within 15 minutes of each other): 1–4 no pause, 5 → 30 s, 6 → 1 min, 7 → 2 min, 8 → 5 min,
-- from 9 on 15 min. 15 minutes without a failure, a successful sign-in or a new password reset the counter.

create table private.login_attempts (
  email_hash text primary key check (email_hash ~ '^[0-9a-f]{64}$'),
  failures integer not null default 0 check (failures >= 0),
  last_failed_at timestamptz,
  blocked_until timestamptz
);

create function private.login_pause_seconds(failures integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when failures < 5 then 0
    when failures = 5 then 30
    when failures = 6 then 60
    when failures = 7 then 120
    when failures = 8 then 300
    else 900
  end;
$$;

-- Remaining pause in seconds (0 = sign-in allowed)
create function public.login_pause_remaining(email_hash text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select greatest(0, ceil(extract(epoch from a.blocked_until - now())))::integer
    from private.login_attempts a where a.email_hash = login_pause_remaining.email_hash
  ), 0);
$$;

-- Records a wrong password and returns the pause that starts now (0 = none yet)
create function public.login_failed(email_hash text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  row private.login_attempts;
  pause integer;
begin
  insert into private.login_attempts as a (email_hash, failures, last_failed_at)
  values (login_failed.email_hash, 1, now())
  on conflict on constraint login_attempts_pkey do update
    set failures = case when a.last_failed_at < now() - interval '15 minutes' then 1 else a.failures + 1 end,
        last_failed_at = now()
  returning * into row;
  pause := private.login_pause_seconds(row.failures);
  update private.login_attempts a
    set blocked_until = case when pause > 0 then now() + make_interval(secs => pause) else null end
    where a.email_hash = login_failed.email_hash;
  return pause;
end;
$$;

-- Successful sign-in or new password
create function public.login_reset(email_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.login_attempts a where a.email_hash = login_reset.email_hash;
$$;

revoke all on table private.login_attempts from public, anon, authenticated;
revoke all on function private.login_pause_seconds(integer) from public, anon, authenticated;
revoke all on function public.login_pause_remaining(text), public.login_failed(text), public.login_reset(text) from public, anon, authenticated;
grant execute on function public.login_pause_remaining(text), public.login_failed(text), public.login_reset(text) to service_role;
notify pgrst, 'reload schema';
