-- task-10-5: inbox for unmatched incoming e-mails. Assigning to an existing request stays link_message; this adds
-- creating a new request from an e-mail. The request is created with source 'email' and the fixed key
-- 'email:<message id>', so a repeated call (double click, retry) returns the same request instead of a duplicate.
-- No receipt e-mail is queued: the customer wrote by e-mail, and a dispatcher entering the request by hand should
-- not send anything without an explicit step.

alter table public.requests drop constraint requests_source_check;
alter table public.requests add constraint requests_source_check check (source in ('website_form', 'demo_seed', 'email'));

create function public.create_request_from_message(message_id uuid, fields jsonb)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  req public.requests;
  k text := 'email:' || create_request_from_message.message_id;
  f text;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  perform pg_advisory_xact_lock(hashtextextended(k, 0));

  -- Repetition: the request already exists; return it if the caller may see it
  select * into req from public.requests r where r.source_event_key = k;
  if found then
    if not private.can_access_request(req.id) then
      raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
    end if;
    return req;
  end if;

  select * into msg from public.messages m where m.id = create_request_from_message.message_id for update;
  if not found or not private.can_read_message(msg.id) then
    raise exception 'Nachricht nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if msg.request_id is not null or msg.direction <> 'incoming' then
    raise exception 'Nur unzugeordnete eingehende Nachrichten können eine Anfrage anlegen' using errcode = 'RW422';
  end if;

  if jsonb_typeof(fields) is distinct from 'object' then
    raise exception 'Angaben fehlen' using errcode = 'RW422';
  end if;
  foreach f in array array['company_name', 'contact_name', 'business_email', 'phone_number', 'street_house_number', 'postal_code', 'city'] loop
    if nullif(btrim(fields ->> f), '') is null then
      raise exception 'Pflichtfeld fehlt: %', f using errcode = 'RW422';
    end if;
  end loop;
  if coalesce(fields ->> 'equipment_kind', '') not in ('pump', 'compressor', 'ventilation', 'other')
     or coalesce(fields ->> 'service_kind', '') not in ('inspection', 'scheduled_maintenance', 'diagnosis_repair')
     or coalesce(fields ->> 'customer_urgency', '') not in ('planbar', 'zeitnah', 'erheblich', 'production_stop')
     or coalesce(fields ->> 'safety_risk', '') not in ('none_known', 'known', 'unclear')
     or coalesce(fields ->> 'requested_visit_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or length(btrim(coalesce(fields ->> 'description', ''))) < 10
     or btrim(fields ->> 'business_email') !~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$'
     or btrim(fields ->> 'postal_code') !~ '^\d{5}$' then
    raise exception 'Ungültige Angaben' using errcode = 'RW422';
  end if;

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

  -- The e-mail and its attachments now belong to the request (same effect as link_message)
  update public.messages m set request_id = req.id, handled_at = now() where m.id = msg.id;
  update public.attachments a set request_id = req.id where a.message_id = msg.id;

  perform private.log_request_event(req.id, 'request_created_from_message', null, msg.id::text, null,
    jsonb_build_object('message_id', msg.id, 'from_address', msg.from_address, 'subject', msg.subject), 'dispatch');
  perform private.log_request_event(req.id, 'message_linked', null, msg.id::text, null,
    jsonb_build_object('message_id', msg.id, 'previous_inbox_dispatcher_id', msg.inbox_dispatcher_id, 'subject', msg.subject), 'dispatch');
  return req;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'Ungültige Angaben' using errcode = 'RW422';
end;
$$;

revoke all on function public.create_request_from_message(uuid, jsonb) from public, anon;
grant execute on function public.create_request_from_message(uuid, jsonb) to authenticated;
notify pgrst, 'reload schema';
