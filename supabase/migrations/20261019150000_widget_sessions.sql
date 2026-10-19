-- task-13-8: minute budget of the web widget "Mit Mira sprechen" on the contact page (user decision 19.10.2026:
-- at most 3 minutes per conversation, 10 minutes per day in total). The website server asks for a session before it
-- hands out a signed URL of the agent; each session reserves the full 3 minutes until its conversation is evaluated
-- (task-13-6), then the real duration counts. A session without a conversation keeps its reservation for the day
-- (the signed URL could still be used). At most 3 sessions per client and hour (client = salted hash of the IP
-- address, never the address itself). Only the website server (service_role) uses these functions.

create table public.widget_sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  client_key text not null check (client_key ~ '^[0-9a-f]{64}$'),
  reserved_seconds integer not null check (reserved_seconds between 1 and 3600),
  conversation_id text unique check (conversation_id is null or nullif(btrim(conversation_id), '') is not null)
);
create index widget_sessions_created_idx on public.widget_sessions (created_at);
create index widget_sessions_client_idx on public.widget_sessions (client_key, created_at);
alter table public.widget_sessions enable row level security;
comment on table public.widget_sessions is 'Sitzungen des Web-Widgets (task-13-8) für das Minutenbudget; kein Zugriff über die API.';

-- Seconds used on the local day of at_time: real duration of evaluated conversations (at most the reservation),
-- otherwise the reservation
create function private.widget_seconds_used(at_time timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when p.analyzed_at is not null then least(coalesce(p.duration_seconds, 0), s.reserved_seconds) else s.reserved_seconds end), 0)::int
  from public.widget_sessions s
  left join public.phone_calls p on p.conversation_id = s.conversation_id
  where (s.created_at at time zone 'Europe/Berlin')::date = (at_time at time zone 'Europe/Berlin')::date;
$$;

-- Remaining budget for the page (shown before the start)
create function public.widget_budget(daily_seconds integer default 600, max_seconds integer default 180)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  rest integer := greatest(widget_budget.daily_seconds - private.widget_seconds_used(now()), 0);
begin
  return jsonb_build_object('rest_sekunden', rest, 'verfuegbar', rest >= widget_budget.max_seconds);
end;
$$;

-- New session if the day budget holds another full conversation and the client is below its hourly limit
create function public.widget_session_start(client_key text, max_seconds integer default 180, daily_seconds integer default 600, per_client_hour integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
  recent integer;
  session_id uuid;
begin
  if widget_session_start.client_key is null or widget_session_start.client_key !~ '^[0-9a-f]{64}$' then
    raise exception 'Ungültiger Schlüssel' using errcode = 'RW422';
  end if;
  -- One start at a time, so two parallel starts cannot both take the last minutes
  perform pg_advisory_xact_lock(hashtext('widget_session_start'));
  used := private.widget_seconds_used(now());
  if used + widget_session_start.max_seconds > widget_session_start.daily_seconds then
    return jsonb_build_object('ok', false, 'grund', 'tageslimit', 'rest_sekunden', greatest(widget_session_start.daily_seconds - used, 0));
  end if;
  select count(*) into recent from public.widget_sessions s
  where s.client_key = widget_session_start.client_key and s.created_at > now() - interval '1 hour';
  if recent >= widget_session_start.per_client_hour then
    return jsonb_build_object('ok', false, 'grund', 'zu_viele', 'rest_sekunden', widget_session_start.daily_seconds - used);
  end if;
  insert into public.widget_sessions (client_key, reserved_seconds) values (widget_session_start.client_key, widget_session_start.max_seconds)
  returning id into session_id;
  return jsonb_build_object('ok', true, 'sitzung_id', session_id, 'rest_sekunden', widget_session_start.daily_seconds - used - widget_session_start.max_seconds);
end;
$$;

-- Conversation of a session (reported by the browser after connecting); only once per session and conversation
create function public.widget_session_bind(session_id uuid, conversation_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if nullif(btrim(widget_session_bind.conversation_id), '') is null or length(widget_session_bind.conversation_id) > 100 then
    return false;
  end if;
  update public.widget_sessions s set conversation_id = widget_session_bind.conversation_id
  where s.id = widget_session_bind.session_id and s.conversation_id is null and s.created_at > now() - interval '1 hour'
    and not exists (select 1 from public.widget_sessions o where o.conversation_id = widget_session_bind.conversation_id);
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- Sessions older than 90 days are not needed for the budget
select cron.schedule('widget-sessions-90-days', '45 2 * * *', $$delete from public.widget_sessions where created_at < now() - interval '90 days'$$);

revoke all on table public.widget_sessions from public, anon, authenticated;
revoke all on function private.widget_seconds_used(timestamptz), public.widget_budget(integer, integer),
  public.widget_session_start(text, integer, integer, integer), public.widget_session_bind(uuid, text) from public, anon, authenticated;
grant execute on function public.widget_budget(integer, integer), public.widget_session_start(text, integer, integer, integer),
  public.widget_session_bind(uuid, text) to service_role;
notify pgrst, 'reload schema';
