from pathlib import Path

source = Path('integration.sql').read_text()
record = source[source.index('create function public.record_incoming_message'):source.index('create function public.register_incoming_attachment')]
record = record.replace('create function', 'create or replace function', 1)
record = record.replace("  insert into public.automation_runs(operation_key,step,request_id,message_id,status,decision,result,finished_at)", "  insert into private.integration_incoming_stage(message_id) values(msg.id);\n  insert into public.automation_runs(operation_key,step,request_id,message_id,status,decision,result,finished_at)")
pending = source[source.index('create function public.list_pending_analyses'):source.index('create function public.record_incoming_message')]
pending = pending.replace('create function', 'create or replace function', 1)
pending = pending.replace("and m.handled_at is null", "and m.handled_at is null and not exists(select 1 from private.integration_incoming_stage s where s.message_id=m.id and not s.ready)")
sql = '''-- Wait for all Gmail attachments before an incoming reply becomes analysable.
create table private.integration_incoming_stage(message_id uuid primary key references public.messages(id), ready boolean not null default false, warnings jsonb not null default '[]', completed_at timestamptz);
revoke all on private.integration_incoming_stage from public, anon, authenticated;
'''+record+pending+'''
create function public.complete_incoming_message(message_id uuid,warnings jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.messages; q public.requests;
begin
  perform private.require_integration();
  if jsonb_typeof(warnings) is distinct from 'array' then raise exception 'Warnings must be an array' using errcode='RW422'; end if;
  select * into m from public.messages where id=message_id and direction='incoming' for update;
  if not found then raise exception 'Incoming message required' using errcode='RW422'; end if;
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
'''
Path('integration_incoming.sql').write_text(sql)
