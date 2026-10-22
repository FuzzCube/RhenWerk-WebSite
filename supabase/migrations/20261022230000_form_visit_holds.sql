-- task-19-3 (user request 22.10.2026): the website form holds the wished window like the phone assistant does.
-- The customer names a day and a time (exact start, morning, afternoon or any); if a technician is free then, the
-- least booked one of the month gets a hold, otherwise the next free window from that day on. The dispatcher confirms
-- with one click (visit planned, Terminbestätigung to the customer). Manual planning can send the same confirmation.

-- Where a hold comes from and whether the wish could be met (form only)
alter table public.visit_holds
  add column origin text not null default 'phone' check (origin in ('phone', 'form')),
  add column wish_met boolean;
comment on column public.visit_holds.origin is 'phone: phone assistant (task-13-3); form: website form (task-19-3)';
comment on column public.visit_holds.wish_met is 'form only: true if the wished day and time were free, false if the next free window was held';

-- Booked minutes of a technician in the calendar month of a local day (visits and open holds)
create function private.month_booked_minutes(target_technician_id uuid, local_day date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from least(x.e, b.d1) - greatest(x.s, b.d0)) / 60), 0)::integer
  from (
    select v.scheduled_start s, v.scheduled_end e from public.visits v
    where v.technician_id = target_technician_id and v.status in ('scheduled', 'in_progress', 'waiting_parts', 'completed')
    union all
    select h.starts_at, h.ends_at from public.visit_holds h where h.technician_id = target_technician_id and h.status = 'open'
  ) x,
  lateral (select (date_trunc('month', local_day)::timestamp at time zone 'Europe/Berlin') d0,
                  ((date_trunc('month', local_day) + interval '1 month')::timestamp at time zone 'Europe/Berlin') d1) b
  where x.s < b.d1 and x.e > b.d0;
$$;

-- Least booked technician of the month (then of the day) free for exactly this window, or null
create or replace function private.technician_for_window(range_start timestamptz, range_end timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id from public.profiles p
  where p.role = 'technician' and p.is_active and private.window_free(p.id, range_start, range_end)
  order by private.month_booked_minutes(p.id, (range_start at time zone 'Europe/Berlin')::date),
    private.booked_minutes(p.id, (range_start at time zone 'Europe/Berlin')::date), p.id
  limit 1;
$$;

-- Earliest start on a local day that matches the wish and has a free technician: an exact time (HH:MM) only as
-- wished, morning/afternoon/any on the 30-minute grid of the working hours; null if nothing matches
create function private.wish_window_start(local_day date, wish text, minutes integer)
returns timestamptz
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  candidate timestamp;
  s timestamptz;
begin
  if extract(isodow from local_day) > 5 then
    return null;
  end if;
  if wish ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    s := (local_day + wish::time) at time zone 'Europe/Berlin';
    if s >= now() + interval '1 hour' and private.technician_for_window(s, s + make_interval(mins => minutes)) is not null then
      return s;
    end if;
    return null;
  end if;
  for candidate in
    select distinct g.t
    from public.employee_availability a
    join public.profiles p on p.id = a.employee_id and p.role = 'technician' and p.is_active
    cross join lateral generate_series(local_day + a.local_start, local_day + a.local_end - make_interval(mins => minutes), interval '30 minutes') g(t)
    where a.kind = 'working_hours' and a.weekday = extract(isodow from local_day)
      and (a.valid_from is null or a.valid_from <= local_day) and (a.valid_to is null or a.valid_to >= local_day)
      and case wish when 'morning' then g.t::time < time '12:00' when 'afternoon' then g.t::time >= time '12:00' else true end
    order by 1
  loop
    s := candidate at time zone 'Europe/Berlin';
    continue when s < now() + interval '1 hour';
    if private.technician_for_window(s, s + make_interval(mins => minutes)) is not null then
      return s;
    end if;
  end loop;
  return null;
end;
$$;

-- Hold for a form request: the wished window, else the next free one within two weeks of the wished day.
-- Emergencies (human review) get no hold, like on the phone; null when nothing is free.
create function private.hold_from_wish(req public.requests)
returns public.visit_holds
language plpgsql
security definer
set search_path = ''
as $$
declare
  wish text := coalesce(nullif(btrim(req.raw_payload -> 'request' ->> 'preferred_time'), ''), 'any');
  minutes integer := private.hold_minutes(req.service_kind);
  today date := (now() at time zone 'Europe/Berlin')::date;
  wished_day date := greatest(req.requested_visit_date, today);
  start_at timestamptz;
  met boolean := true;
  hold public.visit_holds;
begin
  if req.human_review_required or req.requested_visit_date is null or wished_day > today + 42 then
    return null;
  end if;
  if wish !~ '^(any|morning|afternoon|([01][0-9]|2[0-3]):[0-5][0-9])$' then
    wish := 'any';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rheinwerk-visit-holds', 0));
  start_at := private.wish_window_start(wished_day, wish, minutes);
  if start_at is null then
    met := false;
    select w.starts_at into start_at from private.free_windows(wished_day, least(wished_day + 14, today + 42), minutes, 1) w;
  end if;
  if start_at is null then
    return null;
  end if;
  hold := private.create_hold(req, start_at, null);
  if hold.id is not null then
    update public.visit_holds h set origin = 'form', wish_met = met where h.id = hold.id returning * into hold;
  end if;
  return hold;
end;
$$;

create or replace function public.ingest_submission(payload jsonb)
 RETURNS requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     or coalesce(p->'contact'->>'business_email','') !~* '^[^@\s]+@([^@\s.]+\.)+[a-z]{2,}$'
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
  perform private.queue_receipt(req);
  -- task-19-3: hold the wished window (or the next free one) for the dispatcher; never lose the request over it
  begin
    perform private.hold_from_wish(req);
  exception when others then
    insert into public.request_events(request_id,actor_type,event_type,visibility,note)
    values(req.id,'system','visit_hold_failed','dispatch',left(sqlerrm,500));
  end;
  return req;
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'Invalid submission field type' using errcode='RW422';
end;
$function$;

-- Terminbestätigung for a manually planned visit (planning board), approved by the planning person; same text as
-- the confirmation of a hold (confirm_visit_hold)
create function public.queue_visit_confirmation(visit_id uuid)
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
  select * into v from public.visits x where x.id = queue_visit_confirmation.visit_id;
  if not found or not private.can_access_request(v.request_id) then
    raise exception 'Einsatz nicht gefunden oder kein Zugriff' using errcode = '42501';
  end if;
  if v.status <> 'scheduled' then
    raise exception 'Nur geplante Einsätze lassen sich bestätigen' using errcode = 'RW422';
  end if;
  select * into req from public.requests r where r.id = v.request_id;
  perform private.queue_hold_mail(req,
    'Terminbestätigung ' || req.request_number || ' · Ihre Serviceanfrage',
    concat_ws(E'\n', 'Guten Tag ' || req.contact_name || ',', '',
      'wir bestätigen Ihren Termin für die Anfrage ' || req.request_number || ':', '',
      private.spoken_datetime(v.scheduled_start) || ', Dauer etwa ' || (extract(epoch from v.scheduled_end - v.scheduled_start) / 3600)::numeric(4,1)::text || ' Stunden,',
      req.street_house_number || ', ' || req.postal_code || ' ' || req.city || '.', '',
      'Sollte der Termin nicht passen, antworten Sie bitte auf diese E-Mail.', '',
      'Mit freundlichen Grüßen', 'RheinWerk Industrieservice · Service Desk'));
end;
$$;

revoke all on function private.month_booked_minutes(uuid, date), private.wish_window_start(date, text, integer),
  private.hold_from_wish(public.requests) from public, anon, authenticated;
revoke all on function public.queue_visit_confirmation(uuid) from public, anon;
grant execute on function public.queue_visit_confirmation(uuid) to authenticated;
notify pgrst, 'reload schema';
