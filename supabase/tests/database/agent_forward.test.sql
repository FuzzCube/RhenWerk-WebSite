-- task-13-11: demo transfer of the phone assistant (agent_forward). Run with: supabase test db
begin;
select plan(9);

set local role authenticated;
select throws_ok($$select public.agent_forward('fw-x', 'service_desk', 'x')$$, '42501', null, 'staff cannot call the tool');
reset role;

create temporary table open_now on commit drop as select private.in_service_hours(now()) as v;
grant select on open_now to service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.agent_forward('fw-1', 'irgendwo', 'Test') ->> 'fehler', 'ziel_ungueltig', 'unknown target');
create temporary table r on commit drop as select public.agent_forward('fw-1', 'bereitschaft', 'Stillstand Kompressor') as j;
select is((select (j ->> 'demo')::boolean and not (j ->> 'verbunden')::boolean from r), true, 'demo answer, not connected');
select ok((select j ->> 'ansage' like 'Dies ist ein Demo-Projekt.%Bereitschaftsdienst verbinden.%Rückruf%' from r), 'sentence names the standby service and offers a callback');
-- The service desk is a target only within the service hours
select is(public.agent_forward('fw-2', 'service_desk', 'Beschwerde') ->> case when (select v from open_now) then 'ok' else 'fehler' end,
  case when (select v from open_now) then 'true' else 'ausserhalb_servicezeit' end, 'service desk follows the service hours');
reset role;

select ok((select forwarded and forward_target = 'bereitschaft' and forward_reason = 'Stillstand Kompressor' and forwarded_at is not null
  from public.phone_calls where conversation_id = 'fw-1'), 'call marked as forwarded with target and reason');
-- A repetition keeps the first time
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select public.agent_forward('fw-1', 'bereitschaft', 'Stillstand Kompressor');
reset role;
select is((select count(*)::int from public.phone_calls where conversation_id = 'fw-1'), 1, 'one call row');
select ok((select forwarded_at <= now() from public.phone_calls where conversation_id = 'fw-1'), 'first transfer time kept');
select throws_ok($$update public.phone_calls set forwarded = false where conversation_id = 'fw-1'$$, '23514', null, 'target needs the forwarded flag');

select * from finish();
rollback;
