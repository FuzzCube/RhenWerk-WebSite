begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
do $$
declare req public.requests; repeat_req public.requests; run jsonb; finished public.automation_runs; applied public.requests;
  result jsonb; msg jsonb; item public.messages; ctx jsonb; dispatcher uuid;
  p jsonb := '{"contract_version":"1.0","schema_version":"1.0","submission_id":"ddaa0000-0000-4000-8000-000000000001","privacy_consent":true,"contact":{"company_name":"Integration Test","contact_name":"Test Contact","business_email":"ops@example.com","phone":"+49123456789"},"site_and_equipment":{"street_and_number":"Teststrasse 1","postal_code":"10115","city":"Berlin","equipment_type":"compressor","manufacturer":"KAESER","model_or_type":"SM 13"},"request":{"service_type":"maintenance","urgency":"planned","known_safety_hazard":"no","description":"Wartung des Kompressors, keine Störung bekannt.","preferred_service_date":"2026-10-20"},"contract_and_attachments":{"emergency_sla_24_7":false,"attachments":[]}}';
begin
  req:=public.ingest_submission(p);
  repeat_req:=public.ingest_submission(p);
  if req.id<>repeat_req.id or (select count(*) from public.request_events where request_id=req.id and event_type='submission_received')<>1 then raise exception 'Ingest dedup failed'; end if;
  ctx:=public.get_analysis_context(req.id);
  if ctx->'request'->>'request_number'<>req.request_number then raise exception 'Context failed'; end if;
  run:=public.start_automation_run('test_analysis:'||req.id,'intake_analysis',req.id,null,req.version,'test-exec');
  if not (run->>'should_process')::boolean then raise exception 'Start failed'; end if;
  if (public.start_automation_run('test_analysis:'||req.id,'intake_analysis',req.id,null,req.version,'other-exec')->>'should_process')::boolean then raise exception 'Concurrent lease dedup failed'; end if;
  result:=jsonb_build_object('contract_version','1.0','request_id',req.id,'expected_version',req.version,'decision','ready_for_planning',
    'confidence',0.9,'priority','normal','service_kind','scheduled_maintenance','summary','Wartung KAESER SM 13',
    'missing_information','[]'::jsonb,'catalog_match',jsonb_build_object('status','listed_model'),
    'equipment',jsonb_build_object('manufacturer','KAESER','model','SM 13'));
  finished:=public.finish_automation_run((run->>'id')::uuid,'succeeded','ready_for_planning',0.9,result,null,null,'test-exec');
  applied:=public.apply_analysis_result(finished.id,req.id,req.version,result);
  if applied.intake_status<>'processed' or applied.intake_mode<>'automatic' then raise exception 'Ready apply failed'; end if;
  applied:=public.apply_analysis_result(finished.id,req.id,req.version,result);
  if (select count(*) from public.request_events where request_id=req.id and event_type='intake_completed')<>1 then raise exception 'Apply dedup failed'; end if;
  begin
    perform public.start_automation_run('stale:'||req.id,'intake_analysis',req.id,null,1,'stale-exec');
    raise exception 'Stale version accepted';
  exception when sqlstate 'RW409' then null; end;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  begin
    perform public.find_submission(req.id);
    raise exception 'Untrusted JWT accepted';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  p:=jsonb_set(p,'{submission_id}','"ddaa0000-0000-4000-8000-000000000002"');
  p:=jsonb_set(p,'{site_and_equipment,model_or_type}','"UNKNOWN MODEL"');
  req:=public.ingest_submission(p);
  run:=public.start_automation_run('test_analysis:'||req.id,'intake_analysis',req.id,null,req.version,'test-exec');
  result:=jsonb_set(jsonb_set(jsonb_set(result,'{request_id}',to_jsonb(req.id)),'{expected_version}',to_jsonb(req.version)),
    '{catalog_match,status}','"needs_review"');
  finished:=public.finish_automation_run((run->>'id')::uuid,'succeeded','ready_for_planning',0.9,result,null,null,'test-exec');
  applied:=public.apply_analysis_result(finished.id,req.id,req.version,result);
  if applied.intake_status<>'needs_review' or not applied.human_review_required or applied.intake_completed_at is not null then raise exception 'Unknown model gate failed'; end if;
  p:=jsonb_set(p,'{submission_id}','"ddaa0000-0000-4000-8000-000000000003"');
  p:=jsonb_set(p,'{site_and_equipment,model_or_type}','"SM 13"');
  req:=public.ingest_submission(p);
  run:=public.start_automation_run('test_analysis:'||req.id,'intake_analysis',req.id,null,req.version,'test-exec');
  result:=jsonb_set(jsonb_set(jsonb_set(result,'{request_id}',to_jsonb(req.id)),'{expected_version}',to_jsonb(req.version)),
    '{catalog_match,status}','"listed_model"');
  result:=jsonb_set(result,'{decision}','"ask_customer"');
  result:=jsonb_set(result,'{clarification_draft}','{"subject":"Rückfrage","body_text":"Bitte beschreiben Sie die Störung genauer."}');
  finished:=public.finish_automation_run((run->>'id')::uuid,'succeeded','ask_customer',0.9,result,null,null,'test-exec');
  applied:=public.apply_analysis_result(finished.id,req.id,req.version,result);
  select * into item from public.messages where request_id=req.id and direction='outgoing';
  if item.status<>'draft' or applied.intake_status='awaiting_customer' then raise exception 'Draft gate failed'; end if;
  select id into dispatcher from public.profiles where role='dispatcher' and is_active limit 1;
  update public.messages set status='queued',approved_by=dispatcher,approved_at=now() where id=item.id;
  perform public.claim_queued_messages(5,180);
  perform public.confirm_message_sent(item.id,null,'rheinwerk.industrieservice@gmail.com','gmail-test-1','thread-test-1','<test-1@rheinwerk-dashboard>');
  select * into applied from public.requests where id=req.id;
  if applied.intake_status<>'awaiting_customer' then raise exception 'Sent clarification state failed'; end if;
  msg:=public.record_incoming_message(jsonb_build_object('contract_version','1.0','mailbox_key','rheinwerk.industrieservice@gmail.com',
    'gmail_message_id','incoming-test-1','gmail_thread_id','thread-test-1','from_address','ops@example.com','subject','Re: Rückfrage',
    'body_text','Die Wartung soll im November stattfinden.','mime_message_id','<reply-test@example.com>'));
  if msg->>'request_id'<>req.id::text then raise exception 'Thread match failed'; end if;
  if exists(select 1 from public.list_pending_analyses(30) x where x->>'message_id'=msg->>'id') then raise exception 'Reply analysed before attachments were ready'; end if;
  if (public.record_incoming_message(jsonb_build_object('contract_version','1.0','mailbox_key','rheinwerk.industrieservice@gmail.com',
    'gmail_message_id','incoming-test-1','from_address','ops@example.com'))->>'id')<>msg->>'id' then raise exception 'Incoming dedup failed'; end if;
  perform public.register_incoming_attachment((msg->>'id')::uuid,'photo.png','image/png',100,'messages/'||(msg->>'id')||'/photo.png');
  perform public.complete_incoming_message((msg->>'id')::uuid);
  perform public.complete_incoming_message((msg->>'id')::uuid);
  msg:=public.record_incoming_message(jsonb_build_object('contract_version','1.0','mailbox_key','rheinwerk.industrieservice@gmail.com',
    'gmail_message_id','incoming-unmatched','from_address','ops@example.com','subject','Unrelated request','body_text','Andere Maschine.'));
  if msg->>'request_id' is not null then raise exception 'Sender-only match is forbidden'; end if;
  update public.messages set created_at=now()-interval '10 minutes' where id=(msg->>'id')::uuid;
  if not exists(select 1 from public.list_incomplete_incoming(10) x where x->>'gmail_message_id'='incoming-unmatched') then raise exception 'Incomplete message recovery failed'; end if;
  perform public.complete_incoming_message((msg->>'id')::uuid);
  if exists(select 1 from public.list_incomplete_incoming(10) x where x->>'gmail_message_id'='incoming-unmatched') then raise exception 'Completed message still in recovery'; end if;
  if not exists(select 1 from public.list_pending_analyses(30) x where x->>'request_id'=req.id::text) then raise exception 'Reply queue failed'; end if;
  raise notice 'PASS: ingestion, deduplication, leases, analysis, unknown-model guard, approval, sent state, thread match, unmatched sender, attachments, reply queue';
end;
$$;
rollback;
