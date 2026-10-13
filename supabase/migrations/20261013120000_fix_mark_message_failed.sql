-- task-9-2: supabase db lint reported "column reference message_id is ambiguous" in mark_message_failed
-- (parameter vs. automation_runs.message_id). The statement only fails at run time, i.e. whenever n8n reports a
-- failed Gmail send. Same body, every use of the parameter qualified with the function name.
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
  insert into public.request_events(request_id,actor_type,event_type,visibility,data)
  values(m.request_id,'automation','message_send_failed','dispatch',jsonb_build_object('message_id',m.id,'permanent',mark_message_failed.permanent));
  return m;
end;
$$;
