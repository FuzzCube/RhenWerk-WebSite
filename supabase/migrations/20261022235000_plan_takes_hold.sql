-- task-20-2 (user request 22.10.2026): the dispatcher plans a held request on the planning board like any other
-- (the hold is preselected there). Planning closes the open hold of the request as confirmed with the planned visit,
-- also when another window was chosen, without a rejection e-mail; the planning board sends the Terminbestätigung.

create or replace function public.schedule_visit(request_id uuid, expected_version integer, technician_id uuid, scheduled_start timestamp with time zone, scheduled_end timestamp with time zone)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  req public.requests;
  result public.visits;
  held public.visit_holds;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(schedule_visit.request_id, schedule_visit.expected_version);

  if req.intake_status <> 'processed' or private.is_terminal(req) then
    raise exception 'Einsatzplanung nur für bearbeitete, nicht abgeschlossene Anfragen' using errcode = 'RW422';
  end if;

  if req.safety_risk <> 'none_known' and req.intake_mode = 'automatic' and not exists (
    select 1 from public.request_events e
    where e.request_id = req.id and e.actor_type = 'user' and e.event_type in ('automatic_result_corrected', 'analysis_corrected', 'intake_status_changed')
  ) then
    raise exception 'Gemeldete oder unklare Sicherheitsgefahr erfordert vor der Planung eine menschliche Prüfung' using errcode = 'RW422';
  end if;

  if schedule_visit.scheduled_start < now() then
    raise exception 'Einsätze können nicht in der Vergangenheit geplant werden' using errcode = 'RW422';
  end if;

  perform private.require_active_technician(schedule_visit.technician_id);
  perform private.lock_technician(schedule_visit.technician_id);
  perform private.require_available(schedule_visit.technician_id, schedule_visit.scheduled_start, schedule_visit.scheduled_end);

  begin
    insert into public.visits (request_id, technician_id, status, scheduled_start, scheduled_end, created_by)
    values (req.id, schedule_visit.technician_id, 'scheduled', schedule_visit.scheduled_start, schedule_visit.scheduled_end, (select auth.uid()))
    returning * into result;
  exception when exclusion_violation then
    raise exception 'Der Techniker hat in diesem Zeitraum bereits einen Einsatz' using errcode = 'RW410';
  end;

  if req.technician_id is distinct from schedule_visit.technician_id then
    update public.requests r set technician_id = schedule_visit.technician_id where r.id = req.id;
    perform private.log_request_event(req.id, 'technician_assigned', req.technician_id::text, schedule_visit.technician_id::text);
  end if;

  insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, to_value, data)
  values (req.id, result.id, 'user', (select auth.uid()), 'visit_scheduled',
    tstzrange(result.scheduled_start, result.scheduled_end, '[)')::text,
    jsonb_build_object('technician_id', result.technician_id, 'scheduled_start', result.scheduled_start, 'scheduled_end', result.scheduled_end));

  if req.work_status in ('not_planned', 'waiting_parts') then
    perform private.set_work_status(req, 'scheduled');
  end if;

  -- task-20-2: planning takes over an open hold of the request, in its window or elsewhere; no e-mail about it
  -- (the planning board sends the Terminbestätigung of the planned time)
  for held in update public.visit_holds h set status = 'confirmed', decided_by = (select auth.uid()), decided_at = now(), visit_id = result.id
    where h.request_id = req.id and h.status = 'open' returning h.* loop
    insert into public.request_events (request_id, visit_id, actor_type, actor_id, event_type, visibility, data)
    values (req.id, result.id, 'user', (select auth.uid()), 'visit_hold_confirmed', 'dispatch',
      jsonb_build_object('hold_id', held.id, 'same_window', held.starts_at = result.scheduled_start and held.ends_at = result.scheduled_end
        and held.technician_id = result.technician_id));
  end loop;

  return result;
end;
$function$;

create or replace function public.confirm_visit_hold(hold_id uuid, expected_version integer)
 RETURNS visits
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  hold public.visit_holds;
  req public.requests;
  result public.visits;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into hold from public.visit_holds h where h.id = confirm_visit_hold.hold_id for update;
  if not found or not private.can_access_request(hold.request_id) then
    raise exception 'Terminvormerkung nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if hold.status <> 'open' or hold.expires_at <= now() then
    raise exception 'Die Vormerkung ist nicht mehr offen' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = hold.request_id;
  if req.intake_status <> 'processed' then
    raise exception 'Bitte zuerst die Erstbearbeitung abschließen, dann den Termin bestätigen' using errcode = 'RW422';
  end if;

  -- Holds do not block schedule_visit, so the visit can take the held window directly
  -- schedule_visit closes the hold and logs it (task-20-2)
  result := public.schedule_visit(hold.request_id, confirm_visit_hold.expected_version, hold.technician_id, hold.starts_at, hold.ends_at);

  select * into req from public.requests r where r.id = hold.request_id;
  perform private.queue_hold_mail(req,
    'Terminbestätigung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir bestätigen Ihren Termin für die Anfrage ' || req.request_number || ':', '',
      private.spoken_datetime(hold.starts_at) || ', Dauer etwa ' || (extract(epoch from hold.ends_at - hold.starts_at) / 3600)::numeric(4,1)::text || ' Stunden,',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Sollte der Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
  return result;
end;
$function$;

notify pgrst, 'reload schema';
