-- task-13-6: evaluation after the call. n8n fetches finished conversations from ElevenLabs every 2 minutes, lets OpenAI
-- fill a fixed schema and stores the result with agent_record_call (once per conversation). Facts the database already
-- knows (request, held window, callback, service hours) come from here, not from the language model. Urgent calls
-- (emergency, danger, production stop or an urgent callback) are shown to dispatchers until someone called back. The
-- evaluation only raises a call to urgent while it is recent (12 hours); older calls (first run, n8n was off) are kept
-- as normal callbacks, an urgent callback asked for by the assistant during the call stays urgent.

alter table public.phone_calls
  add column analyzed_at timestamptz,
  add column credits integer check (credits is null or credits >= 0);
comment on column public.phone_calls.analyzed_at is 'Zeitpunkt der Gesprächsauswertung (task-13-6); gesetzt = nicht erneut auswerten.';
comment on column public.phone_calls.credits is 'Verbrauch der Sprachplattform in ElevenLabs-Credits.';
create index phone_calls_urgent_idx on public.phone_calls (started_at) where callback_needed and callback_urgent and callback_done_at is null;

-- Conversations of a page from the platform that still need an evaluation
create function public.agent_calls_pending(conversation_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  return jsonb_build_object('ids', (select coalesce(jsonb_agg(x.cid order by x.cid), '[]'::jsonb)
    from unnest(coalesce(agent_calls_pending.conversation_ids, '{}')) as x(cid)
    where not exists (select 1 from public.phone_calls p where p.conversation_id = x.cid and p.analyzed_at is not null)));
end;
$$;

-- Stores the evaluation of one finished conversation. analysis: kategorie, dringlichkeit, sicherheitsgefahr, firma,
-- kontakt, rueckrufnummer, anfrage_nummer, zusammenfassung, rueckruf_noetig, stimmung (schema docs/telefonassistent-plan.md).
-- A repetition changes nothing (wiederholt).
create function public.agent_record_call(call_id text, started_at timestamptz, duration_seconds integer, transcript text,
  analysis jsonb, credits integer default null, cost_cents integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  a jsonb := coalesce(analysis, '{}'::jsonb);
  kategorie text := a ->> 'kategorie';
  call_urgency public.customer_urgency;
  risk public.safety_risk;
  req public.requests;
  hold_open boolean := false;
  urgent boolean;
  callback_wanted boolean;
  facts jsonb;
  number_value text;
begin
  perform private.require_integration();
  c := private.call_for(agent_record_call.call_id);
  if c.analyzed_at is not null then
    return jsonb_build_object('ok', true, 'wiederholt', true, 'dringend', c.callback_urgent and c.callback_done_at is null);
  end if;

  if kategorie is null or kategorie not in ('neue_anfrage', 'termin', 'status', 'verspaetung', 'frage', 'notfall', 'beschwerde', 'ausserhalb_gebiet', 'spam', 'sonstiges') then
    kategorie := 'sonstiges';
  end if;
  call_urgency := case when a ->> 'dringlichkeit' in ('planbar', 'zeitnah', 'erheblich', 'production_stop') then (a ->> 'dringlichkeit')::public.customer_urgency end;
  risk := case when a ->> 'sicherheitsgefahr' in ('none_known', 'known', 'unclear') then (a ->> 'sicherheitsgefahr')::public.safety_risk end;

  -- Request: the one the tools linked, otherwise a request number named in the call
  if c.request_id is not null then
    select * into req from public.requests r where r.id = c.request_id;
  elsif nullif(a ->> 'anfrage_nummer', '') is not null then
    select * into req from public.requests r
    where r.request_number = regexp_replace(upper(a ->> 'anfrage_nummer'), '^RIS\s*-?\s*(\d{4})\s*-?\s*(\d+)$', 'RIS-\1-\2');
  end if;
  if req.id is not null then
    hold_open := exists (select 1 from public.visit_holds h where h.request_id = req.id and h.status = 'open');
  end if;

  urgent := c.callback_urgent or ((kategorie = 'notfall' or risk in ('known', 'unclear') or call_urgency = 'production_stop')
    and coalesce(agent_record_call.started_at, c.started_at) > now() - interval '12 hours');
  callback_wanted := c.callback_needed or urgent or kategorie = 'notfall' or coalesce((a ->> 'rueckruf_noetig')::boolean, false);
  -- Placeholders like "unbekannt 000000" (prompt rule for emergencies without a number) are no callback number
  number_value := coalesce(
    case when regexp_replace(coalesce(c.callback_number, ''), '[^1-9]', '', 'g') <> '' then c.callback_number end,
    case when regexp_replace(coalesce(a ->> 'rueckrufnummer', ''), '[^1-9]', '', 'g') <> '' then btrim(a ->> 'rueckrufnummer') end,
    c.caller_number);
  facts := jsonb_build_object(
    'anfrage_nummer', req.request_number,
    'termin_vorgemerkt', hold_open,
    'ausserhalb_servicezeit', c.in_service_hours is not null and not c.in_service_hours,
    'rueckruf_ueber_werkzeug', c.callback_needed,
    'kunde_erkannt', c.customer_id is not null);

  update public.phone_calls p set
    started_at = coalesce(agent_record_call.started_at, p.started_at),
    ended_at = coalesce(agent_record_call.started_at, p.started_at) + make_interval(secs => greatest(coalesce(agent_record_call.duration_seconds, 0), 0)),
    duration_seconds = greatest(coalesce(agent_record_call.duration_seconds, 0), 0),
    category = kategorie,
    urgency = call_urgency,
    safety_risk = risk,
    summary = left(nullif(btrim(a ->> 'zusammenfassung'), ''), 1000),
    transcript = case when p.transcript_deleted_at is null then nullif(agent_record_call.transcript, '') end,
    sentiment = case when a ->> 'stimmung' in ('positiv', 'neutral', 'negativ') then a ->> 'stimmung' end,
    request_id = coalesce(p.request_id, req.id),
    callback_needed = callback_wanted,
    callback_urgent = p.callback_urgent or urgent,
    callback_reason = coalesce(p.callback_reason, case when callback_wanted then left(coalesce(nullif(btrim(a ->> 'zusammenfassung'), ''), 'Rückruf gewünscht'), 500) end),
    callback_number = case when callback_wanted then number_value else p.callback_number end,
    credits = agent_record_call.credits,
    cost_cents = agent_record_call.cost_cents,
    analysis = a || facts,
    analyzed_at = now()
  where p.id = c.id
  returning * into c;
  return jsonb_build_object('ok', true, 'wiederholt', false, 'dringend', c.callback_urgent and c.callback_done_at is null,
    'anfrage_nummer', req.request_number);
end;
$$;

-- "Rückruf erledigt" in the dashboard banner (dispatcher, manager, admin); a repetition keeps the first acknowledgement
create function public.acknowledge_call_callback(call_id uuid)
returns public.phone_calls
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_role('dispatcher', 'manager', 'admin');
  result public.phone_calls;
begin
  update public.phone_calls p set callback_done_at = now(), callback_done_by = me
  where p.id = acknowledge_call_callback.call_id and p.callback_needed and p.callback_done_at is null
  returning * into result;
  if result.id is null then
    select * into result from public.phone_calls p where p.id = acknowledge_call_callback.call_id;
    if not found then
      raise exception 'Anruf nicht gefunden' using errcode = 'RW422';
    end if;
  end if;
  return result;
end;
$$;

revoke all on function public.agent_calls_pending(text[]), public.agent_record_call(text, timestamptz, integer, text, jsonb, integer, integer),
  public.acknowledge_call_callback(uuid) from public, anon, authenticated;
grant execute on function public.agent_calls_pending(text[]), public.agent_record_call(text, timestamptz, integer, text, jsonb, integer, integer) to service_role;
grant execute on function public.acknowledge_call_callback(uuid) to authenticated;
notify pgrst, 'reload schema';
