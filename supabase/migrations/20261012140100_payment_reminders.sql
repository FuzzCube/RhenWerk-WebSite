-- Payment reminders (task-10-2): staged reminders for overdue invoices.
-- Stage 1 friendly reminder, stage 2 first dunning notice, stage 3 second dunning notice with default notice.
-- Each stage is due a configurable number of days after the due date (stage 1) or after the previous
-- reminder (stages 2 and 3). A daily pg_cron run queues due reminders with system approval (user decision
-- 12.10.2026); managers and admins can send the next stage at once or pause reminders per invoice.
-- Never for paid, paused or demo invoices; at most one reminder per invoice and stage.

-- Settings: days per stage, null = stage off. Changes only affect reminders not yet created.
alter table public.settings
  add column reminder_stage1_days integer default 7 check (reminder_stage1_days between 1 and 90),
  add column reminder_stage2_days integer default 14 check (reminder_stage2_days between 1 and 90),
  add column reminder_stage3_days integer default 14 check (reminder_stage3_days between 1 and 90),
  add constraint settings_reminder_stages_in_order check (
    (reminder_stage2_days is null or reminder_stage1_days is not null)
    and (reminder_stage3_days is null or reminder_stage2_days is not null)
  );

-- Pause per invoice (not part of the frozen invoice contents, see guard_invoice_update)
alter table public.invoices
  add column reminders_paused_at timestamptz,
  add column reminders_paused_by uuid references public.profiles (id) on delete restrict,
  add column reminders_pause_reason text,
  add constraint invoices_reminder_pause check (
    (reminders_paused_at is null) = (reminders_paused_by is null)
    and (reminders_paused_at is null) = (nullif(btrim(reminders_pause_reason), '') is null)
  );

-- Messages: reminders are outgoing, belong to an invoice and may be approved by the system
alter table public.messages drop constraint messages_outgoing_fields;
alter table public.messages add constraint messages_outgoing_fields check (
  direction <> 'outgoing' or (
    status in ('draft', 'queued', 'sent', 'failed')
    and received_at is null
    and nullif(btrim(to_address), '') is not null
    and kind in ('receipt', 'clarification', 'invoice', 'other', 'payment_reminder')
  )
);
alter table public.messages drop constraint messages_invoice_kind;
alter table public.messages add constraint messages_invoice_kind check (kind not in ('invoice', 'payment_reminder') or invoice_id is not null);
alter table public.messages drop constraint messages_approval_pair;
alter table public.messages add constraint messages_approval_pair check (
  (approved_by is null) = (approved_at is null)
  or (kind in ('receipt', 'payment_reminder') and direction = 'outgoing' and approved_by is null and approved_at is not null)
);

-- Reminder log: one row per invoice and stage
create table public.invoice_reminders (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  stage smallint not null check (stage between 1 and 3),
  message_id uuid not null unique references public.messages (id) on delete cascade,
  trigger text not null check (trigger in ('automatic', 'manual')),
  created_by uuid references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint invoice_reminders_stage_unique unique (invoice_id, stage),
  constraint invoice_reminders_manual_actor check ((trigger = 'manual') = (created_by is not null))
);
create index invoice_reminders_invoice_idx on public.invoice_reminders (invoice_id);

alter table public.invoice_reminders enable row level security;
create policy invoice_reminders_select on public.invoice_reminders for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_reminders.invoice_id
    and ((select private.is_manager_or_admin()) or private.can_access_request(i.request_id))));
revoke all on public.invoice_reminders from anon, authenticated;
grant select on public.invoice_reminders to authenticated;

-- Current stage and next reminder per issued invoice. Single source for the daily run and the UI.
create view public.invoice_reminder_states with (security_invoker = true) as
select
  i.id as invoice_id,
  coalesce(r.last_stage, 0)::smallint as last_stage,
  r.last_at as last_reminder_at,
  i.reminders_paused_at is not null as paused,
  case when n.days is not null then (coalesce(r.last_stage, 0) + 1)::smallint end as next_stage,
  case when n.days is not null
    then coalesce((r.last_at at time zone coalesce(s.timezone, 'Europe/Berlin'))::date, i.payment_due_date) + n.days end as next_due_on
from public.invoices i
cross join public.settings s
left join lateral (
  select max(ir.stage) as last_stage, max(ir.created_at) as last_at
  from public.invoice_reminders ir where ir.invoice_id = i.id
) r on true
left join lateral (
  select case when i.status in ('issued', 'sent') and i.paid_at is null and coalesce(r.last_stage, 0) < 3
    then (array[s.reminder_stage1_days, s.reminder_stage2_days, s.reminder_stage3_days])[coalesce(r.last_stage, 0) + 1] end as days
) n on true
where s.id = 1 and i.status <> 'draft';
grant select on public.invoice_reminder_states to authenticated;

create function private.local_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone coalesce((select s.timezone from public.settings s where s.id = 1), 'Europe/Berlin'))::date
$$;

-- Creates the reminder e-mail (queued) and its log row. Automatic reminders are approved by the system
-- (approved_by null), manual ones by the acting manager or admin.
create function private.create_payment_reminder(inv public.invoices, reminder_stage smallint, actor uuid)
returns public.invoice_reminders
language plpgsql security definer set search_path = '' as $$
declare
  req public.requests;
  msg public.messages;
  result public.invoice_reminders;
  recipient text;
begin
  select * into req from public.requests r where r.id = inv.request_id;
  recipient := coalesce(nullif(btrim(inv.customer_snapshot ->> 'business_email'), ''), req.business_email);
  insert into public.messages (request_id, invoice_id, direction, kind, status, to_address, subject, body_text, body_html,
    author_id, approved_by, approved_at)
  values (req.id, inv.id, 'outgoing', 'payment_reminder', 'queued', recipient,
    private.reminder_subject(inv, reminder_stage), private.reminder_text(inv, req, reminder_stage),
    private.reminder_html(inv, req, reminder_stage), actor, actor, now())
  returning * into msg;
  insert into public.invoice_reminders (invoice_id, stage, message_id, trigger, created_by)
  values (inv.id, reminder_stage, msg.id, case when actor is null then 'automatic' else 'manual' end, actor)
  returning * into result;
  update public.requests r set updated_at = now() where r.id = req.id;
  insert into public.request_events (request_id, actor_type, actor_id, event_type, visibility, from_value, to_value, data)
  values (req.id, case when actor is null then 'automation' else 'user' end::public.actor_type, actor, 'payment_reminder_queued',
    'management', nullif(reminder_stage - 1, 0)::text, reminder_stage::text,
    jsonb_build_object('invoice_id', inv.id, 'invoice_number', inv.invoice_number, 'message_id', msg.id, 'stage', reminder_stage,
      'approved_by', case when actor is null then 'system' else actor::text end));
  return result;
end;
$$;

-- Daily run (pg_cron): at most one new stage per invoice and run, so stages keep their spacing.
create function public.run_payment_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  next_stage smallint;
  created integer := 0;
begin
  if coalesce(auth.role(), '') not in ('service_role', '') then
    raise exception 'Nur für den täglichen Lauf' using errcode = '42501';
  end if;
  for inv in
    select i.* from public.invoices i
    join public.requests q on q.id = i.request_id
    join public.invoice_reminder_states st on st.invoice_id = i.id
    where not q.is_demo and not st.paused and st.next_due_on <= private.local_today()
    order by i.payment_due_date
    for update of i skip locked
  loop
    -- Re-read under the lock: a payment or a parallel run may have changed the state
    select st.next_stage into next_stage from public.invoice_reminder_states st
    where st.invoice_id = inv.id and not st.paused and st.next_due_on <= private.local_today();
    if next_stage is null then continue; end if;
    perform private.create_payment_reminder(inv, next_stage, null);
    created := created + 1;
  end loop;
  return created;
end;
$$;

-- Manager/admin: send the next stage now (only for overdue, open, not paused invoices)
create function public.send_payment_reminder(invoice_id uuid, expected_version integer)
returns public.invoice_reminders
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid;
  locked record;
  st public.invoice_reminder_states;
begin
  caller := private.require_role('manager', 'admin');
  locked := private.lock_invoice(send_payment_reminder.invoice_id, send_payment_reminder.expected_version);
  if (locked.inv).status not in ('issued', 'sent') or (locked.inv).paid_at is not null then
    raise exception 'Erinnerungen nur für offene Rechnungen' using errcode = 'RW422';
  end if;
  if (locked.req).is_demo then
    raise exception 'Für Demo-Anfragen werden keine E-Mails versendet' using errcode = 'RW422';
  end if;
  if (locked.inv).reminders_paused_at is not null then
    raise exception 'Erinnerungen sind für diese Rechnung ausgesetzt' using errcode = 'RW422';
  end if;
  if (locked.inv).payment_due_date >= private.local_today() then
    raise exception 'Die Rechnung ist noch nicht überfällig' using errcode = 'RW422';
  end if;
  select * into st from public.invoice_reminder_states s where s.invoice_id = (locked.inv).id;
  if st.next_stage is null then
    raise exception 'Keine weitere Erinnerungsstufe vorgesehen' using errcode = 'RW422';
  end if;
  return private.create_payment_reminder(locked.inv, st.next_stage, caller);
end;
$$;

create function public.pause_payment_reminders(invoice_id uuid, expected_version integer, reason text)
returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid;
  locked record;
  result public.invoices;
begin
  caller := private.require_role('manager', 'admin');
  locked := private.lock_invoice(pause_payment_reminders.invoice_id, pause_payment_reminders.expected_version);
  if nullif(btrim(pause_payment_reminders.reason), '') is null then
    raise exception 'Bitte einen Grund angeben' using errcode = 'RW422';
  end if;
  if (locked.inv).reminders_paused_at is not null then return locked.inv; end if;
  update public.invoices i set reminders_paused_at = now(), reminders_paused_by = caller,
    reminders_pause_reason = btrim(pause_payment_reminders.reason)
  where i.id = (locked.inv).id returning * into result;
  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'payment_reminders_paused', null, null, result.reminders_pause_reason,
    jsonb_build_object('invoice_id', result.id, 'invoice_number', result.invoice_number), 'management');
  return result;
end;
$$;

create function public.resume_payment_reminders(invoice_id uuid, expected_version integer)
returns public.invoices
language plpgsql security definer set search_path = '' as $$
declare
  locked record;
  result public.invoices;
begin
  perform private.require_role('manager', 'admin');
  locked := private.lock_invoice(resume_payment_reminders.invoice_id, resume_payment_reminders.expected_version);
  if (locked.inv).reminders_paused_at is null then return locked.inv; end if;
  update public.invoices i set reminders_paused_at = null, reminders_paused_by = null, reminders_pause_reason = null
  where i.id = (locked.inv).id returning * into result;
  update public.requests r set updated_at = now() where r.id = (locked.req).id;
  perform private.log_request_event((locked.req).id, 'payment_reminders_resumed', null, null, null,
    jsonb_build_object('invoice_id', result.id, 'invoice_number', result.invoice_number), 'management');
  return result;
end;
$$;

-- Admin: days per stage (null = stage off)
create function public.admin_update_reminder_settings(stage1_days integer, stage2_days integer, stage3_days integer)
returns public.settings
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid;
  result public.settings;
begin
  caller := private.require_role('admin');
  if coalesce(stage1_days, 1) not between 1 and 90 or coalesce(stage2_days, 1) not between 1 and 90
     or coalesce(stage3_days, 1) not between 1 and 90 then
    raise exception 'Abstände müssen zwischen 1 und 90 Tagen liegen' using errcode = 'RW422';
  end if;
  if (stage2_days is not null and stage1_days is null) or (stage3_days is not null and stage2_days is null) then
    raise exception 'Eine Stufe setzt die vorherige voraus' using errcode = 'RW422';
  end if;
  update public.settings s
  set reminder_stage1_days = stage1_days, reminder_stage2_days = stage2_days, reminder_stage3_days = stage3_days,
      updated_by = caller
  where s.id = 1
  returning * into result;
  delete from private.demo_seed_records d where d.table_name = 'settings';
  return result;
end;
$$;

-- Sending: the Gmail workflow also picks up system-approved reminders
create or replace function public.claim_queued_messages(batch_limit integer default 5, lease_seconds integer default 180)
returns setof jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.messages; run public.automation_runs; lastmail public.messages;
begin
  perform private.require_integration();
  for m in select ms.* from public.messages ms join public.requests q on q.id=ms.request_id
    left join private.integration_send_leases l on l.message_id=ms.id
    where ms.direction='outgoing' and ms.status='queued' and not q.is_demo
      and (ms.approved_by is not null or ms.kind in ('receipt','payment_reminder')) and ms.approved_at is not null
      and (l.message_id is null or (l.lease_until<now() and l.next_attempt_at<=now()))
    order by ms.created_at limit greatest(1,least(batch_limit,20)) for update of ms skip locked loop
    insert into private.integration_send_leases(message_id,lease_until) values(m.id,now()+make_interval(secs=>greatest(60,least(lease_seconds,600))))
      on conflict(message_id) do update set lease_until=excluded.lease_until,attempts=private.integration_send_leases.attempts+1;
    insert into public.automation_runs(request_id,message_id,operation_key,step)
    values(m.request_id,m.id,'email_send:'||m.id,'email_send') on conflict(operation_key) do nothing;
    select * into lastmail from public.messages where request_id=m.request_id and mailbox_key='rheinwerk.industrieservice@gmail.com'
      and mime_message_id is not null order by created_at desc limit 1;
    return next to_jsonb(m)||jsonb_build_object('approved_by',coalesce(m.approved_by::text,'system'),'gmail_thread_id',coalesce(m.gmail_thread_id,lastmail.gmail_thread_id),
      'in_reply_to',coalesce(m.in_reply_to,lastmail.mime_message_id),'references_header',coalesce(m.references_header,lastmail.references_header));
  end loop;
end;
$$;

revoke all on function private.local_today(), private.create_payment_reminder(public.invoices, smallint, uuid)
  from public, anon, authenticated;
revoke all on function public.run_payment_reminders() from public, anon, authenticated;
grant execute on function public.run_payment_reminders() to service_role;
revoke all on function public.send_payment_reminder(uuid, integer), public.pause_payment_reminders(uuid, integer, text),
  public.resume_payment_reminders(uuid, integer), public.admin_update_reminder_settings(integer, integer, integer)
  from public, anon;
grant execute on function public.send_payment_reminder(uuid, integer), public.pause_payment_reminders(uuid, integer, text),
  public.resume_payment_reminders(uuid, integer), public.admin_update_reminder_settings(integer, integer, integer)
  to authenticated;

-- Daily at 06:00 UTC (08:00 Berlin in summer, 07:00 in winter)
create extension if not exists pg_cron;
select cron.schedule('payment-reminders', '0 6 * * *', 'select public.run_payment_reminders()');

notify pgrst, 'reload schema';
