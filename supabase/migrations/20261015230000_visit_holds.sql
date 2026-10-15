-- task-13-3: the phone assistant offers free windows and reserves the chosen one (visit hold). A hold blocks the window
-- for further offers until a dispatcher confirms it (visit planned through schedule_visit, customer e-mail) or rejects
-- it (reason, optional alternative, customer e-mail); unanswered holds expire after two business days. Holds do not
-- block manual planning; the planning board shows them.

create table public.visit_holds (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  technician_id uuid not null references public.profiles (id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'rejected', 'expired')),
  expires_at timestamptz not null,
  conversation_id text,
  -- Visit planned on confirmation; null again if that visit is deleted (demo seed)
  visit_id uuid references public.visits (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete restrict,
  decided_at timestamptz,
  reject_reason text,
  alternative text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_holds_order check (ends_at > starts_at),
  constraint visit_holds_decision check ((status in ('open', 'expired')) = (decided_at is null) and (decided_at is null) = (decided_by is null)),
  constraint visit_holds_reject_reason check (status <> 'rejected' or nullif(btrim(reject_reason), '') is not null),
  constraint visit_holds_no_overlap exclude using gist (technician_id with =, tstzrange(starts_at, ends_at, '[)') with &&) where (status = 'open')
);
create unique index visit_holds_one_open_per_request on public.visit_holds (request_id) where status = 'open';
create index visit_holds_open_idx on public.visit_holds (starts_at) where status = 'open';

create trigger visit_holds_set_updated_at
  before update on public.visit_holds
  for each row execute function public.set_updated_at();

alter table public.visit_holds enable row level security;
create policy visit_holds_staff_read on public.visit_holds for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin') and private.can_access_request(request_id));
revoke insert, update, delete on public.visit_holds from anon, authenticated;

-- Visit length by service (docs/telefonassistent/regeln.md)
create function private.hold_minutes(kind public.service_kind)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case kind when 'scheduled_maintenance' then 180 else 120 end;
$$;

-- Same time n business days (Mon–Fri) later
create function private.add_business_days(ts timestamptz, n integer)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  result timestamptz := ts;
  added integer := 0;
begin
  while added < n loop
    result := result + interval '1 day';
    if extract(isodow from result at time zone 'Europe/Berlin') <= 5 then
      added := added + 1;
    end if;
  end loop;
  return result;
end;
$$;

-- Free for an offer: within working hours, no absence, no reserving visit, no open hold
create function private.window_free(target_technician_id uuid, range_start timestamptz, range_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.availability_problem(target_technician_id, range_start, range_end) is null
    and not exists (select 1 from public.visits v where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress')
      and v.scheduled_start < range_end and v.scheduled_end > range_start)
    and not exists (select 1 from public.visit_holds h where h.technician_id = target_technician_id and h.status = 'open'
      and h.starts_at < range_end and h.ends_at > range_start);
$$;

-- Booked minutes of a technician on a local day (visits and open holds); the least booked gets a new window
create function private.booked_minutes(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from least(e, d1) - greatest(s, d0)) / 60), 0)::integer
  from (
    select v.scheduled_start s, v.scheduled_end e from public.visits v
    where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress', 'waiting_parts', 'completed')
    union all
    select h.starts_at, h.ends_at from public.visit_holds h where h.technician_id = target_technician_id and h.status = 'open'
  ) x,
  lateral (select (local_day::timestamp at time zone 'Europe/Berlin') d0, ((local_day + 1)::timestamp at time zone 'Europe/Berlin') d1) b
  where x.s < b.d1 and x.e > b.d0;
$$;

-- Least booked active technician free for exactly this window, or null
create function private.technician_for_window(range_start timestamptz, range_end timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.role = 'technician' and p.is_active and private.window_free(p.id, range_start, range_end)
  order by private.booked_minutes(p.id, (range_start at time zone 'Europe/Berlin')::date), p.id
  limit 1;
$$;

-- Up to max_count free windows between two local days: per day the earliest morning start and the earliest
-- afternoon start (30-minute grid from the start of the working hours), earliest day first
create function private.free_windows(from_day date, to_day date, minutes integer, max_count integer default 3)
returns table (technician_id uuid, starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  day date;
  half text;
  candidate timestamp;
  found_count integer := 0;
  tech uuid;
  s timestamptz;
begin
  day := from_day;
  while day <= to_day and found_count < max_count loop
    if extract(isodow from day) <= 5 then
      foreach half in array array['vormittag', 'nachmittag'] loop
        exit when found_count >= max_count;
        for candidate in
          select distinct g.t
          from public.employee_availability a
          join public.profiles p on p.id = a.employee_id and p.role = 'technician' and p.is_active
          cross join lateral generate_series(day + a.local_start, day + a.local_end - make_interval(mins => minutes), interval '30 minutes') g(t)
          where a.kind = 'working_hours' and a.weekday = extract(isodow from day)
            and (a.valid_from is null or a.valid_from <= day) and (a.valid_to is null or a.valid_to >= day)
            and case when half = 'vormittag' then g.t::time < time '12:00' else g.t::time >= time '12:00' end
          order by 1
        loop
          s := candidate at time zone 'Europe/Berlin';
          continue when s < now() + interval '1 hour';
          tech := private.technician_for_window(s, s + make_interval(mins => minutes));
          if tech is not null then
            technician_id := tech; starts_at := s; ends_at := s + make_interval(mins => minutes);
            found_count := found_count + 1;
            return next;
            exit;
          end if;
        end loop;
      end loop;
    end if;
    day := day + 1;
  end loop;
end;
$$;

-- For the agent: free windows from a day (default: next business day), at most six weeks ahead
create function public.agent_free_slots(call_id text, von_tag date default null, bis_tag date default null, leistung text default 'diagnosis_repair', plz text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/Berlin')::date;
  first_day date := (private.add_business_days(now(), 1) at time zone 'Europe/Berlin')::date;
  from_day date;
  to_day date;
  minutes integer;
begin
  perform private.require_integration();
  perform private.call_for(agent_free_slots.call_id);
  if coalesce(leistung, '') not in ('inspection', 'scheduled_maintenance', 'diagnosis_repair') then
    return jsonb_build_object('ok', false, 'fehler', 'leistung_ungueltig');
  end if;
  minutes := private.hold_minutes(leistung::public.service_kind);
  from_day := greatest(coalesce(von_tag, first_day), first_day);
  to_day := least(coalesce(bis_tag, from_day + 7), today + 42);
  if from_day > today + 42 then
    return jsonb_build_object('ok', true, 'fenster', '[]'::jsonb, 'hinweis', 'zu_weit_in_der_zukunft');
  end if;
  return jsonb_build_object('ok', true, 'fenster', coalesce((
    select jsonb_agg(jsonb_build_object('beginn', w.starts_at, 'ende', w.ends_at, 'dauer_minuten', minutes,
      'ansage', private.spoken_datetime(w.starts_at)) order by w.starts_at)
    from private.free_windows(from_day, to_day, minutes) w), '[]'::jsonb),
    'ab_tag', from_day, 'bis_tag', to_day);
end;
$$;

-- Hold a window for a request; null when it is no longer free
create function private.create_hold(req public.requests, window_start timestamptz, conversation text)
returns public.visit_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  minutes integer := private.hold_minutes(req.service_kind);
  window_end timestamptz := window_start + make_interval(mins => private.hold_minutes(req.service_kind));
  tech uuid;
  hold public.visit_holds;
begin
  perform pg_advisory_xact_lock(hashtextextended('rheinwerk-visit-holds', 0));
  if window_start < now() + interval '1 hour' or window_start > now() + interval '43 days' then
    return null;
  end if;
  tech := private.technician_for_window(window_start, window_end);
  if tech is null then
    return null;
  end if;
  insert into public.visit_holds (request_id, technician_id, starts_at, ends_at, expires_at, conversation_id)
  values (req.id, tech, window_start, window_end, least(private.add_business_days(now(), 2), window_start), conversation)
  returning * into hold;
  insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, 'automation', 'visit_hold_created', 'dispatch', tstzrange(window_start, window_end, '[)')::text,
    jsonb_build_object('hold_id', hold.id, 'technician_id', tech, 'starts_at', window_start, 'ends_at', window_end, 'expires_at', hold.expires_at, 'minutes', minutes));
  return hold;
end;
$$;

-- agent_create_request with the chosen window (termin_beginn); the request is created even if the window is gone
drop function public.agent_create_request(text, jsonb);
create function public.agent_create_request(call_id text, fields jsonb, termin_beginn timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  req public.requests;
  hold public.visit_holds;
  k text;
  problems text[];
  dispatcher uuid;
  f jsonb := fields;
begin
  perform private.require_integration();
  c := private.call_for(agent_create_request.call_id);
  k := 'phone_agent:' || c.conversation_id;
  perform pg_advisory_xact_lock(hashtextextended(k, 0));

  select * into req from public.requests r where r.source_event_key = k;
  if found then
    select * into hold from public.visit_holds h where h.request_id = req.id and h.status = 'open';
    return jsonb_build_object('ok', true, 'wiederholt', true, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number,
      'termin_vorgemerkt', hold.id is not null, 'termin_ansage', private.spoken_datetime(hold.starts_at));
  end if;

  if jsonb_typeof(f) = 'object' and nullif(f ->> 'requested_visit_date', '') is null then
    f := f || jsonb_build_object('requested_visit_date', to_char(coalesce(termin_beginn at time zone 'Europe/Berlin', (now() at time zone 'Europe/Berlin') + interval '7 days')::date, 'YYYY-MM-DD'));
  end if;
  problems := private.request_field_problems(f);
  if problems is not null then
    return jsonb_build_object('ok', false, 'fehler', 'fehlende_felder', 'fehlende_felder', to_jsonb(problems));
  end if;
  perform private.validate_request_fields(f);

  perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment', 0));
  dispatcher := private.least_loaded_dispatcher();
  if dispatcher is null then
    raise exception 'Kein aktiver Dispatcher' using errcode = 'RW422';
  end if;

  insert into public.requests (
    source_event_key, source, company_name, contact_name, business_email, phone_number, customer_number,
    street_house_number, postal_code, city, site_label, equipment_kind, manufacturer, model_type, service_kind,
    requested_visit_date, description, customer_urgency, safety_risk, sla_contract_number, raw_payload, dispatcher_id, human_review_required)
  values (
    k, 'phone_agent', btrim(f ->> 'company_name'), btrim(f ->> 'contact_name'), btrim(f ->> 'business_email'),
    btrim(f ->> 'phone_number'), nullif(btrim(f ->> 'customer_number'), ''),
    btrim(f ->> 'street_house_number'), btrim(f ->> 'postal_code'), btrim(f ->> 'city'), nullif(btrim(f ->> 'site_label'), ''),
    (f ->> 'equipment_kind')::public.equipment_kind, nullif(btrim(f ->> 'manufacturer'), ''), nullif(btrim(f ->> 'model_type'), ''),
    (f ->> 'service_kind')::public.service_kind, (f ->> 'requested_visit_date')::date, btrim(f ->> 'description'),
    (f ->> 'customer_urgency')::public.customer_urgency, (f ->> 'safety_risk')::public.safety_risk,
    nullif(btrim(f ->> 'sla_contract_number'), ''),
    jsonb_build_object('channel', 'phone_agent', 'conversation_id', c.conversation_id, 'termin_beginn', termin_beginn),
    dispatcher,
    f ->> 'customer_urgency' = 'production_stop' or f ->> 'safety_risk' in ('known', 'unclear'))
  returning * into req;

  insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, 'automation', 'request_created_by_agent', 'dispatch', dispatcher::text,
    jsonb_build_object('conversation_id', c.conversation_id, 'dispatcher_id', dispatcher));
  perform private.queue_receipt(req);
  update public.phone_calls p set request_id = req.id where p.id = c.id;

  -- Emergencies get no hold: they go to people straight away
  if termin_beginn is not null and not req.human_review_required then
    hold := private.create_hold(req, termin_beginn, c.conversation_id);
  end if;
  return jsonb_build_object('ok', true, 'wiederholt', false, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number,
    'termin_vorgemerkt', hold.id is not null, 'termin_ansage', private.spoken_datetime(hold.starts_at),
    'termin_hinweis', case when termin_beginn is null then null when req.human_review_required then 'notfall_ohne_vormerkung'
      when hold.id is null then 'fenster_nicht_mehr_frei' end);
exception when invalid_text_representation or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'fehler', 'ungueltige_angaben');
end;
$$;

-- Situation with "vorgemerkt" (open hold) after a planned visit
create or replace function private.request_situation(req public.requests, at_time timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  next_visit public.visits;
  hold public.visit_holds;
  situation text;
begin
  select * into next_visit from public.visits v
  where v.request_id = req.id and v.status = 'scheduled'
    and v.scheduled_end + interval '2 hours' > at_time
  order by v.scheduled_start limit 1;
  select * into hold from public.visit_holds h where h.request_id = req.id and h.status = 'open';

  situation := case
    when req.intake_status = 'cancelled' or req.work_status = 'cancelled' then 'storniert'
    when req.intake_status = 'rejected' then 'abgelehnt'
    when req.work_status = 'completed' then 'abgeschlossen'
    when exists (select 1 from public.visits v where v.request_id = req.id and v.status = 'in_progress') then 'vor_ort'
    when req.work_status = 'waiting_parts' or exists (select 1 from public.visits v where v.request_id = req.id and v.status = 'waiting_parts') then 'wartet_auf_teile'
    when next_visit.id is not null and next_visit.scheduled_start <= at_time then 'ueberfaellig'
    when next_visit.id is not null then 'geplant'
    when hold.id is not null then 'vorgemerkt'
    when req.intake_status = 'awaiting_customer' then 'wartet_auf_kunde'
    else 'in_pruefung'
  end;
  return jsonb_build_object('lage', situation)
    || case when situation in ('ueberfaellig', 'geplant') then jsonb_build_object(
         'einsatz_id', next_visit.id, 'termin_beginn', next_visit.scheduled_start,
         'termin_ansage', private.spoken_datetime(next_visit.scheduled_start))
       when situation = 'vorgemerkt' then jsonb_build_object('termin_beginn', hold.starts_at, 'termin_ansage', private.spoken_datetime(hold.starts_at))
       else '{}'::jsonb end;
end;
$$;

-- E-mail to the customer about a hold decision; approved by the deciding person
create function private.queue_hold_mail(req public.requests, subject text, body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
begin
  if nullif(btrim(req.business_email), '') is null then return; end if;
  insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, author_id, approved_by, approved_at)
  values (req.id, 'outgoing', 'other', 'queued', req.business_email, subject, body, (select auth.uid()), (select auth.uid()), now())
  returning * into msg;
  insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, to_value, data)
  values (req.id, 'user', (select auth.uid()), 'message_queued', 'dispatch', 'queued', jsonb_build_object('message_id', msg.id, 'kind', msg.kind));
end;
$$;

-- Dispatcher confirms: plan the visit in the held window (schedule_visit with all its checks) and tell the customer
create function public.confirm_visit_hold(hold_id uuid, expected_version integer)
returns public.visits
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold public.visit_holds;
  req public.requests;
  result public.visits;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into hold from public.visit_holds h where h.id = confirm_visit_hold.hold_id for update;
  if not found or not private.can_access_request(hold.request_id) then
    raise exception 'Terminvormerkung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if hold.status <> 'open' or hold.expires_at <= now() then
    raise exception 'Die Vormerkung ist nicht mehr offen' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = hold.request_id;
  if req.intake_status <> 'processed' then
    raise exception 'Bitte zuerst die Erstbearbeitung abschließen, dann den Termin bestätigen' using errcode = 'RW422';
  end if;

  -- Holds do not block schedule_visit, so the visit can take the held window directly
  result := public.schedule_visit(hold.request_id, confirm_visit_hold.expected_version, hold.technician_id, hold.starts_at, hold.ends_at);
  update public.visit_holds h set status = 'confirmed', decided_by = (select auth.uid()), decided_at = now(), visit_id = result.id where h.id = hold.id;

  select * into req from public.requests r where r.id = hold.request_id;
  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, visibility, data)
  values (req.id, result.id, 'user', (select auth.uid()), 'visit_hold_confirmed', 'dispatch', jsonb_build_object('hold_id', hold.id));
  perform private.queue_hold_mail(req,
    'Terminbestätigung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir bestätigen Ihren Termin für die Anfrage ' || req.request_number || ':', '',
      private.spoken_datetime(hold.starts_at) || ', Dauer etwa ' || (extract(epoch from hold.ends_at - hold.starts_at) / 3600)::numeric(4,1)::text || ' Stunden,',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Sollte der Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  return result;
end;
$$;

-- Dispatcher rejects: reason required, optional alternative for the customer
create function public.reject_visit_hold(hold_id uuid, reason text, alternative text default null)
returns public.visit_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  hold public.visit_holds;
  req public.requests;
  result public.visit_holds;
  why text := private.require_reason(reject_visit_hold.reason);
  other text := nullif(btrim(coalesce(reject_visit_hold.alternative, '')), '');
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into hold from public.visit_holds h where h.id = reject_visit_hold.hold_id for update;
  if not found or not private.can_access_request(hold.request_id) then
    raise exception 'Terminvormerkung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if hold.status <> 'open' then
    raise exception 'Die Vormerkung ist nicht mehr offen' using errcode = 'RW422';
  end if;
  update public.visit_holds h set status = 'rejected', decided_by = (select auth.uid()), decided_at = now(), reject_reason = why, alternative = other
  where h.id = hold.id returning * into result;
  select * into req from public.requests r where r.id = hold.request_id;
  insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, note, data)
  values (req.id, 'user', (select auth.uid()), 'visit_hold_rejected', 'dispatch', why, jsonb_build_object('hold_id', hold.id, 'alternative', other));
  perform private.queue_hold_mail(req,
    'Ihr Terminwunsch ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'den vorgemerkten Termin ' || private.spoken_datetime(hold.starts_at) || ' können wir leider nicht bestätigen.',
      'Grund: ' || why || '.',
      case when other is not null then E'\nUnser Vorschlag: ' || other end, '',
      'Wir melden uns, um einen passenden Termin zu vereinbaren. Sie können auch auf diese E-Mail antworten.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  return result;
end;
$$;

-- Unanswered holds expire (hourly); the request stays in the intake with an event
create function public.expire_visit_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  hold public.visit_holds;
begin
  for hold in update public.visit_holds h set status = 'expired' where h.status = 'open' and h.expires_at <= now() returning * loop
    insert into public.request_events (request_id, actor_type, event_type, visibility, data)
    values (hold.request_id, 'system', 'visit_hold_expired', 'dispatch', jsonb_build_object('hold_id', hold.id, 'starts_at', hold.starts_at));
    n := n + 1;
  end loop;
  return n;
end;
$$;
select cron.schedule('visit-holds-expire', '5 * * * *', 'select public.expire_visit_holds()');

revoke all on function private.hold_minutes(public.service_kind), private.add_business_days(timestamptz, integer),
  private.window_free(uuid, timestamptz, timestamptz), private.booked_minutes(uuid, date), private.technician_for_window(timestamptz, timestamptz),
  private.free_windows(date, date, integer, integer), private.create_hold(public.requests, timestamptz, text),
  private.queue_hold_mail(public.requests, text, text) from public, anon, authenticated;
revoke all on function public.agent_free_slots(text, date, date, text, text), public.agent_create_request(text, jsonb, timestamptz),
  public.expire_visit_holds() from public, anon, authenticated;
grant execute on function public.agent_free_slots(text, date, date, text, text), public.agent_create_request(text, jsonb, timestamptz),
  public.expire_visit_holds() to service_role;
revoke all on function public.confirm_visit_hold(uuid, integer), public.reject_visit_hold(uuid, text, text) from public, anon;
grant execute on function public.confirm_visit_hold(uuid, integer), public.reject_visit_hold(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
