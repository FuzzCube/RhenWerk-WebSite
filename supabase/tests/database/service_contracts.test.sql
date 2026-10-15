-- task-13-9: service contracts (SLA) and the check for the phone assistant. Run with: supabase test db
begin;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@x.test'),
  ('00000000-0000-0000-0000-0000000000b1', 't1@x.test');
insert into public.profiles (id, display_name, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'Dispo 1', 'dispatcher'),
  ('00000000-0000-0000-0000-0000000000b1', 'Technik 1', 'technician');
insert into public.service_contracts (contract_number, company_name, postal_codes, emergency_24_7, valid_from, valid_until) values
  ('SLA-2099-101', 'Neckartest Brauerei GmbH', '{69115}', true, '2021-01-01', null),
  ('SLA-2099-102', 'Pfalztest Druckerei KG', '{67059}', false, '2021-01-01', null),
  ('SLA-2099-103', 'Abgelaufen Metall GmbH', '{68519}', true, '2020-01-01', '2021-12-31'),
  ('SLA-2099-104', 'Zukunft Recycling GmbH', '{68623}', true, '2099-01-01', null),
  ('SLA-2099-105', 'Zwei Standorte Molkerei GmbH', '{69168,69190}', true, '2021-01-01', null);

create function pg_temp.check(n text, company text default null, plz text default null) returns text language sql as $$
  select public.agent_check_contract(n, company, plz) ->> 'status';
$$;

-- Agent check: service_role only, status only (no company)
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(pg_temp.check('SLA-2099-101', null, '69115'), 'gueltig_24_7', 'valid 24/7 by site');
select is(pg_temp.check('sla 2099 101', 'Neckartest Brauerei', null), 'gueltig_24_7', 'spoken number and company without legal form');
select is(pg_temp.check('2099-102', null, '67059'), 'gueltig_ohne_24_7', 'valid without 24/7, number without prefix');
select is(pg_temp.check('SLA-2099-103', null, '68519'), 'abgelaufen', 'expired');
select is(pg_temp.check('SLA-2099-104', null, '68623'), 'noch_nicht_gueltig', 'not yet valid');
select is(pg_temp.check('SLA-2099-105', null, '69190'), 'gueltig_24_7', 'second site of the contract');
select is(pg_temp.check('SLA-2099-101', null, '68159'), 'passt_nicht', 'site not in the contract');
select is(pg_temp.check('SLA-2099-101', 'Andere Firma GmbH', null), 'passt_nicht', 'other company');
select is(pg_temp.check('SLA-2099-999', null, '69115'), 'unbekannt', 'unknown number');
select is(pg_temp.check('SLA-2099-101'), 'angaben_fehlen', 'neither company nor site');
select ok(not (public.agent_check_contract('SLA-2099-101', null, '69115') ? 'company_name'), 'no company in the answer');
reset role;

-- Staff read, technicians and the API cannot; nobody writes through the API
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000b1', 'role', 'authenticated')::text, true);
select throws_ok($$select public.agent_check_contract('SLA-2099-101', null, '69115')$$, '42501', null, 'agent check not for employees');
select is((select count(*)::int from public.service_contracts where contract_number like 'SLA-2099-%'), 0, 'technician sees no contracts');
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select is((select count(*)::int from public.service_contracts where contract_number like 'SLA-2099-%'), 5, 'dispatcher reads contracts');
select throws_ok($$insert into public.service_contracts (contract_number, company_name, valid_from) values ('SLA-2099-106', 'X GmbH', '2021-01-01')$$, '42501', null, 'no insert through the API');
reset role;
select throws_ok($$insert into public.service_contracts (contract_number, company_name, valid_from) values ('K-10007', 'X GmbH', '2021-01-01')$$, '23514', null, 'number format enforced');

select * from finish();
rollback;
