-- task-17-8: queues of n8n for the watchdog (scripts/ops/n8n.mjs) and e-mails for warnings that n8n raises itself.

-- The rule of send_backlog (task-12-9) once, for the dashboard hint and for the watchdog
create function private.send_backlog_counts(min_minutes integer)
returns table (waiting integer, oldest_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select count(*)::int, min(ms.approved_at)
  from public.messages ms
  left join public.requests q on q.id = ms.request_id
  left join public.messages root on root.id = ms.inbox_root_id
  where ms.direction = 'outgoing' and ms.status = 'queued'
    and ((q.id is not null and not q.is_demo)
      or (ms.request_id is null and root.mailbox_key = 'rheinwerk.industrieservice@gmail.com'))
    and (ms.approved_by is not null or ms.kind in ('receipt', 'payment_reminder')) and ms.approved_at is not null
    and ms.approved_at < now() - make_interval(mins => greatest(1, min_minutes));
$$;
revoke all on function private.send_backlog_counts(integer) from public, anon, authenticated;

create or replace function public.send_backlog(min_minutes integer default 10)
returns table (waiting integer, oldest_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_role('dispatcher', 'manager', 'admin');
  return query select * from private.send_backlog_counts(send_backlog.min_minutes);
end;
$$;

-- Watchdog: e-mails waiting longer than 10 minutes for the Gmail dispatch, and requests waiting longer than
-- 15 minutes for the AI analysis (same selection as list_pending_analyses; the workflow runs every 2 minutes)
create function public.monitor_n8n_queues()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  send record;
  analysis record;
begin
  perform private.require_integration();
  select * into send from private.send_backlog_counts(10);
  select count(*)::int as waiting, min(p.since) as oldest_at into analysis
  from (
    select coalesce(reply.created_at, r.created_at) as since
    from public.requests r
    left join lateral (
      select m.created_at from public.messages m
      where m.request_id = r.id and m.direction = 'incoming' and m.handled_at is null
        and not exists (select 1 from private.integration_incoming_stage s where s.message_id = m.id and not s.ready)
      order by m.created_at desc limit 1
    ) reply on true
    where not r.is_demo and r.intake_completed_at is null and not private.is_terminal(r)
      and (r.intake_status in ('new', 'analyzing') or (r.intake_status = 'awaiting_customer' and reply.created_at is not null))
  ) p
  where p.since < now() - interval '15 minutes';
  return jsonb_build_object(
    'send_waiting', send.waiting, 'send_oldest', send.oldest_at,
    'analysis_waiting', analysis.waiting, 'analysis_oldest', analysis.oldest_at);
end;
$$;

-- Open warnings whose e-mail is due: never sent (e.g. raised by the n8n error workflow, or the send failed) or the
-- last one older than 6 hours (reminder, same rule as raise_alert). The watchdog sends them and calls
-- mark_alert_notified.
create function public.alerts_to_notify()
returns setof public.system_alerts
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  return query select * from public.system_alerts a
    where a.resolved_at is null and (a.notified_at is null or a.notified_at < now() - interval '6 hours')
    order by a.first_seen_at;
end;
$$;

-- Open warnings of one prefix (watchdog closes n8n:fehler:* once a workflow ran without error for an hour)
create function public.open_alerts(key_prefix text)
returns setof public.system_alerts
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_integration();
  return query select * from public.system_alerts a
    where a.resolved_at is null and starts_with(a.alert_key, key_prefix) order by a.first_seen_at;
end;
$$;

revoke all on function public.monitor_n8n_queues(), public.alerts_to_notify(), public.open_alerts(text) from public, anon, authenticated;
grant execute on function public.monitor_n8n_queues(), public.alerts_to_notify(), public.open_alerts(text) to service_role;
