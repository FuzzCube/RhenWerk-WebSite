-- task-14-4: customers normally come from requests (task-14-1); "Kunde anlegen" stays for cases without a request
-- (maintenance or SLA contract before the first order, existing customers, several sites up front). Two additions:
--   origin_request_id   request a customer was created from (automatically or "Neuen Kunden anlegen"); null = manual
--   find_similar_customers   duplicate check before manual creation, same rules as the automatic match

alter table public.customers add column origin_request_id uuid references public.requests (id) on delete set null;
comment on column public.customers.origin_request_id is 'Anfrage, aus der der Kunde entstanden ist (automatisch oder „Neuen Kunden anlegen“); leer = manuell angelegt.';

-- Customers created from requests so far: the creating event names the customer
update public.customers c set origin_request_id = e.request_id
from (
  select distinct on ((ev.data ->> 'customer_id')::uuid) (ev.data ->> 'customer_id')::uuid as customer_id, ev.request_id
  from public.request_events ev
  where ev.event_type in ('customer_auto_created', 'customer_created_from_request') and ev.data ? 'customer_id'
  order by (ev.data ->> 'customer_id')::uuid, ev.seq
) e
where e.customer_id = c.id and c.origin_request_id is null;

create or replace function private.new_customer_from_request(req public.requests)
returns public.customers
language plpgsql
security definer
set search_path = ''
as $$
declare
  email text := lower(btrim(req.business_email));
  result public.customers;
begin
  insert into public.customers (customer_number, company_name, contact_name, business_email, phone_number, is_demo, origin_request_id)
  values ('K-' || nextval('private.customer_number_seq'), private.clean(req.company_name), private.clean(req.contact_name),
    -- An address the master data would not accept is left out instead of failing
    case when email ~* '^[^@\s]+@[^@\s.]+(\.[^@\s.]+)*\.[a-z]{2,}$' then email end, private.clean(req.phone_number), req.is_demo, req.id)
  returning * into result;
  return result;
end;
$$;

-- Similar customers for the form "Kunde anlegen" (demo customers included: only a warning, and staff see them in the list); reason:
--   gleiche_email | gleiche_firma (same postal code at an active site) | gleiche_firma_anderswo | gleiche_domain
create function public.find_similar_customers(company_name text, business_email text default null, postal_code text default null)
returns table (id uuid, customer_number text, company text, city text, is_active boolean, reason text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  key text := private.customer_company_key(find_similar_customers.company_name);
  domain text := private.company_domain(find_similar_customers.business_email);
  email text := lower(btrim(coalesce(find_similar_customers.business_email, '')));
  plz text := btrim(coalesce(find_similar_customers.postal_code, ''));
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  return query
  select c.id, c.customer_number, c.company_name,
    (select s.city from public.customer_sites s where s.customer_id = c.id order by s.is_active desc, s.created_at limit 1),
    c.is_active,
    case
      when email <> '' and lower(c.business_email) = email then 'gleiche_email'
      when key is not null and private.customer_company_key(c.company_name) = key and exists (
        select 1 from public.customer_sites s where s.customer_id = c.id and s.is_active and s.postal_code = plz) then 'gleiche_firma'
      when key is not null and private.customer_company_key(c.company_name) = key then 'gleiche_firma_anderswo'
      else 'gleiche_domain'
    end
  from public.customers c
  where (
    (email <> '' and lower(c.business_email) = email)
    or (key is not null and private.customer_company_key(c.company_name) = key)
    or (domain is not null and private.company_domain(c.business_email) = domain))
  order by c.is_active desc, c.customer_number
  limit 5;
end;
$$;

revoke all on function public.find_similar_customers(text, text, text) from public, anon;
grant execute on function public.find_similar_customers(text, text, text) to authenticated;
