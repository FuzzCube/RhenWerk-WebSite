-- task-17-12: the area "System" is for the owner; code updates are no longer requested from the dashboard. The
-- nightly run and the terminal (npm run prod:update, prod:release -- --switch) stay. The table update_requests and
-- the service online.rheinwerk.requests remain for backups, data restore and system updates (task-17-13 to 17-16).
revoke execute on function public.request_update(), public.request_rollback(text) from authenticated;
