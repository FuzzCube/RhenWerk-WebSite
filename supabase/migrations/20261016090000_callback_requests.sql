-- task-13-4: callback request to the technician. When a caller asks about a visit that should have started and has
-- not (situation "ueberfaellig"), the phone assistant asks the assigned technician to call the customer back. The
-- technician sees it as a notification in the dashboard and confirms "Kunde angerufen". Without confirmation after
-- 15 minutes the request goes urgently to the dispatcher of the request (all active dispatchers if there is none).
-- Starting the visit closes an open request. No Telegram (user decision 15.10.2026): notifications stay in the
-- dashboard. Company, site, number and planned start are copied so the notification needs no further access.

create table public.callback_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  visit_id uuid not null references public.visits (id) on delete cascade,
  technician_id uuid not null references public.profiles (id) on delete restrict,
  conversation_id text not null,
  callback_number text not null,
  company_name text not null,
  site text not null,
  scheduled_start timestamptz not null,
  status text not null default 'open' check (status in ('open', 'done')),
  closed_reason text check (closed_reason in ('acknowledged', 'visit_started')),
  closed_by uuid references public.profiles (id) on delete restrict,
  closed_at timestamptz,
  escalated_at timestamptz,
  -- Dispatcher of the escalation; null after escalation means all active dispatchers
  escalated_to uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint callback_requests_number check (nullif(btrim(callback_number), '') is not null),
  constraint callback_requests_closed check ((status = 'open') = (closed_at is null) and (closed_at is null) = (closed_reason is null)),
  constraint callback_requests_closed_by check (closed_reason is distinct from 'acknowledged' or closed_by is not null),
  constraint callback_requests_escalated_to check (escalated_to is null or escalated_at is not null)
);
create unique index callback_requests_one_open_per_visit on public.callback_requests (visit_id) where status = 'open';
create index callback_requests_open_idx on public.callback_requests (technician_id, created_at) where status = 'open';

create trigger callback_requests_set_updated_at
  before update on public.callback_requests
  for each row execute function public.set_updated_at();

-- Who is notified: the technician of the visit; after escalation the dispatcher of the escalation (or every
-- dispatcher when nobody is named). Manager and admin read all for history.
create function private.can_read_callback(c public.callback_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.current_employee_role()
    when 'technician' then c.technician_id = (select auth.uid())
    when 'dispatcher' then private.can_access_request(c.request_id)
      or (c.escalated_at is not null and (c.escalated_to is null or c.escalated_to = (select auth.uid())))
    when 'manager' then true
    when 'admin' then true
    else false
  end;
$$;

alter table public.callback_requests enable row level security;
create policy callback_requests_read on public.callback_requests for select to authenticated
  using (private.can_read_callback(callback_requests));
revoke insert, update, delete on public.callback_requests from anon, authenticated;

-- Tool rueckrufbitte_techniker: only for an overdue visit, one open request per visit (repetition returns it)
create function public.agent_request_callback(call_id text, anfrage_id uuid, rueckrufnummer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  req public.requests;
  v public.visits;
  situation jsonb;
  existing public.callback_requests;
  created public.callback_requests;
  number_value text := btrim(regexp_replace(coalesce(rueckrufnummer, ''), '\s+', ' ', 'g'));
begin
  perform private.require_integration();
  c := private.call_for(agent_request_callback.call_id);
  if length(regexp_replace(number_value, '[^0-9]', '', 'g')) < 6 then
    return jsonb_build_object('ok', false, 'fehler', 'rueckrufnummer_ungueltig');
  end if;
  select * into req from public.requests r where r.id = agent_request_callback.anfrage_id;
  if not found then
    return jsonb_build_object('ok', false, 'fehler', 'anfrage_unbekannt');
  end if;
  situation := private.request_situation(req, now());
  if situation ->> 'lage' <> 'ueberfaellig' then
    return jsonb_build_object('ok', false, 'fehler', 'nicht_ueberfaellig', 'lage', situation ->> 'lage');
  end if;
  select * into v from public.visits x where x.id = (situation ->> 'einsatz_id')::uuid for update;

  select * into existing from public.callback_requests cr where cr.visit_id = v.id and cr.status = 'open';
  if found then
    return jsonb_build_object('ok', true, 'bereits_offen', true, 'rueckrufbitte_id', existing.id);
  end if;

  insert into public.callback_requests (request_id, visit_id, technician_id, conversation_id, callback_number, company_name, site, scheduled_start)
  values (req.id, v.id, v.technician_id, c.conversation_id, number_value, req.company_name,
    req.street_house_number || ', ' || req.postal_code || ' ' || req.city, v.scheduled_start)
  returning * into created;
  insert into public.request_events (request_id, visit_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, v.id, 'automation', 'callback_requested', 'operational', v.technician_id::text,
    jsonb_build_object('callback_id', created.id, 'conversation_id', c.conversation_id));
  update public.phone_calls p set request_id = req.id where p.id = c.id;
  return jsonb_build_object('ok', true, 'bereits_offen', false, 'rueckrufbitte_id', created.id);
end;
$$;

-- "Kunde angerufen": the technician of the request, or after escalation the notified dispatcher; manager and admin
create function public.acknowledge_callback(callback_id uuid)
returns public.callback_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  cb public.callback_requests;
  result public.callback_requests;
begin
  perform private.require_role('technician', 'dispatcher', 'manager', 'admin');
  select * into cb from public.callback_requests x where x.id = acknowledge_callback.callback_id for update;
  if not found or not private.can_read_callback(cb) then
    raise exception 'Rückrufbitte nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if cb.status <> 'open' then
    raise exception 'Die Rückrufbitte ist bereits erledigt' using errcode = 'RW422';
  end if;
  update public.callback_requests x set status = 'done', closed_reason = 'acknowledged', closed_by = (select auth.uid()), closed_at = now()
  where x.id = cb.id returning * into result;
  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, visibility, data)
  values (cb.request_id, cb.visit_id, 'user', (select auth.uid()), 'callback_acknowledged', 'operational',
    jsonb_build_object('callback_id', cb.id, 'escalated', cb.escalated_at is not null));
  return result;
end;
$$;

-- Every minute: close requests whose visit has started (or is no longer planned), then escalate open ones older
-- than 15 minutes to the dispatcher of the request (active), otherwise to all active dispatchers
create function public.escalate_callbacks()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  cb public.callback_requests;
  target uuid;
begin
  for cb in update public.callback_requests x set status = 'done', closed_reason = 'visit_started', closed_at = now()
    from public.visits v
    where x.status = 'open' and v.id = x.visit_id and v.status <> 'scheduled'
    returning x.* loop
    insert into public.request_events (request_id, visit_id, actor_type, event_type, visibility, data)
    values (cb.request_id, cb.visit_id, 'system', 'callback_closed_by_visit', 'operational', jsonb_build_object('callback_id', cb.id));
  end loop;

  for cb in select * from public.callback_requests x
    where x.status = 'open' and x.escalated_at is null and x.created_at <= now() - interval '15 minutes'
    for update skip locked loop
    select p.id into target from public.requests r join public.profiles p on p.id = r.dispatcher_id
    where r.id = cb.request_id and p.is_active and p.role = 'dispatcher';
    update public.callback_requests x set escalated_at = now(), escalated_to = target where x.id = cb.id;
    insert into public.request_events (request_id, visit_id, actor_type, event_type, visibility, to_value, data)
    values (cb.request_id, cb.visit_id, 'system', 'callback_escalated', 'dispatch', target::text,
      jsonb_build_object('callback_id', cb.id, 'all_dispatchers', target is null));
    n := n + 1;
  end loop;
  return n;
end;
$$;
select cron.schedule('callback-escalation', '* * * * *', 'select public.escalate_callbacks()');

revoke all on function private.can_read_callback(public.callback_requests) from public, anon;
grant execute on function private.can_read_callback(public.callback_requests) to authenticated;
revoke all on function public.agent_request_callback(text, uuid, text), public.escalate_callbacks() from public, anon, authenticated;
grant execute on function public.agent_request_callback(text, uuid, text), public.escalate_callbacks() to service_role;
revoke all on function public.acknowledge_callback(uuid) from public, anon;
grant execute on function public.acknowledge_callback(uuid) to authenticated;
notify pgrst, 'reload schema';
