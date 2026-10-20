-- task-12-9: e-mails that n8n should have sent but that are still waiting. Same condition as claim_queued_messages
-- (outgoing, queued, approved or automatic, not for a demo request), waiting since approval longer than min_minutes.
-- A backlog means the Gmail dispatch in n8n is down (e.g. expired Google access). Security definer, because a
-- dispatcher only reads their own messages but an outage concerns all of them; only counts are returned.

create function public.send_backlog(min_minutes integer default 10)
returns table (waiting integer, oldest_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  return query
  select count(*)::int, min(ms.approved_at)
  from public.messages ms
  left join public.requests q on q.id = ms.request_id
  left join public.messages root on root.id = ms.inbox_root_id
  where ms.direction = 'outgoing' and ms.status = 'queued'
    and ((q.id is not null and not q.is_demo)
      or (ms.request_id is null and root.mailbox_key = 'rheinwerk.industrieservice@gmail.com'))
    and (ms.approved_by is not null or ms.kind in ('receipt', 'payment_reminder')) and ms.approved_at is not null
    and ms.approved_at < now() - make_interval(mins => greatest(1, send_backlog.min_minutes));
end;
$$;

revoke all on function public.send_backlog(integer) from public, anon;
grant execute on function public.send_backlog(integer) to authenticated;
