-- task-13-5: calendar for the agent in servicezeit (dates are looked up, not computed). Run with: supabase test db
begin;
select plan(5);

select is(jsonb_array_length(private.agent_calendar('2026-10-19')), 21, '21 days');
select is(private.agent_calendar('2026-10-19') ->> 0, 'Montag, der 19. Oktober (KW 43), heute = 2026-10-19', 'today first');
select is(private.agent_calendar('2026-10-19') ->> 9, 'Mittwoch, der 28. Oktober (KW 44) = 2026-10-28', 'Wednesday of next week');
select is(private.agent_calendar('2026-10-30') ->> 2, 'Sonntag, der 1. November (KW 44), Feiertag = 2026-11-01', 'holiday marked');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(jsonb_array_length(public.agent_service_hours('cal-call-1') -> 'kalender'), 21, 'servicezeit returns the calendar');
reset role;

select * from finish();
rollback;
