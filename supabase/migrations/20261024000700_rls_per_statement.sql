-- task-26-1 (user report 24.10.2026, after the live test): the planning board got slower. The policies checked every
-- row on its own: can_read_message looked the message up again, can_access_request looked the request up, and the
-- role was read from profiles once per call. The shared dashboard poll counts whole tables every 20 seconds, so on the
-- VPS a count of the ~3,100 messages took 1.3 s; locally a dispatcher needed 0.8 s for messages, 1.2 s for events.
--
-- Same visibility as before, evaluated once per statement: role and visibility levels as initplans, the requests a
-- user may read as one set (hashed subplan) instead of one lookup per row. private.can_access_request and
-- private.can_read_message stay for functions and the storage policies.

-- Requests the caller may read, same rules as private.can_access_request
create function private.accessible_request_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id from public.requests r
  where case private.current_employee_role()
    when 'admin' then true
    when 'manager' then true
    when 'dispatcher' then r.dispatcher_id = (select auth.uid())
    when 'technician' then r.technician_id = (select auth.uid())
      or exists (select 1 from public.visits v where v.request_id = r.id and v.technician_id = (select auth.uid()))
    else false
  end;
$$;

-- Visibility levels the caller may read, same rules as private.visibility_allowed
create function private.allowed_visibilities()
returns public.visibility_level[]
language sql
stable
set search_path = ''
as $$
  select array_remove(array[
    case when private.is_active_employee() then 'operational'::public.visibility_level end,
    case when coalesce(private.current_employee_role() in ('dispatcher', 'manager', 'admin'), false) then 'dispatch'::public.visibility_level end,
    case when private.is_manager_or_admin() then 'management'::public.visibility_level end
  ], null);
$$;

revoke all on function private.accessible_request_ids() from public, anon;
revoke all on function private.allowed_visibilities() from public, anon;
grant execute on function private.accessible_request_ids() to authenticated;
grant execute on function private.allowed_visibilities() to authenticated;

alter policy requests_select on public.requests
  using ((select private.is_manager_or_admin()) or id in (select private.accessible_request_ids()));

alter policy request_events_select on public.request_events
  using (
    (select private.is_manager_or_admin())
    or (request_id in (select private.accessible_request_ids()) and visibility = any ((select private.allowed_visibilities())::public.visibility_level[]))
  );

-- Former private.can_read_message(id), on the columns of the row itself
alter policy messages_select on public.messages
  using (
    (select private.is_manager_or_admin())
    or (
      (select private.current_employee_role()) = 'dispatcher'
      and (
        (request_id is not null and request_id in (select private.accessible_request_ids()))
        or (request_id is null and inbox_dispatcher_id = (select auth.uid()))
      )
    )
  );

alter policy visits_select on public.visits
  using (
    (select private.is_manager_or_admin())
    or (
      request_id in (select private.accessible_request_ids())
      and (
        (select private.current_employee_role()) <> 'technician'
        or technician_id = (select auth.uid())
        or private.is_current_technician(request_id)
      )
    )
  );

alter policy automation_runs_select on public.automation_runs
  using (
    (select private.is_manager_or_admin())
    or (
      (select private.current_employee_role()) = 'dispatcher'
      and (
        (request_id is not null and request_id in (select private.accessible_request_ids()))
        or (request_id is null and message_id is not null and private.can_read_message(message_id))
      )
    )
  );

alter policy visit_holds_staff_read on public.visit_holds
  using ((select private.current_employee_role()) in ('dispatcher', 'manager', 'admin') and request_id in (select private.accessible_request_ids()));

alter policy visit_change_requests_select on public.visit_change_requests
  using ((select private.current_employee_role()) in ('dispatcher', 'manager', 'admin') and request_id in (select private.accessible_request_ids()));
