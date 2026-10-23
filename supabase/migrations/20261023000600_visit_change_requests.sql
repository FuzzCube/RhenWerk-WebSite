-- task-20-16 (user request 23.10.2026): a customer's wish to move a planned visit becomes a change request.
-- Flow: the customer writes -> workflow 13 recognises "reschedule" with the wished day and time -> request 'open' and an
-- automatic acknowledgement ("we will look at it and get back to you") -> the dispatcher sees the visit marked on the planning
-- board, confirms the wished time (visit moved, confirmation mail) or offers an alternative (status 'offered', offer mail)
-- -> the customer answers by e-mail; "yes" moves the visit by itself (workflow 13), "no" ends the wish. Without an answer
-- the customer gets one reminder after two days or one day before the visit.

create table public.visit_change_requests (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete restrict,
  visit_id uuid not null references public.visits (id) on delete restrict,
  message_id uuid references public.messages (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'offered', 'accepted', 'declined', 'done', 'withdrawn', 'expired')),
  wished_day date,
  wished_time text check (wished_time is null or wished_time ~ '^(any|morning|afternoon|([01][0-9]|2[0-3]):[0-5][0-9])$'),
  wish_summary text,
  offered_technician_id uuid references public.profiles (id) on delete restrict,
  offered_start timestamptz,
  offered_end timestamptz,
  offered_at timestamptz,
  offered_by uuid references public.profiles (id) on delete restrict,
  reminder_sent_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_change_offer_complete check (status <> 'offered' or (offered_technician_id is not null and offered_start is not null and offered_end > offered_start))
);
comment on table public.visit_change_requests is 'Verschiebewunsch des Kunden zu einem geplanten Einsatz (task-20-16): open, offered (Angebot gesendet), dann accepted/declined/done/withdrawn/expired';
create unique index visit_change_one_active on public.visit_change_requests (visit_id) where status in ('open', 'offered');
create index visit_change_request_idx on public.visit_change_requests (request_id);
create trigger visit_change_requests_set_updated_at before update on public.visit_change_requests for each row execute function set_updated_at();

alter table public.visit_change_requests enable row level security;
create policy visit_change_requests_select on public.visit_change_requests for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin') and private.can_access_request(request_id));
revoke all on public.visit_change_requests from public, anon, authenticated;
grant select on public.visit_change_requests to authenticated;

-- A moved, cancelled or finished visit closes its active wish
create function private.close_visit_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.visit_change_requests c set status = 'done', decided_at = coalesce(c.decided_at, now())
  where c.visit_id = new.id and c.status in ('open', 'offered');
  return new;
end;
$$;
create trigger visits_close_changes after update on public.visits for each row
  when (old.scheduled_start is distinct from new.scheduled_start or old.scheduled_end is distinct from new.scheduled_end
    or old.technician_id is distinct from new.technician_id or (new.status <> 'scheduled' and old.status = 'scheduled'))
  execute function private.close_visit_changes();

-- Like window_free, but the visit that is moved does not block its own new window
create function private.window_free_for_move(target_technician_id uuid, range_start timestamptz, range_end timestamptz, except_visit uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.availability_problem(target_technician_id, range_start, range_end) is null
    and not exists (select 1 from public.visits v where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress')
      and v.id <> except_visit and v.scheduled_start < range_end and v.scheduled_end > range_start)
    and not exists (select 1 from public.visit_holds h where h.technician_id = target_technician_id and h.status = 'open'
      and h.starts_at < range_end and h.ends_at > range_start);
$$;

-- Start times (30-minute grid within the working hours) of a technician on a local day for a window of the given length
create function private.technician_grid(target_technician_id uuid, local_day date, minutes integer)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct (g.t at time zone 'Europe/Berlin')
  from public.employee_availability a
  cross join lateral generate_series(local_day + a.local_start, local_day + a.local_end - make_interval(mins => minutes), interval '30 minutes') g(t)
  where a.employee_id = target_technician_id and a.kind = 'working_hours' and a.weekday = extract(isodow from local_day)
    and (a.valid_from is null or a.valid_from <= local_day) and (a.valid_to is null or a.valid_to >= local_day);
$$;

-- What the dispatcher can do with a wish: the wished window on the technician of the visit (free or not) and up to three
-- alternatives, nearest to the wish first (same technician first, then others)
create function public.visit_change_options(change_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.visit_change_requests;
  v public.visits;
  minutes integer;
  day date;
  wish text;
  target_minutes integer;
  s timestamptz;
  wished jsonb;
  alts jsonb := '[]'::jsonb;
  taken timestamptz[] := '{}';
  rec record;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into c from public.visit_change_requests x where x.id = visit_change_options.change_id;
  if not found or not private.can_access_request(c.request_id) then
    raise exception 'Änderungswunsch nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  select * into v from public.visits x where x.id = c.visit_id;
  minutes := (extract(epoch from v.scheduled_end - v.scheduled_start) / 60)::integer;
  day := greatest(coalesce(c.wished_day, (v.scheduled_start at time zone 'Europe/Berlin')::date), (now() at time zone 'Europe/Berlin')::date);
  wish := coalesce(c.wished_time, 'any');
  -- Time of day the alternatives should be near: the wished time, else the time of the visit now
  target_minutes := case when wish ~ '^\d\d:\d\d$' then extract(hour from wish::time)::integer * 60 + extract(minute from wish::time)::integer
    when wish = 'morning' then 9 * 60 when wish = 'afternoon' then 14 * 60
    else extract(hour from (v.scheduled_start at time zone 'Europe/Berlin'))::integer * 60 + extract(minute from (v.scheduled_start at time zone 'Europe/Berlin'))::integer end;

  -- The wished window on the day of the wish
  s := null;
  if wish ~ '^\d\d:\d\d$' then
    s := (day + wish::time) at time zone 'Europe/Berlin';
    if s < now() + interval '1 hour' or not private.window_free_for_move(v.technician_id, s, s + make_interval(mins => minutes), v.id) then s := null; end if;
  else
    -- Same time of day as now first (move "to the next day"), otherwise the first free start of the wished part of the day
    s := (day + (v.scheduled_start at time zone 'Europe/Berlin')::time) at time zone 'Europe/Berlin';
    if wish <> 'any' or s < now() + interval '1 hour' or not private.window_free_for_move(v.technician_id, s, s + make_interval(mins => minutes), v.id)
       or not exists (select 1 from private.technician_grid(v.technician_id, day, minutes) g where g.starts_at = s) then
      s := (select g.starts_at from private.technician_grid(v.technician_id, day, minutes) g
        where g.starts_at >= now() + interval '1 hour'
          and case wish when 'morning' then (g.starts_at at time zone 'Europe/Berlin')::time < time '12:00'
                        when 'afternoon' then (g.starts_at at time zone 'Europe/Berlin')::time >= time '12:00' else true end
          and private.window_free_for_move(v.technician_id, g.starts_at, g.starts_at + make_interval(mins => minutes), v.id)
        order by g.starts_at limit 1);
    end if;
  end if;
  wished := jsonb_build_object('technician_id', v.technician_id, 'day', day, 'free', s is not null,
    'start', s, 'end', case when s is null then null else s + make_interval(mins => minutes) end);
  if s is not null then taken := taken || s; end if;

  -- Alternatives of the same technician in the next two weeks, nearest to the wished time of day, the wished day first
  for rec in
    select g.starts_at,
      row_number() over (order by (d.d <> day), abs(extract(hour from (g.starts_at at time zone 'Europe/Berlin'))::integer * 60
        + extract(minute from (g.starts_at at time zone 'Europe/Berlin'))::integer - target_minutes), d.d) as rank
    from generate_series(day, day + 14, interval '1 day') d(d)
    cross join lateral private.technician_grid(v.technician_id, d.d::date, minutes) g
    where extract(isodow from d.d) <= 5 and g.starts_at >= now() + interval '1 hour' and g.starts_at <> all (taken)
      and private.window_free_for_move(v.technician_id, g.starts_at, g.starts_at + make_interval(mins => minutes), v.id)
    order by 2
    limit 2
  loop
    alts := alts || jsonb_build_object('technician_id', v.technician_id, 'start', rec.starts_at, 'end', rec.starts_at + make_interval(mins => minutes));
    taken := taken || rec.starts_at;
  end loop;
  -- Fill up with the earliest windows of other technicians
  for rec in select f.technician_id, f.starts_at, f.ends_at from private.free_windows(day, day + 14, minutes, 6) f
    where f.technician_id <> v.technician_id and f.starts_at <> all (taken)
  loop
    exit when jsonb_array_length(alts) >= 3;
    alts := alts || jsonb_build_object('technician_id', rec.technician_id, 'start', rec.starts_at, 'end', rec.ends_at);
  end loop;

  return jsonb_build_object('wished', wished, 'alternatives', alts, 'minutes', minutes);
end;
$$;

-- The dispatcher moves the visit as wished or to a time of his choice: visit moved, wish done, confirmation to the customer
create function public.confirm_visit_change(change_id uuid, expected_version integer, technician_id uuid, scheduled_start timestamptz, scheduled_end timestamptz)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.visit_change_requests;
  old public.visits;
  result public.visits;
  req public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into c from public.visit_change_requests x where x.id = confirm_visit_change.change_id for update;
  if not found or not private.can_access_request(c.request_id) then
    raise exception 'Änderungswunsch nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if c.status not in ('open', 'offered') then
    raise exception 'Der Änderungswunsch ist nicht mehr offen' using errcode = 'RW422';
  end if;
  select * into old from public.visits x where x.id = c.visit_id;
  update public.visit_change_requests x set status = 'done', decided_at = now(), decided_by = (select auth.uid()) where x.id = c.id;
  result := public.reschedule_visit(c.visit_id, expected_version, scheduled_start, scheduled_end, 'Auf Wunsch des Kunden (Änderungswunsch per E-Mail)', technician_id);
  select * into req from public.requests r where r.id = c.request_id;
  perform private.queue_hold_mail(req,
    'Terminänderung bestätigt ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'gern haben wir Ihren Terminwunsch für die Anfrage ' || req.request_number || ' berücksichtigt.', '',
      'Ihr neuer Termin: ' || private.spoken_datetime(result.scheduled_start) || ', Dauer etwa ' || private.duration_text(result.scheduled_start, result.scheduled_end) || ',',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Bisher: ' || private.spoken_datetime(old.scheduled_start) || '.', '',
      'Sollte der neue Termin doch nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  perform private.log_request_event(req.id, 'visit_change_confirmed', old.scheduled_start::text, result.scheduled_start::text, 'Terminwunsch bestätigt', jsonb_build_object('change_id', c.id, 'visit_id', c.visit_id));
  return result;
end;
$$;

-- The wished window is not free (or not suitable): the dispatcher offers another one; the visit stays where it is
create function public.offer_visit_change(change_id uuid, expected_version integer, technician_id uuid, scheduled_start timestamptz, scheduled_end timestamptz)
returns public.visit_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.visit_change_requests;
  locked record;
  result public.visit_change_requests;
  req public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into c from public.visit_change_requests x where x.id = offer_visit_change.change_id for update;
  if not found or not private.can_access_request(c.request_id) then
    raise exception 'Änderungswunsch nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if c.status not in ('open', 'offered') then
    raise exception 'Der Änderungswunsch ist nicht mehr offen' using errcode = 'RW422';
  end if;
  locked := private.lock_visit(c.visit_id, expected_version);
  if (locked.vis).status <> 'scheduled' then
    raise exception 'Nur geplante Einsätze lassen sich umplanen' using errcode = 'RW422';
  end if;
  if offer_visit_change.scheduled_start < now() or offer_visit_change.scheduled_end <= offer_visit_change.scheduled_start then
    raise exception 'Ungültiger Zeitraum für das Angebot' using errcode = 'RW422';
  end if;
  perform private.require_active_technician(offer_visit_change.technician_id);
  if not private.window_free_for_move(offer_visit_change.technician_id, offer_visit_change.scheduled_start, offer_visit_change.scheduled_end, c.visit_id) then
    raise exception 'Der Techniker hat in diesem Zeitraum bereits einen Einsatz oder ist nicht verfügbar' using errcode = 'RW410';
  end if;
  update public.visit_change_requests x
  set status = 'offered', offered_technician_id = offer_visit_change.technician_id, offered_start = offer_visit_change.scheduled_start,
      offered_end = offer_visit_change.scheduled_end, offered_at = now(), offered_by = (select auth.uid()), reminder_sent_at = null
  where x.id = c.id returning * into result;
  update public.requests r set updated_at = now() where r.id = c.request_id;
  select * into req from public.requests r where r.id = c.request_id;
  perform private.queue_hold_mail(req,
    'Ihr Terminwunsch ' || req.request_number || ' · Vorschlag',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'vielen Dank für Ihre Nachricht zur Anfrage ' || req.request_number || '. Zu Ihrem Wunschtermin können wir leider keinen Einsatz anbieten.', '',
      'Wir können Ihnen stattdessen diesen Termin vorschlagen:', '',
      private.spoken_datetime(result.offered_start) || ', Dauer etwa ' || private.duration_text(result.offered_start, result.offered_end) || ',',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Bitte antworten Sie auf diese E-Mail mit „Ja“, wenn Ihnen der Vorschlag passt, oder mit „Nein“.',
      'Bis dahin bleibt Ihr bisheriger Termin bestehen: ' || private.spoken_datetime((locked.vis).scheduled_start) || '.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  perform private.log_request_event(req.id, 'visit_change_offered', null, result.offered_start::text, 'Alternativtermin angeboten', jsonb_build_object('change_id', c.id, 'visit_id', c.visit_id, 'technician_id', result.offered_technician_id));
  return result;
end;
$$;

-- The wish is settled in another way (phone call, new plan): close it without e-mail
create function public.close_visit_change(change_id uuid)
returns public.visit_change_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.visit_change_requests;
  result public.visit_change_requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into c from public.visit_change_requests x where x.id = close_visit_change.change_id for update;
  if not found or not private.can_access_request(c.request_id) then
    raise exception 'Änderungswunsch nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if c.status not in ('open', 'offered') then
    return c;
  end if;
  update public.visit_change_requests x set status = 'withdrawn', decided_at = now(), decided_by = (select auth.uid()) where x.id = c.id returning * into result;
  update public.requests r set updated_at = now() where r.id = c.request_id;
  perform private.log_request_event(c.request_id, 'visit_change_closed', null, null, 'Änderungswunsch erledigt', jsonb_build_object('change_id', c.id));
  return result;
end;
$$;

-- Workflow 13 asks for the replies to evaluate; with today's date, the open offer (if any) for the intent
create or replace function public.visit_replies_pending(batch_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_integration();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(x.item order by x.received_at) from (
      select m.received_at, jsonb_build_object(
        'message_id', m.id, 'request_number', q.request_number, 'subject', m.subject, 'text', left(coalesce(m.body_text, ''), 4000),
        'today', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
        'weekday', to_char(now() at time zone 'Europe/Berlin', 'FMDay'),
        'offer', (select private.spoken_datetime(c.offered_start) from public.visit_change_requests c where c.request_id = q.id and c.status = 'offered' limit 1),
        'visits', (select jsonb_agg(private.spoken_datetime(v.scheduled_start) order by v.scheduled_start) from public.visits v
          where v.request_id = q.id and v.status = 'scheduled' and v.scheduled_start > now())) as item
      from public.messages m
      join public.requests q on q.id = m.request_id and not q.is_demo
      where m.direction = 'incoming' and m.kind = 'customer_reply' and m.received_at > now() - interval '3 days'
        and exists (select 1 from public.visits v where v.request_id = q.id and v.status = 'scheduled' and v.scheduled_start > now() and v.created_at < m.received_at)
        and not exists (select 1 from public.automation_runs r where r.operation_key = 'visit_reply:' || m.id)
      order by m.received_at
      limit greatest(1, least(batch_limit, 20))
    ) x), '[]'::jsonb));
end;
$$;

-- Evaluation of a customer reply (workflow 13). New: reschedule wishes become change requests with an acknowledgement; a
-- "yes" or "no" to an open offer is applied. Cancellation as before. The old five-argument version is replaced.
drop function public.apply_visit_reply(uuid, text, numeric, text, text);
create function public.apply_visit_reply(message_id uuid, intent text, confidence numeric, summary text, workflow_execution_id text default null, wished_day date default null, wished_time text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  req public.requests;
  v public.visits;
  c public.visit_change_requests;
  clean_intent text := case when apply_visit_reply.intent in ('cancel_visit', 'reschedule', 'confirm', 'decline', 'question', 'other') then apply_visit_reply.intent else 'other' end;
  sure numeric := greatest(0, least(1, coalesce(apply_visit_reply.confidence, 0)));
  note text := left(coalesce(nullif(btrim(apply_visit_reply.summary), ''), 'Kundenantwort zum Termin'), 500);
  clean_time text := case when apply_visit_reply.wished_time ~ '^(any|morning|afternoon|([01][0-9]|2[0-3]):[0-5][0-9])$' then apply_visit_reply.wished_time else null end;
  clean_day date := case when apply_visit_reply.wished_day >= (now() at time zone 'Europe/Berlin')::date and apply_visit_reply.wished_day <= (now() at time zone 'Europe/Berlin')::date + 120 then apply_visit_reply.wished_day else null end;
  sender_ok boolean;
  action text := 'none';
  cancelled text[] := '{}';
  reason text;
  old_start timestamptz;
  old_end timestamptz;
begin
  perform private.require_integration();
  select * into m from public.messages x where x.id = apply_visit_reply.message_id and x.direction = 'incoming' and x.request_id is not null for update;
  if not found then
    raise exception 'Nachricht nicht gefunden' using errcode = 'RW422';
  end if;
  if exists (select 1 from public.automation_runs r where r.operation_key = 'visit_reply:' || m.id) then
    return jsonb_build_object('action', 'duplicate');
  end if;
  select * into req from public.requests r where r.id = m.request_id for update;
  sender_ok := nullif(btrim(req.business_email), '') is not null and position(lower(btrim(req.business_email)) in lower(coalesce(m.from_address, ''))) > 0;
  select * into c from public.visit_change_requests x where x.request_id = req.id and x.status in ('open', 'offered') order by x.created_at desc limit 1 for update;

  if found and c.status = 'offered' and clean_intent in ('confirm', 'decline') and sure >= 0.8 and sender_ok then
    if clean_intent = 'confirm' then
      -- The customer accepts the offer: the visit moves by itself if the window is still free
      select * into v from public.visits x where x.id = c.visit_id and x.status = 'scheduled' for update;
      if found and c.offered_start > now() and private.window_free_for_move(c.offered_technician_id, c.offered_start, c.offered_end, v.id) then
        old_start := v.scheduled_start; old_end := v.scheduled_end;
        update public.visit_change_requests x set status = 'accepted', decided_at = now() where x.id = c.id;
        begin
          update public.visits x set technician_id = c.offered_technician_id, scheduled_start = c.offered_start, scheduled_end = c.offered_end where x.id = v.id returning * into v;
          if req.technician_id is distinct from c.offered_technician_id then
            update public.requests r set technician_id = c.offered_technician_id where r.id = req.id;
            perform private.log_request_event(req.id, 'technician_assigned', req.technician_id::text, c.offered_technician_id::text);
          else
            update public.requests r set updated_at = now() where r.id = req.id;
          end if;
          insert into public.request_events (request_id, visit_id, actor_type, event_type, from_value, to_value, note, data)
          values (req.id, v.id, 'automation', 'visit_rescheduled', tstzrange(old_start, old_end, '[)')::text, tstzrange(v.scheduled_start, v.scheduled_end, '[)')::text,
            'Angebot vom Kunden per E-Mail angenommen',
            jsonb_build_object('old_start', old_start, 'old_end', old_end, 'new_start', v.scheduled_start, 'new_end', v.scheduled_end, 'message_id', m.id, 'change_id', c.id));
          perform private.queue_system_mail(req,
            'Terminänderung bestätigt ' || req.request_number || ' · Ihre Serviceanfrage',
            concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
              'vielen Dank für Ihre Rückmeldung. Wir haben Ihren Termin für die Anfrage ' || req.request_number || ' wie vorgeschlagen geändert.', '',
              'Ihr neuer Termin: ' || private.spoken_datetime(v.scheduled_start) || ', Dauer etwa ' || private.duration_text(v.scheduled_start, v.scheduled_end) || ',',
              req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
              'Bisher: ' || private.spoken_datetime(old_start) || '.', '',
              'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'),
            'visit_change_accepted');
          action := 'moved';
        exception when exclusion_violation then
          update public.visit_change_requests x set status = 'open', decided_at = null where x.id = c.id;
          action := 'flagged';
        end;
      else
        -- Not free any more: back to the dispatcher with the wish open again
        update public.visit_change_requests x set status = 'open' where x.id = c.id;
        update public.requests r set updated_at = now() where r.id = req.id;
        action := 'flagged';
      end if;
    else
      update public.visit_change_requests x set status = 'declined', decided_at = now() where x.id = c.id;
      update public.requests r set updated_at = now() where r.id = req.id;
      perform private.queue_system_mail(req,
        'Ihr Termin bleibt bestehen ' || req.request_number || ' · Ihre Serviceanfrage',
        concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
          'vielen Dank für Ihre Rückmeldung. Wir lassen Ihren bisherigen Termin für die Anfrage ' || req.request_number || ' unverändert bestehen:', '',
          (select private.spoken_datetime(x.scheduled_start) from public.visits x where x.id = c.visit_id) || '.', '',
          'Wenn Sie einen anderen Termin wünschen, antworten Sie einfach auf diese E-Mail.', '',
          'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'),
        'visit_change_declined');
      action := 'declined';
    end if;
  elsif clean_intent = 'reschedule' and sender_ok and sure >= 0.5 then
    -- A wish to move the visit: a change request for the dispatcher and an acknowledgement; a second mail about an open
    -- wish only completes it
    if found and c.status = 'open' then
      update public.visit_change_requests x set wished_day = coalesce(clean_day, x.wished_day), wished_time = coalesce(clean_time, x.wished_time), wish_summary = note, message_id = m.id where x.id = c.id;
      update public.requests r set updated_at = now() where r.id = req.id;
      action := 'change_updated';
    else
      select * into v from public.visits x where x.request_id = req.id and x.status = 'scheduled' and x.scheduled_start > now() order by x.scheduled_start limit 1 for update;
      if found then
        insert into public.visit_change_requests (request_id, visit_id, message_id, wished_day, wished_time, wish_summary)
        values (req.id, v.id, m.id, clean_day, clean_time, note);
        update public.requests r set updated_at = now() where r.id = req.id;
        perform private.queue_system_mail(req,
          'Ihr Terminwunsch ' || req.request_number || ' · Eingang bestätigt',
          concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
            'vielen Dank für Ihre Nachricht zur Anfrage ' || req.request_number || '. Wir haben Ihren Wunsch, den Termin zu ändern, erhalten.', '',
            'Wir prüfen, ob wir Ihren Wunsch umsetzen können, und melden uns bei Ihnen, sobald wir mehr wissen. Bis dahin gilt Ihr bisheriger Termin:', '',
            private.spoken_datetime(v.scheduled_start) || '.', '',
            'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'),
          'visit_change_received');
        action := 'change_requested';
      else
        action := 'flagged';
        update public.requests r set updated_at = now() where r.id = req.id;
      end if;
    end if;
  elsif clean_intent = 'cancel_visit' and sure >= 0.8 and sender_ok then
    reason := 'Storniert auf Wunsch des Kunden (E-Mail vom ' || to_char(m.received_at at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') || ')';
    for v in select * from public.visits x where x.request_id = req.id and x.status = 'scheduled' and x.scheduled_start > now() order by x.scheduled_start for update loop
      update public.visits x set status = 'cancelled', cancellation_reason = reason where x.id = v.id;
      insert into public.request_events (request_id, visit_id, actor_type, event_type, from_value, to_value, note, data)
      values (req.id, v.id, 'automation', 'visit_status_changed', 'scheduled', 'cancelled', reason,
        jsonb_build_object('scheduled_start', v.scheduled_start, 'scheduled_end', v.scheduled_end, 'message_id', m.id));
      cancelled := cancelled || private.spoken_datetime(v.scheduled_start);
    end loop;
    if cardinality(cancelled) > 0 then
      action := 'cancelled';
      if req.work_status = 'scheduled' and not exists (
        select 1 from public.visits x where x.request_id = req.id and x.status in ('scheduled', 'in_progress', 'waiting_parts')
      ) then
        update public.requests r set work_status = 'not_planned' where r.id = req.id;
        insert into public.request_events (request_id, actor_type, event_type, from_value, to_value, note)
        values (req.id, 'automation', 'work_status_changed', req.work_status::text, 'not_planned', reason);
      else
        update public.requests r set updated_at = now() where r.id = req.id;
      end if;
      perform private.queue_system_mail(req,
        'Stornierung Ihres Termins ' || req.request_number || ' · Ihre Serviceanfrage',
        concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
          'wie gewünscht haben wir Ihren Termin für die Anfrage ' || req.request_number || ' storniert:', '',
          array_to_string(cancelled, E'\n') || '.', '',
          'Wenn Sie einen neuen Termin wünschen, antworten Sie einfach auf diese E-Mail.', '',
          'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'),
        'visit_cancelled');
    else
      action := 'flagged';
      update public.requests r set updated_at = now() where r.id = req.id;
    end if;
  elsif clean_intent in ('cancel_visit', 'reschedule', 'confirm', 'decline') and (c.id is not null) then
    -- An answer about an open offer or wish that is not clear enough: a person decides
    action := 'flagged';
    update public.requests r set updated_at = now() where r.id = req.id;
  elsif clean_intent in ('cancel_visit', 'reschedule') then
    action := 'flagged';
    update public.requests r set updated_at = now() where r.id = req.id;
  end if;

  insert into public.request_events (request_id, actor_type, event_type, to_value, note, data)
  values (req.id, 'automation', 'visit_reply_analyzed', action, note,
    jsonb_build_object('message_id', m.id, 'intent', clean_intent, 'confidence', sure, 'sender_ok', sender_ok, 'wished_day', clean_day, 'wished_time', clean_time));
  insert into public.automation_runs (request_id, message_id, operation_key, workflow_execution_id, step, status, confidence, result, finished_at)
  values (req.id, m.id, 'visit_reply:' || m.id, apply_visit_reply.workflow_execution_id, 'visit_reply', 'succeeded', sure,
    jsonb_build_object('intent', clean_intent, 'summary', note, 'action', action, 'sender_ok', sender_ok, 'cancelled', to_jsonb(cancelled), 'wished_day', clean_day, 'wished_time', clean_time), now());
  return jsonb_build_object('action', action, 'intent', clean_intent, 'cancelled', to_jsonb(cancelled));
end;
$$;

-- One reminder for an unanswered offer: two days after the offer or one day before the visit; an offer for a visit that
-- has begun expires. Runs hourly.
create function public.run_visit_change_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.visit_change_requests;
  v public.visits;
  req public.requests;
  sent integer := 0;
begin
  update public.visit_change_requests x set status = 'expired', decided_at = now()
  where x.status = 'offered' and exists (select 1 from public.visits y where y.id = x.visit_id and (y.scheduled_start <= now() or y.status <> 'scheduled'));
  for c in
    select x.* from public.visit_change_requests x
    join public.visits y on y.id = x.visit_id and y.status = 'scheduled' and y.scheduled_start > now()
    where x.status = 'offered' and x.reminder_sent_at is null and x.offered_start > now()
      and (x.offered_at <= now() - interval '2 days' or y.scheduled_start <= now() + interval '1 day')
    for update of x skip locked
  loop
    select * into v from public.visits y where y.id = c.visit_id;
    select * into req from public.requests r where r.id = c.request_id;
    update public.visit_change_requests x set reminder_sent_at = now() where x.id = c.id;
    perform private.queue_system_mail(req,
      'Erinnerung: Ihr Terminwunsch ' || req.request_number || ' · Bitte um Antwort',
      concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
        'wir haben Ihnen zu Ihrem Terminwunsch für die Anfrage ' || req.request_number || ' einen Vorschlag gemacht und noch keine Antwort erhalten:', '',
        'Vorschlag: ' || private.spoken_datetime(c.offered_start) || ', Dauer etwa ' || private.duration_text(c.offered_start, c.offered_end) || '.',
        'Bisheriger Termin: ' || private.spoken_datetime(v.scheduled_start) || '.', '',
        'Bitte antworten Sie auf diese E-Mail mit „Ja“, wenn Ihnen der Vorschlag passt, oder mit „Nein“. Ohne Antwort bleibt Ihr bisheriger Termin bestehen.', '',
        'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'),
      'visit_change_reminder');
    perform private.log_request_event(req.id, 'visit_change_reminded', null, null, 'Erinnerung zum Terminvorschlag gesendet', jsonb_build_object('change_id', c.id));
    sent := sent + 1;
  end loop;
  return sent;
end;
$$;
select cron.schedule('visit-change-reminders', '15 * * * *', 'select public.run_visit_change_reminders()');

revoke all on function private.close_visit_changes(), private.window_free_for_move(uuid, timestamptz, timestamptz, uuid), private.technician_grid(uuid, date, integer) from public, anon, authenticated;
revoke all on function public.visit_change_options(uuid), public.confirm_visit_change(uuid, integer, uuid, timestamptz, timestamptz),
  public.offer_visit_change(uuid, integer, uuid, timestamptz, timestamptz), public.close_visit_change(uuid) from public, anon;
grant execute on function public.visit_change_options(uuid), public.confirm_visit_change(uuid, integer, uuid, timestamptz, timestamptz),
  public.offer_visit_change(uuid, integer, uuid, timestamptz, timestamptz), public.close_visit_change(uuid) to authenticated;
revoke all on function public.apply_visit_reply(uuid, text, numeric, text, text, date, text), public.run_visit_change_reminders() from public, anon, authenticated;
grant execute on function public.apply_visit_reply(uuid, text, numeric, text, text, date, text) to service_role;
