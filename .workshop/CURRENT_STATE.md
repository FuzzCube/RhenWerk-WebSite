# Aktueller Projektstand

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website mit Supabase. Roadmap v5 mit 11 Phasen und 37 Tasks. Fortschritt 94,44 % (Gewicht 119 von 126, 35 von 37 Tasks).

## Aktive Phase

Phasen 0–8 sind abgeschlossen; in Phase 9 fehlt nur die Gesamtprüfung `task-9-2` (jetzt `ready`). In Phase 10 (Erweiterungen) ist nur `task-10-5` offen.

## Aktive Aufgabe

Keine. `task-10-3` wurde am 13.10.2026 abgeschlossen; der nächste Task wird mit dem Nutzer gewählt.

`task-10-4` ist lokal abgeschlossen: sechs veröffentlichte n8n-Workflows, lokaler Formularpfad zu n8n, echte Blob→Supabase→OpenAI-Dateiverarbeitung und Gmail-Antwortgedächtnis geprüft. Öffentliche Website nicht umgestellt.

## Zuletzt abgeschlossen

`task-10-3` (13.10.2026): Überarbeitung des Dashboard-Designs, vom Nutzer abgenommen. RheinWerk-Design, nur hell. Listen- und Bereichsseiten (Anfragen, Erstbearbeitung, Auswertung, Rechnungen, Verwaltung) mit hellem Seitenmenü (`components/dashboard/ui/side-menu.tsx`, auf schmalen Breiten ein Umschaltknopf) und Kopf mit Ansicht, Anzahl und Beschreibung; Manager-Übersicht auf einem 4-Spalten-Raster; Einsatzplanung als Plantafel mit Warteschlange im Stil des Seitenmenüs; Anfrageseite mit aufklappbaren Nebenabschnitten; Technikerseiten mobil zuerst (Mein Tag und Einsatz einspaltig, höchstens 960 px; Kalender als Wochenagenda). Breite Seiten bis 1680 px mit bündigen Kopf-, Navigations- und Inhaltskanten. Geprüft: typecheck, lint, test:unit 61/61, build, test:auth (gegen `next start`; Prüfanker auf die neue Markup umgestellt) und test:ui 198; im Browser bei 390/768/1440 px kein horizontales Scrollen. Details in `docs/architecture.md` (Abschnitt Design-Überarbeitung).

`task-10-2` (12.10.2026): Zahlungserinnerungen. Stufen Zahlungserinnerung / 1. Mahnung / 2. Mahnung (7/14/14 Tage, Einstellungen → Zahlungserinnerungen), täglicher pg_cron-Job `payment-reminders` 06:00 UTC, Systemfreigabe, Aussetzen und Sofort-Auslösen auf der Anfrageseite (Manager/Admin), Spalte „Mahnstufe“ in der Rechnungsliste, E-Mail im Design der Eingangsbestätigung (`emails/zahlungserinnerung.*`). Demo-Seed lädt eine Erinnerungshistorie und scheitert nicht mehr an echten Einsätzen. test:db 566/566, test:unit 61/61, test:ui 198, lint, typecheck, build. Details in `docs/database.md`.

`task-10-6` (12.10.2026): Automatische Eingangsbestätigung per E-Mail ohne manuelle Freigabe (nur Art `receipt`, Systemfreigabe), HTML-Design aus Claude Design (`emails/`, `messages.body_html`, `multipart/alternative`), Subdomain-Adressen zugelassen. test:db 532/532, Integrationstest, lint, typecheck; echter Versand vom Nutzer bestätigt (RIS-2026-00360).

`task-10-4`: lokale n8n/OpenAI/Gmail-Integration. Vollständiger API-Formularpfad mit privatem PDF und PNG: RIS-2026-00356 processed, KAESER SM 13 aus Dokumenten, keine Duplikate. Versandwiederaufnahme und verpasste RIS-Eingänge geprüft. Kein Push/Website-Deployment.

`task-10-1`: Testkonten automatischer Tests (`api-`/`ui-`/`e2e-…@example.com`) löscht `demo:seed`; `test:api` und `test:ui` deaktivieren ihre Konten am Ende; `demo:verify` prüft aktives Personal (18 Prüfungen). Davor `task-9-1` (Kennzahlen-Wörterbuch, n8n-Vertrag).

## Bereite nächste Aufgaben

- `task-9-2`: Gesamtprüfung und Responsive-Check (alle Abhängigkeiten abgeschlossen).
- `task-10-5`: Posteingang für nicht zugeordnete E-Mails (eingehende Mails ohne Anfragenummer/Thread werden gespeichert, sind im Dashboard aber noch unsichtbar).

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

Design task-10-3 abnehmen; danach task-9-2 Gesamtprüfung. task-10-5 Posteingang für nicht zugeordnete E-Mails ist ready. Für eine spätere öffentliche Demonstration die Website mit produktivem Turnstile und geschütztem Zugriff auf das lokale n8n konfigurieren; nicht automatisch deployen.
