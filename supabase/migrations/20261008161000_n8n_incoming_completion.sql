create or replace function public.complete_incoming_message(message_id uuid,warnings jsonb default '[]') returns jsonb
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
