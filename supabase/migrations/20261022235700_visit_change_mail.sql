-- task-20-7: a visit moved on the planning board tells the customer the new time (user request: e.g. technician ill).
-- The planning person approves it with the move (checkbox, on by default), like the Terminbestätigung of
-- queue_visit_confirmation. Sent only when the time changed; another technician alone does not concern the customer.
create or replace function public.queue_visit_change(visit_id uuid, previous_start timestamptz, previous_end timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.visits;
  req public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into v from public.visits x where x.id = queue_visit_change.visit_id;
  if not found or not private.can_access_request(v.request_id) then
    raise exception 'Einsatz nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if v.status <> 'scheduled' then
    raise exception 'Nur geplante Einsätze lassen sich mitteilen' using errcode = 'RW422';
  end if;
  if v.scheduled_start = previous_start and v.scheduled_end = previous_end then
    return;
  end if;
  select * into req from public.requests r where r.id = v.request_id;
  perform private.queue_hold_mail(req,
    'Terminänderung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir haben Ihren Termin für die Anfrage ' || req.request_number || ' geändert.', '',
      'Neuer Termin: ' || private.spoken_datetime(v.scheduled_start) || ', Dauer etwa ' || private.duration_text(v.scheduled_start, v.scheduled_end) || ',',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Bisher: ' || private.spoken_datetime(previous_start) || ', Dauer etwa ' || private.duration_text(previous_start, previous_end) || '.', '',
      'Sollte der neue Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
end;
$$;

revoke all on function public.queue_visit_change(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.queue_visit_change(uuid, timestamptz, timestamptz) to authenticated;
notify pgrst, 'reload schema';
