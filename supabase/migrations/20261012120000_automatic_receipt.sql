-- Automatic receipt e-mail for website submissions (task-10-6).
-- A fixed-template receipt ("Eingangsbestätigung") is queued in the same transaction as the request
-- and sent by the existing Gmail send workflow. It is the only outgoing message approved by the system:
-- approved_at is set, approved_by stays null. Clarifications, invoices and free texts still need an employee.
-- Also accepts business e-mail addresses with subdomains (name@mail.firma.de), as the website form does.

alter table public.messages drop constraint messages_approval_pair;
alter table public.messages add constraint messages_approval_pair check (
  (approved_by is null) = (approved_at is null)
  or (kind = 'receipt' and direction = 'outgoing' and approved_by is null and approved_at is not null)
);

-- At most one receipt per request, so a repeated submission never sends twice.
create unique index messages_one_receipt_per_request on public.messages (request_id) where kind = 'receipt';

create function private.receipt_text(req public.requests) returns text
language sql immutable set search_path = '' as $$
  select concat_ws(E'\n',
    'Guten Tag ' || req.contact_name || ',',
    '',
    'vielen Dank für Ihre Serviceanfrage. Sie ist bei uns eingegangen und hat die Nummer ' || req.request_number || '.',
    '',
    'Ihre Angaben:',
    '- Unternehmen: ' || req.company_name,
    '- Standort: ' || req.street_house_number || ', ' || req.postal_code || ' ' || req.city,
    '- Leistung: ' || case req.service_kind when 'inspection' then 'Inspektion' when 'scheduled_maintenance' then 'Planmäßige Wartung' else 'Diagnose und Reparatur' end,
    '- Wunschtermin: ' || coalesce(to_char(req.requested_visit_date, 'DD.MM.YYYY'), 'keine Angabe'),
    '',
    'Unser Service Desk prüft die Anfrage und meldet sich mit einem Terminvorschlag oder mit Rückfragen. '
      || 'Mit dieser Bestätigung ist noch kein Auftrag erteilt; Priorität, Termin und Konditionen bestätigen wir nach der Prüfung.',
    '',
    'Bei Produktionsstillstand oder Sicherheitsgefahr rufen Sie uns bitte zusätzlich an: +49 621 00000-0.',
    '',
    'Antworten Sie bei Fragen einfach auf diese E-Mail oder nennen Sie die Nummer ' || req.request_number || ' im Betreff.',
    '',
    'Mit freundlichen Grüßen',
    'RheinWerk Industrieservice · Service Desk')
$$;

create function private.queue_receipt(req public.requests) returns void
language plpgsql security definer set search_path = '' as $$
declare msg public.messages;
begin
  if req.is_demo or nullif(btrim(req.business_email), '') is null then return; end if;
  insert into public.messages (request_id, direction, kind, status, to_address, subject, body_text, approved_at)
  values (req.id, 'outgoing', 'receipt', 'queued', req.business_email,
    'Eingangsbestätigung ' || req.request_number || ' · Ihre Serviceanfrage', private.receipt_text(req), now())
  on conflict (request_id) where kind = 'receipt' do nothing
  returning * into msg;
  if msg.id is null then return; end if;
  insert into public.request_events (request_id, actor_type, event_type, visibility, from_value, to_value, data)
  values (req.id, 'automation', 'message_queued', 'dispatch', null, 'queued',
    jsonb_build_object('message_id', msg.id, 'kind', msg.kind, 'approved_by', 'system'));
end;
$$;
revoke all on function private.receipt_text(public.requests), private.queue_receipt(public.requests) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ingest_submission(payload jsonb)
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
  perform private.queue_receipt(req);
  return req;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'Invalid submission field type' using errcode='RW422';
end;
$function$;

CREATE OR REPLACE FUNCTION public.claim_queued_messages(batch_limit integer DEFAULT 5, lease_seconds integer DEFAULT 180)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.messages; run public.automation_runs; lastmail public.messages;
begin
  perform private.require_integration();
  for m in select ms.* from public.messages ms join public.requests q on q.id=ms.request_id
    left join private.integration_send_leases l on l.message_id=ms.id
    where ms.direction='outgoing' and ms.status='queued' and not q.is_demo and (ms.approved_by is not null or ms.kind='receipt') and ms.approved_at is not null
      and (l.message_id is null or (l.lease_until<now() and l.next_attempt_at<=now()))
    order by ms.created_at limit greatest(1,least(batch_limit,20)) for update of ms skip locked loop
    insert into private.integration_send_leases(message_id,lease_until) values(m.id,now()+make_interval(secs=>greatest(60,least(lease_seconds,600))))
      on conflict(message_id) do update set lease_until=excluded.lease_until,attempts=private.integration_send_leases.attempts+1;
    insert into public.automation_runs(request_id,message_id,operation_key,step)
    values(m.request_id,m.id,'email_send:'||m.id,'email_send') on conflict(operation_key) do nothing;
    select * into lastmail from public.messages where request_id=m.request_id and mailbox_key='rheinwerk.industrieservice@gmail.com'
      and mime_message_id is not null order by created_at desc limit 1;
    return next to_jsonb(m)||jsonb_build_object('approved_by',coalesce(m.approved_by::text,'system'),'gmail_thread_id',coalesce(m.gmail_thread_id,lastmail.gmail_thread_id),
      'in_reply_to',coalesce(m.in_reply_to,lastmail.mime_message_id),'references_header',coalesce(m.references_header,lastmail.references_header));
  end loop;
end;
$function$;

notify pgrst, 'reload schema';
