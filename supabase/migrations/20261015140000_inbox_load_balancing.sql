-- task-11-7: the inbox of unmatched e-mails is shared by load instead of always going to the first active
-- dispatcher by id. Load = open intakes (not completed, live data) + open inbox e-mails (unmatched, not archived);
-- ties by id. The same rule serves phone requests (create_phone_request). Website requests keep their rule in
-- ingest_submission (open intakes only). On deactivation, open inbox e-mails move to the replacement or, without
-- one, to the least-loaded other active dispatcher.

drop function private.least_loaded_dispatcher();

create function private.least_loaded_dispatcher(excluded uuid default null)
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
    + (select count(*) from public.messages m where m.inbox_dispatcher_id = pr.id and m.request_id is null and m.archived_at is null),
    pr.id
  limit 1;
$$;

revoke all on function private.least_loaded_dispatcher(uuid) from public, anon, authenticated;

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
  -- task-11-7: unmatched e-mails go to the least-loaded active dispatcher (open intakes + open inbox e-mails)
  if req is null then
    perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment',0));
    dispatcher:=private.least_loaded_dispatcher();
  end if;
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

create or replace function public.admin_deactivate_employee(employee_id uuid, replacement_id uuid default null)
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
    inbox_target := coalesce(admin_deactivate_employee.replacement_id, private.least_loaded_dispatcher(emp.id));
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

notify pgrst, 'reload schema';
