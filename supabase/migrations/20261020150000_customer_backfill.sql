-- task-14-3: one-off back-fill. Live requests that were processed before task-14-1 have no customer yet. They get the
-- same rules as the trigger: the trigger body moves into private.assign_request_customer, which both the trigger and
-- private.backfill_request_customers use. The back-fill first runs as a dry run (report only, every change rolled back,
-- customer number sequence reset) and changes data only with apply = true.
-- Called by scripts/customers-backfill.mjs (npm run customers:backfill) as database owner, not through the API.

-- Rules of task-14-1 for one request; returns the row with customer, site and number set, or unchanged
-- (suggestions stored, or an unexpected error turned into a warning)
create function private.assign_request_customer(req public.requests)
returns public.requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  key text := private.customer_company_key(req.company_name);
  domain text := private.company_domain(req.business_email);
  email text := lower(btrim(req.business_email));
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

    select coalesce(array_agg(c.id), '{}') into sure from public.customers c
    where not c.is_demo and c.is_active and (
      (email <> '' and lower(c.business_email) = email)
      or (key is not null and private.customer_company_key(c.company_name) = key and exists (
        select 1 from public.customer_sites s where s.customer_id = c.id and s.is_active and s.postal_code = btrim(req.postal_code))));

    if cardinality(sure) = 1 then
      select * into cust from public.customers c where c.id = sure[1];
      select count(*) into sites_before from public.customer_sites s where s.customer_id = cust.id;
      site_id := private.ensure_request_site(cust.id, req);
      req.customer_id := cust.id;
      req.customer_site_id := site_id;
      req.customer_number := coalesce(req.customer_number, cust.customer_number);
      delete from public.request_customer_suggestions x where x.request_id = req.id;
      insert into public.request_events (request_id, actor_type, event_type, to_value, data)
      values (req.id, 'automation', 'customer_auto_linked', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id,
        'site_added', (select count(*) from public.customer_sites s where s.customer_id = cust.id) > sites_before));
      return req;
    end if;

    -- Uncertain: several sure matches, or weaker hints (same company elsewhere, same company domain, inactive customer)
    delete from public.request_customer_suggestions x where x.request_id = req.id;
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
    req.customer_number := coalesce(req.customer_number, cust.customer_number);
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

create or replace function private.link_customer_on_processed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.assign_request_customer(new);
end;
$$;

-- Back-fill of processed live requests without customer. Requests with open suggestions wait for a human and are
-- skipped, so a second run changes nothing. outcome: anlegen | verknuepfen | vorschlag | uebersprungen
create function private.backfill_request_customers(apply boolean default false)
returns table (request_number text, outcome text, customer_number text, detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  req public.requests;
  res public.requests;
  last_seq bigint;
  ev record;
  seq_value bigint;
  seq_called boolean;
begin
  select s.last_value, s.is_called into seq_value, seq_called from private.customer_number_seq s;
  for req in
    select * from public.requests r
    where r.intake_status = 'processed' and r.customer_id is null and not r.is_demo
      and not exists (select 1 from public.request_customer_suggestions x where x.request_id = r.id)
    order by r.created_at
    for update
  loop
    request_number := req.request_number;
    outcome := 'uebersprungen';
    customer_number := null;
    detail := 'Fehler bei der Zuordnung, siehe Warnung';
    begin
      select coalesce(max(e.seq), 0) into last_seq from public.request_events e where e.request_id = req.id;
      res := private.assign_request_customer(req);
      if res.customer_id is not null then
        update public.requests r set customer_id = res.customer_id, customer_site_id = res.customer_site_id, customer_number = res.customer_number
        where r.id = req.id;
      end if;
      select e.event_type, e.to_value, e.data into ev from public.request_events e
      where e.request_id = req.id and e.seq > last_seq and e.event_type in ('customer_auto_created', 'customer_auto_linked', 'customer_suggested')
      order by e.seq desc limit 1;
      if ev.event_type = 'customer_auto_created' then
        outcome := 'anlegen';
        customer_number := case when apply then ev.to_value end;
        detail := concat_ws(', ', req.company_name, req.street_house_number, btrim(req.postal_code) || ' ' || req.city);
      elsif ev.event_type = 'customer_auto_linked' then
        outcome := 'verknuepfen';
        customer_number := ev.to_value;
        detail := case when (ev.data ->> 'site_added')::boolean then 'neuer Standort ' else 'bestehender Standort ' end
          || concat_ws(', ', req.street_house_number, btrim(req.postal_code) || ' ' || req.city);
      elsif ev.event_type = 'customer_suggested' then
        outcome := 'vorschlag';
        select string_agg(c.customer_number || ' ' || c.company_name || ' (' || x.reason || ')', '; ' order by c.customer_number) into detail
        from public.request_customer_suggestions x join public.customers c on c.id = x.customer_id where x.request_id = req.id;
      end if;
      if not apply then
        raise exception 'Probelauf' using errcode = 'RWDRY';
      end if;
    exception when sqlstate 'RWDRY' then
      null; -- dry run: everything of this request rolled back, the report row stays
    end;
    return next;
  end loop;
  if not apply then
    perform setval('private.customer_number_seq', seq_value, seq_called);
  end if;
end;
$$;

revoke all on function private.assign_request_customer(public.requests), private.backfill_request_customers(boolean)
  from public, anon, authenticated;
