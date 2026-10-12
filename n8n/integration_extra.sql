create function public.find_submission(submission_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare req public.requests;
begin
  perform private.require_integration();
  select * into req from public.requests r where r.source_event_key='website_form:'||submission_id;
  return jsonb_build_object('exists',found,'request',case when req.id is null then null else to_jsonb(req) end);
end;
$$;
create function public.list_orphaned_integration_files() returns setof jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_integration();
  return query select jsonb_build_object('storage_path',o.name) from storage.objects o
    where o.bucket_id='dashboard' and o.created_at<now()-interval '24 hours'
    and o.name~'^(requests|messages)/[0-9a-f-]{36}/'
    and not exists(select 1 from public.attachments a where a.bucket=o.bucket_id and a.storage_path=o.name);
end;
$$;
revoke all on function public.find_submission(uuid),public.list_orphaned_integration_files() from public,anon,authenticated;
grant execute on function public.find_submission(uuid),public.list_orphaned_integration_files() to service_role;
notify pgrst,'reload schema';
