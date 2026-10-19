-- task-13-10: customer master data with sites. Known customers (with a customer number) are kept here instead of
-- only as copies inside requests. Staff with intake rights (dispatcher, manager, admin) read and maintain them through
-- controlled operations with version checks; requests point to customer and site. The phone assistant finds a
-- customer by number and postal code of a site (agent_find_customer) and agent_create_request takes company, address
-- and e-mail from the master data. Demo customers come with the demo seed (is_demo, demo_seed_customers).

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  customer_number text not null unique,
  company_name text not null,
  contact_name text,
  business_email text,
  phone_number text,
  notes text,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_number_format check (customer_number ~ '^K-[0-9]{4,}$'),
  constraint customers_company check (nullif(btrim(company_name), '') is not null),
  constraint customers_email check (business_email is null or business_email ~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$')
);
comment on table public.customers is 'Kundenstamm (task-13-10): Firma mit Kundennummer; Standorte in customer_sites.';

create table public.customer_sites (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete cascade,
  label text,
  street_house_number text not null,
  postal_code text not null,
  city text not null,
  is_active boolean not null default true,
  is_demo boolean not null default false,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_sites_street check (nullif(btrim(street_house_number), '') is not null),
  constraint customer_sites_postal_code check (postal_code ~ '^[0-9]{5}$'),
  constraint customer_sites_city check (nullif(btrim(city), '') is not null)
);
create index customer_sites_customer_idx on public.customer_sites (customer_id);
create index customer_sites_postal_code_idx on public.customer_sites (postal_code);

-- New numbers above the demo range (K-10000 … K-10483)
create sequence private.customer_number_seq start 20000;

create function private.bump_master_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;
create trigger customers_bump_version before update on public.customers for each row execute function private.bump_master_version();
create trigger customer_sites_bump_version before update on public.customer_sites for each row execute function private.bump_master_version();

alter table public.customers enable row level security;
alter table public.customer_sites enable row level security;
create policy customers_staff_read on public.customers for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin'));
create policy customer_sites_staff_read on public.customer_sites for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin'));
revoke insert, update, delete, truncate on public.customers, public.customer_sites from anon, authenticated;

-- Requests point to customer and site; the copied fields of the request stay as they were submitted
alter table public.requests
  add column customer_id uuid references public.customers (id) on delete set null,
  add column customer_site_id uuid references public.customer_sites (id) on delete set null;
create index requests_customer_idx on public.requests (customer_id) where customer_id is not null;

create function private.check_request_customer_site()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Customer removed (also through on delete set null): the site goes with it
  if new.customer_id is null then
    new.customer_site_id := null;
  end if;
  if new.customer_site_id is not null and (
     not exists (select 1 from public.customer_sites s where s.id = new.customer_site_id and s.customer_id = new.customer_id)) then
    raise exception 'Der Standort gehört nicht zu diesem Kunden' using errcode = 'RW422';
  end if;
  return new;
end;
$$;
create trigger requests_customer_site_check before insert or update of customer_id, customer_site_id on public.requests
  for each row execute function private.check_request_customer_site();

-- The phone assistant remembers the customer found in the call
alter table public.phone_calls
  add column customer_id uuid references public.customers (id) on delete set null,
  add column customer_site_id uuid references public.customer_sites (id) on delete set null;

-- Normalized spelling of the customer number: "k 10021", "K10021", "10021" → "K-10021"
create function private.customer_number_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') = '' then null
    else 'K-' || regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') end;
$$;

create function private.clean(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(coalesce(value, ''), '\s+', ' ', 'g')), '');
$$;

create function private.require_customer_text(value text, what text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if private.clean(value) is null then
    raise exception '% fehlt', what using errcode = 'RW422';
  end if;
  return private.clean(value);
end;
$$;

-- Address of a site as spoken or listed: "Neckarauer Straße 12 in Mannheim (Halle 3)"
create function private.site_text(s public.customer_sites)
returns text
language sql
immutable
set search_path = ''
as $$
  select s.street_house_number || ' in ' || s.city || coalesce(' (' || s.label || ')', '');
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Operations for staff (dispatcher, manager, admin)

create function public.create_customer(
  company_name text, street_house_number text, postal_code text, city text,
  contact_name text default null, business_email text default null, phone_number text default null, notes text default null,
  site_label text default null, customer_number text default null)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.customers;
  number_value text := coalesce(private.customer_number_key(create_customer.customer_number), 'K-' || nextval('private.customer_number_seq'));
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if exists (select 1 from public.customers c where c.customer_number = number_value) then
    raise exception 'Die Kundennummer % ist bereits vergeben', number_value using errcode = 'RW422';
  end if;
  insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number, notes)
  values (number_value, private.require_customer_text(create_customer.company_name, 'Firma'), private.clean(create_customer.contact_name),
    lower(private.clean(create_customer.business_email)), private.clean(create_customer.phone_number), private.clean(create_customer.notes))
  returning * into result;
  insert into public.customer_sites (customer_id, label, street_house_number, postal_code, city)
  values (result.id, private.clean(site_label), private.require_customer_text(create_customer.street_house_number, 'Straße und Hausnummer'),
    btrim(coalesce(create_customer.postal_code, '')), private.require_customer_text(create_customer.city, 'Ort'));
  return result;
exception when check_violation then
  raise exception 'Ungültige Angaben (E-Mail-Adresse oder Postleitzahl prüfen)' using errcode = 'RW422';
end;
$$;

create function public.update_customer(
  customer_id uuid, expected_version integer, company_name text,
  contact_name text default null, business_email text default null, phone_number text default null, notes text default null,
  is_active boolean default true)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.customers;
  result public.customers;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into current_row from public.customers c where c.id = update_customer.customer_id for update;
  if not found then
    raise exception 'Kunde nicht gefunden' using errcode = 'RW422';
  end if;
  if expected_version is null or current_row.version <> expected_version then
    raise exception 'Der Kunde wurde zwischenzeitlich geändert. Bitte neu laden.' using errcode = 'RW409';
  end if;
  update public.customers c set
    company_name = private.require_customer_text(update_customer.company_name, 'Firma'),
    contact_name = private.clean(update_customer.contact_name),
    business_email = lower(private.clean(update_customer.business_email)),
    phone_number = private.clean(update_customer.phone_number),
    notes = private.clean(update_customer.notes),
    is_active = coalesce(update_customer.is_active, true)
  where c.id = current_row.id
  returning * into result;
  return result;
exception when check_violation then
  raise exception 'Ungültige Angaben (E-Mail-Adresse prüfen)' using errcode = 'RW422';
end;
$$;

create function public.add_customer_site(customer_id uuid, street_house_number text, postal_code text, city text, label text default null)
returns public.customer_sites
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.customer_sites;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  if not exists (select 1 from public.customers c where c.id = add_customer_site.customer_id) then
    raise exception 'Kunde nicht gefunden' using errcode = 'RW422';
  end if;
  insert into public.customer_sites (customer_id, label, street_house_number, postal_code, city)
  values (add_customer_site.customer_id, private.clean(add_customer_site.label), private.require_customer_text(add_customer_site.street_house_number, 'Straße und Hausnummer'),
    btrim(coalesce(add_customer_site.postal_code, '')), private.require_customer_text(add_customer_site.city, 'Ort'))
  returning * into result;
  return result;
exception when check_violation then
  raise exception 'Ungültige Postleitzahl (fünf Ziffern)' using errcode = 'RW422';
end;
$$;

create function public.update_customer_site(
  site_id uuid, expected_version integer, street_house_number text, postal_code text, city text,
  label text default null, is_active boolean default true)
returns public.customer_sites
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.customer_sites;
  result public.customer_sites;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  select * into current_row from public.customer_sites s where s.id = update_customer_site.site_id for update;
  if not found then
    raise exception 'Standort nicht gefunden' using errcode = 'RW422';
  end if;
  if expected_version is null or current_row.version <> expected_version then
    raise exception 'Der Standort wurde zwischenzeitlich geändert. Bitte neu laden.' using errcode = 'RW409';
  end if;
  update public.customer_sites s set
    label = private.clean(update_customer_site.label),
    street_house_number = private.require_customer_text(update_customer_site.street_house_number, 'Straße und Hausnummer'),
    postal_code = btrim(coalesce(update_customer_site.postal_code, '')),
    city = private.require_customer_text(update_customer_site.city, 'Ort'),
    is_active = coalesce(update_customer_site.is_active, true)
  where s.id = current_row.id
  returning * into result;
  return result;
exception when check_violation then
  raise exception 'Ungültige Postleitzahl (fünf Ziffern)' using errcode = 'RW422';
end;
$$;

-- Links a request to a customer (or removes the link with an empty number). The site is the given one, otherwise
-- the site with the address of the request, otherwise the main site. copy_data takes company, customer number,
-- address and (if stored) e-mail from the master data, e.g. to correct a mistake of the phone assistant.
create function public.link_request_customer(request_id uuid, expected_version integer, customer_number text,
  site_id uuid default null, copy_data boolean default false)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  cust public.customers;
  site public.customer_sites;
  result public.requests;
  wanted text := private.customer_number_key(link_request_customer.customer_number);
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(link_request_customer.request_id, link_request_customer.expected_version);

  if wanted is null then
    update public.requests r set customer_id = null, customer_site_id = null where r.id = req.id returning * into result;
    perform private.log_request_event(req.id, 'customer_unlinked', req.customer_id::text, null);
    return result;
  end if;

  select * into cust from public.customers c where c.customer_number = wanted;
  if not found then
    raise exception 'Kundennummer % nicht gefunden', wanted using errcode = 'RW422';
  end if;
  if link_request_customer.site_id is not null then
    select * into site from public.customer_sites s where s.id = link_request_customer.site_id and s.customer_id = cust.id;
    if not found then
      raise exception 'Der Standort gehört nicht zu diesem Kunden' using errcode = 'RW422';
    end if;
  else
    select * into site from public.customer_sites s where s.customer_id = cust.id
      and s.postal_code = req.postal_code and lower(s.street_house_number) = lower(btrim(req.street_house_number)) limit 1;
    -- Otherwise the main site (oldest active one); another one can be chosen afterwards
    if not found then
      select * into site from public.customer_sites s where s.customer_id = cust.id and s.is_active order by s.created_at limit 1;
    end if;
  end if;

  update public.requests r set
    customer_id = cust.id,
    customer_site_id = site.id,
    company_name = case when copy_data then cust.company_name else r.company_name end,
    customer_number = case when copy_data then cust.customer_number else r.customer_number end,
    business_email = case when copy_data and cust.business_email is not null then cust.business_email else r.business_email end,
    street_house_number = case when copy_data and site.id is not null then site.street_house_number else r.street_house_number end,
    postal_code = case when copy_data and site.id is not null then site.postal_code else r.postal_code end,
    city = case when copy_data and site.id is not null then site.city else r.city end,
    site_label = case when copy_data and site.id is not null then site.label else r.site_label end
  where r.id = req.id
  returning * into result;
  perform private.log_request_event(req.id, 'customer_linked', req.customer_id::text, cust.id::text, null,
    jsonb_build_object('customer_number', cust.customer_number, 'site_id', site.id, 'copy_data', coalesce(copy_data, false)));
  return result;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Phone assistant

-- Tool kunde_finden: customer by number, checked against the postal code of an active site. Only the company and
-- the sites at that postal code are returned, never e-mail or phone. The match is kept for the call.
create function public.agent_find_customer(call_id text, kundennummer text, plz text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  cust public.customers;
  wanted text := private.customer_number_key(kundennummer);
  code text := btrim(coalesce(plz, ''));
  sites jsonb;
  site_count integer;
  only_site uuid;
begin
  perform private.require_integration();
  c := private.call_for(agent_find_customer.call_id);
  if wanted is null or code !~ '^[0-9]{5}$' then
    return jsonb_build_object('ok', true, 'treffer', false, 'grund', 'angaben_fehlen');
  end if;
  select * into cust from public.customers k where k.customer_number = wanted and k.is_active;
  select coalesce(jsonb_agg(jsonb_build_object('standort_id', s.id, 'ansage', private.site_text(s)) order by s.created_at), '[]'::jsonb),
    count(*), (array_agg(s.id))[1]
  into sites, site_count, only_site
  from public.customer_sites s where s.customer_id = cust.id and s.is_active and s.postal_code = code;
  -- Unknown number and wrong postal code look the same to the caller
  if cust.id is null or site_count = 0 then
    return jsonb_build_object('ok', true, 'treffer', false);
  end if;
  update public.phone_calls p set customer_id = cust.id, customer_site_id = case when site_count = 1 then only_site end where p.id = c.id;
  return jsonb_build_object('ok', true, 'treffer', true, 'firma', cust.company_name, 'standorte', sites,
    'email_hinterlegt', cust.business_email is not null);
end;
$$;

-- agent_create_request: with a customer found in the call, company, customer number, address and e-mail come from
-- the master data (a spelled e-mail of the call still wins); fields.standort_id chooses one of several sites
create or replace function public.agent_create_request(call_id text, fields jsonb, termin_beginn timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
  req public.requests;
  hold public.visit_holds;
  cust public.customers;
  site public.customer_sites;
  k text;
  problems text[];
  dispatcher uuid;
  f jsonb := fields;
begin
  perform private.require_integration();
  c := private.call_for(agent_create_request.call_id);
  k := 'phone_agent:' || c.conversation_id;
  perform pg_advisory_xact_lock(hashtextextended(k, 0));

  select * into req from public.requests r where r.source_event_key = k;
  if found then
    select * into hold from public.visit_holds h where h.request_id = req.id and h.status = 'open';
    return jsonb_build_object('ok', true, 'wiederholt', true, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number,
      'termin_vorgemerkt', hold.id is not null, 'termin_ansage', private.spoken_datetime(hold.starts_at));
  end if;

  if jsonb_typeof(f) = 'object' and c.customer_id is not null then
    select * into cust from public.customers x where x.id = c.customer_id;
    if (f ->> 'standort_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select * into site from public.customer_sites s where s.id = (f ->> 'standort_id')::uuid and s.customer_id = cust.id;
    end if;
    if site.id is null and c.customer_site_id is not null then
      select * into site from public.customer_sites s where s.id = c.customer_site_id;
    end if;
    f := f || jsonb_build_object('company_name', cust.company_name, 'customer_number', cust.customer_number)
      || case when cust.business_email is not null then jsonb_build_object('business_email', cust.business_email) else '{}'::jsonb end
      || case when site.id is not null then jsonb_build_object('street_house_number', site.street_house_number, 'postal_code', site.postal_code,
           'city', site.city, 'site_label', site.label) else '{}'::jsonb end;
  end if;
  if jsonb_typeof(f) = 'object' and c.checked_email is not null then
    f := f || jsonb_build_object('business_email', c.checked_email);
  end if;
  if jsonb_typeof(f) = 'object' and nullif(f ->> 'requested_visit_date', '') is null then
    f := f || jsonb_build_object('requested_visit_date', to_char(coalesce(termin_beginn at time zone 'Europe/Berlin', (now() at time zone 'Europe/Berlin') + interval '7 days')::date, 'YYYY-MM-DD'));
  end if;
  problems := private.request_field_problems(f);
  if problems is not null then
    return jsonb_build_object('ok', false, 'fehler', 'fehlende_felder', 'fehlende_felder', to_jsonb(problems));
  end if;
  perform private.validate_request_fields(f);

  perform pg_advisory_xact_lock(hashtextextended('rheinwerk-dispatch-assignment', 0));
  dispatcher := private.least_loaded_dispatcher();
  if dispatcher is null then
    raise exception 'Kein aktiver Dispatcher' using errcode = 'RW422';
  end if;

  insert into public.requests (
    source_event_key, source, company_name, contact_name, business_email, phone_number, customer_number,
    street_house_number, postal_code, city, site_label, equipment_kind, manufacturer, model_type, service_kind,
    requested_visit_date, description, customer_urgency, safety_risk, sla_contract_number, raw_payload, dispatcher_id, human_review_required,
    customer_id, customer_site_id)
  values (
    k, 'phone_agent', btrim(f ->> 'company_name'), btrim(f ->> 'contact_name'), btrim(f ->> 'business_email'),
    btrim(f ->> 'phone_number'), nullif(btrim(f ->> 'customer_number'), ''),
    btrim(f ->> 'street_house_number'), btrim(f ->> 'postal_code'), btrim(f ->> 'city'), nullif(btrim(f ->> 'site_label'), ''),
    (f ->> 'equipment_kind')::public.equipment_kind, nullif(btrim(f ->> 'manufacturer'), ''), nullif(btrim(f ->> 'model_type'), ''),
    (f ->> 'service_kind')::public.service_kind, (f ->> 'requested_visit_date')::date, btrim(f ->> 'description'),
    (f ->> 'customer_urgency')::public.customer_urgency, (f ->> 'safety_risk')::public.safety_risk,
    nullif(btrim(f ->> 'sla_contract_number'), ''),
    jsonb_build_object('channel', 'phone_agent', 'conversation_id', c.conversation_id, 'termin_beginn', termin_beginn,
      'email_buchstabiert', c.checked_email is not null, 'kunde_erkannt', cust.id is not null),
    dispatcher,
    f ->> 'customer_urgency' = 'production_stop' or f ->> 'safety_risk' in ('known', 'unclear'),
    cust.id, site.id)
  returning * into req;

  insert into public.request_events (request_id, actor_type, event_type, visibility, to_value, data)
  values (req.id, 'automation', 'request_created_by_agent', 'dispatch', dispatcher::text,
    jsonb_build_object('conversation_id', c.conversation_id, 'dispatcher_id', dispatcher));
  perform private.queue_receipt(req);
  update public.phone_calls p set request_id = req.id where p.id = c.id;

  -- Emergencies get no hold: they go to people straight away
  if termin_beginn is not null and not req.human_review_required then
    hold := private.create_hold(req, termin_beginn, c.conversation_id);
  end if;
  return jsonb_build_object('ok', true, 'wiederholt', false, 'anfrage_id', req.id, 'anfrage_nummer', req.request_number,
    'termin_vorgemerkt', hold.id is not null, 'termin_ansage', private.spoken_datetime(hold.starts_at),
    'termin_hinweis', case when termin_beginn is null then null when req.human_review_required then 'notfall_ohne_vormerkung'
      when hold.id is null then 'fenster_nicht_mehr_frei' end);
exception when invalid_text_representation or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'fehler', 'ungueltige_angaben');
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Demo seed: replaces the demo customers as a whole and links requests with the same customer number
-- (payload: [{customer_number, company_name, contact_name, business_email, phone_number, sites: [{label, street_house_number, postal_code, city}]}])
create function public.demo_seed_customers(customers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  site_item jsonb;
  new_id uuid;
  inserted integer := 0;
  linked integer;
begin
  delete from public.customers c where c.is_demo;
  for item in select value from jsonb_array_elements(coalesce(demo_seed_customers.customers, '[]'::jsonb)) loop
    insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number, is_demo)
    values (item ->> 'customer_number', item ->> 'company_name', item ->> 'contact_name', lower(item ->> 'business_email'), item ->> 'phone_number', true)
    returning id into new_id;
    for site_item in select value from jsonb_array_elements(item -> 'sites') loop
      insert into public.customer_sites (customer_id, label, street_house_number, postal_code, city, is_demo)
      values (new_id, nullif(site_item ->> 'label', ''), site_item ->> 'street_house_number', site_item ->> 'postal_code', site_item ->> 'city', true);
    end loop;
    inserted := inserted + 1;
  end loop;

  update public.requests r set customer_id = c.id,
    customer_site_id = (select s.id from public.customer_sites s where s.customer_id = c.id and s.postal_code = r.postal_code
      and lower(s.street_house_number) = lower(btrim(r.street_house_number)) limit 1)
  from public.customers c
  where c.customer_number = r.customer_number and r.customer_id is null;
  get diagnostics linked = row_count;
  return jsonb_build_object('customers', inserted, 'linked_requests', linked);
end;
$$;

revoke all on function private.bump_master_version(), private.check_request_customer_site(), private.customer_number_key(text), private.clean(text),
  private.require_customer_text(text, text), private.site_text(public.customer_sites) from public, anon, authenticated;
revoke all on function public.create_customer(text, text, text, text, text, text, text, text, text, text),
  public.update_customer(uuid, integer, text, text, text, text, text, boolean),
  public.add_customer_site(uuid, text, text, text, text),
  public.update_customer_site(uuid, integer, text, text, text, text, boolean),
  public.link_request_customer(uuid, integer, text, uuid, boolean),
  public.agent_find_customer(text, text, text), public.demo_seed_customers(jsonb) from public, anon;
grant execute on function public.create_customer(text, text, text, text, text, text, text, text, text, text),
  public.update_customer(uuid, integer, text, text, text, text, text, boolean),
  public.add_customer_site(uuid, text, text, text, text),
  public.update_customer_site(uuid, integer, text, text, text, text, boolean),
  public.link_request_customer(uuid, integer, text, uuid, boolean) to authenticated;
revoke all on function public.agent_find_customer(text, text, text), public.demo_seed_customers(jsonb) from authenticated;
grant execute on function public.agent_find_customer(text, text, text), public.demo_seed_customers(jsonb) to service_role;
notify pgrst, 'reload schema';
