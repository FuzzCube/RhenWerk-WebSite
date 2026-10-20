-- task-14-1: customers come from processed requests. When a live request reaches intake_status processed (complete_intake
-- by staff or apply_analysis_result by n8n, and any later path), it is linked to an existing customer or a new customer
-- with its address as first site is created. Uncertain matches create nothing and are kept as suggestions for a human
-- (task-14-2). Not at receipt on purpose: spam, duplicates and rejected requests must not fill the master data.
-- Decision and rules: docs/decisions.md (2026-10-20).
--
-- Rules (live customers only; demo requests never reach this code):
--   already linked                      → only add the request address as site if it is new
--   exactly one sure match              → link; a new address becomes a further site
--     sure = same e-mail (case-insensitive) or same normalized company + postal code of an active site, customer active
--   no match at all                     → create customer K-2xxxx (company, contact, e-mail, phone) + first site, link
--   uncertain (several sure matches, same company other postal code, same company e-mail domain, inactive customer)
--                                       → create nothing, store suggestions
-- The trigger changes only the row being updated (no second update, no extra version) and never blocks the intake:
-- an unexpected error is turned into a warning and the request stays without customer.

-- Company name for comparisons: lower case, umlauts spelled out, without punctuation and legal forms
-- "Müller Pumpen GmbH & Co. KG" → "mueller pumpen"
create function private.customer_company_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
    replace(replace(replace(replace(lower(coalesce(value, '')), 'ä', 'ae'), 'ö', 'oe'), 'ü', 'ue'), 'ß', 'ss'),
    '[^a-z0-9 ]', '', 'g'),
    '\m(gmbh|mbh|ag|kg|kgaa|ohg|gbr|ug|se|ev|ek|eg|co|haftungsbeschraenkt|und)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

-- Street for comparisons: "Hafenstraße 12a" = "Hafenstr. 12 a"
create function private.street_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(replace(replace(lower(coalesce(value, '')), 'straße', 'str'), 'strasse', 'str'), '[^a-z0-9äöü]', '', 'g');
$$;

-- Domain of an e-mail address, null for free mail providers (they say nothing about the company)
create function private.company_domain(email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when d is null or d = any (array['gmail.com', 'googlemail.com', 'gmx.de', 'gmx.net', 'gmx.at', 'web.de', 't-online.de',
      'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'live.com', 'live.de', 'msn.com', 'yahoo.com', 'yahoo.de',
      'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.de', 'freenet.de', 'arcor.de', 'mail.de', 'posteo.de', 'online.de',
      'protonmail.com', 'proton.me', 'example.com'])
    then null else d end
  from (select nullif(lower(split_part(btrim(coalesce(email, '')), '@', 2)), '') as d) x;
$$;

-- Suggestions for uncertain matches; shown on the request page (task-14-2). Read like customers, written only here.
create table public.request_customer_suggestions (
  request_id uuid not null references public.requests (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  reason text not null check (reason in ('mehrere_treffer', 'gleiche_firma', 'gleiche_domain', 'kunde_inaktiv')),
  created_at timestamptz not null default now(),
  primary key (request_id, customer_id)
);
comment on table public.request_customer_suggestions is 'Mögliche Bestandskunden einer Anfrage, wenn die automatische Zuordnung unsicher war (task-14-1).';
alter table public.request_customer_suggestions enable row level security;
create policy request_customer_suggestions_staff_read on public.request_customer_suggestions for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin'));
revoke insert, update, delete, truncate on public.request_customer_suggestions from anon, authenticated;

-- Site of the customer with the request address, created when missing
create function private.ensure_request_site(target_customer uuid, req public.requests)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_id uuid;
begin
  select s.id into found_id from public.customer_sites s
  where s.customer_id = target_customer and s.postal_code = btrim(req.postal_code)
    and private.street_key(s.street_house_number) = private.street_key(req.street_house_number)
  order by s.is_active desc, s.created_at limit 1;
  if found_id is null then
    insert into public.customer_sites (customer_id, label, street_house_number, postal_code, city)
    values (target_customer, private.clean(req.site_label), private.clean(req.street_house_number), btrim(req.postal_code), private.clean(req.city))
    returning id into found_id;
  end if;
  return found_id;
end;
$$;

create function private.link_customer_on_processed()
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
    -- Already linked (phone assistant, dispatcher): only make sure the address is one of its sites
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

    -- Uncertain: several sure matches, or weaker hints (same company elsewhere, same company domain, inactive customer)
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

    -- No match at all: new customer with the request address as first site
    insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number)
    values ('K-' || nextval('private.customer_number_seq'), private.clean(new.company_name), private.clean(new.contact_name),
      -- An address the master data would not accept is left out instead of failing
      case when email ~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$' then email end, private.clean(new.phone_number))
    returning * into cust;
    site_id := private.ensure_request_site(cust.id, new);
    new.customer_id := cust.id;
    new.customer_site_id := site_id;
    new.customer_number := coalesce(new.customer_number, cust.customer_number);
    insert into public.request_events (request_id, actor_type, event_type, to_value, data)
    values (new.id, 'automation', 'customer_auto_created', cust.customer_number, jsonb_build_object('customer_id', cust.id, 'site_id', site_id));
    return new;
  exception when others then
    -- Never block the intake; the request stays without customer and can be linked by hand
    raise warning 'Automatische Kundenzuordnung für Anfrage % übersprungen: %', new.id, sqlerrm;
    return original;
  end;
end;
$$;

create trigger requests_link_customer before update of intake_status on public.requests
  for each row when (new.intake_status = 'processed' and old.intake_status is distinct from 'processed' and not new.is_demo)
  execute function private.link_customer_on_processed();
