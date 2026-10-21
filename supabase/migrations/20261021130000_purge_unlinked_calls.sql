-- Calls without a request (task-16-1, docs/telefonassistent/datenschutz.md): summary, category and figures are kept
-- 12 months after the end of the call, then the whole row is deleted. Calls with a request stay as long as the request.
-- Nothing references phone_calls, so deleting needs no follow-up.
create function public.purge_unlinked_calls()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  delete from public.phone_calls p
  where p.request_id is null and coalesce(p.ended_at, p.started_at) < now() - interval '12 months';
  get diagnostics n = row_count;
  return n;
end;
$$;
select cron.schedule('calls-without-request-12-months', '40 2 * * *', 'select public.purge_unlinked_calls()');

revoke all on function public.purge_unlinked_calls() from public, anon, authenticated;
grant execute on function public.purge_unlinked_calls() to service_role;
