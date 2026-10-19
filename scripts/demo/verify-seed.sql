-- Consistency checks of the demo seed. Every row must show "ok".
-- Run: docker exec -i supabase_db_A.Sadkovojs_Project psql -U postgres -qAt < scripts/demo/verify-seed.sql
with checks(name, failures) as (
  values
  ('Rund 600 Demo-Anfragen über 24 Monate',
    (select case when count(*) between 540 and 660 and count(distinct date_trunc('month', created_at at time zone 'Europe/Berlin')) = 24 then 0 else 1 end from public.requests where is_demo)),
  ('Keine zukünftigen Ist-Daten bei Anfragen',
    (select count(*) from public.requests where is_demo and greatest(created_at, intake_completed_at, completed_at, cancelled_at, first_substantive_response_at) > now())),
  ('Keine zukünftigen Ist-Daten bei Einsätzen, Rechnungen, Nachrichten, Ereignissen',
    (select (select count(*) from public.visits where greatest(actual_start, actual_end) > now())
          + (select count(*) from public.invoices where greatest(issued_at, sent_at, paid_at) > now())
          + (select count(*) from public.messages where greatest(sent_at, received_at) > now())
          + (select count(*) from public.request_events where occurred_at > now())
          + (select count(*) from public.work_entries where greatest(performed_at, ordered_at) > now()))),
  ('Chronologie Eingang <= Erstbearbeitung <= Abschluss <= Rechnung <= Versand <= Zahlung',
    (select (select count(*) from public.requests where is_demo and (intake_completed_at < created_at or completed_at < intake_completed_at))
          + (select count(*) from public.invoices i join public.requests r on r.id = i.request_id
             where i.issued_at < r.completed_at or i.sent_at < i.issued_at or i.paid_at < coalesce(i.sent_at, i.issued_at))
          + (select count(*) from public.request_events e join public.requests r on r.id = e.request_id where e.occurred_at < r.created_at))),
  ('Keine Buchungskonflikte (alle nicht stornierten Einsätze)',
    (select count(*) from public.visits a join public.visits b on a.technician_id = b.technician_id and a.id < b.id
       and tstzrange(a.scheduled_start, a.scheduled_end) && tstzrange(b.scheduled_start, b.scheduled_end)
     where a.status <> 'cancelled' and b.status <> 'cancelled')),
  ('Einsätze in Arbeitszeit und ohne Abwesenheit',
    (select (select count(*) from public.visits v
             where extract(isodow from v.scheduled_start at time zone 'Europe/Berlin') > 5
                or (v.scheduled_start at time zone 'Europe/Berlin')::time < '07:00'
                or (v.scheduled_end at time zone 'Europe/Berlin')::time > '16:00')
          + (select count(*) from public.visits v join public.employee_availability a on a.employee_id = v.technician_id and a.kind = 'absence'
             and tstzrange(a.starts_at, a.ends_at) && tstzrange(v.scheduled_start, v.scheduled_end) where v.status <> 'cancelled'))),
  ('Alle Erstbearbeitungs- und Arbeitsstatus vorhanden',
    (select (7 - count(distinct intake_status)) + 0 from public.requests where is_demo)
     + (select 6 - count(distinct work_status) from public.requests where is_demo)),
  ('Alle Einsatz-, Rechnungs- und Nachrichtenstatus vorhanden',
    (select (5 - (select count(distinct status) from public.visits)) + (4 - (select count(distinct status) from public.invoices))
          + (5 - (select count(distinct status) from public.messages)))),
  ('Alle Fallbeispiele vorhanden',
    (select count(*) from unnest(array[
      'Sichere automatische Bearbeitung', 'Rückfrage und Kundenantwort', 'Geringe Konfidenz mit menschlicher Freigabe',
      'Korrigierter Modellfehler', 'Technischer Fehler der Analyse', 'Ablehnung', 'Stornierung nach Planung',
      'Versäumte vereinbarte Frist', 'Keine Fristzusage', 'Bestellte Teile und Folgeeinsatz',
      'Abgeschlossen mit offener Rechnung', 'Mehrere Läufe und Nachrichten, ein Abschluss']) c
     where not exists (select 1 from public.requests r where r.raw_payload ->> 'demo_case' = c))),
  ('Jeder Techniker hat Einsätze in dieser Woche',
    (select count(*) from public.profiles p join auth.users u on u.id = p.id
     where u.raw_app_meta_data ->> 'demo_seed' = 'rheinwerk-demo-v1' and p.role = 'technician' and p.is_active and not exists (
       select 1 from public.visits v where v.technician_id = p.id and v.status <> 'cancelled'
         and date_trunc('week', v.scheduled_start at time zone 'Europe/Berlin') = date_trunc('week', now() at time zone 'Europe/Berlin')))),
  ('Jeder Demo-Dispatcher hat Anfragen',
    (select count(*) from public.profiles p join auth.users u on u.id = p.id
     where u.raw_app_meta_data ->> 'demo_seed' = 'rheinwerk-demo-v1' and p.role = 'dispatcher' and not exists (
       select 1 from public.requests r where r.is_demo and r.dispatcher_id = p.id))),
  ('Abwesenheit in dieser Woche vorhanden',
    (select case when exists (select 1 from public.employee_availability where kind = 'absence'
       and date_trunc('week', starts_at at time zone 'Europe/Berlin') = date_trunc('week', now() at time zone 'Europe/Berlin')) then 0 else 1 end)),
  ('Tarifwechsel: ausgestellte Positionen behalten alte Preise',
    (select case when exists (select 1 from public.invoice_items it join public.work_entries w on w.id = it.work_entry_id
       join public.service_rates s on s.id = w.service_rate_id where not s.is_active and it.unit_price <> (select unit_price from public.service_rates n where n.service_kind = s.service_kind and n.is_active and n.code like 'DEMO-%'))
       then 0 else 1 end)),
  ('Demo-Basiswert 15 Minuten in Einstellungen und Snapshots',
    (select (select count(*) from public.settings where manual_intake_minutes <> 15)
          + (select count(*) from public.requests where is_demo and manual_minutes_baseline is not null and manual_minutes_baseline <> 15))),
  ('Demo-Dateien im privaten Bucket mit Metadaten',
    (select case when (select public from storage.buckets where id = 'dashboard') = false
       and (select count(*) from public.attachments a join storage.objects o on o.bucket_id = a.bucket and o.name = a.storage_path
            where a.storage_path like 'demo/%') >= 6
       and (select count(distinct visibility) from public.attachments where storage_path like 'demo/%') = 3
       then 0 else 1 end)),
  ('Genau ein Abschluss der Erstbearbeitung je Anfrage',
    (select count(*) from (select request_id from public.request_events where event_type = 'intake_completed' group by 1 having count(*) > 1) x)),
  ('Keine aktiven Testkonten automatischer Tests (api-/ui-/e2e-…@example.com)',
    (select count(*) from public.profiles p join auth.users u on u.id = p.id
      where p.is_active and u.email ~ '^(api|ui|e2e)-[a-z0-9-]+@example\.com$')),
  ('Aktives Demo-Personal: 1 Admin, 1 Manager, 3 Dispatcher, 3 Techniker',
    (select case when count(*) filter (where p.role = 'admin') = 1 and count(*) filter (where p.role = 'manager') = 1
       and count(*) filter (where p.role = 'dispatcher') = 3 and count(*) filter (where p.role = 'technician') = 3 then 0 else 1 end
     from public.profiles p join auth.users u on u.id = p.id
     where p.is_active and u.raw_app_meta_data ->> 'demo_seed' is not null)),
  ('Kundenstamm: jede Demo-Anfrage mit Kundennummer ist mit Kunde und Standort verknüpft',
    (select case when (select count(*) from public.customers where is_demo) >= 14 then 0 else 1 end
          + (select count(*) from public.requests r where r.is_demo and r.customer_number is not null
             and (r.customer_id is null or r.customer_site_id is null))))
)
select case when failures = 0 then 'ok  ' else 'FAIL' end || ' ' || name || case when failures = 0 then '' else ' (' || failures || ')' end
from checks;
