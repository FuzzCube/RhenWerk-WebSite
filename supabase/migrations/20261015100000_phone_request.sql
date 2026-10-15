-- task-11-4: requests taken over the phone. A dispatcher, manager or admin enters the request in the dashboard;
-- source 'phone', key 'phone:<submission id>' from the form, so a double click or retry returns the same request.
-- The field rules are shared with create_request_from_message (private.validate_request_fields), the dispatcher
-- choice with the website intake (private.least_loaded_dispatcher). The request starts as 'new' and goes through the
-- normal n8n analysis. A receipt e-mail is queued only on request (form checkbox, on by default).

alter table public.requests drop constraint requests_source_check;
alter table public.requests add constraint requests_source_check check (source in ('website_form', 'demo_seed', 'email', 'phone'));

-- Required fields and value checks of a manually entered request (e-mail inbox and phone)
create function private.validate_request_fields(fields jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  f text;
begin
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
end;
$$;

-- Active dispatcher with the fewest open intakes (same rule as the website intake); serialized by the caller's lock
create function private.least_loaded_dispatcher()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id from public.profiles pr
  left join public.requests r on r.dispatcher_id = pr.id and r.intake_completed_at is null and not r.is_demo
  where pr.role = 'dispatcher' and pr.is_active
  group by pr.id order by count(r.id), pr.id limit 1;
$$;

revoke all on function private.validate_request_fields(jsonb), private.least_loaded_dispatcher() from public, anon, authenticated;

-- Same behaviour as before; only the field checks moved to private.validate_request_fields
create or replace function public.create_request_from_message(message_id uuid, fields jsonb)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  msg public.messages;
  req public.requests;
  k text := 'email:' || create_request_from_message.message_id;
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

-- New request from a phone call. Dispatchers always get the request themselves; managers and admins choose an
-- active dispatcher or leave it to the least-loaded one.
create function public.create_phone_request(
  submission_id uuid,
  fields jsonb,
  send_receipt boolean default true,
  assigned_dispatcher_id uuid default null
)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  k text := 'phone:' || create_phone_request.submission_id;
  caller public.profiles;
  dispatcher uuid;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if create_phone_request.submission_id is null then
    raise exception 'Angaben fehlen' using errcode = 'RW422';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(k, 0));

  -- Repetition: the request already exists; return it if the caller may see it
  select * into req from public.requests r where r.source_event_key = k;
  if found then
    if not private.can_access_request(req.id) then
      raise exception 'Anfrage nicht gefunden oder kein Zugriff' using errcode = '42501';
    end if;
    return req;
  end if;

  perform private.validate_request_fields(fields);

  select * into caller from public.profiles p where p.id = auth.uid();
  if caller.role = 'dispatcher' then
    dispatcher := caller.id;
  elsif create_phone_request.assigned_dispatcher_id is not null then
    if not exists (select 1 from public.profiles p where p.id = create_phone_request.assigned_dispatcher_id and p.role = 'dispatcher' and p.is_active) then
      raise exception 'Kein aktiver Dispatcher' using errcode = 'RW422';
    end if;
    dispatcher := create_phone_request.assigned_dispatcher_id;
  else
    perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment', 0));
    dispatcher := private.least_loaded_dispatcher();
    if dispatcher is null then
      raise exception 'Kein aktiver Dispatcher' using errcode = 'RW422';
    end if;
  end if;

  insert into public.requests (
    source_event_key, source, company_name, contact_name, business_email, phone_number, customer_number,
    street_house_number, postal_code, city, site_label, equipment_kind, manufacturer, model_type, service_kind,
    requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, human_review_required)
  values (
    k, 'phone', btrim(fields ->> 'company_name'), btrim(fields ->> 'contact_name'), btrim(fields ->> 'business_email'),
    btrim(fields ->> 'phone_number'), nullif(btrim(fields ->> 'customer_number'), ''),
    btrim(fields ->> 'street_house_number'), btrim(fields ->> 'postal_code'), btrim(fields ->> 'city'), nullif(btrim(fields ->> 'site_label'), ''),
    (fields ->> 'equipment_kind')::public.equipment_kind, nullif(btrim(fields ->> 'manufacturer'), ''), nullif(btrim(fields ->> 'model_type'), ''),
    (fields ->> 'service_kind')::public.service_kind, (fields ->> 'requested_visit_date')::date, btrim(fields ->> 'description'),
    (fields ->> 'customer_urgency')::public.customer_urgency, (fields ->> 'safety_risk')::public.safety_risk,
    jsonb_build_object('channel', 'phone', 'entered_by', caller.id, 'send_receipt', create_phone_request.send_receipt),
    dispatcher,
    fields ->> 'customer_urgency' = 'production_stop' or fields ->> 'safety_risk' in ('known', 'unclear'))
  returning * into req;

  perform private.log_request_event(req.id, 'request_created_by_phone', null, dispatcher::text, null,
    jsonb_build_object('dispatcher_id', dispatcher, 'send_receipt', create_phone_request.send_receipt), 'dispatch');
  if create_phone_request.send_receipt then
    perform private.queue_receipt(req);
  end if;
  return req;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'Ungültige Angaben' using errcode = 'RW422';
end;
$$;

revoke all on function public.create_phone_request(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.create_phone_request(uuid, jsonb, boolean, uuid) to authenticated;
notify pgrst, 'reload schema';
