-- task-12-3: reply to an inbox e-mail without a request (ask for the request number, company, site). The reply goes
-- out through the existing n8n send queue in the same Gmail thread; nothing is sent automatically, the click on
-- "Senden" is the approval. An inbox conversation is the first unmatched e-mail (root) plus every later message of
-- it (inbox_root_id): our replies and further customer e-mails in the same thread. The conversation stays in the
-- inbox of the same dispatcher; assigning, creating a request and archiving act on the whole conversation.

alter table public.messages
  add column inbox_root_id uuid references public.messages (id) on delete cascade,
  add constraint messages_inbox_root_not_self check (inbox_root_id is distinct from id);
create index messages_inbox_root_idx on public.messages (inbox_root_id) where inbox_root_id is not null;

-- Outgoing without a request: only as a reply inside an inbox conversation
alter table public.messages drop constraint messages_outgoing_has_request;
alter table public.messages add constraint messages_outgoing_has_request
  check (direction <> 'outgoing' or request_id is not null or (inbox_root_id is not null and inbox_dispatcher_id is not null));

-- Sending an inbox reply runs without a request as well
alter table public.automation_runs drop constraint automation_runs_request_required;
alter table public.automation_runs add constraint automation_runs_request_required
  check (request_id is not null or step = 'email_matching' or (step = 'email_send' and message_id is not null));

-- Load of a dispatcher counts open conversations, not every message in them
create or replace function private.least_loaded_dispatcher(excluded uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id from public.profiles pr
  where pr.role = 'dispatcher' and pr.is_active and pr.id is distinct from excluded
  order by
    (select count(*) from public.requests r where r.dispatcher_id = pr.id and r.intake_completed_at is null and not r.is_demo)
    + (select count(*) from public.messages m where m.inbox_dispatcher_id = pr.id and m.request_id is null and m.archived_at is null
         and m.direction = 'incoming' and m.inbox_root_id is null),
    pr.id
  limit 1;
$$;

-- Root of the conversation of a readable unmatched incoming message, locked; the caller's rights are checked
create function private.lock_inbox_root(target_message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  root public.messages;
begin
  select * into msg from public.messages m where m.id = target_message_id;
  if not found or not private.can_read_message(msg.id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  select * into root from public.messages m where m.id = coalesce(msg.inbox_root_id, msg.id) for update;
  return root;
end;
$$;

create function public.reply_to_inbox_message(message_id uuid, subject text, body_text text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  root public.messages;
  last_in public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  root := private.lock_inbox_root(reply_to_inbox_message.message_id);
  if root.request_id is not null or root.direction <> 'incoming' then
    raise exception 'Antworten hier nur auf unzugeordnete E-Mails; zugeordnete E-Mails unter Korrespondenz der Anfrage' using errcode = 'RW422';
  end if;
  if root.archived_at is not null then
    raise exception 'Archivierte E-Mail zuerst wiederherstellen' using errcode = 'RW422';
  end if;
  if nullif(btrim(reply_to_inbox_message.subject), '') is null or nullif(btrim(reply_to_inbox_message.body_text), '') is null then
    raise exception 'Betreff und Text sind erforderlich' using errcode = 'RW422';
  end if;
  if length(reply_to_inbox_message.subject) > 200 or length(reply_to_inbox_message.body_text) > 10000 then
    raise exception 'Betreff höchstens 200, Text höchstens 10000 Zeichen' using errcode = 'RW422';
  end if;

  -- Repetition (double click): the same text for the same conversation within a minute is not sent twice
  select * into result from public.messages m
  where m.inbox_root_id = root.id and m.direction = 'outgoing' and m.body_text = reply_to_inbox_message.body_text
    and m.created_at > now() - interval '1 minute';
  if found then
    return result;
  end if;

  -- Answer the latest customer e-mail of the conversation, in its thread
  select * into last_in from public.messages m
  where (m.id = root.id or m.inbox_root_id = root.id) and m.direction = 'incoming'
  order by m.received_at desc, m.created_at desc limit 1;

  insert into public.messages (inbox_dispatcher_id, inbox_root_id, direction, kind, status, to_address, subject, body_text,
    gmail_thread_id, in_reply_to, references_header, author_id, approved_by, approved_at)
  values (root.inbox_dispatcher_id, root.id, 'outgoing', 'clarification', 'queued', btrim(last_in.from_address),
    btrim(reply_to_inbox_message.subject), reply_to_inbox_message.body_text,
    root.gmail_thread_id, last_in.mime_message_id,
    case when last_in.mime_message_id is null then last_in.references_header
         else coalesce(last_in.references_header, '{}') || last_in.mime_message_id end,
    (select auth.uid()), (select auth.uid()), now())
  returning * into result;
  return result;
end;
$$;

-- Inbox replies are sent only for conversations that came in through the real mailbox (not demo or test rows)
create or replace function public.claim_queued_messages(batch_limit integer default 5, lease_seconds integer default 180)
returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.messages; run public.automation_runs; lastmail public.messages;
begin
  perform private.require_integration();
  for m in select ms.* from public.messages ms left join public.requests q on q.id=ms.request_id
    left join public.messages root on root.id=ms.inbox_root_id
    left join private.integration_send_leases l on l.message_id=ms.id
    where ms.direction='outgoing' and ms.status='queued'
      and ((q.id is not null and not q.is_demo)
        or (ms.request_id is null and root.mailbox_key='rheinwerk.industrieservice@gmail.com'))
      and (ms.approved_by is not null or ms.kind in ('receipt','payment_reminder')) and ms.approved_at is not null
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
$$;

-- Same as before; the request part only when the message belongs to a request
create or replace function public.confirm_message_sent_base(
  message_id uuid,
  sent_at timestamptz default null,
  mailbox_key text default null,
  gmail_message_id text default null,
  gmail_thread_id text default null,
  mime_message_id text default null
)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  req public.requests;
  inv public.invoices;
  result public.messages;
  delivery_time timestamptz := coalesce(confirm_message_sent_base.sent_at, now());
begin
  select * into msg from public.messages m where m.id = confirm_message_sent_base.message_id for update;
  if not found or msg.direction <> 'outgoing' then
    raise exception 'Ausgehende Nachricht nicht gefunden' using errcode = 'RW422';
  end if;

  if msg.status = 'sent' then
    return msg;
  end if;
  if msg.status <> 'queued' then
    raise exception 'Nur Nachrichten in der Warteschlange können als versendet bestätigt werden' using errcode = 'RW422';
  end if;

  if msg.request_id is not null then
    select * into req from public.requests r where r.id = msg.request_id for update;
    if req.is_demo then
      raise exception 'Demo-Anfragen werden nicht versendet' using errcode = 'RW422';
    end if;
  end if;

  update public.messages m
  set status = 'sent',
      sent_at = delivery_time,
      mailbox_key = coalesce(confirm_message_sent_base.mailbox_key, m.mailbox_key),
      gmail_message_id = coalesce(confirm_message_sent_base.gmail_message_id, m.gmail_message_id),
      gmail_thread_id = coalesce(confirm_message_sent_base.gmail_thread_id, m.gmail_thread_id),
      mime_message_id = coalesce(confirm_message_sent_base.mime_message_id, m.mime_message_id),
      error_text = null
  where m.id = msg.id
  returning * into result;

  if req.id is null then
    return result;
  end if;

  if msg.kind in ('clarification', 'other') and req.first_substantive_response_at is null then
    update public.requests r set first_substantive_response_at = delivery_time where r.id = req.id;
  else
    update public.requests r set updated_at = now() where r.id = req.id;
  end if;

  insert into public.request_events (request_id, actor_type, event_type, visibility, from_value, to_value, data)
  values (req.id, 'automation', 'message_sent', 'dispatch', 'queued', 'sent',
    jsonb_build_object('message_id', msg.id, 'kind', msg.kind, 'sent_at', delivery_time));

  if msg.kind = 'invoice' and msg.invoice_id is not null then
    select * into inv from public.invoices i where i.id = msg.invoice_id for update;

    if inv.status = 'issued' then
      update public.invoices i set status = 'sent', sent_at = delivery_time where i.id = inv.id;
    elsif inv.status = 'paid' and inv.sent_at is null then
      update public.invoices i set sent_at = delivery_time where i.id = inv.id;
    end if;

    insert into public.request_events (request_id, actor_type, event_type, from_value, to_value, data)
    values (req.id, 'automation', 'invoice_sent', inv.status::text,
      case when inv.status = 'issued' then 'sent' else inv.status::text end,
      jsonb_build_object('invoice_id', inv.id, 'message_id', msg.id, 'sent_at', delivery_time));
  end if;

  return result;
end;
$$;

create or replace function public.confirm_message_sent(message_id uuid,sent_at timestamptz default null,mailbox_key text default null,
  gmail_message_id text default null,gmail_thread_id text default null,mime_message_id text default null) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare m public.messages; req public.requests; was_sent boolean;
begin
  perform private.require_integration();
  select status='sent' into was_sent from public.messages where id=message_id;
  m:=public.confirm_message_sent_base(message_id,sent_at,mailbox_key,gmail_message_id,gmail_thread_id,mime_message_id);
  if m.request_id is not null then
    select * into req from public.requests where id=m.request_id for update;
    if not was_sent and m.kind='clarification' and req.intake_completed_at is null and not private.is_terminal(req)
      and not exists(select 1 from public.messages mi where mi.request_id=req.id and mi.direction='incoming' and mi.received_at>m.created_at) then
      update public.requests set intake_status='awaiting_customer' where id=req.id;
      insert into public.request_events(request_id,actor_type,event_type,visibility,from_value,to_value,data)
      values(req.id,'automation','intake_status_changed','dispatch',req.intake_status::text,'awaiting_customer',jsonb_build_object('message_id',m.id));
    end if;
  end if;
  update public.automation_runs set status='succeeded',decision='sent',finished_at=now(),error_code=null,error_text=null,
    result=jsonb_build_object('contract_version','1.0','gmail_message_id',m.gmail_message_id,'gmail_thread_id',m.gmail_thread_id)
    where operation_key='email_send:'||m.id;
  return m;
end;
$$;

create or replace function public.mark_message_failed(message_id uuid,error_text text,permanent boolean default false) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  perform private.require_integration();
  select * into m from public.messages where id=mark_message_failed.message_id for update;
  if not found then raise exception 'Message not found' using errcode='RW404'; end if;
  if m.status='sent' then return m; end if;
  if m.status<>'queued' then raise exception 'Queued message required' using errcode='RW422'; end if;
  update public.messages set status=case when permanent then 'failed'::public.message_status else 'queued' end,
    error_text=left(coalesce(mark_message_failed.error_text,'Delivery failed'),1000) where id=mark_message_failed.message_id returning * into m;
  update private.integration_send_leases set lease_until=now(),next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) where integration_send_leases.message_id=mark_message_failed.message_id;
  update public.automation_runs set status='failed',finished_at=now(),error_code='GMAIL_SEND_FAILED',error_text=mark_message_failed.error_text,decision=null
    where operation_key='email_send:'||mark_message_failed.message_id and status<>'succeeded';
  if m.request_id is not null then
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(m.request_id,'automation','message_send_failed','dispatch',jsonb_build_object('message_id',m.id,'permanent',mark_message_failed.permanent));
  end if;
  return m;
end;
$$;

-- Incoming: an e-mail without request in the thread of an open inbox conversation (or answering one of its
-- messages) joins that conversation in the same inbox instead of starting a new one
create or replace function public.record_incoming_message(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb:=payload; msg public.messages; req uuid; dispatcher uuid; candidate uuid[]; thread text; num text; ambiguous boolean:=false;
  root public.messages;
begin
  perform private.require_integration();
  if p->>'contract_version' is distinct from '1.0' or p->>'mailbox_key' is distinct from 'rheinwerk.industrieservice@gmail.com'
    or nullif(p->>'gmail_message_id','') is null or nullif(p->>'from_address','') is null then
    raise exception 'Invalid incoming message envelope' using errcode='RW422'; end if;
  perform pg_advisory_xact_lock(hashtextextended((p->>'mailbox_key')||':'||(p->>'gmail_message_id'),0));
  select * into msg from public.messages m where m.mailbox_key=p->>'mailbox_key' and m.gmail_message_id=p->>'gmail_message_id';
  if found then return to_jsonb(msg)||jsonb_build_object('duplicate',true); end if;
  thread:=nullif(p->>'gmail_thread_id','');
  select array_agg(distinct m.request_id) into candidate from public.messages m
    where m.mailbox_key=p->>'mailbox_key' and m.gmail_thread_id=thread and m.request_id is not null;
  if cardinality(candidate)=1 then req:=candidate[1]; end if;
  if coalesce(cardinality(candidate),0)>1 then ambiguous:=true; end if;
  if req is null and not ambiguous then
    select array_agg(distinct m.request_id) into candidate from public.messages m
    where m.mailbox_key=p->>'mailbox_key' and m.request_id is not null and
      (m.mime_message_id=p->>'in_reply_to' or m.mime_message_id in(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))));
    if cardinality(candidate)=1 then req:=candidate[1]; end if;
    if coalesce(cardinality(candidate),0)>1 then ambiguous:=true; end if;
  end if;
  if req is null and not ambiguous then
    select array_agg(distinct r.id) into candidate from public.requests r
      where r.request_number in(select upper((s)[1]) from regexp_matches(coalesce(p->>'subject',''),'\m(RIS-[0-9]{4}-[0-9]{5})\M','gi') s);
    if cardinality(candidate)=1 then req:=candidate[1]; end if;
  end if;
  if exists(select 1 from public.requests r where r.id=req and r.is_demo) then
    return jsonb_build_object('ignored',true,'reason','demo_request'); end if;
  -- task-12-3: same thread (or reply to one of its messages) as an open inbox conversation
  if req is null and not ambiguous then
    select r.* into root from public.messages m join public.messages r on r.id=coalesce(m.inbox_root_id,m.id)
    where m.request_id is null and r.request_id is null and r.archived_at is null and r.direction='incoming'
      and ((thread is not null and m.mailbox_key=p->>'mailbox_key' and m.gmail_thread_id=thread)
        or (m.mime_message_id is not null and (m.mime_message_id=p->>'in_reply_to'
          or m.mime_message_id in(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))))))
    order by r.received_at desc limit 1;
    if root.id is not null then dispatcher:=root.inbox_dispatcher_id; end if;
  end if;
  -- task-11-7: other unmatched e-mails go to the least-loaded active dispatcher (open intakes + open conversations)
  if req is null and dispatcher is null then
    perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment',0));
    dispatcher:=private.least_loaded_dispatcher();
  end if;
  if req is null and dispatcher is null then raise exception 'No dispatcher for unmatched message' using errcode='RW422'; end if;
  insert into public.messages(request_id,inbox_dispatcher_id,inbox_root_id,direction,kind,status,from_address,to_address,subject,body_text,
    mailbox_key,gmail_message_id,gmail_thread_id,mime_message_id,in_reply_to,references_header,received_at)
  values(req,case when req is null then dispatcher else null end,case when req is null then root.id end,'incoming',
    case when req is null and root.id is null then 'other'::public.message_kind else 'customer_reply' end,
    'received',p->>'from_address',p->>'mailbox_key',coalesce(p->>'subject',''),coalesce(p->>'body_text',''),
    p->>'mailbox_key',p->>'gmail_message_id',thread,p->>'mime_message_id',p->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))),coalesce((p->>'received_at')::timestamptz,now())) returning * into msg;
  insert into private.integration_incoming_stage(message_id) values(msg.id);
  insert into public.automation_runs(operation_key,step,request_id,message_id,status,decision,result,finished_at)
  values('email_matching:'||(p->>'mailbox_key')||':'||(p->>'gmail_message_id'),'email_matching',req,msg.id,'succeeded',
    case when req is null then 'unmatched'::public.automation_decision else 'matched' end,
    jsonb_build_object('contract_version','1.0','matched',req is not null,'ambiguous',ambiguous,'inbox_conversation',root.id is not null),now());
  if req is not null then
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(req,'automation','message_received','dispatch',jsonb_build_object('message_id',msg.id));
  end if;
  return to_jsonb(msg)||jsonb_build_object('duplicate',false,'matched',req is not null,'ambiguous',ambiguous);
end;
$$;

-- Moves a whole inbox conversation (root, replies, later e-mails, their attachments) to a request
create function private.move_inbox_conversation(root_id uuid, target_request_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.messages m
  set request_id = target_request_id, handled_at = case when m.direction = 'incoming' then coalesce(m.handled_at, now()) else m.handled_at end
  where (m.id = root_id or m.inbox_root_id = root_id) and m.request_id is null;
  get diagnostics moved = row_count;
  update public.attachments a set request_id = target_request_id
  where a.request_id is null and a.message_id in (select m.id from public.messages m where m.id = root_id or m.inbox_root_id = root_id);
  return moved;
end;
$$;

create or replace function public.link_message(message_id uuid, request_id uuid, expected_version integer)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  root public.messages;
  moved integer;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  root := private.lock_inbox_root(link_message.message_id);
  if root.request_id is not null or root.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können verknüpft werden' using errcode = 'RW422';
  end if;

  req := private.lock_request(link_message.request_id, link_message.expected_version);
  moved := private.move_inbox_conversation(root.id, req.id);
  select * into result from public.messages m where m.id = root.id;

  update public.requests r set updated_at = now() where r.id = req.id;
  perform private.log_request_event(req.id, 'message_linked', null, root.id::text, null,
    jsonb_build_object('message_id', root.id, 'previous_inbox_dispatcher_id', root.inbox_dispatcher_id, 'subject', root.subject,
      'conversation_messages', moved),
    'dispatch');
  return result;
end;
$$;

create or replace function public.create_request_from_message(message_id uuid, fields jsonb)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  req public.requests;
  moved integer;
  k text;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  msg := private.lock_inbox_root(create_request_from_message.message_id);
  k := 'email:' || msg.id;
  perform pg_advisory_xact_lock(hashtextextended(k, 0));

  -- Repetition: the request already exists; return it if the caller may see it
  select * into req from public.requests r where r.source_event_key = k;
  if found then
    if not private.can_access_request(req.id) then
      raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
    end if;
    return req;
  end if;

  if msg.request_id is not null or msg.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können eine Anfrage anlegen' using errcode = 'RW422';
  end if;

  perform private.validate_request_fields(fields);

  insert into public.requests (
    source_event_key, source, company_name, contact_name, business_email, phone_number, customer_number,
    street_house_number, postal_code, city, equipment_kind, manufacturer, model_type, service_kind,
    requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, human_review_required)
  values (
    k, 'email', btrim(fields ->> 'company_name'), btrim(fields ->> 'contact_name'), btrim(fields ->> 'business_email'),
    btrim(fields ->> 'phone_number'), nullif(btrim(fields ->> 'customer_number'), ''),
    btrim(fields ->> 'street_house_number'), btrim(fields ->> 'postal_code'), btrim(fields ->> 'city'),
    (fields ->> 'equipment_kind')::public.equipment_kind, nullif(btrim(fields ->> 'manufacturer'), ''), nullif(btrim(fields ->> 'model_type'), ''),
    (fields ->> 'service_kind')::public.service_kind, (fields ->> 'requested_visit_date')::date, btrim(fields ->> 'description'),
    (fields ->> 'customer_urgency')::public.customer_urgency, (fields ->> 'safety_risk')::public.safety_risk,
    jsonb_build_object('message_id', msg.id, 'from_address', msg.from_address, 'subject', msg.subject, 'received_at', msg.received_at),
    msg.inbox_dispatcher_id,
    fields ->> 'customer_urgency' = 'production_stop' or fields ->> 'safety_risk' in ('known', 'unclear'))
  returning * into req;

  -- The conversation and its attachments now belong to the request (same effect as link_message)
  moved := private.move_inbox_conversation(msg.id, req.id);

  perform private.log_request_event(req.id, 'request_created_from_message', null, msg.id::text, null,
    jsonb_build_object('message_id', msg.id, 'from_address', msg.from_address, 'subject', msg.subject), 'dispatch');
  perform private.log_request_event(req.id, 'message_linked', null, msg.id::text, null,
    jsonb_build_object('message_id', msg.id, 'previous_inbox_dispatcher_id', msg.inbox_dispatcher_id, 'subject', msg.subject,
      'conversation_messages', moved), 'dispatch');
  return req;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'Ungültige Angaben' using errcode = 'RW422';
end;
$$;

-- Archive and restore act on the root; later messages of the conversation stay with it
create or replace function public.archive_message(message_id uuid, reason text)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if archive_message.reason is null or archive_message.reason not in ('advertising', 'supplier', 'application', 'other') then
    raise exception 'Ungültiger Grund' using errcode = 'RW422';
  end if;
  msg := private.lock_inbox_root(archive_message.message_id);
  if msg.request_id is not null or msg.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können archiviert werden' using errcode = 'RW422';
  end if;
  -- Repetition (double click): already archived, nothing changes
  if msg.archived_at is not null then
    return msg;
  end if;

  update public.messages m
  set archived_at = now(), archived_by = (select auth.uid()), archive_reason = archive_message.reason, handled_at = now()
  where m.id = msg.id
  returning * into result;
  return result;
end;
$$;

create or replace function public.restore_message(message_id uuid)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  result public.messages;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  msg := private.lock_inbox_root(restore_message.message_id);
  if msg.archived_at is null then
    return msg;
  end if;

  update public.messages m
  set archived_at = null, archived_by = null, archive_reason = null, handled_at = null
  where m.id = msg.id
  returning * into result;
  return result;
end;
$$;

revoke all on function private.lock_inbox_root(uuid), private.move_inbox_conversation(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reply_to_inbox_message(uuid, text, text) from public, anon;
grant execute on function public.reply_to_inbox_message(uuid, text, text) to authenticated;
notify pgrst, 'reload schema';
