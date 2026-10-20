-- Customer number as the fixed key of a customer (task-15-2, user decision 20.10.2026).
-- Only the database assigns customer numbers. A request carries the number of its linked customer and nothing else;
-- what a caller, the form or an e-mail states is kept apart in stated_customer_number and checked when the intake
-- is completed: number and postal code (or e-mail) fit → link, number exists but the data do not fit → suggestion
-- for the dispatcher, unknown number → event, normal matching.

alter table public.requests add column stated_customer_number text;
comment on column public.requests.stated_customer_number is
  'Kundennummer, wie vom Kunden genannt (Formular, E-Mail, Telefon); nur Hinweis für die Zuordnung, nicht geprüft (task-15-2).';
comment on column public.requests.customer_number is
  'Kundennummer des verknüpften Kunden (Trigger requests_sync_customer_number), leer ohne Verknüpfung (task-15-2).';

-- Writers keep passing the stated number in customer_number (form, e-mail, phone, n8n); the trigger moves it to
-- stated_customer_number on insert and always derives customer_number from the link. Named so that it runs after
-- requests_link_customer (BEFORE triggers fire in name order).
create function private.sync_request_customer_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.stated_customer_number is null and nullif(btrim(new.customer_number), '') is not null then
    new.stated_customer_number := coalesce(private.customer_number_key(new.customer_number), btrim(new.customer_number));
  end if;
  new.customer_number := (select c.customer_number from public.customers c where c.id = new.customer_id);
  return new;
end;
$$;

-- Existing data: stated numbers that are not the number of the linked customer move to stated_customer_number,
-- then customer_number follows the link. Without version bump: the visible request data do not change.
alter table public.requests disable trigger requests_guard_update;
-- Demo requests: their number is the key the demo seed links them by (demo_seed_customers below)
update public.requests r set stated_customer_number = private.customer_number_key(r.customer_number)
where r.is_demo and r.stated_customer_number is null and nullif(btrim(r.customer_number), '') is not null;
update public.requests r set stated_customer_number = coalesce(private.customer_number_key(r.customer_number), btrim(r.customer_number))
where r.stated_customer_number is null and nullif(btrim(r.customer_number), '') is not null
  and r.customer_number is distinct from (select c.customer_number from public.customers c where c.id = r.customer_id);
update public.requests r set customer_number = (select c.customer_number from public.customers c where c.id = r.customer_id)
where r.customer_number is distinct from (select c.customer_number from public.customers c where c.id = r.customer_id);
alter table public.requests enable trigger requests_guard_update;

create trigger requests_sync_customer_number before insert or update on public.requests
  for each row execute function private.sync_request_customer_number();

-- New suggestion reason: the stated number exists, but neither postal code nor e-mail fit
alter table public.request_customer_suggestions drop constraint request_customer_suggestions_reason_check;
alter table public.request_customer_suggestions add constraint request_customer_suggestions_reason_check
  check (reason in ('mehrere_treffer', 'gleiche_firma', 'gleiche_domain', 'kunde_inaktiv', 'nummer_passt_nicht'));

-- Automatic assignment (task-14-1/14-3) with a check of the stated number first
create or replace function private.assign_request_customer(req public.requests)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := private.customer_company_key(req.company_name);
  domain text := private.company_domain(req.business_email);
  email text := lower(btrim(req.business_email));
  stated text := private.customer_number_key(req.stated_customer_number);
  claimed public.customers;
  sure uuid[];
  cust public.customers;
  site_id uuid;
  sites_before integer;
  suggestion record;
  numbers text[] := '{}';
  original public.requests := req;
begin
  begin
    -- Already linked (phone assistant, dispatcher): only make sure the address is one of its sites
    if req.customer_id is not null then
      if req.customer_site_id is null then
        req.customer_site_id := private.ensure_request_site(req.customer_id, req);
      end if;
      return req;
    end if;

    -- Stated customer number: proven by a postal code of an active site or the stored e-mail, like on the phone
    if stated is not null then
      select * into claimed from public.customers c where c.customer_number = stated and not c.is_demo;
      if claimed.id is null then
        insert into public.request_events (request_id, actor_type, event_type, to_value)
        values (req.id, 'automation', 'stated_customer_number_unknown', stated);
      elsif claimed.is_active and (
          (email <> '' and lower(claimed.business_email) = email)
          or exists (select 1 from public.customer_sites s where s.customer_id = claimed.id and s.is_active and s.postal_code = btrim(req.postal_code))) then
        sure := array[claimed.id];
      end if;
    end if;

    if sure is null then
      select coalesce(array_agg(c.id), '{}') into sure from public.customers c
      where not c.is_demo and c.is_active and (
        (email <> '' and lower(c.business_email) = email)
        or (key is not null and private.customer_company_key(c.company_name) = key and exists (
          select 1 from public.customer_sites s where s.customer_id = c.id and s.is_active and s.postal_code = btrim(req.postal_code))));
    end if;

    -- A stated number that exists but does not fit is never overruled by an automatic link
    if cardinality(sure) = 1 and (claimed.id is null or claimed.id = sure[1]) then
      select * into cust from public.customers c where c.id = sure[1];
      select count(*) into sites_before from public.customer_sites s where s.customer_id = cust.id;
      site_id := private.ensure_request_site(cust.id, req);
      req.customer_id := cust.id;
      req.customer_site_id := site_id;
      delete from public.request_customer_suggestions x where x.request_id = req.id;
      insert into public.request_events (request_id, actor_type, event_type, to_value, data)
      values (req.id, 'automation', 'customer_auto_linked', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id,
        'site_added', (select count(*) from public.customer_sites s where s.customer_id = cust.id) > sites_before,
        'by_customer_number', claimed.id is not null));
      return req;
    end if;

    -- Uncertain: stated number without fitting data, several sure matches, or weaker hints
    delete from public.request_customer_suggestions x where x.request_id = req.id;
    for suggestion in
      select c.id, c.customer_number,
        case when c.id = claimed.id then case when c.is_active then 'nummer_passt_nicht' else 'kunde_inaktiv' end
          when c.id = any (sure) then 'mehrere_treffer'
          when not c.is_active then 'kunde_inaktiv'
          when key is not null and private.customer_company_key(c.company_name) = key then 'gleiche_firma'
          else 'gleiche_domain' end as reason
      from public.customers c
      where not c.is_demo and (
        c.id = claimed.id
        or c.id = any (sure)
        or (key is not null and private.customer_company_key(c.company_name) = key)
        or (domain is not null and private.company_domain(c.business_email) = domain)
        or (email <> '' and lower(c.business_email) = email))
      order by c.id = claimed.id desc, c.customer_number limit 5
    loop
      insert into public.request_customer_suggestions (request_id, customer_id, reason) values (req.id, suggestion.id, suggestion.reason);
      numbers := numbers || suggestion.customer_number;
    end loop;
    if cardinality(numbers) > 0 then
      insert into public.request_events (request_id, actor_type, event_type, to_value, data)
      values (req.id, 'automation', 'customer_suggested', array_to_string(numbers, ', '), jsonb_build_object('customer_numbers', to_jsonb(numbers)));
      return req;
    end if;

    -- No match at all: new customer with the request address as first site
    cust := private.new_customer_from_request(req);
    site_id := private.ensure_request_site(cust.id, req);
    req.customer_id := cust.id;
    req.customer_site_id := site_id;
    insert into public.request_events (request_id, actor_type, event_type, to_value, data)
    values (req.id, 'automation', 'customer_auto_created', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id));
    return req;
  exception when others then
    -- Never block the intake; the request stays without customer and can be linked by hand
    raise warning 'Automatische Kundenzuordnung für Anfrage % übersprungen: %', req.id, sqlerrm;
    return original;
  end;
end;
$$;

-- "Kunde anlegen": the number always comes from the sequence, it cannot be chosen
drop function public.create_customer(text, text, text, text, text, text, text, text, text, text);
create function public.create_customer(company_name text, street_house_number text, postal_code text, city text,
  contact_name text default null, business_email text default null, phone_number text default null, notes text default null,
  site_label text default null)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  result public.customers;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number, notes)
  values ('K-' || nextval('private.customer_number_seq'), private.require_customer_text(create_customer.company_name, 'Firma'),
    private.clean(create_customer.contact_name), lower(private.clean(create_customer.business_email)), private.clean(create_customer.phone_number),
    private.clean(create_customer.notes))
  returning * into result;
  insert into public.customer_sites (customer_id, label, street_house_number, postal_code, city)
  values (result.id, private.clean(site_label), private.require_customer_text(create_customer.street_house_number, 'Straße und Hausnummer'),
    btrim(coalesce(create_customer.postal_code, '')), private.require_customer_text(create_customer.city, 'Ort'));
  return result;
exception when check_violation then
  raise exception 'Ungültige Angaben (E-Mail-Adresse oder Postleitzahl prüfen)' using errcode = 'RW422';
end;
$$;
revoke all on function public.create_customer(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.create_customer(text, text, text, text, text, text, text, text, text) to authenticated;
revoke all on function private.sync_request_customer_number() from public, anon, authenticated;

-- Demo seed (task-13-10): demo requests are linked by the number they state
create or replace function public.demo_seed_customers(customers jsonb)
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
  where c.customer_number = private.customer_number_key(r.stated_customer_number) and r.customer_id is null;
  get diagnostics linked = row_count;
  return jsonb_build_object('customers', inserted, 'linked_requests', linked);
end;
$$;
