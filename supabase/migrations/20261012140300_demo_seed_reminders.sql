-- Demo seed loads the reminder history of overdue demo invoices (task-10-2).
-- Also: a reseed replaces the demo working hours. With live visits in the calendar the row-wise availability
-- check fired between delete and re-insert. During demo_seed_apply the check now waits and runs once at the end.

create or replace function private.availability_conflict(target_technician_id uuid)
returns record
language sql stable security definer set search_path = '' as $$
  select v.id, v.scheduled_start, private.availability_problem(target_technician_id, v.scheduled_start, v.scheduled_end) as problem
  from public.visits v
  where v.technician_id = target_technician_id
    and v.status in ('scheduled', 'in_progress')
    and v.scheduled_end > now()
    and private.availability_problem(target_technician_id, v.scheduled_start, v.scheduled_end) is not null
  order by v.scheduled_start
  limit 1
$$;

create or replace function private.check_availability_change()
returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  affected uuid;
  broken record;
begin
  if current_setting('rheinwerk.demo_seed_running', true) = 'on' then
    return null;
  end if;
  for affected in
    select distinct e from unnest(array[
      case when tg_op in ('INSERT', 'UPDATE') then new.employee_id end,
      case when tg_op in ('UPDATE', 'DELETE') then old.employee_id end
    ]) as e where e is not null order by 1
  loop
    perform private.lock_technician(affected);
    select * into broken from private.availability_conflict(affected) as c(id uuid, scheduled_start timestamptz, problem text);
    if broken.id is not null then
      raise exception 'Änderung kollidiert mit dem aktiven Einsatz am % (%). Einsatz zuerst umplanen oder stornieren.',
        broken.scheduled_start, broken.problem
        using errcode = 'RW422';
    end if;
  end loop;
  return null;
end;
$$;
revoke all on function private.availability_conflict(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.demo_seed_apply(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  purged jsonb;
  inv record;
  cfg public.settings;
  broken record;
begin
  perform set_config('rheinwerk.demo_seed_running', 'on', true);
  purged := public.demo_seed_purge();

  -- Settings: only fill an untouched configuration, remember the original for the purge
  select * into cfg from public.settings where id = 1;
  if payload ? 'settings' and cfg.updated_by is null and cfg.company_details = '{}'::jsonb then
    insert into private.demo_seed_records (table_name, record_id, original)
    values ('settings', '1', to_jsonb(cfg) - 'id' - 'created_at' - 'updated_at');

    update public.settings s
    set company_details = payload -> 'settings' -> 'company_details',
        manual_intake_minutes = coalesce((payload -> 'settings' ->> 'manual_intake_minutes')::numeric, s.manual_intake_minutes),
        default_tax_rate = coalesce((payload -> 'settings' ->> 'default_tax_rate')::numeric, s.default_tax_rate),
        payment_terms_days = coalesce((payload -> 'settings' ->> 'payment_terms_days')::integer, s.payment_terms_days)
    where s.id = 1;
  end if;

  insert into public.service_rates select * from jsonb_populate_recordset(null::public.service_rates, payload -> 'service_rates');
  insert into private.demo_seed_records (table_name, record_id)
  select 'service_rates', x ->> 'id' from jsonb_array_elements(payload -> 'service_rates') x;

  insert into public.employee_availability
  select * from jsonb_populate_recordset(null::public.employee_availability, payload -> 'employee_availability');
  insert into private.demo_seed_records (table_name, record_id)
  select 'employee_availability', x ->> 'id' from jsonb_array_elements(payload -> 'employee_availability') x;

  insert into public.requests
  select * from jsonb_populate_recordset(null::public.requests, payload -> 'requests') r
  order by r.created_at, r.source_event_key;

  insert into public.visits
  select * from jsonb_populate_recordset(null::public.visits, payload -> 'visits');

  insert into public.work_entries
  select * from jsonb_populate_recordset(null::public.work_entries, payload -> 'work_entries');

  -- Invoices: insert as draft with items, then issue in chronological order (atomic numbers)
  insert into public.invoices (id, request_id, status, created_by, currency, seller_snapshot, customer_snapshot, notes, created_at, updated_at)
  select i.id, i.request_id, 'draft', i.created_by, i.currency, '{}'::jsonb, '{}'::jsonb, i.notes, i.created_at, i.updated_at
  from jsonb_populate_recordset(null::public.invoices, payload -> 'invoices') i;

  insert into public.invoice_items
  select * from jsonb_populate_recordset(null::public.invoice_items, payload -> 'invoice_items');

  for inv in
    select * from jsonb_populate_recordset(null::public.invoices, payload -> 'invoices') i
    where i.status <> 'draft'
    order by i.issued_at, i.id
  loop
    update public.invoices i
    set status = inv.status,
        invoice_number = private.next_invoice_number(extract(year from inv.issue_date)::integer),
        issued_by = inv.issued_by,
        issue_date = inv.issue_date,
        payment_due_date = inv.payment_due_date,
        issued_at = inv.issued_at,
        sent_at = inv.sent_at,
        paid_at = inv.paid_at,
        subtotal = t.net,
        tax_total = t.tax,
        total = t.net + t.tax,
        seller_snapshot = inv.seller_snapshot,
        customer_snapshot = inv.customer_snapshot,
        updated_at = inv.updated_at
    from (select coalesce(sum(net_amount), 0) as net, coalesce(sum(tax_amount), 0) as tax
          from public.invoice_items where invoice_id = inv.id) t
    where i.id = inv.id;
  end loop;

  update public.invoices i
  set subtotal = t.net, tax_total = t.tax, total = t.net + t.tax
  from (select it.invoice_id, sum(it.net_amount) as net, sum(it.tax_amount) as tax from public.invoice_items it group by 1) t
  where i.id = t.invoice_id and i.status = 'draft'
    and i.request_id in (select id from public.requests where is_demo);

  insert into public.messages
  select * from jsonb_populate_recordset(null::public.messages, payload -> 'messages');
  insert into private.demo_seed_records (table_name, record_id)
  select 'messages', x ->> 'id' from jsonb_array_elements(payload -> 'messages') x where x ->> 'request_id' is null;

  insert into public.invoice_reminders
  select * from jsonb_populate_recordset(null::public.invoice_reminders, coalesce(payload -> 'invoice_reminders', '[]'::jsonb));

  insert into public.automation_runs
  select * from jsonb_populate_recordset(null::public.automation_runs, payload -> 'automation_runs');

  insert into public.request_events (id, request_id, visit_id, actor_type, actor_id, event_type, visibility, from_value, to_value, note, data, occurred_at, created_at)
  select e.id, e.request_id, e.visit_id, e.actor_type, e.actor_id, e.event_type, e.visibility, e.from_value, e.to_value, e.note,
         coalesce(e.data, '{}'::jsonb), e.occurred_at, e.occurred_at
  from jsonb_populate_recordset(null::public.request_events, payload -> 'request_events') e
  order by e.occurred_at, e.id;

  -- Availability check postponed during the seed: every active visit must still fit the working hours
  perform set_config('rheinwerk.demo_seed_running', 'off', true);
  select c.* into broken from (select distinct v.technician_id from public.visits v
    where v.status in ('scheduled', 'in_progress') and v.scheduled_end > now()) t
  cross join lateral private.availability_conflict(t.technician_id) as c(id uuid, scheduled_start timestamptz, problem text)
  limit 1;
  if broken.id is not null then
    raise exception 'Demo-Daten kollidieren mit dem aktiven Einsatz am % (%).', broken.scheduled_start, broken.problem
      using errcode = 'RW422';
  end if;

  return jsonb_build_object(
    'purged', purged,
    'inserted', jsonb_build_object(
      'requests', jsonb_array_length(payload -> 'requests'),
      'visits', jsonb_array_length(payload -> 'visits'),
      'work_entries', jsonb_array_length(payload -> 'work_entries'),
      'invoices', jsonb_array_length(payload -> 'invoices'),
      'messages', jsonb_array_length(payload -> 'messages'),
      'invoice_reminders', jsonb_array_length(coalesce(payload -> 'invoice_reminders', '[]'::jsonb)),
      'automation_runs', jsonb_array_length(payload -> 'automation_runs'),
      'request_events', jsonb_array_length(payload -> 'request_events')));
end;
$function$;
