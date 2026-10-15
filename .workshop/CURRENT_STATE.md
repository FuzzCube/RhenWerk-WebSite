# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v10 mit 14 Phasen und 60 Tasks. Fortschritt 91,43 % (Gewicht 160 von 175, 54 von 60 Tasks).

## Aktive Phase

Phasen 0–12 abgeschlossen. Phase 13 „KI-Telefonassistent“ (Plan `docs/telefonassistent-plan.md`) ist angelegt: ElevenLabs-Agent „Mira“ (nur Deutsch), Werkzeuge über n8n hinter benanntem Cloudflare-Tunnel, Terminvormerkung mit Bestätigung durch den Dispatcher, Rückrufbitte an den Techniker bei Verspätung, Web-Widget statt Telefonnummer.

## Aktive Aufgabe

Keine in Arbeit. Bereit: `task-13-3` „Termine vormerken“ und `task-13-4` „Rückrufbitte an Techniker“.

Hinweis: Nach `npm run test:ui` meldet `demo:verify` Chronologie-Abweichungen der vom Test angelegten Demo-Anfragen (UI-Test …); `npm run demo:seed` räumt sie ab.

`task-10-4` ist lokal abgeschlossen: sechs veröffentlichte n8n-Workflows, lokaler Formularpfad zu n8n, echte Blob→Supabase→OpenAI-Dateiverarbeitung und Gmail-Antwortgedächtnis geprüft. Öffentliche Website nicht umgestellt.

## Zuletzt abgeschlossen

`task-13-2` (15.10.2026): Daten für den Telefonassistenten – `phone_calls`, Quelle `phone_agent`, `agent_create_request` (fehlende Felder als Liste, idempotent je Gespräch), `agent_find_request` (Lage nach Regeln, gesprochene Terminansage), `agent_check_area`, Transkripte nach 30 Tagen gelöscht. test:db 743, lint, typecheck, build.

`task-13-9` (15.10.2026): Demo-Daten in der Region um Mannheim (Rhein-Neckar) neu erzeugt; SLA-Verträge `service_contracts` mit 14 festen Demo-Verträgen, Prüfung `agent_check_contract` für den Agenten, „Vertragsbestand“ in der Anfrage, Testliste `docs/telefonassistent/testdaten.md`. demo:verify 18/18, test:db 705, test:ui, lint, typecheck, build.

`task-13-1` (15.10.2026): Konzept des Telefonassistenten unter `docs/telefonassistent/` – Gesprächsleitfaden, Systemprompt, Wissensbasis mit betreuten Anlagen (20 Hersteller, 74 Baureihen), Regeln und Werkzeugverträge (inkl. `anlage_pruefen`), PLZ-Liste, Datenschutzkonzept. SLA wird vom Menschen geprüft (keine SLA-Stammdaten).

`task-12-3` (15.10.2026): Posteingang „Antworten“ – Rückfrage an den Absender mit Vorlage, Versand nach Klick über n8n im selben Gmail-Verlauf; Unterhaltung (`inbox_root_id`) mit Kundenantworten beim selben Dispatcher, Stand in der Liste, Zuordnen/Anlegen/Archivieren für die ganze Unterhaltung. test:unit 83, test:db 689, n8n-Integration, test:ui, lint, typecheck, build.

`task-12-2` (15.10.2026): Posteingang „Einer Anfrage zuordnen“ mit leerem Eintrag „Anfrage wählen …“, Vorauswahl nur bei eindeutiger gleicher Absenderadresse, Domain-Treffer gekennzeichnet, Suche auch nach Ort, Hinweis bei fehlender Anfrage. test:ui, lint, typecheck, build.

`task-12-1` (15.10.2026): Plantafel zeigt neben jedem Techniker die Auslastung im Kalendermonat („Okt. · 14 % belegt“, Tooltip mit Stunden), Abwesenheit mindert die Arbeitszeit statt als belegt zu zählen. test:unit 80, test:db 659, test:ui 262, lint, typecheck, build.

`task-11-7` (15.10.2026): Posteingang nach Auslastung (offene Erstbearbeitungen + offene Posteingangs-E-Mails) statt immer an den ersten Dispatcher; bei Deaktivierung gehen offene E-Mails an die Vertretung. test:db 654, n8n-SQL-Test, demo:verify, test:ui 260, test:unit 75, lint, typecheck, build.

`task-11-6` (15.10.2026): Pause nach Fehlversuchen je Adresse (ab dem 5. Fehlversuch 30 s bis höchstens 15 min, keine harte Sperre, keine Kontoauskunft), Zurücksetzen bei Erfolg und neuem Passwort. test:db 644, test:auth 136, test:unit 75, test:ui 260, lint, typecheck, build. Details in `docs/architecture.md` und `docs/database.md`.

`task-11-5` (15.10.2026): Passwort vergessen per E-Mail-Link (`/auth/passwort-vergessen` → `/auth/bestaetigen` → `/auth/passwort-neu`), ändern unter `/dashboard/konto`, vorläufiges Passwort durch Admin. Mindestens 12 Zeichen. Lokal kommen die Mails in Mailpit an (54324); echte Zustellung braucht SMTP (`docs/setup.md`). test:ui 260, test:auth 130, test:unit 73, test:db 631, lint, typecheck, build.

`task-11-4` (15.10.2026): Telefonische Anfrage unter `/dashboard/anfragen/neu` (Dispatcher, Manager, Admin), `create_phone_request` mit Quelle `phone`, idempotent, Dispatcher-Zuweisung, optionale Eingangsbestätigung; Feldbaustein und -prüfung gemeinsam mit dem Posteingang. test:db phone_request 18/18, test:ui 243, test:unit 71, lint, typecheck, build. Details in `docs/architecture.md` und `docs/database.md`.

`task-11-3` (15.10.2026): „Route“ öffnet Google Maps mit Navigation zur Einsatzadresse (Universal-Link ohne API-Schlüssel, `lib/contact-links.ts`). test:unit 71, test:ui 238, lint, typecheck.

`task-11-2` (15.10.2026): Aktionsleiste der Einsatzseite („Auf Teile warten | Einsatz beenden“) sticky statt fixed, dieselben Kanten wie die Karten auf jeder Breite, Schaltflächen gleich hoch ohne Umbruch. test:ui 236, lint, typecheck. Details in `docs/architecture.md` (Einsatzaktionen).

`task-11-1` (15.10.2026): „Weitere Kennzahlen“ der Übersicht ausgerichtet – Werte und Chips je Zeile bündig (subgrid), „Vorperiode“ ohne hängenden Trennpunkt, 4 / 2 / 1 Spalten nach Breite. test:ui 233, lint, typecheck. Details in `docs/architecture.md` (Übersicht).

`task-10-10` (13.10.2026): Posteingang mit vorbelegter Suche (Absender, Vorschläge auch nach Firmendomain), regelbasierter Vorbelegung der neuen Anfrage aus der E-Mail (`lib/inbox-extract.ts`, ohne KI; erkannte Felder markiert) und Archiv für E-Mails ohne Auftragsbezug (`archive_message`/`restore_message`, Migration `20261013140000_inbox_archive.sql`, Ansicht Archiv, Rückgängig). KI-Vorbelegung über n8n als mögliche Ergänzung. test:ui 231, test:db 613, test:unit 68, test:auth 130. Details in `docs/architecture.md` (Posteingang).

`task-10-9` (13.10.2026): Sicherheitsupdates nach Dependabot – `next`/`eslint-config-next` 16.3.8, transitiv `sharp`, `undici`, `source-map-js`, `brace-expansion`. Offen nur `braces` (ohne Fix, nur Entwicklung; Begründung in `docs/setup.md`). Alle Testsuiten bestanden (test:ui 226, test:db 597, test:auth 130, demo:verify 18/18).

`task-10-8` (13.10.2026): Geplante Einsätze auf der Plantafel verschieben – Ziehen mit Maus, Finger oder Pfeiltasten auf andere Zeit, anderen Techniker oder Tag; Bestätigung „Bisher → Neu“ mit Grund (Standard „Verschoben auf der Plantafel“, änderbar) und Abbrechen; Speichern über `rescheduleVisit` → `reschedule_visit` mit Versionsprüfung, Verlaufseintrag `visit_rescheduled`. Keine Migration. test:ui 226, test:db 597, test:auth 130, lint, typecheck, build, demo:verify 18/18. Details in `docs/architecture.md` (Einsatzplanung).

`task-10-7` (13.10.2026): Auswahl auf der Plantafel ziehen – fließend mit Maus, Stift oder Finger, 15-Minuten-Raster, Wechsel von Techniker und Tag, Zeitanzeige mit Konfliktgrund am Zeiger, Ablegen ins Formular oder ins nächste freie Fenster, Tastatur ←/→/↑/↓. Bestehende Einsätze verschieben folgt in `task-10-8`. test:ui 219, lint, typecheck, build. Details in `docs/architecture.md` (Einsatzplanung).

`task-10-5` (13.10.2026): Posteingang für nicht zugeordnete E-Mails unter `/dashboard/posteingang` (Dispatcher eigener Posteingang, Manager/Admin alle, Zähler in der Navigation). Zuordnung per `link_message` (Vorschläge nach Absenderadresse, Suche), neue Anfrage aus E-Mail per `create_request_from_message` (Migration `20261013130000_inbox_create_request.sql`, Quelle `email`, idempotent über `email:<message_id>`, keine Eingangsbestätigung). Tests: `inbox.test.sql` (24), test:db 592, test:auth 130, test:ui 216, lint, typecheck, build. Details in `docs/architecture.md` (Posteingang) und `docs/database.md`.

`task-9-2` (13.10.2026): Gesamtprüfung und Responsive-Check. Alle Testsuiten bestanden (lint, typecheck, build, test:unit 61, test:db 568, test:api, test:auth 130 gegen `next start`, test:ui 199, demo:verify 18/18); Sichtprüfung je Rolle bei 390/768/1440 px ohne Befund. Behoben: mehrdeutige Spalte in `mark_message_failed` (Migration `20261013120000_fix_mark_message_failed.sql`, neuer pgTAP-Test). Ergebnisse, Szenarien 1–8 und nicht Geprüftes in `docs/testing.md` (Abschnitt Gesamtprüfung); Setup- und Startanleitung `docs/setup.md`.

`task-10-3` (13.10.2026): Überarbeitung des Dashboard-Designs, vom Nutzer abgenommen. RheinWerk-Design, nur hell. Listen- und Bereichsseiten (Anfragen, Erstbearbeitung, Auswertung, Rechnungen, Verwaltung) mit hellem Seitenmenü (`components/dashboard/ui/side-menu.tsx`, auf schmalen Breiten ein Umschaltknopf) und Kopf mit Ansicht, Anzahl und Beschreibung; Manager-Übersicht auf einem 4-Spalten-Raster; Einsatzplanung als Plantafel mit Warteschlange im Stil des Seitenmenüs; Anfrageseite mit aufklappbaren Nebenabschnitten; Technikerseiten mobil zuerst (Mein Tag und Einsatz einspaltig, höchstens 960 px; Kalender als Wochenagenda). Breite Seiten bis 1680 px mit bündigen Kopf-, Navigations- und Inhaltskanten. Geprüft: typecheck, lint, test:unit 61/61, build, test:auth (gegen `next start`; Prüfanker auf die neue Markup umgestellt) und test:ui 198; im Browser bei 390/768/1440 px kein horizontales Scrollen. Details in `docs/architecture.md` (Abschnitt Design-Überarbeitung).

`task-10-2` (12.10.2026): Zahlungserinnerungen. Stufen Zahlungserinnerung / 1. Mahnung / 2. Mahnung (7/14/14 Tage, Einstellungen → Zahlungserinnerungen), täglicher pg_cron-Job `payment-reminders` 06:00 UTC, Systemfreigabe, Aussetzen und Sofort-Auslösen auf der Anfrageseite (Manager/Admin), Spalte „Mahnstufe“ in der Rechnungsliste, E-Mail im Design der Eingangsbestätigung (`emails/zahlungserinnerung.*`). Demo-Seed lädt eine Erinnerungshistorie und scheitert nicht mehr an echten Einsätzen. test:db 566/566, test:unit 61/61, test:ui 198, lint, typecheck, build. Details in `docs/database.md`.

`task-10-6` (12.10.2026): Automatische Eingangsbestätigung per E-Mail ohne manuelle Freigabe (nur Art `receipt`, Systemfreigabe), HTML-Design aus Claude Design (`emails/`, `messages.body_html`, `multipart/alternative`), Subdomain-Adressen zugelassen. test:db 532/532, Integrationstest, lint, typecheck; echter Versand vom Nutzer bestätigt (RIS-2026-00360).

`task-10-4`: lokale n8n/OpenAI/Gmail-Integration. Vollständiger API-Formularpfad mit privatem PDF und PNG: RIS-2026-00356 processed, KAESER SM 13 aus Dokumenten, keine Duplikate. Versandwiederaufnahme und verpasste RIS-Eingänge geprüft. Kein Push/Website-Deployment.

`task-10-1`: Testkonten automatischer Tests (`api-`/`ui-`/`e2e-…@example.com`) löscht `demo:seed`; `test:api` und `test:ui` deaktivieren ihre Konten am Ende; `demo:verify` prüft aktives Personal (18 Prüfungen). Davor `task-9-1` (Kennzahlen-Wörterbuch, n8n-Vertrag).

## Bereite nächste Aufgaben

Keine. Offene Ideen nur nach Rücksprache als neue Tasks: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen, SMTP für echte Passwort-Mails, öffentliche Website auf n8n umstellen.

## Blockiert

Keine Blockierung. Lokale Integration task-10-4 nach den tatsächlich geprüften Definition-of-Done-Punkten abgeschlossen; die frühere Blockierung ist behoben. Dokumentierte Lifecycle-Korrektur blocked → completed für die bereits begonnene und ausdrücklich wiederaufgenommene Arbeit; keine zweite Aufgabe in_progress eingeführt.

12.10.2026: Alle sechs Workflows veröffentlicht, Nodes ohne Gruppen. Lokales N8N_WEBHOOK_URL gesetzt. Echte E-Mail-Rückfrage und Antwortgedächtnis RIS-2026-00355 geprüft. Private Uploads über tatsächlichen API-/Clientpfad und OpenAI-Dateiauswertung RIS-2026-00356 geprüft. Send-Recovery nutzt den von Gmail erhaltenen internen Header; faktische MIME-ID wird nachgelesen. Inbox-Nachlesen für RIS-Antworten letzte sieben Tage alle 15 Minuten; vollständige registrierte Eingänge zusätzlich alle fünf Minuten. Details und Grenzen in docs/n8n-contract.md.

## Wichtige Entscheidungen

- Design-Überarbeitung (Nutzerentscheidungen 08.10.2026 zu den offenen Punkten der Spezifikation): Kennzahl-Richtungen bleiben wie in `KPI_INFO` (Automatisierungsanteil und Zeitersparnis „besser“ bei Anstieg; Warteschlangen, offene und überfällige Forderungen: niedriger ist besser). Einheitlicher Anzeigestatus aus Erstbearbeitung × Arbeit; nicht vorgesehene Kombinationen fallen auf die Erstbearbeitung zurück. „Zahlung erfassen“ (`record_payment`) in der Rechnungsliste und auf der Anfrageseite. Foto beim Einsatzabschluss nicht Pflicht. Einsatzvorschläge: zuerst Techniker mit abgeschlossenen Einsätzen bei derselben Firma (Kundennummer, sonst Firmenname); bei Neukunden Erfahrung mit Anlagentyp/Hersteller, dann geringere Auslastung, dann frühestes Fenster.
- n8n-Vertrag: lokale Integrations-RPCs mit Idempotenz, `expected_version`, Audit und Versandfreigabe sind vorhanden. Sechs ungruppierte veröffentlichte Workflows; aktuelle JSON-Graphen unter n8n/workflows/*.workflow.json. Unbekannte/mehrdeutige Modelle gehen an Menschen, nie automatisch ablehnen. Anhänge privat, Antwortanalyse erst nach abgeschlossener Registrierung. Unfertige Gmail-Eingänge werden erneut aufgenommen. Keine automatische Speicherlöschung (Genehmigungsprüfung abgewiesen); Rollenprüfung weiterhin strikt service_role. Test-JWTs für service_role korrigiert. Team-Kennzahlen zählen nach aktueller Zuweisung.
- Verwaltung: Mitarbeitende werden deaktiviert, nie gelöscht; aktive Zuweisungen gehen dabei in einer Transaktion an eine Vertretung derselben Rolle, der Login wird gesperrt. Rollenwechsel nur ohne aktive Zuweisungen, eigenes Konto weder Rollenwechsel noch Deaktivierung. Öffentliche Registrierung aus (`[auth] enable_signup = false`; `[auth.email]` bleibt an, sonst ist die E-Mail-Anmeldung lokal aus). Einstellungen wirken nur auf spätere Vorgänge.
- Diagramme: Recharts, Farben `lib/chart-colors.ts` (Dataviz-validiert, feste Reihenfolge), je Abbildung Datentabelle; nur helle Darstellung.
- Manager-Übersicht verlinkt jede Kennzahl auf Anfrage- oder Rechnungsliste (`feld`/`von`/`bis`, `modus`, `status`); Definitionen in `lib/analytics.ts`.
- Analytik: laufende Zeiträume vergleichen dieselbe verstrichene Zeit ab Beginn des Vorzeitraums (begrenzt auf dessen Ende), abgeschlossene den ganzen Vorzeitraum; Ereignis-Kennzahlen nach eigenem Zeitstempel, Momentaufnahmen am Periodenende; `change_percent` nie bei Null-Basis. Warteschlangenhistorie aus `request_events` rekonstruiert.
- Rechnungs-PDF wird bei jedem Abruf deterministisch aus Positionen und Snapshots der ausgestellten Rechnung erzeugt (`lib/invoice-pdf.ts`, `pdf-lib`), nicht gespeichert; Entwürfe haben kein PDF. Für echte Rechnungen wäre eine Archivierung bei Ausstellung nötig.
- Gestaltung des PDFs folgt der Maßtabelle in `docs/design/RheinWerk Rechnungsvorlage.html`; Schriften unter `assets/fonts/` (OFL), eingebettet mit festen Namen für byte-identische Ausgabe.
- Website-Code wird aus `05_Export/RheinWerk Industrieservice Website` übernommen; das Dashboard entsteht im selben Next.js-Projekt.
- Quelle der Website: `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`, ohne Git-Historie übernommen.
- Markenname RheinWerk statt „Rheinberg“ aus der Spezifikation.
- Nutzerentscheidung 08.10.2026: Make durch lokales n8n ersetzen; Supabase ebenfalls lokal auf dem Mac. Gmail: rheinwerk.industrieservice@gmail.com. Unbekannte Modelle gehen an Menschen, keine automatische Ablehnung. Katalog: docs/equipment/RheinWerk_Anlagenkatalog_DE.md.
- Entwicklung gegen lokales Supabase (`supabase start`); Schemaänderungen nur als Migrationen unter `supabase/migrations/`, spätere Übernahme in die Cloud per `supabase db push`.
- `proxy.ts` erneuert nur die Sitzung (nur `/dashboard`, `/login`, `/auth/*`) und setzt `Cache-Control: private, no-store`; Zugriffsschutz in jeder Dashboard-Seite (`lib/auth/session.ts`) und über RLS.
- Einsatzfotos: Server lädt in den privaten Bucket (`visits/<request>/<visit>/`), `add_visit_photo` registriert mit Nutzerrechten; bei Fehler wird die Datei gelöscht. Limit 11 MB für Server Actions und Proxy.
- Techniker-Seiten filtern zusätzlich zu RLS auf die eigene `technician_id` (RLS zeigt sonst fremde Einsätze auf aktuellen Anfragen).
- Einsatzplanung mit eigener Kalenderansicht (keine Bibliothek); Zeiten über `lib/berlin-time.ts` in Europe/Berlin.
- Prüfaktionen als Server Actions, je Aktion genau eine RPC mit angezeigter `version`, danach `refresh()`; kein Senden-Knopf, Warteschlange ≠ Versand.
- Dispatcher-Warteschlangen als View `public.dispatcher_queue` mit `security_invoker`; Regeln und Sortierung in `docs/database.md`.
- Anfrageseite liest alle Abschnitte mit Nutzerrechten (nie Admin-Client); Dokumente werden durch die App gestreamt (`/dashboard/anfragen/[id]/dokumente/[attachmentId]`). Supabase-Clients sind mit `lib/supabase/database.types.ts` typisiert (`npm run db:types` nach Schemaänderungen).
- UI-Bausteine unter `components/dashboard/ui/`, Formatierung `lib/format.ts`, Status `lib/status.ts`, Speichervertrag `lib/forms.ts`; kein segmentweites `loading.tsx` (würde Zugriffs-Weiterleitungen streamen), Laden per `Suspense` je Seite.
- Website und Dashboard in Route Groups `(site)`/`(dashboard)`; Bereiche, Startseiten und erlaubte Rollen zentral in `lib/auth/roles.ts`.

- Alle Enums der Spezifikation entstehen in einer eigenen Migration; Tabellen aktivieren RLS sofort (Deny-by-default), Richtlinien folgen in task-1-5.
- SQL-Tests mit pgTAP unter `supabase/tests/database/`, Ausführung `supabase test db`.
- Anfragenummern vergibt ausschließlich die Datenbank (Trigger), das Jahr folgt `created_at` in `settings.timezone`; `request_events` ist per Trigger append-only.
- Zugehörigkeit zur selben Anfrage wird über `UNIQUE (id, request_id)` und zusammengesetzte Fremdschlüssel garantiert; Überschneidungen aktiver Einsätze verhindert ein Exclusion Constraint (`btree_gist`).
- RLS gewährt nur Lesen; Schreiben ausschließlich über kontrollierte `security definer`-Operationen (Phase 2). Neue Tabellen müssen RLS aktivieren und Standardrechte von `anon`/`authenticated` entziehen.
- Kontrollierte Operationen: `security definer`-RPCs mit `expected_version`; Fehlercodes `42501` (Berechtigung), `RW409` (Versionskonflikt), `RW422` (Zustand/Eingabe). Siehe `docs/database.md`.
- Einsatzplanung serialisiert pro Techniker per Advisory-Lock; Verfügbarkeitsänderungen nehmen dieselbe Sperre. Reservierend sind nur `scheduled`/`in_progress`.
- Rechnungsentwurf ist eine Vorschau; die Ausstellung baut die Positionen neu und sperrt danach alle Arbeitspositionen der Anfrage.
- Tests: `npm run test:db` (pgTAP, datenunabhängig), `npm run test:api` (nur lokal, echte Logins), `npm run test:auth` (Login und Bereichsschutz über HTTP, laufende App), `npm run test:unit` und `npm run test:ui` (headless Chrome, laufende App); siehe `docs/testing.md`.
- Demo-Nutzer werden über die Admin-API angelegt und per `app_metadata.demo_seed` als Seed-Eigentum markiert; Rollen stehen ausschließlich in `profiles`.
- Demo-Seed: Generierung in Node (deterministisch, Zeit-Simulation mit Stichzeitpunkt), Schreiben atomar in SQL; Seed-Eigentum über `is_demo` und `private.demo_seed_records`.
- Demo-Basiswert der manuellen Erstbearbeitung: 15 Minuten (Nutzerentscheidung, abweichend von 5 Minuten der Spezifikation).

## Bekannte Probleme

- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern der Hilfsfunktionen `private.lock_visit`, `lock_work_entry`, `lock_invoice`, `lock_outgoing_message` (stilistisch, ohne Auswirkung).
- Kein Supabase-Cloud-Projekt verknüpft; für das spätere Deployment nötig (`supabase login`, `supabase link`).
- `npm run test:api` und `npm run test:ui` legen Testnutzer und Testanfragen an. Die Anfragen (`is_demo`) entfernt `npm run demo:seed`; die Testnutzer erscheinen lokal in Namenslisten, bis `supabase db reset` sie entfernt.
- Port 3000 kann lokal von einem anderen Projekt belegt sein; App dann z. B. mit `npx next start -p 3100` und `APP_URL=http://127.0.0.1:3100` für `test:auth`/`test:ui` starten.
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.

## Prüfung der n8n-Integration

Nutzerkorrektur 12.10.2026: Alle 99 Knotennamen in sechs lokalen n8n-Workflows geprüft; 23 russische/englische Bezeichnungen ins Deutsche übertragen. Namensreferenzen in Ausdrücken aktualisiert, Graph und Credentials gegenüber dem vorherigen Stand verglichen und unverändert bestätigt. Geänderte Workflows erneut veröffentlicht und alle sechs aktiven Graphen per MCP zurückgelesen. Generatorsourcen und Exporte synchronisiert; SDK-Validierung der geänderten Quellen bestanden. Keine erneuten E-Mail-/OpenAI-Aufrufe und keine neue Website-/Datenbankänderung.

Echte OpenAI-Textanalyse, Gmail-Rückfrage und Kundenantwort mit historischer Zuordnung; privates PDF und PNG aus dem API-Formularpfad vollständig in Supabase kopiert und ausgewertet. RIS-2026-00356 processed, Modell aus Dokumenten erkannt, zwei private Dateien; Wiederholung ohne zusätzliche Anfrage, Ereignisse oder Analyse. Tatsächliches bereits gesendetes Gmail-Mail per internem Header wiedergefunden ohne erneut zu senden; neue Provider-Metadaten-Strecke mit gepinntem Send-Ergebnis und echtem Get geprüft. Produktions-Send-/Analyse-Scheduler erfolgreich. Node-/SDK-Validierung, lint, build und typecheck bestanden. DB 532/532 und SQL-Smoke-Test ROLLBACK unmittelbar davor; keine neue SQL-Änderung. Unit-Doku-Abgleich abschließend 58/58 bestanden. DB-Reset und API/Auth/UI-Regression nicht wiederholt; keine Sichtprüfung der Formular-Oberfläche im Browser. Kein Push/Website-Deployment.

## Empfohlener nächster Schritt

Phasen 11 und 12 sind abgeschlossen. Für echte Passwort-Mails SMTP einrichten (`docs/setup.md`); weitere Arbeit als neue Roadmap-Tasks. Für eine spätere öffentliche Demonstration die Website mit produktivem Turnstile und geschütztem Zugriff auf das lokale n8n konfigurieren; nicht automatisch deployen.
