-- task-20-10: customers cancel a planned visit by replying to an e-mail of the request (thread or RIS number, matched
-- by the Gmail workflow). The workflow "RheinWerk · Kundenantwort zum Termin" lists such replies, lets OpenAI name the
-- intent and calls apply_visit_reply. A clear cancellation (confidence >= 0.8, sender is the request's e-mail address,
-- visit not started) cancels the coming visits; the request goes back to planning (user decision 22.10.2026: only the
-- visit, not the request) and the customer gets a confirmation. A wish to move the visit or an unclear case is only
-- flagged for the dispatcher. Every reply is evaluated once (operation_key visit_reply:<message_id>).

-- Approval by the system also for messages from a fixed template (system_template), not only receipts and reminders
alter table public.messages drop constraint messages_approval_pair;
alter table public.messages add constraint messages_approval_pair check (
  ((approved_by is null) = (approved_at is null))
  or ((kind in ('receipt', 'payment_reminder') or system_template is not null) and direction = 'outgoing' and approved_by is null and approved_at is not null));

create or replace function private.queue_system_mail(req public.requests, subject text, body text, template text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare msg public.messages;
begin
  if req.is_demo or nullif(btrim(req.business_email), '') is null then return null; end if;
  body := replace(body, E'\nMit freundlichen Grüßen', E'\n' || private.customer_number_note_text(req.customer_number) || 'Mit freundlichen Grüßen');
  insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at, system_template)
  values (req.id, 'outgoing', 'other', 'queued', req.business_email, subject, body, now(), template)
  returning * into msg;
  insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, 'automation', 'message_queued', 'dispatch', 'queued', jsonb_build_object('message_id', msg.id, 'kind', msg.kind, 'approved_by', 'system'));
  return msg.id;
end;
$$;

-- Same as before, plus messages from a fixed system template
create or replace function public.claim_queued_messages(batch_limit integer default 5, lease_seconds integer default 180)
 returns setof jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare m public.messages; run public.automation_runs; lastmail public.messages;
begin
  perform private.require_integration();
  for m in select ms.* from public.messages ms left join public.requests q on q.id=ms.request_id
    left join public.messages root on root.id=ms.inbox_root_id
    left join private.integration_send_leases l on l.message_id=ms.id
    where ms.direction='outgoing' and ms.status='queued'
      and ((q.id is not null and not q.is_demo)
        or (ms.request_id is null and root.mailbox_key='rheinwerk.industrieservice@gmail.com'))
      and (ms.approved_by is not null or ms.kind in ('receipt','payment_reminder') or ms.system_template is not null) and ms.approved_at is not null
      and (l.message_id is null or (l.lease_until<now() and l.next_attempt_at<=now()))
    order by ms.created_at limit greatest(1,least(batch_limit,20)) for update of ms skip locked loop
    insert into private.integration_send_leases(message_id,lease_until) values(m.id,now()+make_interval(secs=>greatest(60,least(lease_seconds,600))))
      on conflict(message_id) do update set lease_until=excluded.lease_until,attempts=private.integration_send_leases.attempts+1;
    insert into public.automation_runs(request_id,message_id,operation_key,step)
    values(m.request_id,m.id,'email_send:'||m.id,'email_send') on conflict(operation_key) do nothing;
    lastmail:=null;
    if m.request_id is not null then
      select * into lastmail from public.messages where request_id=m.request_id and mailbox_key='rheinwerk.industrieservice@gmail.com'
        and mime_message_id is not null order by created_at desc limit 1;
    end if;
    return next to_jsonb(m)||jsonb_build_object('approved_by',coalesce(m.approved_by::text,'system'),'gmail_thread_id',coalesce(m.gmail_thread_id,lastmail.gmail_thread_id),
      'in_reply_to',coalesce(m.in_reply_to,lastmail.mime_message_id),'references_header',coalesce(m.references_header,lastmail.references_header));
  end loop;
end;
$function$;

-- Replies of the last 3 days to requests with a coming visit planned before the reply, not evaluated yet
create or replace function public.visit_replies_pending(batch_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_integration();
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(x.item order by x.received_at) from (
      select m.received_at, jsonb_build_object(
        'message_id', m.id, 'request_number', q.request_number, 'subject', m.subject, 'text', left(coalesce(m.body_text, ''), 4000),
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

create or replace function public.apply_visit_reply(message_id uuid, intent text, confidence numeric, summary text, workflow_execution_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.messages;
  req public.requests;
  v public.visits;
  clean_intent text := case when apply_visit_reply.intent in ('cancel_visit', 'reschedule', 'confirm', 'question', 'other') then apply_visit_reply.intent else 'other' end;
  sure numeric := greatest(0, least(1, coalesce(apply_visit_reply.confidence, 0)));
  note text := left(coalesce(nullif(btrim(apply_visit_reply.summary), ''), 'Kundenantwort zum Termin'), 500);
  sender_ok boolean;
  action text := 'none';
  cancelled text[] := '{}';
  reason text;
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

  if clean_intent = 'cancel_visit' and sure >= 0.8 and sender_ok then
    reason := 'Storniert auf Wunsch des Kunden (E-Mail vom ' || to_char(m.received_at at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI') || ')';
    for v in select * from public.visits x where x.request_id = req.id and x.status = 'scheduled' and x.scheduled_start > now() order by x.scheduled_start for update loop
      update public.visits x set status = 'cancelled', cancellation_reason = reason where x.id = v.id;
      insert into public.request_events (request_id, visit_id, actor_type, event_type, from_value, to_value, note, data)
      values (req.id, v.id, 'automation', 'visit_status_changed', 'scheduled', 'cancelled', reason,
        jsonb_build_object('scheduled_start', v.scheduled_start, 'scheduled_end', v.scheduled_end, 'message_id', m.id));
      cancelled := cancelled || private.spoken_datetime(v.scheduled_start);
    end loop;
  end if;

  if cardinality(cancelled) > 0 then
    action := 'cancelled';
    if req.work_status = 'scheduled' and not exists (
      select 1 from public.visits x where x.request_id = req.id and x.status in ('scheduled', 'in_progress', 'waiting_parts')
    ) then
      -- As set_work_status, but logged as automation (set_work_status logs the signed-in person)
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
  elsif clean_intent in ('cancel_visit', 'reschedule') then
    -- Not clear enough or not from the customer's address: a person decides
    action := 'flagged';
    update public.requests r set updated_at = now() where r.id = req.id;
  end if;

  insert into public.request_events (request_id, actor_type, event_type, to_value, note, data)
  values (req.id, 'automation', 'visit_reply_analyzed', action, note,
    jsonb_build_object('message_id', m.id, 'intent', clean_intent, 'confidence', sure, 'sender_ok', sender_ok));
  insert into public.automation_runs (request_id, message_id, operation_key, workflow_execution_id, step, status, confidence, result, finished_at)
  values (req.id, m.id, 'visit_reply:' || m.id, apply_visit_reply.workflow_execution_id, 'visit_reply', 'succeeded', sure,
    jsonb_build_object('intent', clean_intent, 'summary', note, 'action', action, 'sender_ok', sender_ok, 'cancelled', to_jsonb(cancelled)), now());
  return jsonb_build_object('action', action, 'intent', clean_intent, 'cancelled', to_jsonb(cancelled));
end;
$$;

revoke all on function private.queue_system_mail(public.requests, text, text, text) from public, anon, authenticated;
revoke all on function public.visit_replies_pending(integer), public.apply_visit_reply(uuid, text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.visit_replies_pending(integer), public.apply_visit_reply(uuid, text, numeric, text, text) to service_role;
notify pgrst, 'reload schema';
