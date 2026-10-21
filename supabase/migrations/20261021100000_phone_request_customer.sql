-- task-15-4: a caller who names a customer number is taken over as existing customer. The phone form suggests active
-- customers while the number is typed; the chosen customer arrives here as customer_id and the request is linked on
-- creation, like requests of the phone assistant, so no new customer is created at the end of the intake. The site
-- is the one with the address of the request; a changed address stays without site until the intake is completed
-- (assign_request_customer adds it to the customer then). Without customer_id nothing changes.

drop function public.create_phone_request(uuid, jsonb, boolean, uuid);

create function public.create_phone_request(
  submission_id uuid,
  fields jsonb,
  send_receipt boolean default true,
  assigned_dispatcher_id uuid default null,
  customer_id uuid default null
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
  cust public.customers;
  site_id uuid;
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

  if create_phone_request.customer_id is not null then
    select * into cust from public.customers c where c.id = create_phone_request.customer_id and c.is_active;
    if not found then
      raise exception 'Kunde nicht gefunden oder inaktiv' using errcode = 'RW422';
    end if;
    select s.id into site_id from public.customer_sites s
    where s.customer_id = cust.id and s.is_active and s.postal_code = btrim(fields ->> 'postal_code')
      and lower(btrim(s.street_house_number)) = lower(btrim(fields ->> 'street_house_number'))
    order by s.created_at limit 1;
  end if;

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
    requested_visit_date, description, customer_urgency, safety_risk, raw_payload, dispatcher_id, human_review_required,
    customer_id, customer_site_id)
  values (
    k, 'phone', btrim(fields ->> 'company_name'), btrim(fields ->> 'contact_name'), btrim(fields ->> 'business_email'),
    btrim(fields ->> 'phone_number'), nullif(btrim(fields ->> 'customer_number'), ''),
    btrim(fields ->> 'street_house_number'), btrim(fields ->> 'postal_code'), btrim(fields ->> 'city'), nullif(btrim(fields ->> 'site_label'), ''),
    (fields ->> 'equipment_kind')::public.equipment_kind, nullif(btrim(fields ->> 'manufacturer'), ''), nullif(btrim(fields ->> 'model_type'), ''),
    (fields ->> 'service_kind')::public.service_kind, (fields ->> 'requested_visit_date')::date, btrim(fields ->> 'description'),
    (fields ->> 'customer_urgency')::public.customer_urgency, (fields ->> 'safety_risk')::public.safety_risk,
    jsonb_build_object('channel', 'phone', 'entered_by', caller.id, 'send_receipt', create_phone_request.send_receipt,
      'kunde_erkannt', cust.id is not null),
    dispatcher,
    fields ->> 'customer_urgency' = 'production_stop' or fields ->> 'safety_risk' in ('known', 'unclear'),
    cust.id, site_id)
  returning * into req;

  perform private.log_request_event(req.id, 'request_created_by_phone', null, dispatcher::text, null,
    jsonb_build_object('dispatcher_id', dispatcher, 'send_receipt', create_phone_request.send_receipt), 'dispatch');
  if cust.id is not null then
    perform private.log_request_event(req.id, 'customer_linked', null, cust.id::text, null,
      jsonb_build_object('customer_number', cust.customer_number, 'site_id', site_id, 'by', 'phone_form'));
  end if;
  if create_phone_request.send_receipt then
    perform private.queue_receipt(req);
  end if;
  return req;
exception when invalid_text_representation or datetime_field_overflow then
  raise exception 'Ungültige Angaben' using errcode = 'RW422';
end;
$$;

revoke all on function public.create_phone_request(uuid, jsonb, boolean, uuid, uuid) from public, anon;
grant execute on function public.create_phone_request(uuid, jsonb, boolean, uuid, uuid) to authenticated;
