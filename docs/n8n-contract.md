# n8n-Vertrag (lokale Integration mit OpenAI)

> **Stand 12.10.2026: lokale Integration aktiviert und real geprüft.** Alle sechs Workflows sind veröffentlicht. Gmail `rheinwerk.industrieservice@gmail.com`, OpenAI `gpt-4.1-mini` (`OpenAI account 3`) und lokale Supabase funktionieren. Die lokale Website nutzt `N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/rheinwerk-service-request`; Blob-Token ist lokal konfiguriert. PDF/Foto wurden über API-Upload, privaten Blob, n8n-Dateikopie und echten OpenAI-Aufruf geprüft. Die öffentliche Website wurde nicht umgestellt, das externe Make-Konto nicht verändert.

Dieser Vertrag beschreibt, wie die lokale n8n-Integration mit der Datenbank zusammenarbeitet (Spezifikation Abschnitt 8). Er legt Ein- und Ausgaben, Idempotenz, Versionsprüfung, Warteschlange und Gmail-Zuordnung fest. Fachliche Zustände und Rechte prüft immer die Datenbank; n8n schreibt nie direkt in Tabellen, sondern nur über die unten genannten Funktionen.

## Grundsätze

| Thema | Festlegung |
| --- | --- |
| Zugang | n8n nutzt einen eigenen Server-Schlüssel (`service_role`) nur für die Integrationsfunktionen. Dashboard-Aktionen laufen weiter mit den Rechten des angemeldeten Nutzers |
| Schreibweg | ausschließlich RPC-Funktionen (`security definer`), die Zustand und Audit-Ereignis in **einer** Transaktion schreiben; Ereignisse der Integration mit `actor_type = automation` |
| Idempotenz | jede Operation hat einen stabilen Schlüssel: `source_event_key` (Einreichung), `automation_runs.operation_key` (Lauf), `(mailbox_key, gmail_message_id)` (eingehende Mail), `messages.id` (ausgehende Mail). Eine Wiederholung liefert das bestehende Ergebnis statt eines Duplikats |
| Versionsprüfung | Ergebnisse, die eine Anfrage ändern, tragen `expected_version` (= `requests.version` beim Lesen). Abweichung → `RW409`, das Ergebnis wird verworfen und nicht über eine menschliche Entscheidung geschrieben |
| Vertragsversion | jede Nutzlast trägt `contract_version` (aktuell `"1.0"`); unbekannte Versionen werden abgewiesen |
| Fehlercodes | `42501` keine Berechtigung, `RW409` Versionskonflikt, `RW410` Terminkonflikt, `RW422` Übergang nicht erlaubt oder Eingabe ungültig, `RW404` nicht gefunden, `23505` Duplikat |
| Zeit | Zeitstempel als ISO 8601 mit Offset; fachliche Tage in Europe/Berlin |
| Rekursion | Statusänderungen durch den Workflow lösen keinen weiteren Analyse-Lauf aus (siehe Auslöser) |

## Integrationsfunktionen

| Funktion | Stand | Zweck |
| --- | --- | --- |
| `confirm_message_sent(message_id, sent_at?, mailbox_key?, gmail_message_id?, gmail_thread_id?, mime_message_id?)` | **vorhanden**, nur `service_role` | bestätigter Versand: `queued` → `sent`, Provider-IDs, ggf. `first_substantive_response_at` und Rechnung `issued` → `sent`; Wiederholung liefert das bestehende Ergebnis; Demo-Anfragen werden abgewiesen |
| `link_message(message_id, request_id, expected_version)` | **vorhanden**, Dashboard (Inhaber des Posteingangs, Manager, Admin) | manuelle Zuordnung einer unzugeordneten eingehenden Mail |
| `queue_message(message_id, expected_version)` | **vorhanden**, Dashboard | Freigabe eines Entwurfs in die Warteschlange |
| `ingest_submission(payload)` | **vorhanden**, nur `service_role` | Einreichung speichern (Abschnitt 1) |
| `start_automation_run(operation_key, step, request_id?, message_id?, input_version?, workflow_execution_id?)` | **vorhanden**, nur `service_role` | Lauf idempotent anlegen bzw. bestehenden liefern |
| `finish_automation_run(run_id, status, decision?, confidence?, result?, error_code?, error_text?, workflow_execution_id?)` | **vorhanden**, nur `service_role` | Lauf beenden, Ergebnis speichern |
| `apply_analysis_result(run_id, request_id, expected_version, result)` | **vorhanden**, nur `service_role` | Analyseergebnis auf die Anfrage anwenden (Abschnitt 2) |
| `record_incoming_message(payload)` | **vorhanden**, nur `service_role` | eingehende Gmail-Nachricht speichern und zuordnen (Abschnitt 3) |
| `claim_queued_messages(batch_limit, lease_seconds)` | **vorhanden**, nur `service_role` | versandbereite Nachrichten mit Sperrfrist abholen (Abschnitt 4) |
| `mark_message_failed(message_id, error_text, permanent)` | **vorhanden**, nur `service_role` | endgültiger Fehler → `failed` mit `error_text`; vorübergehender Fehler lässt `queued` |

| `find_submission(submission_id)` | **vorhanden**, nur `service_role` | vor dem Dateikopieren auf Wiederholung prüfen |
| `get_analysis_context(request_id, message_id?)` | **vorhanden**, nur `service_role` | Anfrage, letzte 20 Nachrichten und private Anhänge lesen |
| `list_pending_analyses(batch_limit?)` | **vorhanden**, nur `service_role` | unbearbeitete Anfragen und vollständige Kundenantworten |
| `register_incoming_attachment(message_id, file_name, mime_type, size_bytes, storage_path)` | **vorhanden**, nur `service_role` | eingehenden Anhang idempotent registrieren |
| `complete_incoming_message(message_id, warnings?)` | **vorhanden**, nur `service_role` | Antwort erst nach allen Anhängen zur Analyse freigeben; Dateiprobleme menschlich prüfen |
| `list_incomplete_incoming(batch_limit?)` | **vorhanden**, nur `service_role` | abgebrochene Verarbeitung eingehender Anhänge erneut aufnehmen |
| `list_orphaned_integration_files()` | **vorhanden**, nur `service_role` | verwaiste Speicherobjekte nur auflisten; keine Löschung |
| `agent_create_request(call_id, fields)` | **vorhanden**, nur `service_role` | Telefonassistent: Anfrage aus dem Gespräch (Abschnitt 6) |
| `agent_find_request(call_id, nummer?, firma?, plz, strasse?)` | **vorhanden**, nur `service_role` | Telefonassistent: Anfrage und Lage für die Auskunft (Abschnitt 6) |
| `agent_check_area(call_id, plz)` | **vorhanden**, nur `service_role` | Telefonassistent: Einsatzgebiet (Abschnitt 6) |
| `agent_check_contract(contract_number, company_name?, postal_code?)` | **vorhanden**, nur `service_role` | Telefonassistent: Notfall-SLA prüfen, ohne Firmenauskunft (Abschnitt 6) |

Die vorhandenen Tabellen enthalten bereits alle Felder für diese Funktionen (`requests.source_event_key`, `automation_runs.operation_key`/`input_version`/`workflow_execution_id`, `messages.mailbox_key`/`gmail_message_id`/`gmail_thread_id`/`mime_message_id`/`in_reply_to`/`references_header`, `attachments.bucket`/`storage_path`).

## 1. Einreichung

**Auslöser:** Webhook des Website-Formulars (heute Make, künftig n8n). Nutzlast = bestehender Formularvertrag `ServiceRequestPayload` aus `lib/form-contract.ts` (`schema_version "1.0"`, `submission_id` als UUID, Kontakt, Standort und Anlage, Anliegen, Vertrag und bis zu drei Anhänge, `privacy_consent`). Die Website-Route prüft Pflichtfelder, Turnstile und Anhänge bereits vor der Weiterleitung.

**Ablauf:**

1. Nutzlast erneut validieren (`validatePayload`, Anhänge: PDF/JPEG/PNG, ≤ 5 MB, ≤ 3 Dateien, Pfad `service-requests/<submission_id>/`).
2. `source_event_key = "website_form:" + submission_id` bilden.
3. Nach `find_submission` die Anhänge in den privaten Bucket `dashboard` unter `requests/<submission_id>/<index>_<datei>` kopieren. Die UUID der Einreichung wird auch die `requests.id`; ein Verschieben ist nicht nötig. Speicher ist nicht Teil der Datenbanktransaktion. HTTPS-URLs müssen zu Vercel Blob gehören; Dateisignatur und 5-MB-Grenze werden geprüft.
4. `ingest_submission(payload)` in **einer** Transaktion: Anfrage mit `source = website_form`, `raw_payload`, gemappten Feldern; Anhänge als `attachments` (private Pfade unter `requests/<request_id>/…` registrieren); Ereignis `submission_received`. Die Anfragenummer `RIS-JJJJ-NNNNN` vergibt die Datenbank.
5. Erst nach erfolgreichem Speichern antwortet der Workflow der Website (`201` mit `request_number`, `human_review`). Eine neue gespeicherte Anfrage wird über `Analyse asynchron starten` an den Analyse-Workflow übergeben. Wiederholte Formulare geben dieselbe Anfrage zurück und starten keine neue direkte Analyse. Der veröffentlichte Worker prüft außerdem alle zwei Minuten offene Anfragen und vollständig registrierte Kundenantworten.

**Wiederholung:** derselbe `source_event_key` liefert die bestehende Anfrage (kein zweiter Datensatz, kein zweites Ereignis); die Website erhält dieselbe Antwort.

**Dateien:** Schlägt die Transaktion nach dem Kopieren fehl, bleiben unregistrierte Dateien zunächst privat gespeichert. `list_orphaned_integration_files` listet solche Objekte nach 24 Stunden nur auf. Die automatische Prüfung hat eine tägliche Löschung wegen möglichem Verlust benötigter Dateien abgewiesen; kein Löschworkflow wurde angelegt. Downloads registrierter Dateien laufen über die App mit Zugriffsprüfung.

**Feldzuordnung Formular → `requests`:**

| Formular | Datenbank |
| --- | --- |
| `contact.company_name`, `contact_name`, `business_email`, `phone`, `customer_number` | `company_name`, `contact_name`, `business_email`, `phone_number`, `customer_number` |
| `site_and_equipment.site_name`, `street_and_number`, `postal_code`, `city` | `site_label`, `street_house_number`, `postal_code`, `city` |
| `site_and_equipment.equipment_type` `pump`/`compressor`/`ventilation`/`other` | `equipment_kind` (gleiche Werte) |
| `request.service_type` `inspection`/`maintenance`/`repair` | `service_kind` `inspection`/`scheduled_maintenance`/`diagnosis_repair` |
| `request.urgency` `planned`/`time_sensitive`/`significant`/`production_stop` | `customer_urgency` `planbar`/`zeitnah`/`erheblich`/`production_stop` |
| `request.known_safety_hazard` `no`/`yes`/`unclear` | `safety_risk` `none_known`/`known`/`unclear` |
| `request.preferred_service_date` | `requested_visit_date` (Kundenwunsch, keine Frist) |
| `request.requires_human_review` bzw. Regel `requiresHumanReview` | `human_review_required` |
| `contract_and_attachments.customer_or_sla_contract_number`, `emergency_sla_24_7` | `sla_contract_number`, `emergency_sla_claimed` (`sla_verified` bleibt `false` bis zur menschlichen Prüfung) |
| ganze Nutzlast ohne `turnstile_token` | `raw_payload` (unveränderlich) |

## 2. Analyse

**Auslöser:** neue Anfrage (`submission_received`) oder eingehende Kundenantwort (Abschnitt 3).

1. `start_automation_run` mit `operation_key = "intake_analysis:<request_id>:v<version>"` bzw. `"reply_analysis:<message_id>"`, `input_version = requests.version`, `workflow_execution_id` von n8n. Ein vorhandener Lauf mit demselben Schlüssel wird zurückgegeben; ist er `succeeded`, endet der Workflow ohne neue Analyse.
2. Analyse (z. B. KI) erzeugt ein strukturiertes Ergebnis:

```json
{
  "contract_version": "1.0",
  "request_id": "…",
  "expected_version": 3,
  "decision": "ready_for_planning | ask_customer | human_review",
  "confidence": 0.86,
  "priority": "low | normal | high | critical",
  "service_kind": "inspection | scheduled_maintenance | diagnosis_repair",
  "summary": "Kurzfassung für Dispatcher",
  "missing_information": ["Hersteller", "Maschinennummer"],
  "clarification_draft": { "subject": "…", "body_text": "…" },
  "reasons": ["Produktionsstillstand gemeldet"]
}
```

3. `finish_automation_run` speichert Status, Entscheidung, Konfidenz und `result`. Technische Fehler → `status = failed` mit `error_code`; die Anfrage bleibt unverändert und erscheint weiter in der Analyse-Warteschlange.
4. `apply_analysis_result(run_id, request_id, expected_version, result)` prüft Version und Übergang und schreibt dann in einer Transaktion:
   - `ready_for_planning`: nur wenn `human_review_required = false` und keine Gefahr/kein Produktionsstillstand gemeldet ist → Erstbearbeitung abgeschlossen mit `intake_mode = automatic` und eingefrorenem Basiswert (wie `complete_intake`), Ereignisse `intake_status_changed`, `intake_completed`.
   - `ask_customer`: Rückfrage als Entwurf (`create_message_draft`-Logik, Art `clarification`), Status `awaiting_customer` erst nach bestätigtem Versand; ohne Freigabe-Pflicht nur, wenn die Konfiguration das erlaubt (Standard: Entwurf zur Freigabe durch den Dispatcher).
   - `human_review`: `needs_review`, Dispatcher-Warteschlange „Prüfung“.
   - Abgelehnt wird nie automatisch (Constraint `requests_rejection_not_automatic`).
5. **Veraltete Analyse:** Hat sich die Anfrage seit dem Lesen geändert (`RW409`) oder ist die Erstbearbeitung bereits durch einen Menschen abgeschlossen, wird das Ergebnis nur im Lauf gespeichert und nicht angewendet. Eine menschliche Entscheidung wird nie überschrieben.

Wiederholte Läufe, Rückfragen und Einsätze erhöhen nicht die Zahl der Erstbearbeitungen; Kennzahlen zählen je `request_id` (siehe [kpi-dictionary.md](kpi-dictionary.md)). Korrigiert ein Mensch später ein automatisches Ergebnis (`correct_analysis`), bleibt die Einstufung `automatic`, der Lauf erhält `corrected_at` und zählt nicht zur Zeitersparnis.

## 3. Eingehende Gmail-Nachrichten

**Auslöser:** neue Nachricht im überwachten Postfach (`mailbox_key`, z. B. `service@…`).

1. **Deduplizieren:** `(mailbox_key, gmail_message_id)` ist eindeutig. `record_incoming_message` liefert bei Wiederholung die bestehende Nachricht.
2. **Zuordnen** (Lauf `email_matching`, `operation_key = "email_matching:<mailbox_key>:<gmail_message_id>"`), in dieser Reihenfolge:
   1. `gmail_thread_id` einer bekannten Nachricht derselben Mailbox,
   2. `In-Reply-To`/`References` gegen `messages.mime_message_id`,
   3. Anfragenummer `RIS-JJJJ-NNNNN` im Betreff.
   Absenderadresse allein reicht nie für eine Zuordnung.
3. **Gefunden** (`decision = matched`): Nachricht mit `request_id`, `direction = incoming`, `kind = customer_reply`, Anhänge registriert; Ereignis `message_received`. Steht die Anfrage auf `awaiting_customer`, startet eine `reply_analysis` (Abschnitt 2).
4. **Nicht gefunden oder mehrdeutig** (`decision = unmatched`): Nachricht ohne `request_id` im Posteingang des am wenigsten ausgelasteten aktiven Dispatchers (`inbox_dispatcher_id`; Auslastung = offene Erstbearbeitungen + offene Posteingangs-E-Mails, bei Gleichstand die kleinere ID; seit task-11-7, vorher immer der erste aktive Dispatcher). Der Dispatcher sieht sie im Dashboard unter „Posteingang“ (task-10-5, Zähler in der Navigation) und ordnet sie mit `link_message` zu oder legt mit `create_request_from_message` eine neue Anfrage an (keine Eingangsbestätigung; die neue Anfrage geht mit Status `new` in die normale Analyse).
5. Nachrichten an Demo-Anfragen werden nicht verarbeitet.
6. **Unterhaltung im Posteingang** (task-12-3): ohne Anfrage, aber im Verlauf (`gmail_thread_id`) oder als Antwort (`In-Reply-To`/`References`) einer offenen, nicht archivierten Posteingangs-E-Mail → `inbox_root_id` dieser E-Mail, gleicher Dispatcher, `kind = customer_reply`; zählt nicht als neue Auslastung. Ist die Unterhaltung archiviert, beginnt eine neue.

## 4. Ausgehende Gmail-Nachrichten

**Nur** Nachrichten mit `direction = outgoing`, `status = queued`, an Live-Anfragen (`is_demo = false`) und mit Freigabe (`approved_by`, `approved_at`).

Ausnahme Eingangsbestätigung (task-10-6): `ingest_submission` legt für jede neue Live-Anfrage im selben Schritt genau eine `receipt`-Nachricht aus fester Vorlage an (`private.receipt_text`), Status `queued`, `approved_at` gesetzt, `approved_by` leer = Freigabe durch das System. `claim_queued_messages` liefert sie mit `approved_by = "system"` aus, damit der Versand-Workflow unverändert bleibt. Eindeutiger Index: höchstens eine Eingangsbestätigung je Anfrage. Alle anderen Arten brauchen weiterhin die Freigabe eines Mitarbeitenden. Die Bestätigung hat neben `body_text` einen HTML-Teil `messages.body_html` (Vorlage `emails/eingangsbestaetigung.html` aus Claude Design, Kundendaten HTML-maskiert, Migration über `emails/build_receipt_migration.py`). Zahlungserinnerungen (`payment_reminder`, task-10-2) werden ebenso vom System freigegeben und vom selben Workflow versendet; erstellt werden sie täglich per pg_cron in der Datenbank. Der Knoten „MIME mit stabiler Nachrichten-ID“ baut bei vorhandenem `body_html` eine `multipart/alternative`-Nachricht (Text + HTML), sonst wie bisher `text/plain`.

1. `claim_queued_messages(batch_limit, lease_seconds)` liefert versandbereite Nachrichten (seit task-12-3 auch Antworten aus dem Posteingang ohne `request_id`, nur wenn die Unterhaltung aus dem echten Postfach stammt; Verlauf und `In-Reply-To` stehen dann an der Nachricht selbst; `confirm_message_sent` und `mark_message_failed` schreiben für sie kein Anfrage-Ereignis) und legt je Nachricht einen Lauf `email_send` mit `operation_key = "email_send:<message_id>"` an. Der eindeutige Schlüssel verhindert, dass zwei Workflow-Ausführungen dieselbe Nachricht gleichzeitig senden; eine abgelaufene Sperrfrist erlaubt eine erneute Übernahme.
2. Versand über die Gmail-API mit `From` = Mailbox, eigenem Header `X-RheinWerk-Message-Id: <message_id>` und einer daraus abgeleiteten `Message-ID` (`<message_id>@rheinwerk-dashboard>`), bei Antworten mit `In-Reply-To`/`References` und `threadId`.
3. Erfolg: `confirm_message_sent(message_id, sent_at, mailbox_key, gmail_message_id, gmail_thread_id, mime_message_id)`. Erst dadurch werden `sent_at`, `first_substantive_response_at` (nur `clarification`/`other`) und der Rechnungsstatus `sent` gesetzt.
4. Endgültiger Fehler (z. B. ungültige Adresse): `mark_message_failed(…, permanent = true)` → `failed` mit `error_text`, sichtbar auf der Anfrageseite. Vorübergehender Fehler: Lauf `failed`, Nachricht bleibt `queued`, neuer Versuch mit Backoff.

**Unklarer Versandausgang** (Zeitüberschreitung, Abbruch nach dem API-Aufruf): Vor jedem erneuten Versuch sucht der Workflow im Ordner „Gesendet“ der Mailbox nach `rfc822msgid:<message_id>@rheinwerk-dashboard` bzw. dem Header `X-RheinWerk-Message-Id`. Gefunden → nur `confirm_message_sent` mit den gefundenen IDs, **kein** zweiter Versand. Nicht gefunden → erneuter Versand. Eine wiederholte Workflow-Ausführung ist nie eine Erlaubnis zum doppelten Versand; maßgeblich sind Nachrichten-ID und Provider-Nachweis.

## 5. Auslöser und Rekursion

| Auslöser | Startet |
| --- | --- |
| Webhook des Formulars | Einreichung, danach Analyse |
| neue Nachricht im Postfach | Zuordnung, ggf. `reply_analysis` |
| Zeitplan (z. B. jede Minute) | Versand der Warteschlange |
| Zeitplan (täglich) | Aufräumen von Staging-Dateien |

Statusänderungen durch den Workflow selbst (`apply_analysis_result`, `confirm_message_sent`) sind **keine** Auslöser. Datenbank-Trigger oder Webhooks auf `requests`/`request_events` werden nicht verwendet, damit eine Statusänderung keine erneute Analyse derselben Anfrage auslöst. Jeder Lauf ist über `operation_key` an genau eine Eingabeversion gebunden.

## 6. Telefonassistent (task-13-2)

Der Sprachagent „Mira“ (ElevenLabs) ruft n8n-Webhooks auf; n8n ruft diese Funktionen mit `service_role` auf. Jede trägt die Gesprächs-ID der Plattform als `call_id`: Der erste Aufruf legt die Zeile in `phone_calls` an, die Gesprächsauswertung (task-13-6) ergänzt sie. Regeln und Werkzeugverträge: `docs/telefonassistent/regeln.md`.

- `agent_create_request(call_id, fields)` – Felder wie bei der Telefonanfrage (`company_name`, `contact_name`, `business_email`, `phone_number`, `street_house_number`, `postal_code`, `city`, `equipment_kind`, `service_kind`, `customer_urgency`, `safety_risk`, `description` ≥ 10 Zeichen; optional `customer_number`, `site_label`, `manufacturer`, `model_type`, `requested_visit_date`, `sla_contract_number`). Fehlt etwas: `{ ok: false, fehler: "fehlende_felder", fehlende_felder: [...] }`, keine Ausnahme, damit der Agent nachfragt. Sonst Quelle `phone_agent`, Schlüssel `phone_agent:<call_id>` (Wiederholung liefert dieselbe Anfrage, `wiederholt: true`), Dispatcher nach Auslastung, ohne Wunschtermin heute + 7 Tage, Eingangsbestätigung in die Warteschlange, Ereignis `request_created_by_agent` (Automation), normale Analyse wie jede neue Anfrage. Antwort: `anfrage_id`, `anfrage_nummer`.
- `agent_find_request(call_id, nummer, firma, plz, strasse)` – PLZ des Standorts ist Pflicht; dazu Anfragenummer (gesprochene Schreibweisen wie „RIS 2026 123“ werden normalisiert) oder Firma (ohne Rechtsform, nur offene oder in den letzten 30 Tagen geänderte Anfragen), optional Straße. Nur bei genau einem Treffer: `anfrage_id`, `anfrage_nummer`, `standort` („Pumpe, Hafenstraße 12, Mannheim“), `lage` nach `regeln.md`, bei `geplant`/`ueberfaellig` zusätzlich `einsatz_id`, `termin_beginn`, `termin_ansage` („Mittwoch, der 21. Oktober, um 13 Uhr“). Sonst nur `treffer` (0 oder Anzahl). Keine Technikernamen, Notizen, Preise oder Kontaktdaten.
- `agent_check_area(call_id, plz)` – `in_gebiet` (mit `ort`), `nur_mit_vertrag`, `ungueltig`; Bereiche aus `docs/telefonassistent/einsatzgebiet.json` in `private.service_area`.
- `agent_check_contract(contract_number, company_name, postal_code)` – siehe Datenbank „SLA-Verträge“.
- Transkripte löscht `purge_call_transcripts()` täglich (pg_cron 02:30 UTC) nach 30 Tagen; Zusammenfassung und Kennzahlen bleiben.

## Modellabgleich und Anhänge

Quelle: `docs/equipment/RheinWerk_Anlagenkatalog_DE.md` (74 Serienzeilen). Der Modellabgleich ist deterministisch; Hersteller-Aliasse, Leerzeichen und die beschriebenen Zahlenschreibweisen werden normalisiert, Suffixe erhalten. Nur ein eindeutiges vollständig gelistetes Gerätemodell gilt als `listed_model`. Serienübereinstimmung, Komponenten, widersprüchliche oder unbekannte Modelle und fremde Anlagenarten gehen an einen Menschen. Es gibt keine automatische Ablehnung.

PDF und PNG/JPEG werden mit dem nativen OpenAI-Responses-Node ausgewertet (`gpt-4.1-mini`, striktes JSON-Schema, `store: false`). Die Projektentscheidung für OpenAI und die Verarbeitung technischer Texte, Korrespondenz und Dokumente wurden vom Nutzer am 12.10.2026 bestätigt. Supabase bleibt die einzige Projekt-Persistenz für die Gesprächshistorie; keine OpenAI-Konversation wird als Gedächtnis verwendet. Nur technische Formularfelder, relevante Nachrichtentexte und Dokumentinhalte gehen an das Modell; separate Kontakt- und Standortfelder sind nicht im KI-Eingang enthalten. Nachrichtentexte und Anhänge können dennoch personenbezogene Angaben enthalten. Bei Reparaturen genügt „kaputt“ oder „funktioniert nicht richtig“ nicht: mindestens ein konkretes beobachtbares Symptom oder ein Fehlercode ist nötig. Wartung und Inspektion benötigen keine Fehlerbeschreibung. Der private Gmail-Zwischenschritt verhindert die Antwortanalyse vor Abschluss der Anhänge. Unvollständige registrierte Gmail-Eingänge werden nach fünf Minuten erneut geladen. Zusätzlich werden alle 15 Minuten die neuesten bis zu 100 RIS-Antworten im Posteingang der letzten sieben Tage idempotent erneut eingelesen, auch wenn die erste RPC-Registrierung zuvor ausfiel; Dateiprobleme erfordern menschliche Prüfung.

## Sicherheit und Datenschutz

- Kein Gmail-Token, n8n-Schlüssel oder Secret in `settings` oder im Repository; Zugangsdaten nur in n8n-Credentials bzw. Server-Umgebungsvariablen.
- n8n erhält keine Nutzersitzungen und umgeht RLS nur über die oben genannten Funktionen.
- `raw_payload` und Nachrichtentexte bleiben in Supabase; die KI-Analyse erhält nur die für die Einstufung nötigen Felder.
- Gesäte Dashboard-Demo-Daten (`is_demo = true`) werden nie versendet und nie analysiert. Die ausdrücklich autorisierten Integrationstests verwenden fiktive Kontakt-/Anlagendaten über den normalen Formularpfad (`is_demo = false`); Testempfänger ist die eigene Adresse des Nutzers.

## Workflows und Prüfung

Alle Workflows liegen im lokalen n8n unter `http://localhost:5678`. Alle 99 Nodes haben deutsche Namen und bleiben auf Wunsch des Nutzers ohne visuelle Gruppen. 23 Bezeichnungen wurden am 12.10.2026 korrigiert; referenzierte Namen in Ausdrücken und den Generatoren sind synchron. Aktuelle importierbare Graphen liegen unter `n8n/workflows/*.workflow.json`, SDK-Quellen unter `*.n8n`; die Exporte enthalten den tatsächlichen Aktivierungsstand.

- Serviceanfragen: `lw1QxoJbeSU0H17E`, veröffentlicht, 23 Nodes.
- Anfrage analysieren: `wO3EgSMM8l1wRKsc`, veröffentlicht, 18 Nodes, OpenAI und Zwei-Minuten-Worker aktiv.
- Anhänge analysieren: `RE6MpFCDoYXgVyIm`, veröffentlicht, 7 Nodes, OpenAI für PDF/Foto.
- Formularanhang speichern: `Tr5Ird7F1iSTQe0o`, veröffentlicht, 5 Nodes.
- Gmail Eingang: `rGQGvOLDJUuHt4bO`, veröffentlicht, 27 Nodes, minütlicher Eingang, Wiederaufnahme nach fünf Minuten und RIS-Nachlesen alle 15 Minuten.
- Gmail Versand: `IlH4b7AKuSXyMiOd`, veröffentlicht, 19 Nodes; freigegebene Nachrichten jede Minute, Wiederaufnahme über interne Header-ID.

Historische Prüfung vom 08.10.2026: echte lokale Formularannahme per MCP (5653, `RIS-2026-00267`), Wiederholung ohne Duplikat (5657), Ablehnung fehlender Einwilligung (5658). Gmail-/Katalog-/Dateizweige wurden damals mit simulierten Providerantworten geprüft. Diese damaligen Tests waren kein echter Versand und kein Modellaufruf.

Echte Prüfung vom 12.10.2026:

- Gmail/Supabase-Diagnose 6762 bestätigte das richtige Postfach und die lokale Datenbank.
- OpenAI-Textanalyse 6768; JSON-Adapter 6769 mit der zuvor tatsächlich gelieferten Antwort geprüft. Der native Responses-Node liefert den JSON-Schema-Inhalt als Objekt, nicht immer als String.
- 6770 und 6771: echte OpenAI-Aufrufe mit synthetischem PDF und Typenschild-PNG erkannten KAESER SM 13, Seriennummer und E42. Die Prüfungen verwenden die Fixtures unter `n8n/tests/fixtures/`; die Formular-Dateikopie selbst ist noch nicht echt geprüft.
- 6774/6775: eine zu ungenaue Reparaturbeschreibung wurde zunächst fälschlich als vollständig angesehen (`RIS-2026-00354`). Danach wurde die Symptomregel im Prompt verschärft. 6772 und der neue echte Formularlauf 6777/6778 bestätigten eine konkrete Rückfrage für „kaputt“ (`RIS-2026-00355`). Die frühere Testzeile bleibt als Nachweis dieser Regression erhalten.
- Der Entwurf wurde über einen echten Dispatcher-Demo-Login und `queue_message` regulär freigegeben. 6779 hat genau das autorisierte Testmail an `fuzz.cube.studio@gmail.com` gesendet; Gmail-ID `1a12f64a6abf0475`, Status `sent`, Anfrage `awaiting_customer`. Der Nutzer bestätigte den Empfang.
- Gmail-Trigger 6782 empfing die echte Antwort `1a12f680da8197ad`. Dabei wurden ein fehlender `payload`-Wrapper beim RPC und eine falsche Workflow-ID-Darstellung im Analyse-Scheduler entdeckt und behoben. 6789 spielte die bereits empfangene Nachricht erneut ein; es war keine simulierte Kundenantwort. Sie wurde der bestehenden Anfrage über Thread-ID zugeordnet.
- 6790/6791 analysierten die echte Antwort samt Supabase-Historie mit OpenAI: Druck nur 5 statt 8 bar, Abschaltung nach zehn Minuten, Zischen; Katalog `listed_model`/`RW-002`, Entscheidung `ready_for_planning`. `RIS-2026-00355` ist `processed`, Version 6, eingehende Nachricht behandelt; kein zweiter Anfrage-Datensatz und kein neuer Rückfrage-Entwurf.
- 6797 wiederholte denselben realen Eingang ohne Duplikat. Produktions-Scheduler 6787, 6794 und 6795 liefen nach der Korrektur erfolgreich. 6796 prüfte OpenAI live mit synthetischem SM 999 und gepinnten Datenbankknoten: die deterministische Regel setzte `human_review`/`series_match`.
- SQL-Smoke-Test mit ROLLBACK, `test:db` 532/532, `test:unit` 58/58, lint, typecheck und build bestanden. SDK-Validierung: Analyse, Dokumentenanalyse und Gmail-Eingang gültig.

Gmail-Versand ist für die freigegebene Testnachricht **echt nachgewiesen**. Der Versandzeitplan ist veröffentlicht. Alle sechs Workflows sind veröffentlicht; die Exporte enthalten den tatsächlichen Aktivierungsstand. Die lokale Website nutzt den n8n-Webhooks, nicht den Make-Fallback.

Weitere echte Prüfung: privater PDF-/PNG-Upload mit dem unveränderten Client-SDK über `/api/upload` (HTTP 200), API-Formularübermittlung mit leeren Hersteller-/Modellfeldern (HTTP 201), Kopie beider Dateien (6813/6814), OpenAI-Dokumenten-/Anfrageanalyse 6815 und persistierte Modellfelder. RIS-2026-00356 ist processed; KAESER SM 13, Seriennummer DEMO-SM13-001, Katalog RW-002. Nach wiederholten Übermittlungen genau eine Anfrage, ein submission_received-Ereignis, ein Analyselauf und zwei Dateien/Anhänge. Ein Sandbox-Fehler bei `new URL` im Hauptworkflow wurde durch eine enge HTTPS-Private-Blob-Hostprüfung behoben; Weiterleitungen bleiben verboten. Eine neue Gate-Node verhindert direkte Neu-Analyse bei Formularduplikaten (6833/6834).

Gmail hat die originale MIME-Message-ID beim echten Versand ersetzt; `X-RheinWerk-Message-Id` blieb erhalten. Vor erneutem Senden werden bis zu 100 gesendete Nachrichten desselben Empfängers geladen und die exakte interne ID abgeglichen. Bei weiteren Seiten, mehrdeutigem Treffer oder Lesefehler wird nicht automatisch erneut gesendet. 6825 bestätigte dieses Verhalten gegen den echten Postausgang; Queue und DB-Bestätigung waren für den Replay gepinnt, der Send-Node wurde nicht erreicht. Nach Provider-Annahme wird die tatsächliche MIME-ID erneut gelesen und gespeichert. Dieser Zweig wurde mit gepinntem Send-Ergebnis und echtem Metadaten-Get in 6839 geprüft; keine zweite Test-E-Mail wurde versendet. Der veröffentlichte Versand-Scheduler 6837 lief erfolgreich, die genehmigte Warteschlange war leer.

Die neue 15-Minuten-RIS-Wiederaufnahme wurde in 6828 mit echten Gmail-Daten geprüft: die schon verarbeitete Antwort wurde korrekt als duplicate erkannt. Sie erfasst die letzten sieben Tage bis zu 100 Nachrichten; längere Ausfälle oder mehr Nachrichten benötigen eine gezielte Nachbearbeitung. Der eigentliche Erstversand ist real nachgewiesen; ein absichtlich herbeigeführter Bestätigungsverlust nach einem weiteren echten Versand wurde nicht getestet.

lint, build und typecheck bestanden. SQL-Smoke-Test mit ROLLBACK und test:db 532/532 wurden unmittelbar zuvor gegen dieselbe Datenbank geprüft; in diesem Schritt gab es keine SQL-Änderung. Unit-Checks nach Dokumentationsabgleich erneut 58/58 bestanden. DB-Reset und API/Auth/UI-Regression wurden in diesem Schritt nicht wiederholt; keine Browser-Sichtprüfung der Upload-Oberfläche. Die öffentliche Website wurde nicht umgestellt: produktiver Turnstile-Schlüssel und geschützter Maschinenzugriff über Cloudflare sind gesonderte Deployment-Konfiguration. Kein Make-Szenario im externen Konto deaktiviert, kein Push und kein Website-Deployment.
