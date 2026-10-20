-- task-14-2: staff decide uncertain matches on the request page. "Neuen Kunden anlegen" creates the customer from the
-- request in one step (create_customer_from_request); "Zuordnen" uses link_request_customer. Suggestions disappear as
-- soon as the request is linked, whichever way. A demo request gives a demo customer, so automated UI tests never
-- create live master data and the demo seed removes them again.

-- New customer with the data of a request; the same for the automatic match (trigger) and the button
create function private.new_customer_from_request(req public.requests)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  email text := lower(btrim(req.business_email));
  result public.customers;
begin
  insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number, is_demo)
  values ('K-' || nextval('private.customer_number_seq'), private.clean(req.company_name), private.clean(req.contact_name),
    -- An address the master data would not accept is left out instead of failing
    case when email ~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$' then email end, private.clean(req.phone_number), req.is_demo)
  returning * into result;
  return result;
end;
$$;

-- Trigger function of task-14-1, now creating through the shared function (behaviour unchanged)
create or replace function private.link_customer_on_processed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := private.customer_company_key(new.company_name);
  domain text := private.company_domain(new.business_email);
  email text := lower(btrim(new.business_email));
  sure uuid[];
  cust public.customers;
  site_id uuid;
  sites_before integer;
  suggestion record;
  numbers text[] := '{}';
  original public.requests := new;
begin
  begin
    if new.customer_id is not null then
      if new.customer_site_id is null then
        new.customer_site_id := private.ensure_request_site(new.customer_id, new);
      end if;
      return new;
    end if;

    select coalesce(array_agg(c.id), '{}') into sure from public.customers c
    where not c.is_demo and c.is_active and (
      (email <> '' and lower(c.business_email) = email)
      or (key is not null and private.customer_company_key(c.company_name) = key and exists (
        select 1 from public.customer_sites s where s.customer_id = c.id and s.is_active and s.postal_code = btrim(new.postal_code))));

    if cardinality(sure) = 1 then
      select * into cust from public.customers c where c.id = sure[1];
      select count(*) into sites_before from public.customer_sites s where s.customer_id = cust.id;
      site_id := private.ensure_request_site(cust.id, new);
      new.customer_id := cust.id;
      new.customer_site_id := site_id;
      new.customer_number := coalesce(new.customer_number, cust.customer_number);
      delete from public.request_customer_suggestions x where x.request_id = new.id;
      insert into public.request_events (request_id, actor_type, event_type, to_value, data)
      values (new.id, 'automation', 'customer_auto_linked', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id,
        'site_added', (select count(*) from public.customer_sites s where s.customer_id = cust.id) > sites_before));
      return new;
    end if;

    delete from public.request_customer_suggestions x where x.request_id = new.id;
    for suggestion in
      select c.id, c.customer_number,
        case when c.id = any (sure) then 'mehrere_treffer'
          when not c.is_active then 'kunde_inaktiv'
          when key is not null and private.customer_company_key(c.company_name) = key then 'gleiche_firma'
          else 'gleiche_domain' end as reason
      from public.customers c
      where not c.is_demo and (
        c.id = any (sure)
        or (key is not null and private.customer_company_key(c.company_name) = key)
        or (domain is not null and private.company_domain(c.business_email) = domain)
        or (email <> '' and lower(c.business_email) = email))
      order by c.customer_number limit 5
    loop
      insert into public.request_customer_suggestions (request_id, customer_id, reason) values (new.id, suggestion.id, suggestion.reason);
      numbers := numbers || suggestion.customer_number;
    end loop;
    if cardinality(numbers) > 0 then
      insert into public.request_events (request_id, actor_type, event_type, to_value, data)
      values (new.id, 'automation', 'customer_suggested', array_to_string(numbers, ', '), jsonb_build_object('customer_numbers', to_jsonb(numbers)));
      return new;
    end if;

    cust := private.new_customer_from_request(new);
    site_id := private.ensure_request_site(cust.id, new);
    new.customer_id := cust.id;
    new.customer_site_id := site_id;
    new.customer_number := coalesce(new.customer_number, cust.customer_number);
    insert into public.request_events (request_id, actor_type, event_type, to_value, data)
    values (new.id, 'automation', 'customer_auto_created', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id));
    return new;
  exception when others then
    raise warning 'Automatische Kundenzuordnung für Anfrage % übersprungen: %', new.id, sqlerrm;
    return original;
  end;
end;
$$;

-- Button "Neuen Kunden anlegen": customer from the request, linked in the same step
create function public.create_customer_from_request(request_id uuid, expected_version integer)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  cust public.customers;
  site_id uuid;
  result public.requests;
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  req := private.lock_request(create_customer_from_request.request_id, create_customer_from_request.expected_version);
  if req.customer_id is not null then
    raise exception 'Die Anfrage ist bereits mit einem Kunden verknüpft' using errcode = 'RW422';
  end if;
  if req.intake_status in ('rejected', 'cancelled') then
    raise exception 'Abgelehnte oder stornierte Anfragen erzeugen keinen Kunden' using errcode = 'RW422';
  end if;
  cust := private.new_customer_from_request(req);
  site_id := private.ensure_request_site(cust.id, req);
  update public.requests r set customer_id = cust.id, customer_site_id = site_id, customer_number = coalesce(r.customer_number, cust.customer_number)
  where r.id = req.id returning * into result;
  perform private.log_request_event(req.id, 'customer_created_from_request', null, cust.customer_number, null,
    jsonb_build_object('customer_id', cust.id, 'site_id', site_id));
  return result;
exception when check_violation then
  raise exception 'Ungültige Angaben in der Anfrage (Postleitzahl prüfen); Kunde bitte unter „Kunden“ anlegen' using errcode = 'RW422';
end;
$$;

-- Once linked (button, customer number, phone assistant), the suggestions of the request are settled
create function private.clear_customer_suggestions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.request_customer_suggestions x where x.request_id = new.id;
  return null;
end;
$$;
create trigger requests_clear_customer_suggestions after update of customer_id on public.requests
  for each row when (new.customer_id is not null) execute function private.clear_customer_suggestions();

revoke all on function private.customer_company_key(text), private.street_key(text), private.company_domain(text),
  private.ensure_request_site(uuid, public.requests), private.link_customer_on_processed(), private.new_customer_from_request(public.requests),
  private.clear_customer_suggestions() from public, anon, authenticated;
revoke all on function public.create_customer_from_request(uuid, integer) from public, anon;
grant execute on function public.create_customer_from_request(uuid, integer) to authenticated;
