-- task-22-3, first live run on the VPS (24.10.2026): the assistant drafted a reply to a Gmail bounce ("Delivery Status
-- Notification (Failure)" from mailer-daemon). Mails of machines are not listed any more: bounces, out-of-office
-- replies and no-reply senders.

create or replace function public.reply_assist_pending(batch_limit integer default 5)
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
        -- No answers to machines: bounces, out-of-office and no-reply senders
        and coalesce(m.from_address, '') !~* '(mailer-daemon|postmaster|no-?reply|do-?not-?reply)'
        and coalesce(m.subject, '') !~* '^(delivery status notification|undeliver|mail delivery|returned mail|automatic reply|auto[- ]?reply|automatische antwort|abwesenheit|out of office)'
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
