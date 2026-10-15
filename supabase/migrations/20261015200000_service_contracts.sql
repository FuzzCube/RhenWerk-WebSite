-- task-13-9: service contracts (SLA) as master data, so the phone assistant and the dispatcher can check a contract
-- number the customer names. Demo contracts come with the demo seed (is_demo). Staff read; nobody writes through
-- the API (no admin screen yet). The check for the agent never reveals the company of a number: it only says
-- whether the number fits what the caller said.

create table public.service_contracts (
  id uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  company_name text not null,
  customer_number text,
  -- Sites covered by the contract (postal codes); empty = all sites of the company
  postal_codes text[] not null default '{}',
  emergency_24_7 boolean not null default false,
  valid_from date not null,
  valid_until date,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_contracts_number_format check (contract_number ~ '^SLA-[0-9]{4}-[0-9]{3,}$'),
  constraint service_contracts_company check (nullif(btrim(company_name), '') is not null),
  constraint service_contracts_period check (valid_until is null or valid_until >= valid_from),
  constraint service_contracts_postal_codes check (array_position(postal_codes, null) is null)
);

create trigger service_contracts_set_updated_at
  before update on public.service_contracts
  for each row execute function public.set_updated_at();

alter table public.service_contracts enable row level security;
create policy service_contracts_staff_read on public.service_contracts for select to authenticated
  using (private.current_employee_role() in ('dispatcher', 'manager', 'admin'));
revoke insert, update, delete on public.service_contracts from anon, authenticated;

-- Company names without legal form and punctuation, for a tolerant comparison ("Neckartal Brauerei" = "Neckartal Brauerei GmbH")
create function private.company_key(name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(
    regexp_replace(lower(coalesce(name, '')), '\m(gmbh|ag|kg|co|ohg|ug|se|e\.?\s?k|mbh|haftungsbeschränkt)\M|&|[.,()+/-]', ' ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Status of a contract number against what the caller said (company and/or postal code of the site):
-- gueltig_24_7, gueltig_ohne_24_7, abgelaufen, noch_nicht_gueltig, passt_nicht, unbekannt, angaben_fehlen
create function private.contract_status(contract_number text, company_name text, postal_code text, on_day date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.service_contracts;
  wanted text := upper(regexp_replace(coalesce(contract_status.contract_number, ''), '\s+', '', 'g'));
  company text := private.company_key(contract_status.company_name);
  plz text := nullif(btrim(coalesce(contract_status.postal_code, '')), '');
  company_ok boolean;
  plz_ok boolean;
begin
  if wanted = '' then
    return jsonb_build_object('status', 'angaben_fehlen');
  end if;
  -- "SLA 2021 801" or "2021-801" spoken without the prefix
  if wanted !~ '^SLA-' then
    wanted := 'SLA-' || regexp_replace(wanted, '^SLA', '');
  end if;
  wanted := regexp_replace(wanted, '^SLA-?([0-9]{4})-?([0-9]{3,})$', 'SLA-\1-\2');

  select * into c from public.service_contracts s where s.contract_number = wanted;
  if not found then
    return jsonb_build_object('status', 'unbekannt');
  end if;
  if company = '' and plz is null then
    return jsonb_build_object('status', 'angaben_fehlen');
  end if;

  company_ok := length(company) >= 4 and (position(company in private.company_key(c.company_name)) > 0 or position(private.company_key(c.company_name) in company) > 0);
  plz_ok := plz is not null and (cardinality(c.postal_codes) = 0 or plz = any(c.postal_codes));
  -- A named site must be covered by the contract; without a site the company must match
  if (plz is not null and not plz_ok) or (plz is null and not company_ok) then
    return jsonb_build_object('status', 'passt_nicht');
  end if;

  if c.valid_from > on_day then
    return jsonb_build_object('status', 'noch_nicht_gueltig', 'gueltig_ab', c.valid_from);
  end if;
  if c.valid_until is not null and c.valid_until < on_day then
    return jsonb_build_object('status', 'abgelaufen', 'gueltig_bis', c.valid_until);
  end if;
  return jsonb_build_object('status', case when c.emergency_24_7 then 'gueltig_24_7' else 'gueltig_ohne_24_7' end,
    'gueltig_bis', c.valid_until, 'vertrag', c.contract_number);
end;
$$;

-- For the phone assistant (n8n, service_role): status only, no company or customer data
create function public.agent_check_contract(contract_number text, company_name text default null, postal_code text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  return private.contract_status(agent_check_contract.contract_number, agent_check_contract.company_name, agent_check_contract.postal_code,
    (now() at time zone 'Europe/Berlin')::date);
end;
$$;

revoke all on function private.company_key(text), private.contract_status(text, text, text, date) from public, anon, authenticated;
revoke all on function public.agent_check_contract(text, text, text) from public, anon, authenticated;
grant execute on function public.agent_check_contract(text, text, text) to service_role;
notify pgrst, 'reload schema';
