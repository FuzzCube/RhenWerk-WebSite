-- task-13-5: e-mail address from the spelling of the caller, assembled deterministically by the database instead of
-- the language model. The checked address is kept per call; agent_create_request uses it in place of the address the
-- model passes, so the address read back to the caller is exactly the one that is stored.

alter table public.phone_calls add column checked_email text;
comment on column public.phone_calls.checked_email is 'E-Mail-Adresse aus agent_check_email (buchstabiert, vom Anrufer bestätigt); wird mit dem Transkript gelöscht.';

-- "A, N, D, R wie Richard, Punkt, S, @gmail.com" → "andr.s@gmail.com"; null if no valid address results
create function private.email_from_spelling(spelled text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  s text := lower(coalesce(spelled, ''));
  t text;
  result text := '';
  twice boolean := false;
begin
  s := regexp_replace(s, '[\s.,;:!?]+$', '');
  -- Spelling alphabet: only the letter counts
  s := regexp_replace(s, '\m([a-z0-9äöü])[\s,]+wie[\s,]+[^\s,;]+', '\1', 'g');
  s := regexp_replace(s, '\m(doppel|doppelt)-', '\1 ', 'g');
  s := replace(replace(replace(replace(s, '@', ' @ '), '.', ' . '), '_', ' _ '), '-', ' - ');
  foreach t in array regexp_split_to_array(btrim(s), '[\s,;:]+') loop
    continue when t in ('', 'äh', 'ähm', 'hm', 'und', 'dann', 'groß', 'gross', 'klein', 'buchstabe');
    if t in ('doppel', 'doppelt', 'zweimal') then
      twice := true;
      continue;
    end if;
    t := case
      when t in ('punkt', 'dot', '.') then '.'
      when t in ('at', 'ät', 'ett', 'klammeraffe', '@') then '@'
      when t in ('bindestrich', 'minus', 'strich', '-') then '-'
      when t in ('unterstrich', '_') then '_'
      when t = 'ypsilon' then 'y'
      when t = 'null' then '0' when t = 'eins' then '1' when t = 'zwei' then '2' when t = 'drei' then '3'
      when t = 'vier' then '4' when t in ('fünf', 'fuenf') then '5' when t = 'sechs' then '6' when t = 'sieben' then '7'
      when t = 'acht' then '8' when t = 'neun' then '9'
      else t end;
    result := result || case when twice then t || t else t end;
    twice := false;
  end loop;
  if result !~ '^[a-z0-9]([a-z0-9._%+-]*[a-z0-9_-])?@[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$'
     or result ~ '\.\.' then
    return null;
  end if;
  return result;
end;
$$;

-- How Mira reads an address back: local part letter by letter, common providers and endings as words, other domains spelled
create function private.spoken_email(email text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  ch text;
  label text;
  letters text[];
  local_part text[] := '{}';
  domain_part text[] := '{}';
begin
  foreach ch in array regexp_split_to_array(split_part(email, '@', 1), '') loop
    local_part := local_part || case ch when '.' then 'Punkt' when '-' then 'Bindestrich' when '_' then 'Unterstrich' else upper(ch) end;
  end loop;
  foreach label in array string_to_array(split_part(email, '@', 2), '.') loop
    if label in ('gmail', 'googlemail', 'web', 'gmx', 'outlook', 'hotmail', 'yahoo', 'icloud', 't-online', 'freenet', 'mail',
                 'com', 'de', 'net', 'org', 'eu', 'info', 'biz') then
      domain_part := domain_part || label;
    else
      letters := '{}';
      foreach ch in array regexp_split_to_array(label, '') loop
        letters := letters || case ch when '-' then 'Bindestrich' else upper(ch) end;
      end loop;
      domain_part := domain_part || array_to_string(letters, ', ');
    end if;
  end loop;
  return array_to_string(local_part, ', ') || ', at ' || array_to_string(domain_part, ' Punkt ');
end;
$$;

-- Tool email_pruefen: assembles the spelled address, keeps it for the call, answers what Mira reads back
create function public.agent_check_email(call_id text, buchstaben text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  address text := private.email_from_spelling(buchstaben);
begin
  perform private.require_integration();
  c := private.call_for(agent_check_email.call_id);
  if address is null then
    return jsonb_build_object('ok', false, 'fehler', 'email_ungueltig');
  end if;
  update public.phone_calls p set checked_email = address where p.id = c.id;
  return jsonb_build_object('ok', true, 'email', address, 'ansage', private.spoken_email(address));
end;
$$;

-- agent_create_request: the checked address of the call replaces the address passed by the model
create or replace function public.agent_create_request(call_id text, fields jsonb, termin_beginn timestamptz default null)
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

  if jsonb_typeof(f) = 'object' and c.checked_email is not null then
    f := f || jsonb_build_object('business_email', c.checked_email);
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
    jsonb_build_object('channel', 'phone_agent', 'conversation_id', c.conversation_id, 'termin_beginn', termin_beginn,
      'email_buchstabiert', c.checked_email is not null),
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

-- The checked address is personal data of the call: deleted together with the transcript
create or replace function public.purge_call_transcripts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.phone_calls p set transcript = null, checked_email = null,
    transcript_deleted_at = case when p.transcript is not null then now() else p.transcript_deleted_at end
  where (p.transcript is not null or p.checked_email is not null) and coalesce(p.ended_at, p.started_at) < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function private.email_from_spelling(text), private.spoken_email(text) from public, anon, authenticated;
revoke all on function public.agent_check_email(text, text) from public, anon, authenticated;
grant execute on function public.agent_check_email(text, text) to service_role;
notify pgrst, 'reload schema';
