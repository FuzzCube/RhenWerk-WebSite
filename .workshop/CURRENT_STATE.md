# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v13 mit 14 Phasen und 63 Tasks. Fortschritt 100 % (Gewicht 182 von 182, 63 von 63 Tasks). Roadmap v13.

## Aktive Phase

Alle Phasen 0–13 abgeschlossen (19.10.2026). Phase 13 „KI-Telefonassistent“ (Plan `docs/telefonassistent-plan.md`): ElevenLabs-Agent „Mira“ (nur Deutsch), Werkzeuge über n8n hinter benanntem Cloudflare-Tunnel, Terminvormerkung mit Bestätigung durch den Dispatcher, Rückrufbitte an den Techniker bei Verspätung (Benachrichtigung im Dashboard, kein Telegram), Web-Widget statt Telefonnummer.

## Aktive Aufgabe

Keine Aufgabe in Arbeit. Alle Tasks der Roadmap v13 sind abgeschlossen; offen sind nur die Sprachtests des Telefonassistenten nach neuem ElevenLabs-Guthaben (siehe Bekannte Probleme).

Hinweis: Nach `npm run test:ui` meldet `demo:verify` Chronologie-Abweichungen der vom Test angelegten Demo-Anfragen (UI-Test …); `npm run demo:seed` räumt sie ab.

`task-10-4` ist lokal abgeschlossen: sechs veröffentlichte n8n-Workflows, lokaler Formularpfad zu n8n, echte Blob→Supabase→OpenAI-Dateiverarbeitung und Gmail-Antwortgedächtnis geprüft. Öffentliche Website nicht umgestellt.

## Zuletzt abgeschlossen

`task-13-11` (19.10.2026): Demo-Anruf und Demo-Weiterleitung – Portfolio ohne Telefonleitung (Nutzerentscheidung): jeder Link auf die Service-Desk-Nummer öffnet einen simulierten Anruf bei Mira (`components/demo-call.tsx`, ersetzt die Widget-Karte der Kontaktseite; Limits wie task-13-8). Werkzeug `weiterleiten` (`agent_forward`, Migration `20261019160000_agent_forward.sql`): Mira sagt, dass es ein Demo-Projekt ist und hier verbunden würde, und nimmt dann einen Rückruf auf; „weitergeleitet (Demo)“ im Bereich Anrufe. test:db 920, test:agent, test:ui, agent:simulate (zwei Volläufe), lint, typecheck, build. Nicht geprüft: Anruf mit Stimme (Guthaben).

`task-13-8` (19.10.2026): Test und Demo des Telefonassistenten – Web-Widget „Mit Mira sprechen“ auf der Kontaktseite (signierte Adresse über `app/api/mira`, Budget in `widget_sessions`: 3 Minuten je Gespräch, 10 Minuten je Tag, 3 Gespräche je Anschluss und Stunde; Hinweis KI/Datenschutz vor dem Start; Agent nur noch mit signierter Adresse, Ende nach 30 s Stille), Testprotokoll `docs/telefonassistent/testprotokoll.md` (14 Szenarien per Textsimulation, `agent:simulate` mit 16 Fällen; drei Prompt-Nachbesserungen), Latenz `npm run agent:latency` (Antwortzeit p50 1,2 s). test:db 911, test:ui 352, test:unit 85, lint, build. Nicht geprüft: Sprachdurchläufe und Widget-Gespräch (Guthaben).

`task-13-7` (19.10.2026): Telefonassistent-Dashboard – Bereich „Anrufe“ (`/dashboard/anrufe`, Dispatcher, Manager, Admin: Liste mit Ansichten Alle/Rückruf offen/Notfälle und Dringendes/Mit neuer Anfrage, Suche mit Vorschlägen, Anrufseite mit Zusammenfassung, Anfrage und Kunde, „Rückruf erledigt“, Transkript 30 Tage), Quelle „über Telefon (KI)“ im Kopf der Anfrage und Block „Telefonat“, Auswertung „Telefon“ (Migration `20261019140000_phone_dashboard.sql`: `analytics_phone`, `analytics_phone_categories`, `analytics_phone_days`), Demo-Anrufe (`scripts/demo/calls.mjs`, rund 340, etwa 40 % der Demo-Anfragen der letzten 150 Tage über das Telefon). test:db 897, test:ui 347, test:unit, lint, typecheck, build, demo:verify 19/19, Sichtprüfung 390/1440 px. test:auth: 5 Cache-Control-Prüfungen schlagen unter `next dev` fehl, auch ohne diese Änderungen.

`task-13-6` (19.10.2026): Gesprächsauswertung – n8n-Workflow `rwCallAnalysis26` holt beendete Gespräche alle 2 Minuten über die ElevenLabs-API (statt Webhook), OpenAI füllt das feste Schema, `agent_record_call` speichert einmal je Gespräch mit Fakten aus der Datenbank; dringende Anrufe als Banner für Dispatcher mit „Rückruf erledigt“. test:db 880, test:calls (7 echte Gespräche), test:ui, test:agent, agent:simulate 5/5, test:unit 85, lint, typecheck, build. Regeln in `docs/telefonassistent/regeln.md` (Gesprächsauswertung).

`task-12-4` (19.10.2026): Autovervollständigung in den Suchen von Anfragen, Kunden, Rechnungen, Posteingang und im Feld Kundennummer – Baustein `SearchSuggest`, Endpunkt `/dashboard/suche/vorschlaege` mit Rollenprüfung und RLS. test:ui (12 neue Prüfungen), test:unit 85, lint, typecheck, build. Details in `docs/architecture.md` (Autovervollständigung).

`task-13-10` (19.10.2026): Kundenstamm – Tabellen `customers`/`customer_sites` (Migration `20261019120000_customers.sql`), Bereich „Kunden“ für Dispatcher, Manager und Admin (Liste mit Suche, Anlegen, Stammdaten, Standorte, Anfragen), Block „Kundenstamm“ in der Anfrage (verknüpfen, Daten übernehmen), Werkzeug `kunde_finden` (Kundennummer + PLZ) und Prompt-Schritt Bestandskunde; Demo-Seed mit 53 Kunden. test:db 861, test:ui, test:auth, test:unit 85, test:agent, agent:simulate 5/5, demo:verify 19/19, lint, typecheck, build. Lokale Datenbank dabei einmal zurückgesetzt (frühere Testanfragen RIS-2026-03316 bis 03318 entfallen).

`task-13-5` (19.10.2026): Telefonassistent „Mira“ – zehn n8n-Webhooks (`rwAgentTools2026`, inkl. `email_pruefen`) hinter `x-agent-secret` und Cloudflare-Access-Service-Token, Agent in ElevenLabs per `npm run agent:sync` (LLM `claude-sonnet-4-5`, TTS `eleven_v3_conversational` mit Expressive Mode, ASR-Schlüsselwörter aus dem Katalog, `turn_eagerness: patient`). Nach drei Browsertests nachgebessert: E-Mail deterministisch aus der Buchstabierung (`agent_check_email`), ähnliche Baureihen als Rückfrage, Kalender in `servicezeit`, Prompt verschärft. test:db 831, test:agent 23/23 (lokal und Tunnel), agent:simulate 4/4, test:unit 85, lint, typecheck, build. Nicht geprüft: Browsertest nach den letzten Änderungen (ElevenLabs-Guthaben aufgebraucht); Status- und Notfallszenario nur in der Simulation. Einrichtung: `docs/telefonassistent/setup.md`.

`task-13-4` (15.10.2026): Rückrufbitte an den Techniker – `agent_request_callback` nur bei überfälligem Einsatz (eine offene je Einsatz), Banner über jeder Dashboard-Seite (Abfrage alle 20 s, `tel:`-Schaltfläche, „Kunde angerufen“, Tab-Zähler, optionale Browser-Benachrichtigung), nach 15 Minuten ohne Quittung dringend an den Dispatcher der Anfrage (sonst alle aktiven), Einsatzbeginn erledigt die Bitte. Kein Telegram (Nutzerentscheidung; später ggf. Push in einer Techniker-App). test:db 800, test:ui 284, test:unit 85, demo:verify 18/18, lint, typecheck, build.

`task-13-3` (15.10.2026): Terminvormerkung des Telefonassistenten – freie Fenster (`agent_free_slots`), Vormerkung beim Anlegen, Bestätigen (Einsatz + E-Mail) oder Ablehnen (Grund, Gegenvorschlag) in der Anfrage, Ablauf nach zwei Werktagen, Kennzeichen in Listen, Plantafel schraffiert. test:db 774, test:ui, demo:verify 18/18.

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

`task-13-7` „Telefonassistent: Dashboard“ (Bereich Anrufe, Block Telefonat in der Anfrage, Kennzahlen Telefon, Demo-Anrufe); danach `task-13-8`. Offene Ideen nur nach Rücksprache als neue Tasks: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen, SMTP für echte Passwort-Mails, öffentliche Website auf n8n umstellen.

## Blockiert

Keine Blockierung. Lokale Integration task-10-4 nach den tatsächlich geprüften Definition-of-Done-Punkten abgeschlossen; die frühere Blockierung ist behoben. Dokumentierte Lifecycle-Korrektur blocked → completed für die bereits begonnene und ausdrücklich wiederaufgenommene Arbeit; keine zweite Aufgabe in_progress eingeführt.

12.10.2026: Alle sechs Workflows veröffentlicht, Nodes ohne Gruppen. Lokales N8N_WEBHOOK_URL gesetzt. Echte E-Mail-Rückfrage und Antwortgedächtnis RIS-2026-00355 geprüft. Private Uploads über tatsächlichen API-/Clientpfad und OpenAI-Dateiauswertung RIS-2026-00356 geprüft. Send-Recovery nutzt den von Gmail erhaltenen internen Header; faktische MIME-ID wird nachgelesen. Inbox-Nachlesen für RIS-Antworten letzte sieben Tage alle 15 Minuten; vollständige registrierte Eingänge zusätzlich alle fünf Minuten. Details und Grenzen in docs/n8n-contract.md.

## Wichtige Entscheidungen

- Nutzerentscheidung 15.10.2026 (task-13-4): Rückrufbitten nicht über Telegram, sondern als Benachrichtigung im Dashboard (Banner mit Abfrage, Browser-Benachrichtigung optional); eine eigene Techniker-App mit Push ist eine spätere Möglichkeit.
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
- Nutzerentscheidung 19.10.2026: Repository vom Organisationsrepo `Futureway-Akademie/A.Sadkovojs_Project` auf das eigene `github.com/FuzzCube/RhenWerk-WebSite` umgezogen (`origin`); weitergearbeitet wird nur dort. Commits auf `main`, Push durch den Nutzer.
- Nutzerentscheidungen 19.10.2026 zum Telefonassistenten: LLM `claude-sonnet-4-5` statt Haiku (verknüpft Buchstabiertes besser, etwas mehr Verzögerung akzeptiert), TTS `eleven_v3_conversational` mit Expressive Mode; E-Mail-Adressen und Kalenderdaten bestimmt die Datenbank, nicht das Sprachmodell; Bestandskunden über Kundennummer + PLZ; Gesprächsauswertung per API-Abfrage statt Webhook.
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
- Port 3000 kann lokal von einem anderen Projekt belegt sein; App dann z. B. mit `npx next start -p 3100` starten. Für `test:ui` `APP_URL=http://localhost:3100` verwenden: der Link aus der Passwort-Mail leitet über `request.nextUrl` auf `localhost` weiter, mit `127.0.0.1` gehen dabei die Sitzungs-Cookies verloren (Prüfung „Link öffnet Neues Passwort festlegen“ schlägt fehl).
- Lokale Entwicklung setzt laufendes Docker und `supabase start` voraus; `.env.local` mit Werten aus `supabase status`.
- `next dev` liefert Client-Skripte nur an `localhost`/`127.0.0.1` (`allowedDevOrigins` in `next.config.ts`). Über die LAN-Adresse (z. B. `http://192.168.2.33:3000`) erscheint die Seite, aber nichts Interaktives funktioniert (Vorschläge, Plantafel, Banner). Lokal immer `http://localhost:3000` öffnen; für Tests von Tablet/Smartphone die Adresse in `allowedDevOrigins` ergänzen und `next dev` neu starten.
- `supabase db reset` löscht alle lokalen Daten (Demo-Nutzer, Demodaten, Testanfragen); danach `npm run demo:users` und `npm run demo:seed`. Geänderte Funktionen einer bereits angewandten Migration besser einzeln per `psql` einspielen (am 19.10.2026 einmal versehentlich zurückgesetzt).
- ElevenLabs-Guthaben des Nutzers am 19.10.2026 aufgebraucht: keine Live-Anrufe; offen ist ein Browsertest von Mira mit den letzten Änderungen (Sonnet, Kalender, ASR-Schlüsselwörter, Bestandskunde). API-Lesen (Gesprächsauswertung, `test:calls`) und `agent:sync` funktionieren weiter; `agent:simulate` lief ebenfalls.

- Zusammenfassungen von Anrufen ohne Anfrage sollen laut `docs/telefonassistent/datenschutz.md` nach 12 Monaten gelöscht werden; noch nicht umgesetzt.
- Nach `npm install` liefert ein laufendes `next dev` teils HTTP 500 („module factory is not available“); `next dev` neu starten (läuft im Terminal des Nutzers).
- Demo-Anruf funktioniert nur lokal (Budget in Supabase, `/api/mira`); die öffentliche Website ist nicht an Supabase angebunden, dort meldete der Dialog „Anruf nicht möglich“, bis Supabase und `ELEVENLABS_API_KEY` im Deployment eingerichtet sind.

## Prüfung der n8n-Integration

Nutzerkorrektur 12.10.2026: Alle 99 Knotennamen in sechs lokalen n8n-Workflows geprüft; 23 russische/englische Bezeichnungen ins Deutsche übertragen. Namensreferenzen in Ausdrücken aktualisiert, Graph und Credentials gegenüber dem vorherigen Stand verglichen und unverändert bestätigt. Geänderte Workflows erneut veröffentlicht und alle sechs aktiven Graphen per MCP zurückgelesen. Generatorsourcen und Exporte synchronisiert; SDK-Validierung der geänderten Quellen bestanden. Keine erneuten E-Mail-/OpenAI-Aufrufe und keine neue Website-/Datenbankänderung.

Echte OpenAI-Textanalyse, Gmail-Rückfrage und Kundenantwort mit historischer Zuordnung; privates PDF und PNG aus dem API-Formularpfad vollständig in Supabase kopiert und ausgewertet. RIS-2026-00356 processed, Modell aus Dokumenten erkannt, zwei private Dateien; Wiederholung ohne zusätzliche Anfrage, Ereignisse oder Analyse. Tatsächliches bereits gesendetes Gmail-Mail per internem Header wiedergefunden ohne erneut zu senden; neue Provider-Metadaten-Strecke mit gepinntem Send-Ergebnis und echtem Get geprüft. Produktions-Send-/Analyse-Scheduler erfolgreich. Node-/SDK-Validierung, lint, build und typecheck bestanden. DB 532/532 und SQL-Smoke-Test ROLLBACK unmittelbar davor; keine neue SQL-Änderung. Unit-Doku-Abgleich abschließend 58/58 bestanden. DB-Reset und API/Auth/UI-Regression nicht wiederholt; keine Sichtprüfung der Formular-Oberfläche im Browser. Kein Push/Website-Deployment.

## Empfohlener nächster Schritt

`task-13-7` (Dashboard für Anrufe). Browsertest von Mira nach den letzten Änderungen nachholen, sobald wieder ElevenLabs-Guthaben vorhanden ist. Für echte Passwort-Mails SMTP einrichten (`docs/setup.md`); öffentliche Demonstration nicht automatisch deployen.
