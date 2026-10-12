from pathlib import Path

s = Path('integration_incoming.sql').read_text()
record = s[s.index('create or replace function public.record_incoming_message'):s.index('create or replace function public.list_pending_analyses')]
record = record.replace('matches integer;', 'matches integer; ambiguous boolean:=false;')
record = record.replace("raise exception 'Ambiguous thread assignment' using errcode='RW422';", 'ambiguous:=true;')
record = record.replace("raise exception 'Ambiguous reference assignment' using errcode='RW422';", 'ambiguous:=true;')
record = record.replace('if req is null then', 'if req is null and not ambiguous then')
record = record.replace("'matched',req is not null)", "'matched',req is not null,'ambiguous',ambiguous)")
complete = s[s.index('create function public.complete_incoming_message'):]
complete = complete.replace('create function', 'create or replace function', 1)
complete = complete.replace('declare m public.messages; q public.requests;', 'declare m public.messages; q public.requests; already_ready boolean;')
complete = complete.replace('  insert into private.integration_incoming_stage(message_id,ready,warnings,completed_at)', '''  select ready into already_ready from private.integration_incoming_stage st where st.message_id=m.id;
  if already_ready then return jsonb_build_object('message_id',m.id,'request_id',m.request_id,'ready',true,'duplicate',true); end if;
  insert into private.integration_incoming_stage(message_id,ready,warnings,completed_at)''')
recovery = '''
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
'''
Path('integration_recovery.sql').write_text(record+complete+recovery)
