-- task-13-2: data for the phone assistant "Mira". Every call is a row in phone_calls (conversation id of the voice
-- platform); the agent works only through service_role functions called by n8n webhooks: create a request from the
-- call (idempotent per call), find a request with the answer rules of docs/telefonassistent/regeln.md, check the
-- service area. Transcripts are deleted after 30 days; the summary stays. Staff read calls; nobody writes directly.

alter table public.requests drop constraint requests_source_check;
alter table public.requests add constraint requests_source_check
  check (source in ('website_form', 'demo_seed', 'email', 'phone', 'phone_agent'));

create table public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null unique,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  caller_number text,
  in_service_hours boolean,
  category text check (category in ('neue_anfrage', 'termin', 'status', 'verspaetung', 'frage', 'notfall', 'beschwerde', 'ausserhalb_gebiet', 'spam', 'sonstiges')),
  urgency public.customer_urgency,
  safety_risk public.safety_risk,
  summary text,
  transcript text,
  transcript_deleted_at timestamptz,
  callback_needed boolean not null default false,
  callback_done_at timestamptz,
  callback_done_by uuid references public.profiles (id) on delete restrict,
  forwarded boolean not null default false,
  sentiment text check (sentiment in ('positiv', 'neutral', 'negativ')),
  request_id uuid references public.requests (id) on delete set null,
  cost_cents integer check (cost_cents >= 0),
  analysis jsonb,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_calls_conversation_id check (nullif(btrim(conversation_id), '') is not null),
  constraint phone_calls_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint phone_calls_callback_pair check ((callback_done_at is null) = (callback_done_by is null)),
  constraint phone_calls_transcript_deleted check (transcript_deleted_at is null or transcript is null)
);
create index phone_calls_started_idx on public.phone_calls (started_at desc);
create index phone_calls_request_idx on public.phone_calls (request_id) where request_id is not null;
create index phone_calls_callback_idx on public.phone_calls (started_at) where callback_needed and callback_done_at is null;

create trigger phone_calls_set_updated_at
  before update on public.phone_calls
  for each row execute function public.set_updated_at();

alter table public.phone_calls enable row level security;
create policy phone_calls_staff_read on public.phone_calls for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin'));
revoke insert, update, delete on public.phone_calls from anon, authenticated;

-- Service area (docs/telefonassistent/einsatzgebiet.json): postal code ranges inside the area
create table private.service_area (
  postal_from text not null check (postal_from ~ '^[0-9]{5}$'),
  postal_to text not null check (postal_to ~ '^[0-9]{5}$' and postal_to >= postal_from),
  place text not null,
  primary key (postal_from, postal_to)
);
insert into private.service_area (postal_from, postal_to, place) values
  ('68159', '68309', 'Mannheim'),
  ('67059', '67071', 'Ludwigshafen am Rhein'),
  ('69115', '69126', 'Heidelberg'),
  ('67346', '67346', 'Speyer'),
  ('67547', '67551', 'Worms'),
  ('69469', '69469', 'Weinheim'),
  ('68723', '68723', 'Schwetzingen, Plankstadt'),
  ('68766', '68766', 'Hockenheim'),
  ('68519', '68519', 'Viernheim'),
  ('68526', '68526', 'Ladenburg'),
  ('68535', '68535', 'Edingen-Neckarhausen'),
  ('68542', '68542', 'Heddesheim'),
  ('68549', '68549', 'Ilvesheim'),
  ('68623', '68623', 'Lampertheim'),
  ('68775', '68775', 'Ketsch'),
  ('68782', '68782', 'Brühl'),
  ('68789', '68789', 'St. Leon-Rot'),
  ('68799', '68799', 'Reilingen'),
  ('68804', '68804', 'Altlußheim'),
  ('69168', '69168', 'Wiesloch'),
  ('69181', '69181', 'Leimen'),
  ('69190', '69190', 'Walldorf'),
  ('69198', '69198', 'Schriesheim'),
  ('69214', '69214', 'Eppelheim'),
  ('69221', '69221', 'Dossenheim'),
  ('69493', '69493', 'Hirschberg an der Bergstraße'),
  ('69502', '69502', 'Hemsbach'),
  ('67105', '67105', 'Schifferstadt'),
  ('67117', '67117', 'Limburgerhof'),
  ('67122', '67122', 'Altrip'),
  ('67227', '67227', 'Frankenthal (Pfalz)');
revoke all on private.service_area from public, anon, authenticated;

-- The call row of a conversation, created on the first tool call
create function private.call_for(conversation text)
returns public.phone_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  k text := nullif(btrim(coalesce(conversation, '')), '');
begin
  if k is null then
    raise exception 'call_id fehlt' using errcode = 'RW422';
  end if;
  insert into public.phone_calls (conversation_id) values (k) on conflict (conversation_id) do nothing;
  select * into c from public.phone_calls p where p.conversation_id = k;
  return c;
end;
$$;

-- "Mittwoch, der 21. Oktober, um 13 Uhr" (Europe/Berlin), as the agent says it
create function private.spoken_datetime(ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  with t as (select ts at time zone 'Europe/Berlin' as l)
  select (array['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'])[extract(isodow from l)::int]
    || ', der ' || extract(day from l)::int || '. '
    || (array['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'])[extract(month from l)::int]
    || ', um ' || extract(hour from l)::int || case when extract(minute from l) = 0 then '' else ':' || to_char(l, 'MI') end || ' Uhr'
  from t;
$$;

-- Missing or invalid fields of a request from the agent (same rules as private.validate_request_fields), so the
-- agent can ask for them instead of failing
create function private.request_field_problems(fields jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text;
  problems text[] := '{}';
begin
  if jsonb_typeof(fields) is distinct from 'object' then
    return array['felder'];
  end if;
  foreach f in array array['company_name', 'contact_name', 'business_email', 'phone_number', 'street_house_number', 'postal_code', 'city', 'description'] loop
    if nullif(btrim(fields ->> f), '') is null then problems := problems || f; end if;
  end loop;
  if coalesce(fields ->> 'equipment_kind', '') not in ('pump', 'compressor', 'ventilation', 'other') then problems := problems || 'equipment_kind'::text; end if;
  if coalesce(fields ->> 'service_kind', '') not in ('inspection', 'scheduled_maintenance', 'diagnosis_repair') then problems := problems || 'service_kind'::text; end if;
  if coalesce(fields ->> 'customer_urgency', '') not in ('planbar', 'zeitnah', 'erheblich', 'production_stop') then problems := problems || 'customer_urgency'::text; end if;
  if coalesce(fields ->> 'safety_risk', '') not in ('none_known', 'known', 'unclear') then problems := problems || 'safety_risk'::text; end if;
  if nullif(btrim(fields ->> 'business_email'), '') is not null and btrim(fields ->> 'business_email') !~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$' then problems := problems || 'business_email'::text; end if;
  if nullif(btrim(fields ->> 'postal_code'), '') is not null and btrim(fields ->> 'postal_code') !~ '^\d{5}$' then problems := problems || 'postal_code'::text; end if;
  if nullif(btrim(fields ->> 'description'), '') is not null and length(btrim(fields ->> 'description')) < 10 then problems := problems || 'description'::text; end if;
  if nullif(fields ->> 'requested_visit_date', '') is not null and (fields ->> 'requested_visit_date') !~ '^\d{4}-\d{2}-\d{2}$' then problems := problems || 'requested_visit_date'::text; end if;
  return (select array_agg(distinct p) from unnest(problems) p);
end;
$$;

-- New request from a call. Same key per call: a repeated tool call returns the same request. Without a desired date
-- the request gets today + 7 days (as the inbox form). The receipt goes to the given e-mail.
create function public.agent_create_request(call_id text, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  req public.requests;
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
    return jsonb_build_object('ok', true, 'wiederholt', true, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number);
  end if;

  if jsonb_typeof(f) = 'object' and nullif(f ->> 'requested_visit_date', '') is null then
    f := f || jsonb_build_object('requested_visit_date', to_char((now() at time zone 'Europe/Berlin')::date + 7, 'YYYY-MM-DD'));
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
    jsonb_build_object('channel', 'phone_agent', 'conversation_id', c.conversation_id),
    dispatcher,
    f ->> 'customer_urgency' = 'production_stop' or f ->> 'safety_risk' in ('known', 'unclear'))
  returning * into req;

  insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, 'automation', 'request_created_by_agent', 'dispatch', dispatcher::text,
    jsonb_build_object('conversation_id', c.conversation_id, 'dispatcher_id', dispatcher));
  perform private.queue_receipt(req);
  update public.phone_calls p set request_id = req.id where p.id = c.id;
  return jsonb_build_object('ok', true, 'wiederholt', false, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number);
exception when invalid_text_representation or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'fehler', 'ungueltige_angaben');
end;
$$;

-- "RIS 2026 123", "ris-2026-00123", "2026 00123" → RIS-2026-00123
create function private.spoken_request_number(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when d ~ '^[0-9]{5,9}$' then 'RIS-' || left(d, 4) || '-' || lpad(substr(d, 5), 5, '0') end
  from (select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as d) x;
$$;

-- Situation of a request as the agent may tell it (docs/telefonassistent/regeln.md)
create function private.request_situation(req public.requests, at_time timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  next_visit public.visits;
  situation text;
begin
  select * into next_visit from public.visits v
  where v.request_id = req.id and v.status = 'scheduled'
    and v.scheduled_end + interval '2 hours' > at_time
  order by v.scheduled_start limit 1;

  situation := case
    when req.intake_status = 'cancelled' or req.work_status = 'cancelled' then 'storniert'
    when req.intake_status = 'rejected' then 'abgelehnt'
    when req.work_status = 'completed' then 'abgeschlossen'
    when exists (select 1 from public.visits v where v.request_id = req.id and v.status = 'in_progress') then 'vor_ort'
    when req.work_status = 'waiting_parts' or exists (select 1 from public.visits v where v.request_id = req.id and v.status = 'waiting_parts') then 'wartet_auf_teile'
    when next_visit.id is not null and next_visit.scheduled_start <= at_time then 'ueberfaellig'
    when next_visit.id is not null then 'geplant'
    when req.intake_status = 'awaiting_customer' then 'wartet_auf_kunde'
    else 'in_pruefung'
  end;
  return jsonb_build_object('lage', situation)
    || case when situation in ('ueberfaellig', 'geplant') then jsonb_build_object(
         'einsatz_id', next_visit.id, 'termin_beginn', next_visit.scheduled_start,
         'termin_ansage', private.spoken_datetime(next_visit.scheduled_start)) else '{}'::jsonb end;
end;
$$;

-- Find a request for a caller: number + postal code of the site, or company + postal code (optionally street).
-- One match only; the answer has no names of technicians, notes, prices or contact data.
create function public.agent_find_request(call_id text, nummer text default null, firma text default null, plz text default null, strasse text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  site text := nullif(regexp_replace(coalesce(plz, ''), '[^0-9]', '', 'g'), '');
  number_value text := private.spoken_request_number(nummer);
  company text := private.company_key(firma);
  street text := lower(btrim(coalesce(strasse, '')));
  ids uuid[];
  req public.requests;
begin
  perform private.require_integration();
  c := private.call_for(agent_find_request.call_id);
  if site is null or (number_value is null and length(company) < 4) then
    return jsonb_build_object('ok', true, 'treffer', 0, 'hinweis', 'nummer_oder_firma_und_plz_noetig');
  end if;

  select array_agg(r.id order by r.created_at desc) into ids from public.requests r
  where r.postal_code = site
    and (case when number_value is not null then r.request_number = number_value
         else position(company in private.company_key(r.company_name)) > 0
           and (street = '' or position(street in lower(r.street_house_number)) > 0)
           -- by company only requests still open or finished within 30 days
           and (r.work_status not in ('completed', 'cancelled') and r.intake_status not in ('rejected', 'cancelled')
                or r.updated_at > now() - interval '30 days') end);

  if coalesce(cardinality(ids), 0) <> 1 then
    return jsonb_build_object('ok', true, 'treffer', coalesce(cardinality(ids), 0));
  end if;
  select * into req from public.requests r where r.id = ids[1];
  update public.phone_calls p set request_id = req.id where p.id = c.id;
  return jsonb_build_object('ok', true, 'treffer', 1, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number,
    'standort', (case req.equipment_kind when 'pump' then 'Pumpe' when 'compressor' then 'Kompressor' when 'ventilation' then 'Lüftungsanlage' else 'Anlage' end)
      || ', ' || req.street_house_number || ', ' || req.city)
    || private.request_situation(req, now());
end;
$$;

create function public.agent_check_area(call_id text, plz text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  code text := btrim(coalesce(plz, ''));
  a private.service_area;
begin
  perform private.require_integration();
  perform private.call_for(agent_check_area.call_id);
  if code !~ '^[0-9]{5}$' then
    return jsonb_build_object('ergebnis', 'ungueltig');
  end if;
  select * into a from private.service_area s where code between s.postal_from and s.postal_to;
  if found then
    return jsonb_build_object('ergebnis', 'in_gebiet', 'ort', a.place);
  end if;
  return jsonb_build_object('ergebnis', 'nur_mit_vertrag');
end;
$$;

-- Transcripts are kept 30 days; summary, category and figures stay
create function public.purge_call_transcripts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.phone_calls p set transcript = null, transcript_deleted_at = now()
  where p.transcript is not null and coalesce(p.ended_at, p.started_at) < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;
select cron.schedule('call-transcripts-30-days', '30 2 * * *', 'select public.purge_call_transcripts()');

revoke all on function private.call_for(text), private.spoken_datetime(timestamptz), private.request_field_problems(jsonb),
  private.spoken_request_number(text), private.request_situation(public.requests, timestamptz) from public, anon, authenticated;
revoke all on function public.agent_create_request(text, jsonb), public.agent_find_request(text, text, text, text, text),
  public.agent_check_area(text, text), public.purge_call_transcripts() from public, anon, authenticated;
grant execute on function public.agent_create_request(text, jsonb), public.agent_find_request(text, text, text, text, text),
  public.agent_check_area(text, text), public.purge_call_transcripts() to service_role;
notify pgrst, 'reload schema';
