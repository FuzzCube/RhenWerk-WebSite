create or replace function public.record_incoming_message(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb:=payload; msg public.messages; req uuid; dispatcher uuid; candidate uuid[]; thread text; ref text; num text; matches integer; ambiguous boolean:=false;
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
  select id into dispatcher from public.profiles where role='dispatcher' and is_active order by id limit 1;
  if req is null and dispatcher is null then raise exception 'No dispatcher for unmatched message' using errcode='RW422'; end if;
  insert into public.messages(request_id,inbox_dispatcher_id,direction,kind,status,from_address,to_address,subject,body_text,
    mailbox_key,gmail_message_id,gmail_thread_id,mime_message_id,in_reply_to,references_header,received_at)
  values(req,case when req is null then dispatcher else null end,'incoming',case when req is null then 'other'::public.message_kind else 'customer_reply' end,
    'received',p->>'from_address',p->>'mailbox_key',coalesce(p->>'subject',''),coalesce(p->>'body_text',''),
    p->>'mailbox_key',p->>'gmail_message_id',thread,p->>'mime_message_id',p->>'in_reply_to',
    array(select jsonb_array_elements_text(coalesce(p->'references_header','[]'))),coalesce((p->>'received_at')::timestamptz,now())) returning * into msg;
  insert into private.integration_incoming_stage(message_id) values(msg.id);
  insert into public.automation_runs(operation_key,step,request_id,message_id,status,decision,result,finished_at)
  values('email_matching:'||(p->>'mailbox_key')||':'||(p->>'gmail_message_id'),'email_matching',req,msg.id,'succeeded',
    case when req is null then 'unmatched'::public.automation_decision else 'matched' end,jsonb_build_object('contract_version','1.0','matched',req is not null,'ambiguous',ambiguous),now());
  if req is not null then
    insert into public.request_events(request_id,actor_type,event_type,visibility,data)
    values(req,'automation','message_received','dispatch',jsonb_build_object('message_id',msg.id));
  end if;
  return to_jsonb(msg)||jsonb_build_object('duplicate',false,'matched',req is not null,'ambiguous',ambiguous);
end;
$$;

create or replace function public.complete_incoming_message(message_id uuid,warnings jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.messages; q public.requests; already_ready boolean;
begin
  perform private.require_integration();
  if jsonb_typeof(warnings) is distinct from 'array' then raise exception 'Warnings must be an array' using errcode='RW422'; end if;
  select * into m from public.messages where id=message_id and direction='incoming' for update;
  if not found then raise exception 'Incoming message required' using errcode='RW422'; end if;
  select ready into already_ready from private.integration_incoming_stage st where st.message_id=m.id;
  if already_ready then return jsonb_build_object('message_id',m.id,'request_id',m.request_id,'ready',true,'duplicate',true); end if;
  insert into private.integration_incoming_stage(message_id,ready,warnings,completed_at)
    values(m.id,true,complete_incoming_message.warnings,now()) on conflict on constraint integration_incoming_stage_pkey do update
    set ready=true,warnings=excluded.warnings,completed_at=coalesce(integration_incoming_stage.completed_at,excluded.completed_at);
  if m.request_id is not null and jsonb_array_length(warnings)>0 then
    select * into q from public.requests where id=m.request_id for update;
    if not q.is_demo and q.intake_completed_at is null and not private.is_terminal(q) then
      update public.requests set human_review_required=true,intake_status='needs_review' where id=q.id;
      update public.messages set handled_at=now() where id=m.id;
      insert into public.request_events(request_id,actor_type,event_type,visibility,data)
        values(q.id,'automation','incoming_attachment_review','dispatch',jsonb_build_object('message_id',m.id,'warnings',warnings));
    end if;
  end if;
  return jsonb_build_object('message_id',m.id,'request_id',m.request_id,'ready',true,'warnings',warnings);
end;
$$;
revoke all on function public.complete_incoming_message(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.complete_incoming_message(uuid,jsonb) to service_role;
notify pgrst,'reload schema';

create function public.list_incomplete_incoming(batch_limit integer default 5) returns setof jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.require_integration();
  return query select jsonb_build_object('gmail_message_id',m.gmail_message_id) from private.integration_incoming_stage s
    join public.messages m on m.id=s.message_id left join public.requests r on r.id=m.request_id
    where not s.ready and m.created_at<now()-interval '5 minutes' and not coalesce(r.is_demo,false)
      and m.mailbox_key='rheinwerk.industrieservice@gmail.com'
    order by m.created_at limit greatest(1,least(batch_limit,10));
end;
$$;
revoke all on function public.list_incomplete_incoming(integer) from public,anon,authenticated;
grant execute on function public.list_incomplete_incoming(integer) to service_role;
notify pgrst,'reload schema';
