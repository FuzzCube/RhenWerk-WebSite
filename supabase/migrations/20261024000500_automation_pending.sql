-- task-24-1 (user request 24.10.2026, after the live test): while the automation still works on a request in the
-- background, the dashboard shows "KI arbeitet …". Two cases: a new request waits for or is in its analysis, or a
-- customer reply waits for workflow 13 (visit reply) or 14 (reply assistant). The conditions mirror
-- reply_assist_pending (20261024000400). At most 15 minutes, so the mark does not spin forever when n8n is down.

create view public.request_automation_pending as
select r.id as request_id, 'analyse'::text as reason, r.created_at as since
from public.requests r
where r.intake_status in ('new', 'analyzing') and r.created_at > now() - interval '15 minutes'
  and private.current_employee_role() in ('dispatcher', 'manager', 'admin')
  and private.can_access_request(r.id)
union all
select q.id, 'antwort', max(m.received_at)
from public.messages m
join public.requests q on q.id = m.request_id and not q.is_demo and q.intake_completed_at is not null
where m.direction = 'incoming' and m.kind = 'customer_reply' and m.archived_at is null
  and m.received_at > now() - interval '15 minutes'
  and not exists (select 1 from public.automation_runs a where a.operation_key = 'reply_assist:' || m.id)
  and coalesce(m.from_address, '') !~* '(mailer-daemon|postmaster|no-?reply|do-?not-?reply)'
  and coalesce(m.subject, '') !~* '^(delivery status notification|undeliver|mail delivery|returned mail|automatic reply|auto[- ]?reply|automatische antwort|abwesenheit|out of office)'
  -- Workflow 13 handled it by itself: no assistant run follows
  and not exists (select 1 from public.automation_runs a where a.operation_key = 'visit_reply:' || m.id
    and a.result ->> 'action' in ('cancelled', 'moved', 'declined', 'change_requested', 'change_updated'))
  -- A person already answered or started an answer
  and not exists (select 1 from public.messages o where o.request_id = q.id and o.direction = 'outgoing'
    and o.system_template is null and o.created_at > m.received_at)
  and private.current_employee_role() in ('dispatcher', 'manager', 'admin')
  and private.can_access_request(q.id)
group by q.id;

comment on view public.request_automation_pending is 'Anfragen, an denen die Automatisierung gerade arbeitet (task-24-1): Analyse oder Kundenantwort für Workflow 13/14, höchstens 15 Minuten; Besitzerrechte, Zugriff über can_access_request geprüft.';
revoke all on public.request_automation_pending from public, anon, authenticated;
grant select on public.request_automation_pending to authenticated;
