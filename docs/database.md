# Datenbank

Schema im lokalen Supabase-Stack, ausschließlich über Migrationen unter `supabase/migrations/`. Tests (pgTAP) unter `supabase/tests/database/`, Ausführung mit `supabase test db`.

## Konventionen

- UUID-Primärschlüssel (`gen_random_uuid()`), außer der Singleton-Schlüssel von `settings`.
- `timestamptz` für Ereignisse und Intervalle, `date` für Kalenderdaten.
- Geld `numeric(12,2)`, Menge `numeric(12,3)`, Steuersatz `numeric(5,2)` zwischen 0 und 100.
- `created_at` und `updated_at` sind `NOT NULL` mit Default `now()`; `updated_at` setzt der Trigger `public.set_updated_at()`.
- Fremdschlüssel auf Mitarbeitende zeigen auf `profiles` mit `ON DELETE RESTRICT`; keine kaskadierenden Löschungen von Geschäftsdaten.
- Pflichttexte sind `NOT NULL` und dürfen nicht leer sein (`btrim(...) <> ''`).
- RLS ist auf jeder Tabelle aktiviert. Ohne Richtlinien ist jeder Zugriff über die Data API gesperrt; Richtlinien folgen in task-1-5.

## Enums

Alle Enums der Spezifikation liegen in `20261007093447_enums.sql`:

| Enum | Werte |
| --- | --- |
| `employee_role` | admin, manager, dispatcher, technician |
| `service_kind` | inspection, scheduled_maintenance, diagnosis_repair |
| `billing_model` | fixed, hourly |
| `availability_kind` | working_hours, absence |
| `equipment_kind` | pump, compressor, ventilation, other |
| `customer_urgency` | planbar, zeitnah, erheblich, production_stop |
| `request_priority` | low, normal, high, critical |
| `safety_risk` | none_known, known, unclear |
| `intake_status` | new, analyzing, needs_review, awaiting_customer, processed, rejected, cancelled |
| `work_status` | not_planned, scheduled, in_progress, waiting_parts, completed, cancelled |
| `intake_mode` | automatic, manual, human_review |
| `message_direction` | incoming, outgoing |
| `message_kind` | receipt, clarification, customer_reply, invoice, other |
| `message_status` | draft, queued, sent, received, failed |
| `visit_status` | scheduled, in_progress, waiting_parts, completed, cancelled |
| `work_entry_kind` | labor, part, fixed_service |
| `work_item_status` | planned, ordered, performed, used, cancelled |
| `work_unit` | hour, piece, service |
| `invoice_status` | draft, issued, sent, paid |
| `visibility_level` | operational, dispatch, management |
| `actor_type` | user, automation, system |
| `automation_step` | intake_analysis, reply_analysis, email_matching, email_send |
| `automation_status` | running, succeeded, failed |
| `automation_decision` | ready_for_planning, ask_customer, human_review, matched, unmatched, sent |

## Stammdaten (task-1-1)

### `profiles`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK, FK `auth.users.id`, `ON DELETE RESTRICT` |
| `display_name` | text | nein | nicht leer |
| `role` | employee_role | nein | |
| `is_active` | boolean | nein | Default `true`; deaktivieren statt löschen |
| `created_at`, `updated_at` | timestamptz | nein | |

Ein Auth-Nutzer mit Profil kann nicht gelöscht werden.

### `settings`

Genau eine Zeile (`id = 1`), wird von der Migration angelegt.

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | smallint | nein | PK, `CHECK (id = 1)` |
| `timezone` | text | nein | Default `Europe/Berlin` |
| `currency` | text | nein | Default `EUR`, drei Großbuchstaben |
| `manual_intake_minutes` | numeric(8,2) | nein | Default 15 (Demo-Basiswert, siehe decisions.md), > 0 |
| `default_tax_rate` | numeric(5,2) | nein | Default 19, 0 bis 100 |
| `payment_terms_days` | integer | nein | Default 14, >= 0 |
| `company_details` | jsonb | nein | Default `{}`, muss ein Objekt sein |
| `created_at`, `updated_at` | timestamptz | nein | |
| `updated_by` | uuid | ja | FK `profiles`; leer bis zur ersten Änderung durch einen Admin |

Die Spezifikation lässt die Nullability offen; alle Einstellungen sind `NOT NULL` mit Default, damit Berechnungen nie auf fehlende Werte treffen. Steuersatz 19 % und Zahlungsziel 14 Tage sind Demo-Annahmen.

### `service_rates`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `code` | text | nein | eindeutig, nicht leer |
| `service_kind` | service_kind | nein | |
| `display_name` | text | nein | nicht leer |
| `billing_model` | billing_model | nein | |
| `unit_price` | numeric(12,2) | nein | >= 0 |
| `tax_rate` | numeric(5,2) | nein | 0 bis 100 |
| `is_active` | boolean | nein | Default `true` |
| `created_at`, `updated_at` | timestamptz | nein | |

### `employee_availability`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `employee_id` | uuid | nein | FK `profiles`, `ON DELETE RESTRICT` |
| `kind` | availability_kind | nein | |
| `weekday` | smallint | je Art | 1 bis 7 (ISO, 1 = Montag) |
| `local_start`, `local_end` | time | je Art | Ortszeit gemäß `settings.timezone` |
| `valid_from`, `valid_to` | date | ja | optionaler Gültigkeitszeitraum der Arbeitszeit; `valid_to >= valid_from` |
| `starts_at`, `ends_at` | timestamptz | je Art | Abwesenheitsintervall |
| `label` | text | ja | Bezeichnung oder Abwesenheitsgrund |
| `created_at`, `updated_at` | timestamptz | nein | |

CHECK-Constraints je Art:

- `working_hours`: `weekday`, `local_start`, `local_end` gesetzt, `local_end > local_start`; `starts_at`, `ends_at` leer. Schichten über Mitternacht sind nicht vorgesehen.
- `absence`: `starts_at`, `ends_at` gesetzt, `ends_at > starts_at`; Wochentag, Uhrzeiten und Gültigkeitszeitraum leer.

Überschneidungsprüfung mit Einsätzen und Serialisierung je Techniker: siehe task-2-2.

## Anfragen und Audit-Ereignisse (task-1-2)

Migration `20261007100000_requests_and_events.sql`.

### `requests`

Alle Felder laut Spezifikation 5.2. Nullability:

| Pflicht (`NOT NULL`) | Optional (`NULL` erlaubt) |
| --- | --- |
| `id`, `request_number`, `source_event_key`, `source` (`website_form`/`demo_seed`), `is_demo` | `customer_number`, `site_label` |
| `company_name`, `contact_name`, `business_email`, `phone_number` | `manufacturer`, `model_type`, `machine_number` |
| `street_house_number`, `postal_code` (Text), `city` | `priority` (bis zur Bestimmung) |
| `equipment_kind`, `service_kind`, `requested_visit_date`, `description` | `sla_contract_number`, `emergency_sla_claimed` (NULL = keine Angabe) |
| `customer_urgency`, `safety_risk`, `sla_verified`, `raw_payload` | `dispatcher_id`, `technician_id` |
| `intake_status` (Default `new`), `work_status` (Default `not_planned`) | `intake_mode`, `manual_minutes_baseline`, `intake_completed_at` |
| `human_review_required`, `version` (Default 1) | `response_due_at`, `service_due_at`, `first_substantive_response_at` |
| `created_at`, `updated_at` | `completed_at`, `cancelled_at`, `rejection_reason`, `cancellation_reason`, `completion_summary` |

Regeln in der Datenbank:

- **Anfragenummer:** Der Trigger `assign_request_number` vergibt `RIS-JJJJ-NNNNN` bei jedem Insert und überschreibt Client-Werte. Das Jahr richtet sich nach `created_at` in `settings.timezone`, damit auch Seed-Daten mit historischem Datum korrekt nummeriert werden. Der Zähler je Jahr (`request_number_counters`) wird per `INSERT … ON CONFLICT DO UPDATE` erhöht; die Zeilensperre macht die Vergabe atomar (geprüft mit 40 parallelen Inserts: 40 eindeutige, lückenlose Nummern).
- **Idempotenz:** `source_event_key` ist `UNIQUE`; eine erneute Zustellung derselben Einreichung scheitert mit `23505`.
- **Unveränderlich:** `request_number`, `source_event_key`, `source`, `is_demo`, `raw_payload`, `created_at` (Trigger `guard_request_update`).
- **Version:** Jede Änderung erhöht `version` um 1 und setzt `updated_at`; kontrollierte Operationen prüfen die erwartete Version.
- **Statusabhängige Pflichtfelder:** `rejected` braucht `rejection_reason`; `cancelled` braucht `cancellation_reason` und `cancelled_at`; `work_status = completed` braucht `completion_summary` und `completed_at`; `intake_completed_at`, `intake_mode` und `manual_minutes_baseline` werden nur gemeinsam gesetzt; eine Ablehnung kann nie den Modus `automatic` haben.
- Rollen- und Aktivitätsprüfung der Zuweisungen sowie erlaubte Statusübergänge folgen in den kontrollierten Operationen (Phase 2).

Indizes: `dispatcher_id`, `technician_id`, `intake_status`, `work_status`, `created_at`, `intake_completed_at`, `completed_at`.

### `request_events`

| Spalte | Typ | Null | Regel |
| --- | --- | --- | --- |
| `id` | uuid | nein | PK |
| `request_id` | uuid | nein | FK `requests`, `ON DELETE RESTRICT` |
| `visit_id` | uuid | ja | FK auf `visits` folgt in task-1-4 |
| `actor_type` | actor_type | nein | |
| `actor_id` | uuid | ja | FK `profiles`; Pflicht bei `actor_type = user` |
| `event_type` | text | nein | snake_case-Code |
| `visibility` | visibility_level | nein | Default `operational` |
| `from_value`, `to_value`, `note` | text | ja | |
| `data` | jsonb | nein | Default `{}`, Objekt |
| `occurred_at`, `created_at` | timestamptz | nein | Default `now()` |

Append-only: Trigger blockieren `UPDATE`, `DELETE` und `TRUNCATE` für alle Rollen; zusätzlich sind diese Rechte für `anon` und `authenticated` entzogen. Normale Clients schreiben Ereignisse nur über kontrollierte Operationen (Phase 2), die `actor_id` und `occurred_at` selbst setzen.

Ereigniscodes: `submission_received`, `intake_status_changed`, `intake_completed`, `dispatcher_assigned`, `technician_assigned`, `visit_scheduled`, `visit_status_changed`, `work_status_changed`, `work_completed`, `message_received`, `message_linked`, `message_queued`, `message_sent`, `invoice_issued`, `invoice_sent`, `invoice_paid`, `automatic_result_corrected`, `note_added`, `deadline_changed`, `analysis_corrected` (task-2-1), `visit_rescheduled` (task-2-2), `work_entry_added`, `work_entry_changed` (task-2-3), `invoice_created`, `message_drafted` (task-2-4). Neue Codes werden hier ergänzt.

## Nachrichten, Automatisierungsläufe, Anhänge (task-1-3)

Migration `20261007110000_messages_automation_attachments.sql`. Die Spalten `messages.invoice_id`, `attachments.visit_id` und `attachments.invoice_id` erhalten ihre Fremdschlüssel in task-1-4 zusammen mit `visits` und `invoices`.

### `messages`

Pflicht: `id`, `direction`, `kind`, `status`, `subject`, `body_text`, `created_at`, `updated_at`. Alle übrigen Felder sind nullable, unterliegen aber diesen Regeln:

- `request_id` oder `inbox_dispatcher_id` ist gesetzt; ausgehende Nachrichten haben immer `request_id`.
- **Eingehend:** Status `received`, `received_at` und `from_address` gesetzt, Art `customer_reply` oder `other`.
- **Ausgehend:** Status `draft`, `queued`, `sent` oder `failed`, `to_address` gesetzt, kein `received_at`, Art `receipt`, `clarification`, `invoice` oder `other`.
- `sent_at` ist genau bei Status `sent` gesetzt; `failed` braucht `error_text`; `queued` ist kein bestätigter Versand.
- `approved_by` und `approved_at` nur gemeinsam; Art `invoice` braucht `invoice_id`.
- `gmail_message_id` verlangt `mailbox_key`; `UNIQUE (mailbox_key, gmail_message_id)`. Dieselbe Gmail-ID in einem anderen Postfach ist erlaubt.

Indizes: `request_id`, `inbox_dispatcher_id` (nur unzugeordnete), `(mailbox_key, gmail_thread_id)`, `mime_message_id`, `invoice_id`.

### `automation_runs`

Pflicht: `id`, `operation_key` (UNIQUE), `step`, `status` (Default `running`), `started_at`, `created_at`, `updated_at`.

- `finished_at` ist genau bei den Endzuständen `succeeded` und `failed` gesetzt und liegt nicht vor `started_at`; `failed` braucht `error_code`.
- `decision` nur bei `succeeded` und passend zum Schritt: Analyse → `ready_for_planning`/`ask_customer`/`human_review`, Zuordnung → `matched`/`unmatched`, Versand → `sent`.
- `confidence` zwischen 0 und 1; ist nur Prüfinformation, kein alleiniges Entscheidungskriterium.
- Korrektur (`corrected_by`, `corrected_at`, `correction_reason`) nur vollständig.
- Ohne `request_id` ist nur `email_matching` erlaubt.

Wiederholungsstrategie: Eine erneute Zustellung derselben Operation verwendet denselben `operation_key` und damit denselben Datensatz; eine neue, eigenständige Analyse erhält einen neuen Schlüssel.

### `attachments`

Pflicht: `id`, `bucket`, `storage_path` (`UNIQUE (bucket, storage_path)`), `file_name`, `mime_type`, `size_bytes` (> 0), `visibility` (Default `operational`), `created_at`. Nullable: `request_id`, `message_id`, `visit_id`, `invoice_id`, `uploaded_by`.

Elternprüfung (Trigger `check_attachment_parents`):

- Mindestens eine Elternreferenz.
- Anhänge einer **zugeordneten** Nachricht tragen dieselbe `request_id` wie die Nachricht.
- Anhänge einer **unzugeordneten** eingehenden Nachricht tragen nur `message_id` und erben deren Zugriffsregeln. Beim späteren Verknüpfen der Nachricht setzt die kontrollierte Operation (Phase 2) auch `request_id` der Anhänge.
- Ohne Nachricht ist `request_id` Pflicht; `visit_id` und `invoice_id` sind über zusammengesetzte Fremdschlüssel an dieselbe Anfrage gebunden (task-1-4).

## Einsätze, Arbeitspositionen und Rechnungen (task-1-4)

Migration `20261007120000_visits_work_invoices.sql`. Erweiterung `btree_gist` (Schema `extensions`).

**Gleiche Anfrage als Datenbankgarantie:** `visits`, `work_entries` und `invoices` haben `UNIQUE (id, request_id)`. Kindzeilen verweisen auf dieses Paar, sodass ein Einsatz oder eine Rechnung einer anderen Anfrage nicht referenziert werden kann:

| Kind | Fremdschlüssel |
| --- | --- |
| `request_events` | `(visit_id, request_id)` → `visits` |
| `work_entries` | `(visit_id, request_id)` → `visits` |
| `messages` | `(invoice_id, request_id)` → `invoices`; `invoice_id` verlangt `request_id` |
| `attachments` | `(visit_id, request_id)` → `visits`, `(invoice_id, request_id)` → `invoices`; beide verlangen `request_id` |
| `invoice_items` | Trigger `check_invoice_item_request`: Arbeitsposition gehört zur Anfrage der Rechnung |

### `visits`

Pflicht: `id`, `request_id`, `technician_id`, `status` (Default `scheduled`), `scheduled_start`, `scheduled_end`, `created_by`, `created_at`, `updated_at`. Nullable: `actual_start`, `actual_end`, `actual_work_minutes` (>= 0), `summary`, `waiting_reason`, `cancellation_reason`.

- `scheduled_end > scheduled_start`; `actual_end >= actual_start`.
- `in_progress`, `waiting_parts`, `completed` verlangen `actual_start`; `completed` verlangt `actual_end`.
- `waiting_parts` verlangt `waiting_reason`, `cancelled` verlangt `cancellation_reason`.

**Reservierende Einsatzstatus:** `scheduled` und `in_progress`. Nur diese blockieren das Zeitfenster eines Technikers. `waiting_parts`, `completed` und `cancelled` reservieren nicht, damit Warten auf Teile keine unbegrenzte Kalenderblockade erzeugt; der Kalender verwendet dieselbe Definition.

**Überschneidungsschutz:** Exclusion Constraint `visits_no_overlap` auf `(technician_id, tstzrange(scheduled_start, scheduled_end, '[)'))` für reservierende Status. Halboffene Intervalle: ein Einsatz bis 10:00 und einer ab 10:00 überschneiden sich nicht. Der Constraint gilt auch bei gleichzeitigen Buchungen (geprüft: 10 parallele Buchungen desselben Zeitfensters, genau 1 erfolgreich). Prüfung gegen Arbeitszeiten und Abwesenheiten: siehe task-2-2.

### `work_entries`

Pflicht: alle Felder außer `visit_id`, `service_rate_id`, `ordered_at`, `performed_at`.

- Art und Einheit passen: `labor` → `hour`, `part` → `piece`, `fixed_service` → `service`.
- Art und Status passen: Teile `planned`/`ordered`/`used`/`cancelled`; Arbeit und Pauschalen `planned`/`performed`/`cancelled`.
- `ordered` verlangt `ordered_at`; `performed` und `used` verlangen `performed_at`.
- `quantity > 0`, `unit_price >= 0`, `tax_rate` 0 bis 100.
- Abrechenbar sind nur `billable` und `performed` beziehungsweise `used` (geprüft beim Erstellen der Rechnung, task-2-4). Die Sperre abgerechneter Positionen: siehe task-2-3.

### `invoices`

Pflicht: `id`, `request_id` (**UNIQUE**, eine Rechnung je Anfrage), `status` (Default `draft`), `created_by`, `subtotal`, `tax_total`, `total` (Default 0), `currency` (Default `EUR`), `seller_snapshot`, `customer_snapshot` (Default `{}`), `created_at`, `updated_at`.

- `draft`: keine Rechnungsnummer, keine Ausstellungs-, Versand- oder Zahlungsdaten.
- Ab `issued`: `invoice_number` (UNIQUE), `issued_by`, `issued_at`, `issue_date`, `payment_due_date` gesetzt; Fälligkeit nicht vor Ausstellung.
- `sent` verlangt `sent_at`; `paid` genau dann, wenn `paid_at` gesetzt ist. `sent_at` darf bei `paid` gesetzt sein (Versand nach Zahlung).
- `total = subtotal + tax_total`.
- Vergabe der Rechnungsnummer und Unveränderlichkeit nach Ausstellung: siehe task-2-4.

### `invoice_items`

Pflicht: alle Felder außer `work_entry_id` (**UNIQUE**, verhindert Doppelabrechnung). `UNIQUE (invoice_id, position)`, `position >= 1`, Art und Einheit wie bei `work_entries`.

**Rundungsregel** (CHECK `invoice_items_rounding`):

- `net_amount = round(quantity * unit_price, 2)`
- `tax_amount = round(net_amount * tax_rate / 100, 2)`
- `gross_amount = net_amount + tax_amount`

PostgreSQL rundet `numeric` kaufmännisch (0,5 von null weg).

## Row Level Security und Storage (task-1-5)

Migration `20261007130000_rls_and_storage.sql`. Tests: `supabase/tests/database/rls.test.sql` (pgTAP mit simulierten JWT-Claims je Rolle).

### Grundsätze

- RLS ist auf allen 13 Kerntabellen und auf `request_number_counters` aktiv.
- **Nur Lesen über RLS.** `anon` hat keinerlei Tabellenrechte; `authenticated` hat ausschließlich `SELECT`. Alle Schreibvorgänge normaler Nutzer laufen über kontrollierte Operationen (`security definer`-Funktionen, Phase 2), die Rolle, Aktivstatus, Elternzugehörigkeit und Statusübergänge prüfen.
- `role` und `is_active` in `profiles` sind für Nutzer nicht änderbar: kein Schreibrecht, keine Update-Richtlinie und zusätzlich der Trigger `guard_profile_privileges`, der Änderungen durch Client-Rollen abweist.
- Jede Hilfsfunktion verlangt ein aktives Profil. Deaktivierte Mitarbeitende sehen nichts.
- Hilfsfunktionen liegen im Schema `private`, das nicht über die Data API erreichbar ist.
- **Neue Tabellen** in `public` erhalten von Supabase standardmäßig Rechte für `anon` und `authenticated`. Jede künftige Migration muss RLS aktivieren und diese Rechte wie hier entziehen.

### Hilfsfunktionen (`private`)

| Funktion | Bedeutung |
| --- | --- |
| `current_employee_role()` | Rolle des angemeldeten, aktiven Nutzers, sonst NULL |
| `is_active_employee()`, `is_manager_or_admin()` | Kurzformen |
| `visibility_allowed(level)` | `operational`: alle; `dispatch`: Dispatcher, Manager, Admin; `management`: Manager, Admin |
| `can_access_request(id)` | Manager/Admin alle; Dispatcher aktuell zugewiesene; Techniker aktuell zugewiesene oder mit eigenem Einsatz (Historie) |
| `is_current_technician(id)` | Aktuell zugewiesener Techniker (operative Kontrolle, nicht Historie) |
| `can_read_message(id)` | Manager/Admin; Dispatcher bei Zugriff auf die Anfrage oder eigener Posteingang; nie Techniker |
| `can_read_attachment(id)` | Elternzugriff, Sichtbarkeit; Nachrichtenanhänge folgen der Nachricht |
| `can_read_storage_object(bucket, name)` | Download nur mit Zugriff auf die zugehörige `attachments`-Zeile |

### Lesezugriff je Rolle

| Tabelle | Admin / Manager | Dispatcher | Techniker |
| --- | --- | --- | --- |
| `profiles`, `settings`, `service_rates` | alle | alle | alle |
| `employee_availability` | alle | Arbeitszeiten aller; keine Abwesenheitsdetails anderer | nur eigene |
| `requests` | alle | aktuell zugewiesene | aktuell zugewiesene und historische mit eigenem Einsatz |
| `request_events` | alle Stufen | `operational`, `dispatch` | `operational` |
| `messages` | alle | eigene Anfragen und eigener Posteingang | keine |
| `automation_runs` | alle | eigene Anfragen | keine |
| `visits` | alle | eigene Anfragen | eigene Einsätze; alle Einsätze der aktuellen Anfrage |
| `work_entries` | alle | eigene Anfragen | eigene, eigene Einsätze, aktuelle Anfrage |
| `invoices`, `invoice_items` | alle | eigene Anfragen | zugängliche Anfragen |
| `attachments`, Storage | nach Sichtbarkeit | nach Sichtbarkeit, eigene Anfragen | `operational`, ohne Nachrichtenanhänge; Einsatzanhänge nur eigener Einsätze oder der aktuellen Anfrage |

Eine Neuzuweisung entzieht dem bisherigen Dispatcher sofort den Zugriff, da `can_access_request` die aktuelle Zuweisung liest.

### Belegte Intervalle für die Einsatzplanung

`public.technician_busy_intervals(range_start, range_end)` (RPC, `security definer`) liefert für Dispatcher, Manager und Admins die belegten Intervalle aller aktiven Techniker: reservierende Einsätze (`scheduled`, `in_progress`) und Abwesenheiten. Rückgabe nur `technician_id`, `starts_at`, `ends_at`, `busy_kind` (`visit`/`absence`), ohne Anfrage, Kunde, Adresse oder Abwesenheitsgrund. Techniker erhalten keine Zeilen.

`public.technician_experience(request_id)` (RPC, `security definer`, task-10-3) liefert für Planende (Dispatcher der Anfrage, Manager, Admins) je aktivem Techniker nur Zähler abgeschlossener Einsätze auf anderen Anfragen: `customer_visits` (gleiche Kundennummer, ohne Kundennummer gleicher Firmenname, jeweils ohne Groß-/Leerzeichen), `manufacturer_visits` (gleicher Hersteller und Anlagentyp) und `equipment_visits` (gleicher Anlagentyp). Keine Anfrage-, Kunden- oder Einsatzdetails; fremde Dispatcher und Techniker erhalten keine Zeilen. Grundlage der Einsatzvorschläge (`lib/slot-suggestions.ts`): zuerst, wer die Firma kennt; bei Neukunden Erfahrung mit Hersteller, dann Anlagentyp, dann geringere Auslastung, dann frühestes Fenster.

### Storage

- Privater Bucket `dashboard` (10 MB je Datei, PDF/JPEG/PNG), angelegt per Migration.
- Download (`SELECT` auf `storage.objects`) nur, wenn eine `attachments`-Zeile mit gleichem Bucket und Pfad für den Nutzer lesbar ist.
- Uploads laufen über vertrauenswürdige Serveroperationen, die zuerst den Zugriff prüfen und dann Datei und Metadaten anlegen. Website-Formularanhänge bleiben in Vercel Blob.

### Geprüft

- pgTAP: 42 Tests mit sieben Rollen- und Statuskombinationen (anon, Admin, Manager, deaktivierter Manager, zwei Dispatcher, zwei Techniker).
- Direkt über die REST-API mit echtem Login: `anon` erhält `42501` auf `requests`; ein Techniker liest sein Profil, kann seine Rolle nicht ändern und keine Anfrage anlegen (`42501`) und erhält keine belegten Intervalle.

## Kontrollierte Operationen: Erstbearbeitung, Zuweisung, Fristen (task-2-1)

Migration `20261007140000_intake_operations.sql`. Tests: `supabase/tests/database/intake_operations.test.sql`.

Alle Operationen sind RPC-Funktionen (`supabase.rpc(...)`) mit `security definer`. Jede Operation prüft aktives Profil und Rolle, sperrt die Anfrage (`FOR UPDATE`), vergleicht `expected_version` mit `requests.version`, prüft den Statusübergang und schreibt Änderung und Audit-Ereignis in derselben Transaktion. Jede Änderung erhöht `version` (Trigger). Rückgabe ist die aktualisierte Anfrage.

### Fehlercodes

| SQLSTATE | Bedeutung | Verhalten in der Oberfläche |
| --- | --- | --- |
| `42501` | keine Berechtigung oder kein Zugriff auf die Anfrage | Hinweis, Aktion ausblenden |
| `RW409` | Versionskonflikt: Anfrage wurde zwischenzeitlich geändert | neu laden, Eingabe erhalten |
| `RW422` | Aktion im aktuellen Zustand nicht erlaubt oder Eingabe ungültig (z. B. fehlender Grund) | Meldung anzeigen |

### Operationen

| Funktion | Rollen | Übergang / Wirkung | Ereignisse |
| --- | --- | --- | --- |
| `assign_dispatcher(request_id, expected_version, dispatcher_id)` | Manager, Admin | nur aktive Dispatcher, nicht bei Endzuständen; bisheriger Dispatcher verliert sofort den Zugriff | `dispatcher_assigned` (dispatch) |
| `mark_needs_review(request_id, expected_version, note?)` | Dispatcher, Manager, Admin | `new`/`analyzing` → `needs_review`, setzt `human_review_required` | `intake_status_changed` |
| `mark_awaiting_customer(…, note?)` | dto. | `new`/`analyzing`/`needs_review` → `awaiting_customer` | `intake_status_changed` |
| `resume_analysis(…, note?)` | dto. | `awaiting_customer` → `analyzing` (Kundenantwort) | `intake_status_changed` |
| `correct_analysis(…, reason, service_kind?, priority?, automation_run_id?)` | dto. | korrigiert Leistungsart/Priorität; markiert den Automatisierungslauf als korrigiert | `automatic_result_corrected` bei automatischem Ergebnis, sonst `analysis_corrected` (dispatch) |
| `complete_intake(…, priority?, note?)` | dto. | `new`/`analyzing`/`needs_review` → `processed`; Priorität Pflicht; erneuter Aufruf liefert das bestehende Ergebnis | `intake_status_changed`, beim ersten Abschluss `intake_completed` |
| `reopen_intake(…, target_status, reason)` | dto. | `processed` → `analyzing`/`needs_review`/`awaiting_customer` vor technischem Abschluss; Buchungen bleiben bestehen | `intake_status_changed` mit `data.reopened` |
| `reject_request(…, reason)` | dto. | vor Arbeitsbeginn (`work_status` `not_planned`/`scheduled`) → `rejected`, `work_status` `cancelled`; offene Einsätze werden storniert | `intake_status_changed`, `work_status_changed`, `visit_status_changed`, ggf. `intake_completed` |
| `cancel_request(…, reason)` | dto. | vor Arbeitsabschluss → `cancelled`, `cancelled_at`; offene Einsätze werden storniert; kein Abschluss der Erstbearbeitung | `intake_status_changed`, `work_status_changed`, `visit_status_changed` |
| `change_deadline(…, deadline_kind, new_due_at, reason)` | dto. | `response` oder `service`; Grund Pflicht | `deadline_changed` mit alter/neuer Frist, Art, Grund, `breach_recorded` |

Dispatcher handeln nur bei aktuell zugewiesenen Anfragen (`can_access_request`). Techniker haben keine dieser Operationen.

### Erstabschluss (einmalig)

Beim ersten Ergebnis `processed` oder `rejected` werden `intake_completed_at`, `intake_mode` und `manual_minutes_baseline` (Snapshot aus `settings.manual_intake_minutes`) gesetzt. Modus durch Menschen: aus `new` = `manual`, aus `analyzing`/`needs_review` = `human_review`. Der Modus `automatic` wird nur durch die künftige Automatisierung (Integrationsoperation) gesetzt. Der Trigger `guard_request_update` verhindert jede spätere Änderung dieser drei Felder, auch für vertrauenswürdige Rollen. Wiedereröffnung und erneuter Abschluss erhalten den ursprünglichen Snapshot.

### Fristverstöße

Wird eine abgelaufene, nicht erfüllte Frist verschoben, hält das Ereignis `deadline_changed` dies in `data.breach_recorded = true` fest. Erfüllung: Antwortfrist durch `first_substantive_response_at`, Servicefrist durch `completed_at`. Damit löscht eine Verschiebung keinen bestehenden Verstoß.

Zusätzliche Ereigniscodes: `analysis_corrected` (menschliche Korrektur ohne automatisches Ergebnis).

## Kontrollierte Operationen: Einsatzplanung und Einsatzstatus (task-2-2)

Migration `20261007150000_visit_operations.sql`. Tests: `supabase/tests/database/visit_operations.test.sql`.

`expected_version` ist immer die Version der Anfrage, zu der der Einsatz gehört. Jede Operation erhöht sie.

Zusätzlicher Fehlercode: **`RW410` Terminkonflikt** – das Zeitfenster überschneidet sich mit einer aktiven Buchung des Technikers (Oberfläche: anderes Zeitfenster wählen).

### Operationen

| Funktion | Rollen | Übergang / Wirkung | Ereignisse |
| --- | --- | --- | --- |
| `schedule_visit(request_id, expected_version, technician_id, scheduled_start, scheduled_end)` | Dispatcher (eigene Anfragen), Manager, Admin | nur `processed` und nicht terminal; nicht in der Vergangenheit; aktiver Techniker; Arbeitszeit und Abwesenheit geprüft; setzt `requests.technician_id`; `not_planned`/`waiting_parts` → `scheduled` | `visit_scheduled`, ggf. `technician_assigned`, `work_status_changed` |
| `reschedule_visit(visit_id, expected_version, scheduled_start, scheduled_end, reason, technician_id?)` | dto. | nur `scheduled`; optional anderer Techniker | `visit_rescheduled` mit altem und neuem Intervall und Techniker, ggf. `technician_assigned` |
| `start_visit(visit_id, expected_version)` | eingeplanter Techniker, Manager, Admin | `scheduled` → `in_progress`, `actual_start`; Anfrage → `in_progress` | `visit_status_changed`, `work_status_changed` |
| `wait_for_parts(visit_id, expected_version, reason)` | dto. | `in_progress` → `waiting_parts`; Anfrage → `waiting_parts`; Einsatz reserviert nicht mehr | dto. |
| `resume_visit(visit_id, expected_version)` | dto. | `waiting_parts` → `in_progress` im ursprünglichen Zeitfenster; ist es inzwischen belegt: `RW410` (neuen Einsatz planen) | dto. |
| `complete_visit(visit_id, expected_version, actual_work_minutes, summary?)` | dto. | `in_progress`/`waiting_parts` → `completed`, `actual_end`; schließt nur den Einsatz, nicht die Anfrage | `visit_status_changed` mit Arbeitsminuten |
| `cancel_visit(visit_id, expected_version, reason)` | Dispatcher, Manager, Admin | `scheduled`/`waiting_parts` → `cancelled`; ohne weitere aktive Einsätze geht eine `scheduled`-Anfrage zurück auf `not_planned` | `visit_status_changed`, ggf. `work_status_changed` |

Techniker dürfen nur eigene Einsätze bearbeiten. Abgebrochene, abgeschlossene und umgeplante Einsätze bleiben samt Intervallen erhalten.

**Sicherheitsgefahr:** Eine Anfrage mit `safety_risk` `known` oder `unclear`, die automatisch bearbeitet wurde, kann erst nach einer menschlichen Aktion (Korrektur oder Statusänderung durch Personal) eingeplant werden.

### Verfügbarkeit

`private.availability_problem` prüft:

- Der Einsatz liegt an einem lokalen Kalendertag (`settings.timezone`); Ende um 24:00 ist zulässig.
- Eine `working_hours`-Zeile für den ISO-Wochentag mit gültigem Zeitraum umfasst Beginn und Ende vollständig. Ohne Arbeitszeiten ist kein Einsatz möglich.
- Keine Abwesenheit überschneidet sich mit dem Einsatz.

### Serialisierung pro Techniker

- Planungsoperationen nehmen eine Advisory-Transaktionssperre je Techniker (`private.lock_technician`), bei Umplanung auf einen anderen Techniker beide Sperren in fester Reihenfolge.
- Der Trigger `employee_availability_check_bookings` nimmt bei jeder Änderung von Arbeitszeiten oder Abwesenheiten dieselbe Sperre und weist Änderungen ab, die einen künftigen aktiven Einsatz ungültig machen würden (`RW422`). Der Einsatz muss zuerst umgeplant oder storniert werden.
- Zusätzlich garantiert der Exclusion Constraint `visits_no_overlap` überschneidungsfreie aktive Buchungen.
- Geprüft: 10 parallele `schedule_visit`-Aufrufe für dasselbe Zeitfenster, genau 1 erfolgreich, 9 mit Terminkonflikt.

Zusätzlicher Ereigniscode: `visit_rescheduled`.

## Kontrollierte Operationen: Arbeitspositionen und Abschluss (task-2-3)

Migration `20261007160000_work_operations.sql`. Tests: `supabase/tests/database/work_operations.test.sql`.

`expected_version` ist die Version der Anfrage; jede Operation erhöht sie.

### Wer darf erfassen?

- Aktuell zugewiesener Techniker der Anfrage, Manager und Admin.
- Ein früherer Techniker nur Positionen zu seinem **eigenen Einsatz** (Einsatzberechtigung), keine anfragebezogenen Positionen.
- Dispatcher erfassen keine Arbeitspositionen.
- Nicht bei abgelehnten oder stornierten Anfragen. Nach dem technischen Abschluss bleiben Korrekturen bis zur Abrechnung möglich.
- **Abrechnungssperre:** Sobald die Rechnung der Anfrage ausgestellt ist, können Positionen weder angelegt, geändert noch im Status bewegt werden (Entwürfe sperren nicht, siehe task-2-4).

### Operationen

| Funktion | Wirkung | Ereignis |
| --- | --- | --- |
| `add_work_entry(request_id, expected_version, kind, description, quantity, item_status?, unit_price?, tax_rate?, visit_id?, service_rate_id?, billable?)` | Einheit folgt aus der Art. Preis und Steuersatz aus dem Tarif, sonst Eingabe; Steuersatz zuletzt aus `settings.default_tax_rate`. Teile brauchen einen Preis. Tarif muss aktiv sein, zur Art passen (stündlich → `labor`, pauschal → `fixed_service`, nie `part`) und zur Leistungsart der Anfrage. Einsatz muss zur Anfrage gehören. | `work_entry_added` |
| `update_work_entry(work_entry_id, expected_version, description?, quantity?, unit_price?, billable?)` | Korrektur nicht stornierter, nicht abgerechneter Positionen; Art bleibt fest | `work_entry_changed` mit alten und neuen Werten |
| `set_work_entry_status(work_entry_id, expected_version, new_status)` | Übergang laut Tabelle; setzt `ordered_at` bzw. `performed_at` | `work_entry_changed` |
| `close_request(request_id, expected_version, completion_summary)` | Technischer Abschluss, siehe unten | `work_status_changed`, `work_completed` |

Erlaubte Statusübergänge:

| Art | Übergänge |
| --- | --- |
| `part` | `planned` → `ordered` / `used` / `cancelled`; `ordered` → `used` / `cancelled`; `used` → `cancelled` |
| `labor`, `fixed_service` | `planned` → `performed` / `cancelled`; `performed` → `cancelled` |

Neue Positionen können direkt im Zielstatus angelegt werden (z. B. Teil als `used`, Arbeit als `performed`). `cancelled` ist endgültig.

Wartung wird pauschal abgerechnet: Es werden keine Stundenpositionen automatisch ergänzt; die tatsächliche Arbeitszeit steht in `visits.actual_work_minutes`. Zusätzliche Arbeit wird als eigene Position erfasst.

### Abschluss der Anfrage

`close_request` setzt `work_status = completed`, `completed_at` und `completion_summary`:

- nur aktuell zugewiesener Techniker, Manager oder Admin,
- nur `intake_status = processed` und nicht terminal,
- Abschlussbericht ist Pflicht,
- keine Einsätze in `scheduled`, `in_progress` oder `waiting_parts`,
- mindestens ein abgeschlossener Einsatz,
- erneuter Aufruf liefert das bestehende Ergebnis.

Der Abschluss verändert keine Rechnung und markiert keine Zahlung; technischer Abschluss und Zahlung sind getrennt.

Zusätzliche Ereigniscodes: `work_entry_added`, `work_entry_changed`.

## Kontrollierte Operationen: Rechnungen, Zahlungen, E-Mail-Warteschlange (task-2-4)

Migration `20261007170000_invoice_message_operations.sql`. Tests: `supabase/tests/database/invoice_message_operations.test.sql`.

`expected_version` ist die Version der Anfrage; jede Operation erhöht sie.

### Rechnungen

| Funktion | Rollen | Wirkung | Ereignis |
| --- | --- | --- | --- |
| `create_invoice(request_id, expected_version)` | aktueller Techniker, Manager, Admin | nur technisch abgeschlossene, bearbeitete Anfragen; legt Entwurf mit Vorschau-Positionen an; gibt eine bestehende Rechnung zurück | `invoice_created` |
| `issue_invoice(invoice_id, expected_version)` | dto. | baut Positionen neu aus den Arbeitspositionen, vergibt `RE-JJJJ-NNNNN` atomar, setzt Ausstellungsdatum (Europe/Berlin), Fälligkeit (+ `payment_terms_days`), `issued_by`, Verkäufer- und Kunden-Snapshot; ohne abrechenbare Positionen `RW422`; erneuter Aufruf liefert die ausgestellte Rechnung | `invoice_issued` |
| `record_payment(invoice_id, expected_version, paid_at?)` | **nur Manager, Admin** | `issued`/`sent` → `paid`; Zahlungsdatum zwischen Ausstellung und jetzt; erneuter Aufruf liefert die bezahlte Rechnung | `invoice_paid` (management) |

**Abrechenbar** sind ausschließlich `billable`-Positionen mit `labor`/`fixed_service` im Status `performed` und `part` im Status `used`. Bestellte, geplante, stornierte und nicht abrechenbare Positionen erscheinen nicht. Es werden keine Positionen automatisch ergänzt; insbesondere entstehen bei Wartung keine Stundenaufschläge aus `visits.actual_work_minutes`.

**Entwurf als Vorschau:** Solange die Rechnung `draft` ist, bleiben Arbeitspositionen änderbar; die Ausstellung übernimmt den aktuellen Stand. Ab Ausstellung sind alle Arbeitspositionen der Anfrage gesperrt, auch neue.

**Unveränderlichkeit** (Trigger, gilt für jede Rolle):

- `guard_invoice_update`: Nach der Ausstellung ändern sich Beträge, Nummer, Daten, Snapshots und Notizen nicht mehr. Status nur `issued` → `sent`, `issued` → `paid`, `sent` → `paid`; kein Weg zurück zu `draft`.
- `guard_invoice_items`: Positionen ausgestellter Rechnungen können weder angelegt, geändert noch gelöscht werden.

**Doppelrechnung ausgeschlossen:** eine Rechnung je Anfrage (`UNIQUE`), Wiederholung liefert das bestehende Ergebnis, Versionsprüfung serialisiert. Geprüft: 10 parallele `issue_invoice`-Aufrufe ergeben genau eine Nummer; 9 Aufrufe erhalten `RW409`.

Der Status `sent` entsteht erst durch bestätigten E-Mail-Versand (künftige Integration). Demo-PDFs tragen die Kennzeichnung „Musterrechnung / Demodaten“.

### E-Mail-Warteschlange und Zuordnung

| Funktion | Rollen | Wirkung | Ereignis |
| --- | --- | --- | --- |
| `create_message_draft(request_id, expected_version, kind, to_address, subject, body_text, invoice_id?)` | Dispatcher der Anfrage, Manager, Admin | ausgehender Entwurf; Arten `receipt`, `clarification`, `invoice`, `other`; `invoice` nur mit ausgestellter Rechnung derselben Anfrage | `message_drafted` (dispatch) |
| `update_message_draft(message_id, expected_version, to_address?, subject?, body_text?)` | dto. | nur Entwürfe | – |
| `queue_message(message_id, expected_version)` | dto. | `draft` → `queued`, setzt `approved_by`/`approved_at` | `message_queued` (dispatch) |
| `link_message(message_id, request_id, expected_version)` | Inhaber des Posteingangs, Manager, Admin | verknüpft eine unzugeordnete eingehende Nachricht mit einer zugänglichen Anfrage; Anhänge erhalten dieselbe `request_id` | `message_linked` mit bisherigem Posteingang (dispatch) |

Die Warteschlange setzt **weder** `messages.sent_at` noch einen Rechnungsstatus `sent`/`paid` noch `requests.first_substantive_response_at`. Diese Werte setzt erst der bestätigte Versand durch die spätere n8n/Gmail-Integration. Techniker schreiben keine Kunden-E-Mails.

Zusätzliche Ereigniscodes: `invoice_created`, `message_drafted`.

## Integration und Ereignisreihenfolge (task-2-5)

Migrationen `20261007180000_confirm_message_sent.sql`, `20261007180100_request_event_sequence.sql`.

**`confirm_message_sent(message_id, sent_at?, mailbox_key?, gmail_message_id?, gmail_thread_id?, mime_message_id?)`** – nur `service_role` (künftige n8n-Integration), nicht für Dashboard-Nutzer:

- `queued` → `sent` mit Provider-IDs; erneute Bestätigung liefert das bestehende Ergebnis.
- `clarification` und `other` setzen einmalig `requests.first_substantive_response_at`; `receipt` und `invoice` nicht.
- Rechnungs-E-Mail: `issued` → `sent`; eine bereits bezahlte Rechnung bleibt `paid` und erhält nur `sent_at`.
- Demo-Anfragen (`is_demo`) werden nicht versendet.
- Ereignisse `message_sent` und ggf. `invoice_sent` mit `actor_type = automation`.

**`request_events.seq`** (Identity) ordnet Ereignisse mit gleichem `occurred_at` (gleiche Transaktion). Historie und Analytik sortieren nach `(occurred_at, seq)`.

Tests: siehe [testing.md](testing.md).

## Demo-Seed (task-3-2)

Migration `20261007190000_demo_seed.sql`: `public.demo_seed_apply(payload)` und `public.demo_seed_purge()` (nur `service_role`), Registry `private.demo_seed_records`, Bereinigungs-Flag `rheinwerk.demo_purge` (transaktionslokal) in den Triggern `prevent_request_event_change` und `guard_invoice_items`. Details: [demo-data.md](demo-data.md).

## Warteschlangen der Dispatcher (task-5-1)

Migration `20261007210000_dispatcher_queue.sql`. View `public.dispatcher_queue` mit `security_invoker = true`: sie läuft mit den Rechten des Aufrufers, RLS der Basistabellen gilt unverändert (Dispatcher sehen nur aktuell zugewiesene Anfragen). `anon` hat keinen Zugriff, `authenticated` nur `SELECT`.

| Spalte `queue` | Bedingung (offene Anfragen; abgelehnte, stornierte und abgeschlossene stehen in keiner Warteschlange) |
| --- | --- |
| `reply_received` – Kundenantwort erhalten | `intake_status` `needs_review` oder `analyzing` und eine eingehende Nachricht, die nach dem letzten Wechsel auf `awaiting_customer` empfangen wurde |
| `review` – Prüfung erforderlich | sonst `intake_status = needs_review` |
| `awaiting_customer` – Warten auf Kundenantwort | `intake_status = awaiting_customer` |
| `planning` – Einsatzplanung erforderlich | Erstbearbeitung `processed`, kein reservierender Einsatz (`scheduled`/`in_progress`) und `work_status` `not_planned` oder `waiting_parts` (Folgeeinsatz). Automatisch bearbeitete Anfragen bleiben hier, bis ein Einsatz geplant ist. |

Jede Anfrage steht in höchstens einer Warteschlange.

Sortierschlüssel (Reihenfolge der Anzeige):

1. `priority_rank`: Priorität (`critical` 1 … `low` 4); solange keine Priorität gesetzt ist, die Dringlichkeit des Kunden (`production_stop` 1, `erheblich` 2, `zeitnah` 3, `planbar` 4).
2. `due_at` aufsteigend, leere zuletzt: Antwortfrist, solange keine inhaltliche Antwort erfolgt ist (Prüfung, Kundenantwort, Warten); Servicefrist in der Planung.
3. `waiting_since` aufsteigend (am längsten wartend zuerst): Eingang der Kundenantwort; Wechsel in den aktuellen Status der Erstbearbeitung; in der Planung der spätere Zeitpunkt aus Abschluss der Erstbearbeitung und letztem Wechsel des Arbeitsstatus.

`safety_check_required` markiert automatisch bearbeitete Anfragen mit bekannter oder unklarer Sicherheitsgefahr; `schedule_visit` verlangt dafür zuerst eine menschliche Aktion (task-2-2).

Tests: `supabase/tests/database/dispatcher_queue.test.sql` (16 Tests: Zuordnung jeder Warteschlange, alte vs. neue Kundenantwort, Folgeeinsatz, Sortierung, Verlassen der Planung nach Einplanung, Stornierung, RLS je Dispatcher, kein Zugriff für `anon`).

## Folgeeinsatz und Einsatzfotos (task-6-2)

Migration `20261007220000_visit_follow_up_and_photos.sql`. Tests: `supabase/tests/database/visit_follow_up_photos.test.sql` (18 Tests).

| Funktion | Rollen | Wirkung | Ereignisse |
| --- | --- | --- | --- |
| `complete_visit(visit_id, expected_version, actual_work_minutes, summary?, follow_up_reason?)` | eingeplanter Techniker, Manager, Admin | wie bisher: beendet nur den Einsatz, **nie** die Anfrage. Mit `follow_up_reason` (nicht leer, sonst `RW422`): Anfrage `in_progress` ohne weiteren offenen Einsatz → `work_status = not_planned` und damit wieder in der Planungs-Warteschlange; eine auf Teile wartende Anfrage bleibt `waiting_parts` | `visit_status_changed` (`data.follow_up_required`), `follow_up_requested` mit Grund, ggf. `work_status_changed` |
| `add_visit_photo(visit_id, expected_version, storage_path, file_name, mime_type, size_bytes)` | dto. | registriert ein bereits hochgeladenes Foto: nur JPEG/PNG bis 10 MB, Pfad `visits/<request_id>/<visit_id>/…`, Objekt muss im privaten Bucket `dashboard` existieren; nicht bei stornierten Einsätzen oder Anfragen. Legt `attachments` (Sichtbarkeit `operational`, `uploaded_by`) an | `photo_added` |

Die bisherige Signatur von `complete_visit` (vier Parameter) wurde ersetzt; Aufrufe ohne Folgeeinsatz bleiben unverändert gültig.

Zusätzliche Ereigniscodes: `follow_up_requested`, `photo_added`.

## Analytik (task-7-1)

Migration `20261008090000_analytics.sql`. Tests: `supabase/tests/database/analytics.test.sql`.

Alle Funktionen sind `security invoker`: Es gilt RLS der Basistabellen. Datenfunktionen prüfen zusätzlich `private.analytics_require_access()` (nur aktive Manager und Admins, sonst `42501`). Zeiträume in `settings.timezone` (Europe/Berlin).

| Funktion | Ergebnis |
| --- | --- |
| `analytics_window(kind, anchor?, as_of?)` | Zeitraum `week`/`month`/`quarter`/`year` um `anchor` (Standard: heute) und Vergleichszeitraum; für alle angemeldeten Nutzer |
| `analytics_kpis(kind, anchor?, as_of?)` | 16 Kennzahlen mit `measure` (`event`/`snapshot`), `unit`, aktuellem und Vergleichswert, `difference`, `change_percent`, `detail` |
| `analytics_series(granularity, from_date, to_date)` | je Tag/Woche/Monat: Eingänge, Erstbearbeitung abgeschlossen (davon automatisch), abgeschlossen, ausgestellt brutto, Zahlungseingang; seit Migration `20261008110000_analytics_series_savings.sql` (task-7-3) zusätzlich `saved_requests`, `saved_minutes`, `baseline_minutes` der Zeitersparnis |
| `analytics_queue_history(from_date, to_date)` | je Tag und Warteschlange (`analysis`, `review`, `awaiting_customer`, `planning`) die Anzahl am Tagesende |
| `analytics_automation(kind, anchor?, as_of?)` | Automatisierungsläufe des Zeitraums je Schritt, Status, Entscheidung, davon korrigiert |
| `analytics_team(kind, anchor?, as_of?)` | je Dispatcher und Techniker: manuelle Erstbearbeitungen, beendete Einsätze, Arbeitsminuten, abgeschlossene Anfragen, offene zugewiesene Anfragen am Periodenende |

**Vergleichszeitraum:** aktueller Zeitraum `[Beginn, min(Ende, as_of))`. Laufender Zeitraum: Vergleich ab Beginn des vorherigen Zeitraums über dieselbe verstrichene Zeit, begrenzt auf dessen Ende (1.–8. Oktober 10:00 mit 1.–8. September 10:00; ein fast vollständiger März mit dem ganzen Februar). Abgeschlossener Zeitraum: Vergleich mit dem ganzen vorherigen Zeitraum (September mit allen 31 Tagen des August; Migration `20261008100000_analytics_complete_periods.sql`, task-7-2). Wochen beginnen montags.

**Ereignis-Kennzahlen** zählen jedes Ereignis nach seinem eigenen Zeitstempel: Eingang `created_at`, Erstbearbeitung `intake_completed_at`, Abschluss `completed_at`, Ausstellung `issued_at`, Zahlung `paid_at`, Läufe `started_at`.

| Schlüssel | Definition |
| --- | --- |
| `received`, `intake_completed`, `completed` | Anzahl nach dem jeweiligen Zeitstempel |
| `automatic_share` | automatische unter allen abgeschlossenen Erstbearbeitungen; korrigierte automatische Ergebnisse zählen als automatisch (erstes Ergebnis) |
| `lead_time_days` | Ø Tage von Eingang bis Abschluss der im Zeitraum abgeschlossenen Anfragen |
| `response_on_time` | Anfragen mit Antwortfrist im Zeitraum, bei denen erste inhaltliche Antwort oder Abschluss der Erstbearbeitung spätestens zur Frist lag |
| `service_on_time` | im Zeitraum abgeschlossene Anfragen mit Servicefrist, abgeschlossen spätestens zur Frist |
| `invoiced_gross`, `revenue_net` | ausgestellte Rechnungen brutto bzw. netto; ausgestellt ist nicht eingenommen |
| `payments_received` | bezahlte Rechnungsbeträge brutto nach `paid_at` |
| `time_saved_minutes` | Summe `manual_minutes_baseline` automatischer Erstabschlüsse ohne Korrektur (Ereignis `automatic_result_corrected` oder korrigierter Lauf); `detail`: Anzahl und Basiswert |

**Momentaufnahmen** gelten für den Zustand am Ende des Zeitraums (und des Vergleichszeitraums): `open_requests`, `review_queue`, `planning_queue` aus der Statushistorie, `open_receivables` (ausgestellt, zu diesem Zeitpunkt nicht bezahlt) und `overdue_receivables` (zusätzlich Fälligkeit vor dem lokalen Stichtag).

**Prozentwerte:** `change_percent` ist `null` bei Prozent-Kennzahlen (Änderung in Punkten über `difference`) und wenn der Vergleichswert `null` oder `0` ist; eine Null-Basis ergibt nie einen Prozentwert.

**Statushistorie:** `private.analytics_status_segments()` rekonstruiert je Anfrage Abschnitte `[valid_from, valid_to)` aus `intake_status_changed` und `work_status_changed`; Ausgangszustand ist der `from_value` des ersten Ereignisses, ohne Ereignisse der aktuelle Status. Die Warteschlangen der Historie entsprechen `dispatcher_queue` ohne die Verfeinerungen „Kundenantwort eingegangen“ (zählt als Prüfung) und reservierender Einsatz (`planning` = bearbeitet und Arbeitsstatus `not_planned`/`waiting_parts`), zusätzlich `analysis` für `new`/`analyzing`.

**RLS-Leistung:** Die Lese-Richtlinien von `requests`, `request_events`, `visits`, `invoices` und `automation_runs` prüfen zuerst einmal je Anweisung `(select private.is_manager_or_admin())`. Für Manager und Admins waren die zeilenweisen Prüfungen ohnehin immer wahr; die Bedeutung ändert sich nicht, Tabellenauswertungen werden aber um Größenordnungen schneller (Zählung aller Ereignisse 1,2 s → 2 ms).

## Verwaltung (task-8-1)

Migration `20261008120000_admin_operations.sql`. Tests: `supabase/tests/database/admin_operations.test.sql`. Alle Funktionen sind `security definer`, verlangen ein aktives Admin-Profil (`private.require_role('admin')`, sonst `42501`) und sind die einzigen Schreibwege für Profile, Tarife, Verfügbarkeiten und Einstellungen; die Tabellen bleiben für Client-Rollen nur lesbar.

| Funktion | Wirkung |
| --- | --- |
| `admin_employee_assignments(employee_id)` | aktive Zuweisungen: offene Anfragen als Dispatcher oder Techniker (nicht abgelehnt, storniert oder abgeschlossen) und Einsätze mit Status `scheduled`/`in_progress` |
| `admin_update_employee(employee_id, display_name, role)` | Name und Rolle; Rollenwechsel nur ohne aktive Zuweisungen, nie für das eigene Konto (es bleibt immer ein Admin) |
| `admin_deactivate_employee(employee_id, replacement_id?)` | setzt `is_active = false`, löscht nichts. Bei aktiven Zuweisungen ist eine aktive Vertretung derselben Rolle Pflicht; Anfragen (`dispatcher_id`/`technician_id`) und geplante Einsätze gehen in derselben Transaktion an sie. Einsätze müssen in Arbeitszeit und Abwesenheiten der Vertretung passen (`RW422`) und dürfen sich nicht überschneiden (`RW410`). Ein laufender Einsatz blockiert. Eigenes Konto nicht. Rückgabe `{reassigned_requests, reassigned_visits}`; Ereignisse `dispatcher_assigned`, `technician_assigned`, `visit_reassigned` mit Notiz „Neuzuweisung wegen Deaktivierung von …“ |
| `admin_reactivate_employee(employee_id)` | wieder aktiv; Zuweisungen werden nicht zurückübertragen |
| `admin_save_service_rate(rate_id?, code, service_kind, display_name, billing_model, unit_price, tax_rate, is_active)` | Tarif anlegen (`rate_id` leer) oder ändern; Kürzel eindeutig. Arbeitspositionen übernehmen Preis und Steuersatz beim Erfassen, ausgestellte Rechnungen ihre Positionen, daher wirken Änderungen nur auf spätere Positionen. Deaktivieren statt löschen |
| `admin_set_working_hours(employee_id, hours)` | ersetzt die Wochenarbeitszeit (`[{weekday, local_start, local_end}]`, je Wochentag ein Fenster). Neue Zeilen werden vor dem Löschen der alten eingefügt, damit der Trigger `employee_availability_check_bookings` den Endzustand prüft |
| `admin_add_absence(employee_id, starts_at, ends_at, label?)`, `admin_delete_absence(absence_id)` | Abwesenheit eintragen bzw. entfernen; Überschneidung mit einem geplanten Einsatz weist der Trigger ab |
| `admin_update_settings(manual_intake_minutes, default_tax_rate, payment_terms_days, company_details)` | Basiswert, Standard-Steuersatz, Zahlungsziel (0–365) und Firmenangaben; setzt `updated_by`. Zeitzone und Währung bleiben fest. Entfernt den Einstellungs-Eintrag aus `private.demo_seed_records`, damit `demo:seed` die Werte des Admins weder überschreibt noch beim Bereinigen zurücksetzt |

Fehlercode `RW404`: Mitarbeiter, Tarif oder Abwesenheit nicht gefunden.

**Einstellungen wirken nur auf spätere Vorgänge:** `complete_intake` und `reject_request` schreiben den Basiswert beim ersten Abschluss der Erstbearbeitung in `requests.manual_minutes_baseline` (danach unveränderlich), `issue_invoice` friert Firmenangaben und Zahlungsziel im Verkäufer-Snapshot ein. Getestet: eine abgeschlossene Anfrage behält 15 Minuten, eine danach abgeschlossene erhält den neuen Wert.

**Konten:** Anmeldedaten liegen nur in Supabase Auth; `profiles` hat keine Passwortspalte. Konten legt die Server-Aktion `createEmployee` mit dem Secret Key an (`auth.admin.createUser` mit bestätigter Adresse, danach Profil; schlägt das Profil fehl, wird das Konto wieder gelöscht). Öffentliche Registrierung ist abgeschaltet (`[auth] enable_signup = false` in `supabase/config.toml`; im Cloud-Projekt unter Authentication → Sign In / Providers „Allow new users to sign up“ ausschalten). Bei Deaktivierung sperrt die Aktion zusätzlich die Anmeldung (`ban_duration`), bei Reaktivierung wird sie freigegeben.

## Zahlungserinnerungen (task-10-2)

Gestufte Erinnerungen für überfällige Rechnungen. Migrationen `20261012140000_payment_reminder_kind.sql`, `20261012140100_payment_reminders.sql`, `20261012140200_payment_reminder_templates.sql` (aus `emails/zahlungserinnerung.*` mit `emails/build_reminder_migration.py`), `20261012140300_demo_seed_reminders.sql`.

| Stufe | Name | fällig |
|---|---|---|
| 1 | Zahlungserinnerung | `settings.reminder_stage1_days` (Standard 7) Tage nach `payment_due_date` |
| 2 | 1. Mahnung | `reminder_stage2_days` (14) Tage nach Stufe 1 |
| 3 | 2. Mahnung mit Hinweis auf Verzug | `reminder_stage3_days` (14) Tage nach Stufe 2 |

- Leeres Feld = Stufe aus; eine Stufe setzt die vorherige voraus. Änderungen gelten nur für noch nicht erstellte Erinnerungen.
- `invoice_reminders`: eine Zeile je Rechnung und Stufe (eindeutig), mit `message_id`, `trigger` (`automatic`/`manual`), `created_by`. Lesbar wie die Rechnung.
- `invoice_reminder_states` (View, `security_invoker`): letzte Stufe, `next_stage`, `next_due_on`, `paused` je ausgestellter Rechnung; gemeinsame Quelle für den täglichen Lauf und die Oberfläche.
- `invoices.reminders_paused_at/_by/_pause_reason`: Aussetzen je Rechnung (nicht Teil des eingefrorenen Rechnungsinhalts).
- Nachrichtenart `payment_reminder` mit Pflicht-`invoice_id`; wie die Eingangsbestätigung vom System freigegeben (`approved_at` gesetzt, `approved_by` leer), manuelle Erinnerungen von der auslösenden Person. `claim_queued_messages` liefert sie an den Gmail-Versand; Versand ändert den Rechnungsstatus nicht.
- Nie für bezahlte, ausgesetzte oder Demo-Rechnungen. Ereignisse `payment_reminder_queued`, `payment_reminders_paused`, `payment_reminders_resumed` (Sichtbarkeit `management`).

| Funktion | Wer | Wirkung |
|---|---|---|
| `run_payment_reminders()` | pg_cron `payment-reminders` täglich 06:00 UTC, `service_role` | erstellt je fälliger Rechnung höchstens eine Stufe; liefert die Anzahl |
| `send_payment_reminder(invoice_id, expected_version)` | Manager, Admin | nächste Stufe sofort; nur offen, überfällig, nicht ausgesetzt, keine Demo-Anfrage |
| `pause_payment_reminders(invoice_id, expected_version, reason)` / `resume_payment_reminders(invoice_id, expected_version)` | Manager, Admin | Aussetzen mit Pflichtgrund / Fortsetzen; fällige Stufen folgen beim nächsten Lauf |
| `admin_update_reminder_settings(stage1_days, stage2_days, stage3_days)` | Admin | Abstände 1–90 Tage oder `null` |

`demo_seed_apply` lädt eine passende Erinnerungshistorie für Demo-Rechnungen. Die Verfügbarkeitsprüfung (`private.check_availability_change`) wartet während des Seeds und prüft am Ende alle aktiven Einsätze, damit ein Neuaufbau mit echten Einsätzen im Kalender funktioniert.
