-- task-20-12 (user request 23.10.2026): new requests go to the active dispatcher with the fewest requests of the
-- current calendar month (Europe/Berlin), so that every dispatcher ends up with about the same number. Unprocessed
-- requests count, cancelled and rejected ones and unmatched inbox messages do not. On a tie the dispatcher who has gone
-- longest without a new request comes first. Before, only open intakes counted: whoever finished intakes fastest got
-- every new request. The website form had its own copy of the old rule and now uses the shared function as well;
-- unmatched inbox e-mails (record_incoming_message, admin_deactivate_employee) keep the old rule.

create or replace function private.least_loaded_dispatcher(excluded uuid default null)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id from public.profiles pr
  cross join lateral (select date_trunc('month', now() at time zone 'Europe/Berlin') at time zone 'Europe/Berlin' as month_start) m
  where pr.role = 'dispatcher' and pr.is_active and pr.id is distinct from excluded
  order by
    (select count(*) from public.requests r where r.dispatcher_id = pr.id and not r.is_demo
      and r.created_at >= m.month_start and r.intake_status not in ('cancelled', 'rejected')),
    (select max(r.created_at) from public.requests r where r.dispatcher_id = pr.id and not r.is_demo) nulls first,
    pr.id
  limit 1;
$$;

-- Unmatched inbox e-mails keep the previous rule (open intakes + open conversations), so e-mails are still spread
-- although they do not count towards the requests of the month
create function private.least_loaded_inbox_dispatcher(excluded uuid default null)
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

revoke all on function private.least_loaded_inbox_dispatcher(uuid) from public, anon, authenticated;

create or replace function public.ingest_submission(payload jsonb)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
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
  dispatcher := private.least_loaded_dispatcher();
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
$$;

create or replace function public.record_incoming_message(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    dispatcher:=private.least_loaded_inbox_dispatcher();
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

create or replace function public.admin_deactivate_employee(employee_id uuid, replacement_id uuid DEFAULT NULL::uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid;
  emp public.profiles;
  item record;
  moved_requests integer := 0;
  moved_visits integer := 0;
  moved_inbox integer := 0;
  inbox_target uuid;
  note text;
begin
  caller := private.require_role('admin');
  if admin_deactivate_employee.employee_id = caller then
    raise exception 'Das eigene Konto kann nicht deaktiviert werden' using errcode = 'RW422';
  end if;

  emp := private.lock_employee(admin_deactivate_employee.employee_id);
  if not emp.is_active then
    raise exception 'Mitarbeiter ist bereits deaktiviert' using errcode = 'RW422';
  end if;

  if exists (select 1 from private.employee_assignments(emp.id) a where a.visit_status = 'in_progress') then
    raise exception 'Ein laufender Einsatz muss zuerst abgeschlossen werden' using errcode = 'RW422';
  end if;

  if exists (select 1 from private.employee_assignments(emp.id)) then
    if admin_deactivate_employee.replacement_id is null then
      raise exception 'Aktive Zuweisungen vorhanden: bitte eine Vertretung für die Neuzuweisung wählen' using errcode = 'RW422';
    end if;
    if admin_deactivate_employee.replacement_id = emp.id or not exists (
      select 1 from public.profiles p
      where p.id = admin_deactivate_employee.replacement_id and p.is_active and p.role = emp.role
    ) then
      raise exception 'Neuzuweisung nur an aktive Mitarbeitende derselben Rolle' using errcode = 'RW422';
    end if;
  end if;

  note := 'Neuzuweisung wegen Deaktivierung von ' || emp.display_name;

  -- Requests in a fixed order (deadlock-free), each locked before the change
  for item in
    select distinct a.request_id, a.assignment from private.employee_assignments(emp.id) a
    where a.assignment in ('dispatcher', 'technician')
    order by a.request_id, a.assignment
  loop
    perform 1 from public.requests r where r.id = item.request_id for update;
    if item.assignment = 'dispatcher' then
      update public.requests r set dispatcher_id = admin_deactivate_employee.replacement_id where r.id = item.request_id;
      perform private.log_request_event(item.request_id, 'dispatcher_assigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note, event_visibility => 'dispatch');
    else
      update public.requests r set technician_id = admin_deactivate_employee.replacement_id where r.id = item.request_id;
      perform private.log_request_event(item.request_id, 'technician_assigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note);
    end if;
    moved_requests := moved_requests + 1;
  end loop;

  -- Scheduled visits: same interval, the replacement must be available
  if exists (select 1 from private.employee_assignments(emp.id) a where a.assignment = 'visit') then
    perform private.lock_technician(t)
    from unnest(array[emp.id, admin_deactivate_employee.replacement_id]) as t order by t;

    for item in
      select a.visit_id, a.request_id, a.scheduled_start, a.scheduled_end from private.employee_assignments(emp.id) a
      where a.assignment = 'visit'
      order by a.scheduled_start
    loop
      if private.availability_problem(admin_deactivate_employee.replacement_id, item.scheduled_start, item.scheduled_end) is not null then
        raise exception 'Einsatz am % (%): %', to_char(item.scheduled_start at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI'),
          (select r.request_number from public.requests r where r.id = item.request_id),
          private.availability_problem(admin_deactivate_employee.replacement_id, item.scheduled_start, item.scheduled_end)
          using errcode = 'RW422';
      end if;
      begin
        update public.visits v set technician_id = admin_deactivate_employee.replacement_id where v.id = item.visit_id;
      exception when exclusion_violation then
        raise exception 'Einsatz am % überschneidet sich mit einem Einsatz der Vertretung',
          to_char(item.scheduled_start at time zone 'Europe/Berlin', 'DD.MM.YYYY HH24:MI')
          using errcode = 'RW410';
      end;
      insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, from_value, to_value, note, data)
      values (item.request_id, item.visit_id, 'user', caller, 'visit_reassigned', emp.id::text,
        admin_deactivate_employee.replacement_id::text, note,
        jsonb_build_object('old_technician_id', emp.id, 'new_technician_id', admin_deactivate_employee.replacement_id,
          'scheduled_start', item.scheduled_start, 'scheduled_end', item.scheduled_end));
      moved_visits := moved_visits + 1;
    end loop;
  end if;

  -- task-11-7: open inbox e-mails go to the replacement, without one to the least-loaded other dispatcher
  -- (they would otherwise stay with an inactive person, visible only to manager and admin)
  if exists (select 1 from public.messages m where m.inbox_dispatcher_id = emp.id and m.request_id is null and m.archived_at is null) then
    perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment', 0));
    inbox_target := coalesce(admin_deactivate_employee.replacement_id, private.least_loaded_inbox_dispatcher(emp.id));
    if inbox_target is not null then
      update public.messages m set inbox_dispatcher_id = inbox_target
      where m.inbox_dispatcher_id = emp.id and m.request_id is null and m.archived_at is null;
      get diagnostics moved_inbox = row_count;
    end if;
  end if;

  update public.profiles p set is_active = false where p.id = emp.id;
  return jsonb_build_object('reassigned_requests', moved_requests, 'reassigned_visits', moved_visits, 'reassigned_inbox', moved_inbox);
end;
$$;
