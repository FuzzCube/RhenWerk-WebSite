-- task-20-6: Terminbestätigung names the length of the planned visit in words ("2 Stunden", "1 Stunde und 30 Minuten"
-- instead of "2.0 Stunden"); the receipt of the website form is queued after the hold, so it can say that the held
-- window is not yet confirmed (private.receipt_wish, 20261022235500).

create or replace function private.duration_text(starts_at timestamptz, ends_at timestamptz) returns text
language sql immutable set search_path = '' as $$
  with d(total) as (select greatest(0, round(extract(epoch from ends_at - starts_at) / 60))::integer)
  select case
    when total < 60 then total || ' Minuten'
    when total % 60 = 0 then (total / 60) || case when total = 60 then ' Stunde' else ' Stunden' end
    else (total / 60) || case when total < 120 then ' Stunde' else ' Stunden' end || ' und ' || (total % 60) || ' Minuten'
  end from d
$$;
revoke all on function private.duration_text(timestamptz, timestamptz) from public, anon, authenticated;

create or replace function public.ingest_submission(payload jsonb)
 RETURNS requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  p jsonb := payload; req public.requests; dispatcher uuid; f text; a jsonb; k text;
begin
  perform private.require_integration();
  if p->>'contract_version' <> '1.0' or p->>'schema_version' <> '1.0'
     or coalesce(p->>'privacy_consent','') <> 'true'
     or coalesce(p->>'submission_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Invalid submission envelope' using errcode = 'RW422';
  end if;
  k := 'website_form:' || lower(p->>'submission_id');
  perform pg_advisory_xact_lock(hashtextextended(k, 0));
  select * into req from public.requests r where r.source_event_key = k;
  if found then return req; end if;
  foreach f in array array['company_name','contact_name','business_email','phone'] loop
    if nullif(btrim(p->'contact'->>f),'') is null then raise exception 'Missing contact field %', f using errcode='RW422'; end if;
  end loop;
  foreach f in array array['street_and_number','postal_code','city','equipment_type'] loop
    if nullif(btrim(p->'site_and_equipment'->>f),'') is null then raise exception 'Missing equipment field %', f using errcode='RW422'; end if;
  end loop;
  if coalesce(p->'site_and_equipment'->>'equipment_type','') not in ('pump','compressor','ventilation','other')
     or coalesce(p->'request'->>'service_type','') not in ('inspection','maintenance','repair')
     or coalesce(p->'request'->>'urgency','') not in ('planned','time_sensitive','significant','production_stop')
     or coalesce(p->'request'->>'known_safety_hazard','') not in ('no','yes','unclear')
     or length(btrim(coalesce(p->'request'->>'description',''))) < 10
     or coalesce(p->'request'->>'preferred_service_date','') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(p->'contact'->>'business_email','') !~* '^[^@\s]+@([^@\s.]+\.)+[a-z]{2,}$'
     or coalesce(p->'site_and_equipment'->>'postal_code','') !~ '^\d{5}$' then
    raise exception 'Invalid submission fields' using errcode='RW422';
  end if;
  if jsonb_typeof(p->'contract_and_attachments'->'attachments') is distinct from 'array'
     or jsonb_array_length(p->'contract_and_attachments'->'attachments') > 3 then
    raise exception 'Invalid attachments' using errcode='RW422';
  end if;
  for a in select value from jsonb_array_elements(p->'contract_and_attachments'->'attachments') loop
    if coalesce(a->>'mime_type','') not in ('application/pdf','image/jpeg','image/png')
       or coalesce((a->>'size_bytes')::bigint,0) not between 1 and 5242880
       or coalesce(a->>'storage_path','') not like 'requests/' || lower(p->>'submission_id') || '/%'
       or (a->>'storage_path') like '%..%' then
      raise exception 'Invalid attachment storage reference' using errcode='RW422';
    end if;
  end loop;
  -- Serialize assignment to keep the least-loaded active dispatcher selection stable.
  perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment',0));
  select pr.id into dispatcher from public.profiles pr
  left join public.requests r on r.dispatcher_id=pr.id and r.intake_completed_at is null and not r.is_demo
  where pr.role='dispatcher' and pr.is_active group by pr.id order by count(r.id), pr.id limit 1;
  if dispatcher is null then raise exception 'No active dispatcher' using errcode='RW422'; end if;
  insert into public.requests (id,source_event_key,source,company_name,contact_name,business_email,phone_number,customer_number,site_label,
    street_house_number,postal_code,city,equipment_kind,manufacturer,model_type,machine_number,service_kind,requested_visit_date,
    description,customer_urgency,safety_risk,sla_contract_number,emergency_sla_claimed,raw_payload,dispatcher_id,human_review_required)
  values ((p->>'submission_id')::uuid,k,'website_form',btrim(p->'contact'->>'company_name'),btrim(p->'contact'->>'contact_name'),
    btrim(p->'contact'->>'business_email'),btrim(p->'contact'->>'phone'),p->'contact'->>'customer_number',p->'site_and_equipment'->>'site_name',
    btrim(p->'site_and_equipment'->>'street_and_number'),p->'site_and_equipment'->>'postal_code',btrim(p->'site_and_equipment'->>'city'),
    (p->'site_and_equipment'->>'equipment_type')::public.equipment_kind,p->'site_and_equipment'->>'manufacturer',p->'site_and_equipment'->>'model_or_type',p->'site_and_equipment'->>'machine_number',
    (case p->'request'->>'service_type' when 'inspection' then 'inspection' when 'maintenance' then 'scheduled_maintenance' else 'diagnosis_repair' end)::public.service_kind,
    (p->'request'->>'preferred_service_date')::date,p->'request'->>'description',
    (case p->'request'->>'urgency' when 'planned' then 'planbar' when 'time_sensitive' then 'zeitnah' when 'significant' then 'erheblich' else 'production_stop' end)::public.customer_urgency,
    (case p->'request'->>'known_safety_hazard' when 'no' then 'none_known' when 'yes' then 'known' else 'unclear' end)::public.safety_risk,
    p->'contract_and_attachments'->>'customer_or_sla_contract_number',coalesce((p->'contract_and_attachments'->>'emergency_sla_24_7')::boolean,false),
    p - 'turnstile_token',dispatcher,coalesce((p->'request'->>'requires_human_review')::boolean,false)
      or p->'request'->>'urgency'='production_stop' or p->'request'->>'known_safety_hazard' in ('yes','unclear')) returning * into req;
  for a in select value from jsonb_array_elements(p->'contract_and_attachments'->'attachments') loop
    insert into public.attachments(request_id,bucket,storage_path,file_name,mime_type,size_bytes)
    values(req.id,'dashboard',a->>'storage_path',a->>'file_name',a->>'mime_type',(a->>'size_bytes')::bigint);
  end loop;
  insert into public.request_events(request_id,actor_type,event_type,visibility,data)
  values(req.id,'automation','submission_received','dispatch',jsonb_build_object('source_event_key',k));
  -- task-19-3: hold the wished window (or the next free one) for the dispatcher; never lose the request over it
  begin
    perform private.hold_from_wish(req);
  exception when others then
    insert into public.request_events(request_id,actor_type,event_type,visibility,note)
    values(req.id,'system','visit_hold_failed','dispatch',left(sqlerrm,500));
  end;
  -- task-20-6: receipt after the hold, so it names the held window as not yet confirmed
  perform private.queue_receipt(req);
  return req;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'Invalid submission field type' using errcode='RW422';
end;
$function$;

create or replace function public.queue_visit_confirmation(visit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.visits;
  req public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into v from public.visits x where x.id = queue_visit_confirmation.visit_id;
  if not found or not private.can_access_request(v.request_id) then
    raise exception 'Einsatz nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if v.status <> 'scheduled' then
    raise exception 'Nur geplante Einsätze lassen sich bestätigen' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = v.request_id;
  perform private.queue_hold_mail(req,
    'Terminbestätigung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir bestätigen Ihren Termin für die Anfrage ' || req.request_number || ':', '',
      private.spoken_datetime(v.scheduled_start) || ', Dauer etwa ' || private.duration_text(v.scheduled_start, v.scheduled_end) || ',',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Sollte der Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
end;
$$;

create or replace function public.confirm_visit_hold(hold_id uuid, expected_version integer)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  hold public.visit_holds;
  req public.requests;
  result public.visits;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into hold from public.visit_holds h where h.id = confirm_visit_hold.hold_id for update;
  if not found or not private.can_access_request(hold.request_id) then
    raise exception 'Terminvormerkung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if hold.status <> 'open' or hold.expires_at <= now() then
    raise exception 'Die Vormerkung ist nicht mehr offen' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = hold.request_id;
  if req.intake_status <> 'processed' then
    raise exception 'Bitte zuerst die Erstbearbeitung abschließen, dann den Termin bestätigen' using errcode = 'RW422';
  end if;

  -- Holds do not block schedule_visit, so the visit can take the held window directly
  -- schedule_visit closes the hold and logs it (task-20-2)
  result := public.schedule_visit(hold.request_id, confirm_visit_hold.expected_version, hold.technician_id, hold.starts_at, hold.ends_at);

  select * into req from public.requests r where r.id = hold.request_id;
  perform private.queue_hold_mail(req,
    'Terminbestätigung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir bestätigen Ihren Termin für die Anfrage ' || req.request_number || ':', '',
      private.spoken_datetime(hold.starts_at) || ', Dauer etwa ' || private.duration_text(result.scheduled_start, result.scheduled_end) || ',',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Sollte der Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  return result;
end;
$function$;

notify pgrst, 'reload schema';
