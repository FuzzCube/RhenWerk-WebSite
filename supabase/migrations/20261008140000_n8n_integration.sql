-- Local n8n integration. Every write is a service-role RPC with an audit event.
create function private.require_integration() returns void language plpgsql stable set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Integration requires service_role' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_integration() from public, anon, authenticated;

create function public.ingest_submission(payload jsonb) returns public.requests
language plpgsql security definer set search_path = '' as $$
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
     or coalesce(p->'contact'->>'business_email','') !~* '^[^@\s]+@[^@\s.]+\.[a-z]{2,}$'
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
  return req;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'Invalid submission field type' using errcode='RW422';
end;
$$;

create function public.get_analysis_context(request_id uuid, message_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare req public.requests; msgs jsonb; files jsonb;
begin
  perform private.require_integration();
  select * into req from public.requests r where r.id=get_analysis_context.request_id and not r.is_demo;
  if not found then raise exception 'Live request not found' using errcode='RW404'; end if;
  if message_id is not null and not exists(select 1 from public.messages m where m.id=get_analysis_context.message_id and m.request_id=req.id and m.direction='incoming') then
    raise exception 'Message does not belong to request' using errcode='RW422';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at),'[]') into msgs from
    (select id,direction,kind,subject,body_text,created_at from public.messages where messages.request_id=req.id order by created_at desc limit 20) m;
  select coalesce(jsonb_agg(to_jsonb(a)),'[]') into files from public.attachments a where a.request_id=req.id;
  return jsonb_build_object('request',to_jsonb(req),'messages',msgs,'attachments',files,'message_id',message_id);
end;
$$;

create function public.start_automation_run(operation_key text, step public.automation_step, request_id uuid default null,
  message_id uuid default null,input_version integer default null,workflow_execution_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.automation_runs; req public.requests; new_run boolean := false;
begin
  perform private.require_integration();
  if nullif(btrim(operation_key),'') is null then raise exception 'Missing operation key' using errcode='RW422'; end if;
  if request_id is not null then
    select * into req from public.requests q where q.id=start_automation_run.request_id for share;
    if not found or req.is_demo then raise exception 'Live request required' using errcode='RW422'; end if;
    if input_version is not null and req.version<>input_version then raise exception 'Stale input' using errcode='RW409'; end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(operation_key,0));
  select * into r from public.automation_runs ar where ar.operation_key=start_automation_run.operation_key for update;
  if not found then
    insert into public.automation_runs(operation_key,step,request_id,message_id,input_version,workflow_execution_id)
    values(operation_key,step,request_id,message_id,input_version,workflow_execution_id) returning * into r;
    new_run := true;
  elsif r.request_id is distinct from request_id or r.step<>step or r.message_id is distinct from message_id then
    raise exception 'Operation identity mismatch' using errcode='RW422';
  elsif r.status='failed' or (r.status='running' and r.updated_at<now()-interval '5 minutes') then
    update public.automation_runs ar set status='running',decision=null,result=null,error_code=null,error_text=null,
      finished_at=null,workflow_execution_id=start_automation_run.workflow_execution_id where ar.id=r.id returning * into r;
    new_run := true;
  end if;
  return to_jsonb(r)||jsonb_build_object('should_process',new_run);
end;
$$;

create function public.finish_automation_run(run_id uuid,status public.automation_status,decision public.automation_decision default null,
  confidence numeric default null,result jsonb default null,error_code text default null,error_text text default null,
  workflow_execution_id text default null) returns public.automation_runs
language plpgsql security definer set search_path = '' as $$
declare r public.automation_runs;
begin
  perform private.require_integration();
  select * into r from public.automation_runs ar where ar.id=run_id for update;
  if not found then raise exception 'Run not found' using errcode='RW404'; end if;
  if r.status<>'running' then return r; end if;
  if r.workflow_execution_id is not null and r.workflow_execution_id is distinct from finish_automation_run.workflow_execution_id then
    raise exception 'Execution lease changed' using errcode='RW409';
  end if;
  if status not in ('succeeded','failed') then raise exception 'Terminal status required' using errcode='RW422'; end if;
  update public.automation_runs ar set status=finish_automation_run.status,decision=finish_automation_run.decision,
    confidence=finish_automation_run.confidence,result=finish_automation_run.result,error_code=finish_automation_run.error_code,
    error_text=finish_automation_run.error_text,finished_at=now() where ar.id=r.id returning * into r;
  return r;
end;
$$;

create function public.apply_analysis_result(run_id uuid,request_id uuid,expected_version integer,result jsonb) returns public.requests
language plpgsql security definer set search_path = '' as $$
declare req public.requests; r public.automation_runs; d text; msg uuid; baseline numeric;
begin
  perform private.require_integration();
  select * into r from public.automation_runs ar where ar.id=run_id for update;
  if not found or r.status<>'succeeded' or r.step not in ('intake_analysis','reply_analysis') or r.request_id is distinct from request_id then
    raise exception 'Successful matching analysis run required' using errcode='RW422';
  end if;
  select * into req from public.requests q where q.id=apply_analysis_result.request_id for update;
  if not found or req.is_demo then raise exception 'Live request required' using errcode='RW422'; end if;
  if coalesce((r.result->>'applied')::boolean,false) then return req; end if;
  if result is distinct from r.result or result->>'contract_version' is distinct from '1.0'
    or result->>'request_id' is distinct from request_id::text or (result->>'expected_version')::integer is distinct from expected_version then
    raise exception 'Result identity or contract mismatch' using errcode='RW422';
  end if;
  if req.version is distinct from expected_version then raise exception 'Stale analysis result' using errcode='RW409'; end if;
  if req.intake_completed_at is not null or private.is_terminal(req) then raise exception 'Human decision is final' using errcode='RW409'; end if;
  d:=result->>'decision';
  if d not in ('ready_for_planning','ask_customer','human_review') then raise exception 'Invalid decision' using errcode='RW422'; end if;
  if coalesce(result->>'priority','') not in ('low','normal','high','critical')
    or coalesce(result->>'service_kind','') not in ('inspection','scheduled_maintenance','diagnosis_repair')
    or jsonb_typeof(result->'missing_information') is distinct from 'array'
    or nullif(btrim(result->>'summary'),'') is null then raise exception 'Invalid analysis fields' using errcode='RW422'; end if;
  -- These gates apply to every automatic outcome, regardless of the model's proposed decision.
  if req.human_review_required or req.safety_risk<>'none_known' or req.customer_urgency='production_stop'
    or coalesce((result->>'safety_flag')::boolean,false) or coalesce((result->>'contradictions')::boolean,false)
    or result->'catalog_match'->>'status' in ('needs_review','series_match','out_of_scope')
    or (nullif(btrim(coalesce(result->'equipment'->>'model',req.model_type)),'') is not null
        and result->'catalog_match'->>'status' is distinct from 'listed_model') then d:='human_review'; end if;
  if d='ready_for_planning' and jsonb_array_length(result->'missing_information')>0 then
    raise exception 'Missing information cannot be marked ready' using errcode='RW422'; end if;
  if d='ask_customer' and (nullif(btrim(result->'clarification_draft'->>'body_text'),'') is null
    or nullif(btrim(result->'clarification_draft'->>'subject'),'') is null) then
    raise exception 'Clarification draft required' using errcode='RW422'; end if;
  select manual_intake_minutes into baseline from public.settings where id=1;
  if d='ask_customer' then
    insert into public.messages(request_id,direction,kind,status,from_address,to_address,subject,body_text,mailbox_key,
      gmail_thread_id,in_reply_to,references_header)
    select req.id,'outgoing','clarification','draft','rheinwerk.industrieservice@gmail.com',req.business_email,
      req.request_number||' · '||left(regexp_replace(result->'clarification_draft'->>'subject','[\r\n]',' ','g'),150),
      result->'clarification_draft'->>'body_text','rheinwerk.industrieservice@gmail.com',m.gmail_thread_id,m.mime_message_id,
      case when m.mime_message_id is null then m.references_header else array_append(coalesce(m.references_header,'{}'),m.mime_message_id) end
    from (select 1) seed left join lateral (select * from public.messages where messages.request_id=req.id and direction='incoming' order by created_at desc limit 1) m on true
    returning id into msg;
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(req.id,'automation','message_drafted','dispatch',jsonb_build_object('message_id',msg,'run_id',run_id));
  end if;
  update public.requests q set priority=(result->>'priority')::public.request_priority,
    service_kind=(result->>'service_kind')::public.service_kind,
    manufacturer=coalesce(nullif(btrim(result->'equipment'->>'manufacturer'),''),q.manufacturer),
    model_type=coalesce(nullif(btrim(result->'equipment'->>'model'),''),q.model_type),
    machine_number=coalesce(nullif(btrim(result->'equipment'->>'machine_number'),''),q.machine_number),
    intake_status=(case when d='ready_for_planning' then 'processed' else 'needs_review' end)::public.intake_status,
    human_review_required=q.human_review_required or d='human_review',
    intake_completed_at=case when d='ready_for_planning' then now() else q.intake_completed_at end,
    intake_mode=case when d='ready_for_planning' then 'automatic'::public.intake_mode else q.intake_mode end,
    manual_minutes_baseline=case when d='ready_for_planning' then baseline else q.manual_minutes_baseline end
    where q.id=req.id;
  insert into public.request_events(request_id,actor_type,event_type,visibility,from_value,to_value,note,data)
    values(req.id,'automation','intake_status_changed','dispatch',req.intake_status::text,
      case when d='ready_for_planning' then 'processed' else 'needs_review' end,result->>'summary',jsonb_build_object('run_id',run_id,'decision',d));
  if d='ready_for_planning' then
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(req.id,'automation','intake_completed','dispatch',jsonb_build_object('run_id',run_id,'intake_mode','automatic','manual_minutes_baseline',baseline));
  end if;
  update public.automation_runs ar set result=ar.result||jsonb_build_object('applied',true,'effective_decision',d) where ar.id=run_id;
  if r.message_id is not null then update public.messages m set handled_at=now() where m.id=r.message_id; end if;
  select * into req from public.requests q where q.id=req.id;
  return req;
end;
$$;

create function public.list_pending_analyses(batch_limit integer default 10) returns setof jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_integration();
  return query select jsonb_build_object('request_id',r.id,'message_id',reply.id) from public.requests r
    left join lateral(select m.id from public.messages m where m.request_id=r.id and m.direction='incoming'
      and m.handled_at is null order by m.created_at desc limit 1) reply on true
    where not r.is_demo and r.intake_completed_at is null and not private.is_terminal(r)
      and (r.intake_status in ('new','analyzing') or (r.intake_status='awaiting_customer' and reply.id is not null))
    order by r.created_at limit greatest(1,least(batch_limit,30));
end;
$$;

create function public.record_incoming_message(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb:=payload; msg public.messages; req uuid; dispatcher uuid; candidate uuid[]; thread text; ref text; num text; matches integer;
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
  if coalesce(cardinality(candidate),0)>1 then raise exception 'Ambiguous thread assignment' using errcode='RW422'; end if;
  if req is null then
    select array_agg(distinct m.request_id) into candidate from public.messages m
    where m.mailbox_key=p->>'mailbox_key' and m.request_id is not null and
      (m.mime_message_id=p->>'in_reply_to' or m.mime_message_id in(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))));
    if cardinality(candidate)=1 then req:=candidate[1]; end if;
    if coalesce(cardinality(candidate),0)>1 then raise exception 'Ambiguous reference assignment' using errcode='RW422'; end if;
  end if;
  if req is null then
    select array_agg(distinct r.id) into candidate from public.requests r
      where r.request_number in(select upper((s)[1]) from regexp_matches(coalesce(p->>'subject',''),'\m(RIS-[0-9]{4}-[0-9]{5})\M','gi') s);
    if cardinality(candidate)=1 then req:=candidate[1]; end if;
  end if;
  if exists(select 1 from public.requests r where r.id=req and r.is_demo) then
    return jsonb_build_object('ignored',true,'reason','demo_request'); end if;
  select id into dispatcher from public.profiles where role='dispatcher' and is_active order by id limit 1;
  if req is null and dispatcher is null then raise exception 'No dispatcher for unmatched message' using errcode='RW422'; end if;
  insert into public.messages(request_id,inbox_dispatcher_id,direction,kind,status,from_address,to_address,subject,body_text,
    mailbox_key,gmail_message_id,gmail_thread_id,mime_message_id,in_reply_to,references_header,received_at)
  values(req,case when req is null then dispatcher else null end,'incoming',case when req is null then 'other'::public.message_kind else 'customer_reply' end,
    'received',p->>'from_address',p->>'mailbox_key',coalesce(p->>'subject',''),coalesce(p->>'body_text',''),
    p->>'mailbox_key',p->>'gmail_message_id',thread,p->>'mime_message_id',p->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))),coalesce((p->>'received_at')::timestamptz,now())) returning * into msg;
  insert into public.automation_runs(operation_key,step,request_id,message_id,status,decision,result,finished_at)
  values('email_matching:'||(p->>'mailbox_key')||':'||(p->>'gmail_message_id'),'email_matching',req,msg.id,'succeeded',
    case when req is null then 'unmatched'::public.automation_decision else 'matched' end,jsonb_build_object('contract_version','1.0','matched',req is not null),now());
  if req is not null then
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(req,'automation','message_received','dispatch',jsonb_build_object('message_id',msg.id));
  end if;
  return to_jsonb(msg)||jsonb_build_object('duplicate',false,'matched',req is not null);
end;
$$;

create function public.register_incoming_attachment(message_id uuid,file_name text,mime_type text,size_bytes bigint,storage_path text) returns public.attachments
language plpgsql security definer set search_path = '' as $$
declare m public.messages; a public.attachments;
begin
  perform private.require_integration();
  select * into m from public.messages where id=message_id and direction='incoming';
  if not found or mime_type not in ('application/pdf','image/jpeg','image/png') or size_bytes not between 1 and 5242880
    or storage_path not like 'messages/'||message_id||'/%' or storage_path like '%..%' then
    raise exception 'Invalid incoming attachment' using errcode='RW422'; end if;
  if exists(select 1 from public.requests r where r.id=m.request_id and r.is_demo) then raise exception 'Demo request' using errcode='RW422'; end if;
  insert into public.attachments(request_id,message_id,bucket,storage_path,file_name,mime_type,size_bytes)
  values(m.request_id,m.id,'dashboard',storage_path,file_name,mime_type,size_bytes)
  on conflict on constraint attachments_storage_unique do nothing returning * into a;
  if not found then select * into a from public.attachments where bucket='dashboard' and attachments.storage_path=register_incoming_attachment.storage_path; end if;
  return a;
end;
$$;

-- Delivery leases are stored separately from the immutable message identity.
create table private.integration_send_leases(message_id uuid primary key references public.messages(id),lease_until timestamptz not null,
  next_attempt_at timestamptz not null default now(),attempts integer not null default 1);
revoke all on private.integration_send_leases from public,anon,authenticated;

create function public.claim_queued_messages(batch_limit integer default 5,lease_seconds integer default 180) returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.messages; run public.automation_runs; lastmail public.messages;
begin
  perform private.require_integration();
  for m in select ms.* from public.messages ms join public.requests q on q.id=ms.request_id
    left join private.integration_send_leases l on l.message_id=ms.id
    where ms.direction='outgoing' and ms.status='queued' and not q.is_demo and ms.approved_by is not null and ms.approved_at is not null
      and (l.message_id is null or (l.lease_until<now() and l.next_attempt_at<=now()))
    order by ms.created_at limit greatest(1,least(batch_limit,20)) for update of ms skip locked loop
    insert into private.integration_send_leases(message_id,lease_until) values(m.id,now()+make_interval(secs=>greatest(60,least(lease_seconds,600))))
      on conflict(message_id) do update set lease_until=excluded.lease_until,attempts=private.integration_send_leases.attempts+1;
    insert into public.automation_runs(request_id,message_id,operation_key,step)
    values(m.request_id,m.id,'email_send:'||m.id,'email_send') on conflict(operation_key) do nothing;
    select * into lastmail from public.messages where request_id=m.request_id and mailbox_key='rheinwerk.industrieservice@gmail.com'
      and mime_message_id is not null order by created_at desc limit 1;
    return next to_jsonb(m)||jsonb_build_object('gmail_thread_id',coalesce(m.gmail_thread_id,lastmail.gmail_thread_id),
      'in_reply_to',coalesce(m.in_reply_to,lastmail.mime_message_id),'references_header',coalesce(m.references_header,lastmail.references_header));
  end loop;
end;
$$;

create function public.mark_message_failed(message_id uuid,error_text text,permanent boolean default false) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  perform private.require_integration();
  select * into m from public.messages where id=message_id for update;
  if not found then raise exception 'Message not found' using errcode='RW404'; end if;
  if m.status='sent' then return m; end if;
  if m.status<>'queued' then raise exception 'Queued message required' using errcode='RW422'; end if;
  update public.messages set status=case when permanent then 'failed'::public.message_status else 'queued' end,
    error_text=left(coalesce(mark_message_failed.error_text,'Delivery failed'),1000) where id=message_id returning * into m;
  update private.integration_send_leases set lease_until=now(),next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,7))::integer)) where integration_send_leases.message_id=mark_message_failed.message_id;
  update public.automation_runs set status='failed',finished_at=now(),error_code='GMAIL_SEND_FAILED',error_text=mark_message_failed.error_text,decision=null
    where operation_key='email_send:'||message_id and status<>'succeeded';
  insert into public.request_events(request_id,actor_type,event_type,visibility,data)
  values(m.request_id,'automation','message_send_failed','dispatch',jsonb_build_object('message_id',m.id,'permanent',permanent));
  return m;
end;
$$;

-- Preserve the existing delivery operation, then add clarification state and run completion.
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

  select * into req from public.requests r where r.id = msg.request_id for update;
  if req.is_demo then
    raise exception 'Demo-Anfragen werden nicht versendet' using errcode = 'RW422';
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


revoke all on function public.confirm_message_sent_base(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;
create or replace function public.confirm_message_sent(message_id uuid,sent_at timestamptz default null,mailbox_key text default null,
  gmail_message_id text default null,gmail_thread_id text default null,mime_message_id text default null) returns public.messages
language plpgsql security definer set search_path = '' as $$
declare m public.messages; req public.requests; was_sent boolean;
begin
  perform private.require_integration();
  select status='sent' into was_sent from public.messages where id=message_id;
  m:=public.confirm_message_sent_base(message_id,sent_at,mailbox_key,gmail_message_id,gmail_thread_id,mime_message_id);
  select * into req from public.requests where id=m.request_id for update;
  if not was_sent and m.kind='clarification' and req.intake_completed_at is null and not private.is_terminal(req)
    and not exists(select 1 from public.messages mi where mi.request_id=req.id and mi.direction='incoming' and mi.received_at>m.created_at) then
    update public.requests set intake_status='awaiting_customer' where id=req.id;
    insert into public.request_events(request_id,actor_type,event_type,visibility,from_value,to_value,data)
    values(req.id,'automation','intake_status_changed','dispatch',req.intake_status::text,'awaiting_customer',jsonb_build_object('message_id',m.id));
  end if;
  update public.automation_runs set status='succeeded',decision='sent',finished_at=now(),error_code=null,error_text=null,
    result=jsonb_build_object('contract_version','1.0','gmail_message_id',m.gmail_message_id,'gmail_thread_id',m.gmail_thread_id)
    where operation_key='email_send:'||m.id;
  return m;
end;
$$;

revoke all on function public.ingest_submission(jsonb),public.get_analysis_context(uuid,uuid),
 public.start_automation_run(text,public.automation_step,uuid,uuid,integer,text),
 public.finish_automation_run(uuid,public.automation_status,public.automation_decision,numeric,jsonb,text,text,text),
 public.apply_analysis_result(uuid,uuid,integer,jsonb),public.list_pending_analyses(integer),public.record_incoming_message(jsonb),
 public.register_incoming_attachment(uuid,text,text,bigint,text),public.claim_queued_messages(integer,integer),
 public.mark_message_failed(uuid,text,boolean),public.confirm_message_sent(uuid,timestamptz,text,text,text,text) from public,anon,authenticated;
grant execute on function public.ingest_submission(jsonb),public.get_analysis_context(uuid,uuid),
 public.start_automation_run(text,public.automation_step,uuid,uuid,integer,text),
 public.finish_automation_run(uuid,public.automation_status,public.automation_decision,numeric,jsonb,text,text,text),
 public.apply_analysis_result(uuid,uuid,integer,jsonb),public.list_pending_analyses(integer),public.record_incoming_message(jsonb),
 public.register_incoming_attachment(uuid,text,text,bigint,text),public.claim_queued_messages(integer,integer),
 public.mark_message_failed(uuid,text,boolean),public.confirm_message_sent(uuid,timestamptz,text,text,text,text) to service_role;
notify pgrst,'reload schema';
create function public.find_submission(submission_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare req public.requests;
begin
  perform private.require_integration();
  select * into req from public.requests r where r.source_event_key='website_form:'||submission_id;
  return jsonb_build_object('exists',found,'request',case when req.id is null then null else to_jsonb(req) end);
end;
$$;
create function public.list_orphaned_integration_files() returns setof jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_integration();
  return query select jsonb_build_object('storage_path',o.name) from storage.objects o
    where o.bucket_id='dashboard' and o.created_at<now()-interval '24 hours'
    and o.name~'^(requests|messages)/[0-9a-f-]{36}/'
    and not exists(select 1 from public.attachments a where a.bucket=o.bucket_id and a.storage_path=o.name);
end;
$$;
revoke all on function public.find_submission(uuid),public.list_orphaned_integration_files() from public,anon,authenticated;
grant execute on function public.find_submission(uuid),public.list_orphaned_integration_files() to service_role;
notify pgrst,'reload schema';
