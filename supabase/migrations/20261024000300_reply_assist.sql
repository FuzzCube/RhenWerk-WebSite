-- task-22-3 (user request 24.10.2026): reply assistant for customer e-mails after the intake. Workflow 14
-- "RheinWerk · Antwortassistent" lists customer replies nobody answered yet (reply_assist_pending, with the facts of the
-- request), lets OpenAI read the concern, asks for free windows to a wished day (reply_assist_slots), lets OpenAI write a
-- reply and stores it as a DRAFT (save_reply_assist). A person reads, edits and sends it; nothing is sent automatically.
-- If the customer asks where the technician is and the visit is overdue, the technician gets a callback request (same
-- notification and escalation as from the phone assistant, task-13-4).
-- Workflow 13 (visit replies) goes first: mails it answered automatically (cancelled, moved, declined, change wish
-- received) are skipped; question, other and flagged cases get a draft. Every reply is handled once
-- (operation_key reply_assist:<message_id>).

-- Start times on a local day for a window of the given length: of one technician, or of every active technician
create function private.assist_grid(target_technician_id uuid, local_day date, minutes integer)
returns table (starts_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select g.starts_at from private.technician_grid(target_technician_id, local_day, minutes) g where target_technician_id is not null
  union
  select g.starts_at from public.profiles p cross join lateral private.technician_grid(p.id, local_day, minutes) g
  where target_technician_id is null and p.role = 'technician' and p.is_active;
$$;

-- Free for the request: the technician of the coming visit (the visit itself does not block) or any technician
create function private.assist_window_free(v public.visits, range_start timestamptz, range_end timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select range_start >= now() + interval '1 hour' and case when v.id is not null
    then private.window_free_for_move(v.technician_id, range_start, range_end, v.id)
    else private.technician_for_window(range_start, range_end) is not null end;
$$;

-- Workflow 14 asks for the replies to answer, with what the model may use
create function public.reply_assist_pending(batch_limit integer default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(x.item order by x.received_at) from (
      select m.received_at, jsonb_build_object(
        'message_id', m.id,
        'heute', to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'),
        'wochentag', to_char(now() at time zone 'Europe/Berlin', 'FMDay'),
        'uhrzeit', to_char(now() at time zone 'Europe/Berlin', 'HH24:MI'),
        'betreff', m.subject,
        'text', left(coalesce(m.body_text, ''), 4000),
        'anfrage', jsonb_build_object(
          'nummer', q.request_number, 'firma', q.company_name, 'ansprechpartner', q.contact_name,
          'anliegen', left(q.description, 800), 'leistung', q.service_kind, 'anlage', q.equipment_kind,
          'hersteller', q.manufacturer, 'modell', q.model_type, 'adresse', q.street_house_number || ', ' || q.postal_code || ' ' || q.city,
          'erstbearbeitung', q.intake_status, 'arbeit', q.work_status, 'abschlussbericht', left(q.completion_summary, 600)),
        'lage', private.request_situation(q, now()),
        'einsaetze', (select jsonb_agg(jsonb_build_object(
            'status', v.status, 'termin', private.spoken_datetime(v.scheduled_start), 'dauer', private.duration_text(v.scheduled_start, v.scheduled_end),
            'techniker', p.display_name, 'begonnen', private.spoken_datetime(v.actual_start), 'wartegrund', v.waiting_reason)
          order by v.scheduled_start) from public.visits v left join public.profiles p on p.id = v.technician_id where v.request_id = q.id),
        'rechnung', (select jsonb_build_object('nummer', i.invoice_number, 'status', i.status, 'betrag', i.total, 'waehrung', i.currency,
            'faellig', to_char(i.payment_due_date, 'DD.MM.YYYY'), 'bezahlt', to_char(i.paid_at at time zone 'Europe/Berlin', 'DD.MM.YYYY'))
          from public.invoices i where i.request_id = q.id order by i.created_at desc limit 1),
        'offener_verschiebewunsch', exists (select 1 from public.visit_change_requests c where c.request_id = q.id and c.status in ('open', 'offered')),
        'rueckrufbitte_offen', exists (select 1 from public.callback_requests c where c.request_id = q.id and c.status = 'open'),
        'auswertung_termin', (select r.result -> 'intent' from public.automation_runs r where r.operation_key = 'visit_reply:' || m.id),
        'verlauf', (select jsonb_agg(jsonb_build_object('richtung', h.direction, 'betreff', h.subject,
            'datum', to_char(coalesce(h.received_at, h.sent_at, h.created_at) at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
            'text', left(coalesce(h.body_text, ''), 600)) order by h.created_at)
          from (select * from public.messages h0 where h0.request_id = q.id and h0.id <> m.id and h0.created_at < m.created_at
            order by h0.created_at desc limit 4) h)) as item
      from public.messages m
      join public.requests q on q.id = m.request_id and not q.is_demo and q.intake_completed_at is not null
      where m.direction = 'incoming' and m.kind = 'customer_reply' and m.received_at > now() - interval '3 days'
        and not exists (select 1 from public.automation_runs r where r.operation_key = 'reply_assist:' || m.id)
        -- Workflow 13 first when it evaluates this reply; skip what it answered by itself
        and (exists (select 1 from public.automation_runs r where r.operation_key = 'visit_reply:' || m.id)
          or not exists (select 1 from public.visits v where v.request_id = q.id and v.status = 'scheduled' and v.scheduled_start > now() and v.created_at < m.received_at))
        and not exists (select 1 from public.automation_runs r where r.operation_key = 'visit_reply:' || m.id
          and r.result ->> 'action' in ('cancelled', 'moved', 'declined', 'change_requested', 'change_updated'))
        -- A person already answered or started an answer
        and not exists (select 1 from public.messages o where o.request_id = q.id and o.direction = 'outgoing'
          and o.system_template is null and o.created_at > m.received_at)
      order by m.received_at
      limit greatest(1, least(batch_limit, 10))
    ) x), '[]'::jsonb));
end;
$$;

-- Free windows to a wish of the customer: the wished window (free or not) and up to three alternatives in the next two
-- weeks, one per day, nearest to the wished time of day. Without a planned visit for any technician, otherwise for the visit's.
create function public.reply_assist_slots(message_id uuid, wished_day date default null, wished_time text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  m public.messages;
  req public.requests;
  v public.visits;
  today date := (now() at time zone 'Europe/Berlin')::date;
  minutes integer := 120;
  day date;
  wish text := case when reply_assist_slots.wished_time ~ '^(any|morning|afternoon|([01][0-9]|2[0-3]):[0-5][0-9])$' then reply_assist_slots.wished_time else 'any' end;
  target integer;
  s timestamptz;
  wished jsonb := null;
  alts jsonb := '[]'::jsonb;
  rec record;
begin
  perform private.require_integration();
  select * into m from public.messages x where x.id = reply_assist_slots.message_id and x.direction = 'incoming' and x.request_id is not null;
  if not found then
    raise exception 'Nachricht nicht gefunden' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = m.request_id;
  select * into v from public.visits x where x.request_id = req.id and x.status = 'scheduled' and x.scheduled_start > now() order by x.scheduled_start limit 1;
  if v.id is not null then
    minutes := (extract(epoch from v.scheduled_end - v.scheduled_start) / 60)::integer;
  end if;
  day := case when reply_assist_slots.wished_day between today and today + 120 then reply_assist_slots.wished_day else null end;
  target := case when wish ~ '^\d\d:\d\d$' then extract(hour from wish::time)::integer * 60 + extract(minute from wish::time)::integer
    when wish = 'afternoon' then 14 * 60
    when wish = 'any' and v.id is not null then extract(hour from (v.scheduled_start at time zone 'Europe/Berlin'))::integer * 60
      + extract(minute from (v.scheduled_start at time zone 'Europe/Berlin'))::integer
    else 9 * 60 end;

  if day is not null then
    if wish ~ '^\d\d:\d\d$' then
      s := (day + wish::time) at time zone 'Europe/Berlin';
      if not private.assist_window_free(v, s, s + make_interval(mins => minutes)) then s := null; end if;
    else
      s := (select g.starts_at from private.assist_grid(v.technician_id, day, minutes) g
        where case wish when 'morning' then (g.starts_at at time zone 'Europe/Berlin')::time < time '12:00'
                        when 'afternoon' then (g.starts_at at time zone 'Europe/Berlin')::time >= time '12:00' else true end
          and private.assist_window_free(v, g.starts_at, g.starts_at + make_interval(mins => minutes))
        order by abs(extract(hour from (g.starts_at at time zone 'Europe/Berlin'))::integer * 60
          + extract(minute from (g.starts_at at time zone 'Europe/Berlin'))::integer - target), g.starts_at
        limit 1);
    end if;
    wished := jsonb_build_object('tag', to_char(day, 'DD.MM.YYYY'), 'wunsch', wish, 'frei', s is not null, 'termin', private.spoken_datetime(s));
  end if;

  -- At most one alternative per working day (the start nearest to the wished time of day), the wished day first
  for rec in
    select x.starts_at from (
      select distinct on (d.d) d.d, g.starts_at
      from generate_series(coalesce(day, today), coalesce(day, today) + 14, interval '1 day') d(d)
      cross join lateral private.assist_grid(v.technician_id, d.d::date, minutes) g
      where extract(isodow from d.d) <= 5 and g.starts_at is distinct from s
        and private.assist_window_free(v, g.starts_at, g.starts_at + make_interval(mins => minutes))
      order by d.d, abs(extract(hour from (g.starts_at at time zone 'Europe/Berlin'))::integer * 60
        + extract(minute from (g.starts_at at time zone 'Europe/Berlin'))::integer - target), g.starts_at
    ) x
    order by x.d
    limit 3
  loop
    alts := alts || to_jsonb(private.spoken_datetime(rec.starts_at));
  end loop;

  return jsonb_build_object('dauer', private.duration_text(now(), now() + make_interval(mins => minutes)),
    'geplanter_termin', private.spoken_datetime(v.scheduled_start), 'wunschtermin', wished, 'alternativen', alts);
end;
$$;

-- Result of workflow 14: a draft for staff (never queued), optionally a callback request to the technician of an
-- overdue visit. Stored once per reply; a reply someone answered in the meantime gets no draft.
create function public.save_reply_assist(
  message_id uuid,
  intent text,
  summary text,
  reply_needed boolean,
  subject text default null,
  body_text text default null,
  reason text default null,
  callback_technician boolean default false,
  confidence numeric default null,
  workflow_execution_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  m public.messages;
  req public.requests;
  v public.visits;
  draft public.messages;
  callback public.callback_requests;
  situation jsonb;
  note text := left(coalesce(nullif(btrim(save_reply_assist.summary), ''), 'Kundenantwort'), 500);
  clean_intent text := case when save_reply_assist.intent in ('reschedule', 'availability', 'where_is_technician', 'status', 'invoice', 'cancel', 'thanks', 'question', 'other')
    then save_reply_assist.intent else 'other' end;
  answered boolean;
  action text := 'none';
begin
  perform private.require_integration();
  select * into m from public.messages x where x.id = save_reply_assist.message_id and x.direction = 'incoming' and x.request_id is not null for update;
  if not found then
    raise exception 'Nachricht nicht gefunden' using errcode = 'RW422';
  end if;
  if exists (select 1 from public.automation_runs r where r.operation_key = 'reply_assist:' || m.id) then
    return jsonb_build_object('action', 'duplicate');
  end if;
  select * into req from public.requests r where r.id = m.request_id for update;
  answered := exists (select 1 from public.messages o where o.request_id = req.id and o.direction = 'outgoing'
    and o.system_template is null and o.created_at > m.received_at);

  if save_reply_assist.reply_needed and not answered and nullif(btrim(req.business_email), '') is not null
     and nullif(btrim(save_reply_assist.body_text), '') is not null then
    insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values (req.id, 'outgoing', 'other', 'draft', btrim(req.business_email),
      left(coalesce(nullif(btrim(save_reply_assist.subject), ''), 'Re: ' || m.subject), 300),
      -- The customer number note before the greeting, as in the system mails
      replace(save_reply_assist.body_text, E'\nMit freundlichen Grüßen', E'\n' || private.customer_number_note_text(req.customer_number) || 'Mit freundlichen Grüßen'))
    returning * into draft;
    insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, note, data)
    values (req.id, 'automation', 'message_drafted', 'dispatch', 'draft', 'Antwortentwurf des Assistenten',
      jsonb_build_object('message_id', draft.id, 'kind', draft.kind, 'reply_to', m.id, 'assistant', true));
    action := 'drafted';
  elsif answered then
    action := 'answered_meanwhile';
  end if;

  -- "Where is the technician?": only for an overdue visit, one open callback request per visit (as task-13-4)
  if save_reply_assist.callback_technician then
    situation := private.request_situation(req, now());
    if situation ->> 'lage' = 'ueberfaellig' then
      select * into v from public.visits x where x.id = (situation ->> 'einsatz_id')::uuid for update;
      if not exists (select 1 from public.callback_requests c where c.visit_id = v.id and c.status = 'open') then
        insert into public.callback_requests (request_id, visit_id, technician_id, conversation_id, callback_number, company_name, site, scheduled_start)
        values (req.id, v.id, v.technician_id, 'email:' || m.id, req.phone_number, req.company_name,
          req.street_house_number || ', ' || req.postal_code || ' ' || req.city, v.scheduled_start)
        returning * into callback;
        insert into public.request_events (request_id, visit_id, actor_type, event_type, visibility, to_value, data)
        values (req.id, v.id, 'automation', 'callback_requested', 'operational', v.technician_id::text,
          jsonb_build_object('callback_id', callback.id, 'message_id', m.id, 'source', 'email'));
      end if;
    end if;
  end if;

  update public.requests r set updated_at = now() where r.id = req.id;
  insert into public.automation_runs (request_id, message_id, operation_key, workflow_execution_id, step, status, confidence, result, finished_at)
  values (req.id, m.id, 'reply_assist:' || m.id, save_reply_assist.workflow_execution_id, 'reply_assist', 'succeeded',
    greatest(0, least(1, coalesce(save_reply_assist.confidence, 0))),
    jsonb_build_object('intent', clean_intent, 'summary', note, 'reason', left(coalesce(save_reply_assist.reason, ''), 500),
      'action', action, 'draft_id', draft.id, 'callback_id', callback.id), now());
  return jsonb_build_object('action', action, 'draft_id', draft.id, 'callback_id', callback.id);
end;
$$;

revoke all on function private.assist_grid(uuid, date, integer), private.assist_window_free(public.visits, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reply_assist_pending(integer), public.reply_assist_slots(uuid, date, text),
  public.save_reply_assist(uuid, text, text, boolean, text, text, text, boolean, numeric, text) from public, anon, authenticated;
grant execute on function public.reply_assist_pending(integer), public.reply_assist_slots(uuid, date, text),
  public.save_reply_assist(uuid, text, text, boolean, text, text, text, boolean, numeric, text) to service_role;
