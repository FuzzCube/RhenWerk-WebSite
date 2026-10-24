-- task-24-2 (user report 24.10.2026, live test): a draft of the reply assistant named the customer number twice, once
-- wrong. The model does not know the number; it wrote one of its own besides the note the database adds. Sentences of
-- the model that mention a customer number are removed; the note with the number of the request stays the only one.

create or replace function public.save_reply_assist(
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
  -- The model must not state a customer number; the database adds the right one once (task-24-2)
  body text := btrim(regexp_replace(coalesce(save_reply_assist.body_text, ''), '[^.!?\n]*kunden-?\s?(nummer|nr\.?)[^.!?\n]*[.!?]?[ \t]*', '', 'gi'));
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
     and body <> '' then
    insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text)
    values (req.id, 'outgoing', 'other', 'draft', btrim(req.business_email),
      left(coalesce(nullif(btrim(save_reply_assist.subject), ''), 'Re: ' || m.subject), 300),
      -- The customer number note before the greeting, as in the system mails
      replace(regexp_replace(body, '\n{3,}', E'\n\n', 'g'), E'\nMit freundlichen Grüßen', E'\n' || private.customer_number_note_text(req.customer_number) || 'Mit freundlichen Grüßen'))
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
