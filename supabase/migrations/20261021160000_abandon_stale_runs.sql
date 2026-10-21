-- task-17-6: a run that crashed (power cut, kill) leaves its request and its run in "running", and the partial
-- unique indexes would then block every further run. The scripts call this function after taking the lock on the
-- host (no other run can be active then) and close such leftovers as failed.
create function public.abandon_stale_runs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
  m integer;
begin
  perform private.require_integration();
  update public.system_updates set status = 'failed', finished_at = now(),
    error = coalesce(error, 'Lauf abgebrochen (Prozess beendet, ohne den Lauf abzuschließen)')
  where status = 'running';
  get diagnostics n = row_count;
  update public.update_requests set status = 'failed', finished_at = now() where status = 'running';
  get diagnostics m = row_count;
  return n + m;
end;
$$;
revoke all on function public.abandon_stale_runs() from public, anon, authenticated;
grant execute on function public.abandon_stale_runs() to service_role;
notify pgrst, 'reload schema';
