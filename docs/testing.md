# Tests

Alle Prüfungen laufen gegen den lokalen Supabase-Stack. Voraussetzungen: Docker, `supabase start`, `.env.local` mit den Werten aus `supabase status` (siehe `.env.example`); vollständige Einrichtung in [setup.md](setup.md).

## Befehle

| Befehl | Prüft | Dauer |
| --- | --- | --- |
| `npm run lint` | ESLint | Sekunden |
| `npm run typecheck` | TypeScript | Sekunden |
| `npm run build` | Produktions-Build | ca. 30 s |
| `npm run test:unit` | Formatierung, Status- und Formularhilfen (`tests/unit/`, `node --test`) | Sekunden |
| `npm run test:db` | pgTAP-Tests unter `supabase/tests/database/` (`supabase test db`) | Sekunden |
| `npm run test:api` | Direkte REST-, RPC- und Storage-Aufrufe mit echten Logins, gleichzeitige Buchungen über HTTP (`scripts/test-api.mjs`) | ca. 10 s |
| `npm run test:auth` | Anmeldung, Rollen-Startseiten, Navigation, Bereichsschutz, Abmelden und Cache-Header über HTTP (`scripts/test-auth.mjs`); laufende App nötig | ca. 10 s |
| `npm run test:ui` | Headless Chrome: kein horizontales Scrollen bei 390/768/1440 px, Eingaben bleiben bei fehlgeschlagenem Speichern erhalten (`scripts/test-ui.mjs`); laufende App nötig | ca. 30 s |
| `npm run test:agent` | Webhooks des Telefonassistenten in n8n: Geheimnis, Antworten, Zeit (`scripts/test-agent.mjs`); lokal oder mit `AGENT_BASE_URL` durch den Tunnel | ca. 5 s |
| `npm run test:calls` | Gesprächsauswertung: alle beendeten Gespräche bei ElevenLabs ausgewertet, Wiederholung ohne Wirkung (`scripts/test-calls.mjs`); aktiver Workflow nötig | Sekunden |
| `npm run agent:simulate` | Textsimulation der Szenarien des Testprotokolls mit dem echten Agenten in ElevenLabs: erwartete und verbotene Werkzeuge, Parameter, Aussagen (`scripts/agent-simulate.mjs`, [telefonassistent/testprotokoll.md](telefonassistent/testprotokoll.md)) | ca. 10 min |
| `npm run agent:latency` | Latenz: Metriken je Gesprächsrunde aus den Live-Gesprächen (Antwortzeit, Sprachmodell, Sprachsynthese, Spracherkennung, Werkzeuge) und Webhooks lokal/durch den Tunnel, p50/p95 (`scripts/agent-latency.mjs`, `--markdown` für das Protokoll) | ca. 1 min |
| `npm run supabase:check` | Verbindung zum Supabase-Projekt | Sekunden |
| `npm run demo:verify` | Konsistenz des Demo-Seeds (`scripts/demo/verify-seed.sql`) | Sekunden |
| `supabase db lint` | Schema-Linter (plpgsql_check) | Sekunden |

Nach Schemaänderungen die neue Migration mit `supabase migration up` einspielen, dann `npm run test:db`. Nie `supabase db reset`: Es löscht die lokalen Daten (Demo-Nutzer, Anfragen, n8n-Bezüge), nur nach einer Sicherung und mit Absicht ([setup.md](setup.md#datenbank-zurücksetzen-und-schemaänderungen)).

## Datenbanktests (`npm run test:db`)

Jede Datei läuft in einer Transaktion mit `ROLLBACK` und hinterlässt keine Daten. Rollen werden mit `set local role` und simulierten JWT-Claims (`request.jwt.claims`) gewechselt. Die Tests zählen nur ihre eigenen Fixtures (feste UUIDs `00000000-0000-0000-0000-…`) und verwenden für Nummernkreise freie Jahre; sie laufen deshalb auch auf einer Datenbank mit Demo- oder API-Testdaten.

| Datei | Inhalt |
| --- | --- |
| `master_data.test.sql` | Stammdaten, CHECK-Constraints |
| `requests_and_events.test.sql` | Anfragenummer, Idempotenz, Unveränderlichkeit, append-only Ereignisse |
| `messages_automation_attachments.test.sql` | Nachrichten, Automatisierungsläufe, Anhänge |
| `visits_work_invoices.test.sql` | Einsätze, Überschneidungsschutz, Arbeitspositionen, Rechnungen, Rundung |
| `rls.test.sql` | Leserechte aller Rollen, Storage |
| `intake_operations.test.sql` | Erstbearbeitung, Zuweisung, Fristen |
| `visit_operations.test.sql` | Einsatzplanung, Verfügbarkeit, Einsatzstatus; Umplanen: Grund, Version (RW409), Überschneidung (RW410), Vergangenheit, fremder Dispatcher und Techniker (42501) |
| `work_operations.test.sql` | Arbeitspositionen, Abschluss der Anfrage |
| `invoice_message_operations.test.sql` | Rechnungen, Zahlungen, E-Mail-Warteschlange, Zuordnung |
| `scenarios.test.sql` | Durchgehende Szenarien 1, 2, 3, 4 und 7 der Spezifikation |
| `dispatcher_queue.test.sql` | Warteschlangen der Dispatcher: Zuordnung, Sortierung, RLS |
| `visit_follow_up_photos.test.sql` | Folgeeinsatz beim Beenden eines Einsatzes, Registrierung von Einsatzfotos |
| `savings_fixture.test.sql` | Prüf-Fixture 100 × 15 Minuten = 25 h (Szenario 5, Teil) |
| `admin_operations.test.sql` | Verwaltung: nur Admin, keine direkten Tabellenschreibrechte, Rollenwechsel, Deaktivierung mit Neuzuweisung (Vertretung abwesend, laufender Einsatz), Reaktivierung, Tarife, Arbeitszeiten gegen geplante Einsätze, Abwesenheiten, Einstellungen nur für spätere Erstbearbeitungen |
| `inbox.test.sql` | Posteingang (task-10-5): Sichtbarkeit unzugeordneter E-Mails und Anhänge je Rolle, `link_message` nur für Inhaber/Manager/Admin mit Ereignis, `create_request_from_message`: Rechte, Pflichtfelder, Quelle `email`, Verknüpfung von Nachricht und Anhang, Ereignisse, Wiederholung ohne Duplikat und ohne Preisgabe an Unberechtigte |
| `inbox_archive.test.sql` | Archiv des Posteingangs (task-10-10): Rechte (Techniker, fremder Dispatcher), ungültiger Grund, Archivieren mit Person/Zeit/Grund, offener Posteingang ohne Archivierte, Wiederholung, kein Zuordnen archivierter E-Mails, zugeordnete nicht archivierbar, Wiederherstellen durch Manager, keine direkte Tabellenänderung |
| `inbox_reply.test.sql` | Antwort aus dem Posteingang (task-12-3): Rechte (Techniker, fremder Dispatcher), leerer und zu langer Text, Antwort `queued` an den Absender im Gmail-Verlauf mit `In-Reply-To`/`References`, Doppelklick, Abholung durch n8n nur aus dem echten Postfach, Fehler und Bestätigung ohne Anfrage, Kundenantwort im Verlauf und auf unsere Antwort in derselben Unterhaltung, Zuordnen über eine spätere Nachricht verschiebt die ganze Unterhaltung, nächste Antwort direkt an die Anfrage, neue Anfrage mit Unterhaltung, archiviert keine Antwort und neue Unterhaltung, Auslastung zählt Unterhaltungen, keine ausgehende Zeile ohne Unterhaltung |
| `service_contracts.test.sql` | SLA-Verträge (task-13-9): Prüfung für den Agenten (24/7, ohne 24/7, abgelaufen, noch nicht gültig, zweiter Standort, falscher Standort, andere Firma, unbekannt, fehlende Angaben, gesprochene Schreibweise), keine Firma in der Antwort, nur `service_role`, Lesen nur für Dispatcher/Manager/Admin, kein Schreiben über die API, Nummernformat |
| `phone_agent_data.test.sql` | Telefonassistent (task-13-2): nur `service_role`; Anfrage aus Gespräch mit Liste fehlender/ungültiger Felder, Wiederholung je Gespräch, Quelle, Dispatcher, Standarddatum, SLA-Nummer, Eingangsbestätigung, Ereignis, Verknüpfung, kritischer Fall zur Prüfung; Suche mit jeder Lage (geplant mit Ansage, überfällig mit Einsatz, vor Ort, Teile, Kunde, Prüfung, abgeschlossen, abgelehnt, storniert), mehrere Treffer ohne Daten, falsche/fehlende PLZ, gesprochene Nummer, keine internen Daten; Einsatzgebiet; Löschung alter Transkripte |
| `visit_holds.test.sql` | Terminvormerkung (task-13-3): freie Fenster mit Ansage, Vormittag/Nachmittag, Dauer je Leistung, höchstens drei, Einsatz und Abwesenheit blockieren; Vormerkung beim Anlegen, Wiederholung, vorgemerktes Fenster nicht mehr angeboten, zweiter Anrufer ohne Vormerkung, Notfall ohne Vormerkung, Lage „vorgemerkt“, keine Überschneidung offener Vormerkungen; Rechte (Techniker, fremder Dispatcher), Bestätigen erst nach Erstbearbeitung, Einsatz im Fenster und Bestätigungs-E-Mail; Ablehnen mit Pflichtgrund und Gegenvorschlag; Ablauf mit Ereignis |
| `phone_dashboard.test.sql` | Kennzahlen des Telefonassistenten (task-13-7): nur Manager/Admin; Anrufe, ohne Rückruf, im Gespräch angelegte Anfragen (nicht nur genannte), außerhalb der Servicezeit, Notfälle, Rückrufe offen, Dauer, Kosten, Credits, Vorzeitraum; nicht ausgewertete und spätere Anrufe zählen nicht; je Kategorie und je Tag; ungültiger Zeitraum |
| `widget_sessions.test.sql` | Minutenbudget des Web-Widgets (task-13-8): nur `service_role`; 3 Reservierungen à 3 Minuten, vierte über dem Tageslimit; echte Dauer ersetzt die Reservierung nach der Auswertung, höchstens die Reservierung; Bindung einmal je Sitzung und Gespräch; 3 Sitzungen je Anschluss und Stunde |
| `agent_forward.test.sql` | Demo-Weiterleitung (task-13-11): nur `service_role`; unbekanntes Ziel, Ansage mit Ziel und Rückrufangebot, Service Desk nur in der Servicezeit, Markierung mit Ziel und Grund, Wiederholung behält die erste Zeit, Ziel nur mit `forwarded` |
| `auto_customers.test.sql` | Kunden aus bearbeiteten Anfragen (task-14-1): Firma ohne Rechtsform + PLZ und E-Mail verknüpfen, „Hafenstr.“ = „Hafenstraße“, neue Adresse als Standort, ein Versionsschritt, Neuanlage mit erstem Standort, Vorschläge bei gleicher Firma anderswo, zwei Treffern, gleicher Domain, inaktivem Kunden; Freemail kein Hinweis; verknüpfte Anfrage nur Standort; Demo unberührt; erneuter Abschluss ohne zweiten Kunden; n8n-Weg über `apply_analysis_result`; Fehler blockiert die Erstbearbeitung nicht |
| `customer_backfill.test.sql` | Nachzuordnung (task-14-3): Probelauf meldet anlegen/verknüpfen/Vorschlag und ändert nichts (Kunden, Standorte, Ereignisse, Versionen, Kundennummernfolge), Ausführung legt an, verknüpft mit Standort, speichert Vorschlag, je ein Ereignis; Demo, storniert, wartender Vorschlag und verknüpfte Anfrage unberührt; zweiter Lauf findet nichts |
| `customer_origin.test.sql` | Herkunft und Dubletten (task-14-4): automatische Anlage und „Neuen Kunden anlegen“ speichern die Anfrage, manuelle Anlage ohne Herkunft; ähnliche Kunden bei gleicher Firma (gleiche/andere PLZ), gleicher E-Mail, gleicher Domain, inaktivem Kunden; Freemail und neue Firma ohne Treffer; Techniker abgewiesen |
| `customer_from_request.test.sql` | „Neuen Kunden anlegen“ (task-14-2): Techniker abgewiesen, veraltete Version, Anlage mit Daten und erstem Standort aus der Anfrage, Kundennummer in der Anfrage, Vorschläge erledigt, Ereignis des Dispatchers, keine zweite Anlage, Demo-Anfrage ergibt Demo-Kunden, abgelehnte Anfrage abgewiesen, Verknüpfen per Nummer erledigt Vorschläge |
| `send_backlog.test.sql` | Hängender E-Mail-Versand (task-12-9): Techniker abgewiesen; nur freigegebene bzw. automatische E-Mails echter Anfragen älter als die Schwelle (mind. 1 Minute) zählen, auch fremde Anfragen für Dispatcher; ältester Zeitpunkt; versandte E-Mails zählen nicht mehr |
| `phone_request_customer.test.sql` | Telefonische Anfrage mit Bestandskunde (task-15-4): Verknüpfung beim Anlegen mit Standort gleicher Anschrift, Kundennummer aus dem Kundenstamm, Ereignis `customer_linked`; geänderte Anschrift ohne Standort; kein neuer Kunde; inaktiver und unbekannter Kunde RW422 ohne Anfrage; ohne Kunde bleibt die getippte Nummer `stated_customer_number` |
| `customer_number_mails.test.sql` | Kundennummer in E-Mails (task-15-3): Eingangsbestätigung (Text und HTML) und Zahlungserinnerungen mit Satz zur Kundennummer nur bei verknüpftem Kunden, Erinnerung mit Nummer der Rechnung, sonst der Anfrage; Terminmail über `queue_hold_mail` mit Satz vor dem Gruß, ohne Kunde unverändert; HTML maskiert, kein Platzhalter übrig |
| `purge_unlinked_calls.test.sql` | Löschfrist für Anrufe ohne Anfrage (task-16-1): nach 12 Monaten gelöscht (ohne Ende zählt der Beginn), alter Anruf mit Anfrage und frischer ohne Anfrage bleiben, nächtlicher Job registriert, kein Aufruf durch `authenticated` |
| `form_visit_holds.test.sql` | Wunschtermin aus dem Formular (task-19-3, 20-2, 20-9, 20-11, 20-15): Vormerkung zum Wunsch oder nächster freier Termin, Bestätigung, Terminänderung; Techniker in zwei Stufen (wenigste Aufträge der Kalenderwoche, bei Gleichstand Auslastung des Monats) |
| `visit_reply.test.sql` | Antwort des Kunden auf die Terminbestätigung (task-20-10, 20-16): Stornierung, Verschiebewunsch als Änderungsanfrage, fremde Absenderadresse, Auswertung nur einmal |
| `visit_change_requests.test.sql` | Verschiebewunsch (task-20-16): Anlegen mit Wunschtag und Eingangsbestätigung, Rechte (fremder Dispatcher), Optionen und Alternativen, Vorschlag (belegtes Fenster abgelehnt), „Ja“ des Kunden verschiebt, „Nein“ lässt bestehen, Bestätigung durch den Dispatcher, Erinnerung nur einmal, Schließen bei Stornierung |
| `dispatcher_month_balance.test.sql` | Verteilung neuer Anfragen an den Dispatcher mit den wenigsten Anfragen des Monats (task-20-12): stornierte, abgelehnte, Demo- und Vormonat zählen nicht, Gleichstand nach letzter Anfrage, Formular nutzt dieselbe Regel |
| `unread_customer_messages.test.sql` | Ungelesene Kundennachrichten (task-20-14): Ursprungs-E-Mail und ausgehende zählen nicht, Rechte (fremder Dispatcher, Techniker), als gelesen markieren, verknüpfte Unterhaltung gilt als gelesen |

`analytics.test.sql` (task-7-1) legt Fixtures im Jahr 2031 an und vergleicht Kennzahlen als Differenz vor und nach dem Anlegen, damit vorhandene Demodaten das Ergebnis nicht beeinflussen. Geprüft: Vergleichszeiträume, getrennte Zeitreihen nach `created_at`, `intake_completed_at` und `completed_at`, Zeitersparnis, Fristen, Rechnungs- und Zahlungsbeträge, Momentaufnahmen am Periodenende, Warteschlangenhistorie aus Ereignissen, Team, Automatisierung, Ablehnung für Dispatcher, Techniker und inaktive Manager, keine `security definer`-Funktion.

## API-Tests (`npm run test:api`)

Legt pro Lauf eigene Nutzer über die Auth-Admin-API an (`api-…-<lauf>@example.com`), meldet sie mit Passwort an und prüft über die öffentliche API:

- **Szenario 1:** `anon` liest und ruft nichts auf; Techniker B liest weder Anfrage noch Dokument-Metadaten von A und lädt dessen Datei nicht herunter; direkte PATCH-/INSERT-Aufrufe mit gefälschtem Autor scheitern; keine Selbstbeförderung; Dispatcher A erreicht keine Anfrage von B; inaktive Profile handeln nicht; nur die Integration bestätigt E-Mail-Versand.
- **Szenario 2 (Nebenläufigkeit über HTTP):** 10 gleichzeitige `schedule_visit`-Aufrufe für dasselbe Zeitfenster ergeben genau eine Buchung und 9 × `RW410`; in 10 Durchläufen wird jeweils gleichzeitig gebucht und eine Abwesenheit eingetragen – nie gelingen beide.

Das Skript bricht ab, wenn `NEXT_PUBLIC_SUPABASE_URL` nicht auf `127.0.0.1`/`localhost` zeigt. Testanfragen bleiben in der lokalen Datenbank, bis `npm run demo:seed` sie entfernt; die Testkonten werden am Ende deaktiviert und vom nächsten Seed gelöscht. Wiederholte Läufe stören sich nicht.

## Anmelde-Tests (`npm run test:auth`)

Voraussetzung: lokaler Supabase-Stack, Demo-Nutzer (`npm run demo:users`) und laufende App (`npm run build && npm run start`; andere Adresse über `APP_URL`). Das Skript sendet das echte Login-Formular ohne JavaScript und prüft:

- je Demo-Rolle: Weiterleitung `/dashboard` → Startseite der Rolle, Name und Rollen-Navigation, keine Website-Kopfzeile, fremder Bereich → eigene Startseite, `/login` → `/dashboard`, unbekannter Pfad → Dashboard-404, Abmelden und danach kein Zugriff, `Cache-Control` privat und `no-store`;
- falsches Passwort und unbekannte Adresse: gleiche Meldung, keine Sitzung;
- Konto ohne Profil, deaktiviertes Profil und Deaktivierung während einer bestehenden Sitzung: kein Zugriff, Hinweis auf `/login`.

- Anfragen: Trefferzahl der Liste je Rolle stimmt mit der Datenbank überein (Manager alle, Dispatcher eigene, Techniker zugewiesene und mit eigenem Einsatz); Filter, Suche, ungültige Filterwerte und letzte Seite; Manager und Dispatcher sehen 10 Abschnitte, Techniker oben den eigenen Einsatz und 7 Abschnitte ohne Erstbearbeitung, Korrespondenz und Einsatzliste, ohne Nachrichteninhalte im HTML; fremde und ungültige IDs ergeben 404;
- Techniker-Seiten: für alle drei Demo-Techniker entspricht der nächste Einsatz der Datenbank (laufend vor geplant), bestellte Teile der eigenen Anfragen stehen unter „Ausstehende Teile“, der Kalender (Wochenagenda) zeigt Tage, keine Namen und keine Einsätze anderer Techniker; Dispatcher erreichen den Techniker-Kalender nicht;
- Einsatzplanung: „Zu planen“ entspricht der Planungs-Warteschlange (Dispatcher eigene, Manager alle), Techniker ohne Zugriff; auf der Plantafel des Dispatchers ab Montag der laufenden Woche (`?woche=`) erscheinen fremde Einsätze nur als „Belegt“ ohne Nummer oder Firma, eigene mit Anfragenummer, Abwesenheitsgründe nirgends;
- Prüfaktionen: Techniker sehen keine Prüfaktionen (ihr Aktionsfeld zeigt nur Stand oder den inaktiven Rechnungsschritt); Manager sehen ihn bei offener Prüfung, mit „Als Entwurf speichern“ und ohne Senden-Knopf;
- Warteschlangen: für alle drei Demo-Dispatcher entsprechen Anzahl und Reihenfolge jedes Tabs der View `dispatcher_queue`; Manager wird umgeleitet; automatisch bearbeitete, ungeplante Anfragen stehen in der Planung;
- Dokumente: Manager lädt die interne Notiz (`management`), der Dispatcher der Anfrage sieht und lädt sie nicht, anonym 401; der Techniker der Anfrage lädt ein operatives Dokument, ein anderer Techniker nicht.

Temporäre Konten (`e2e-…@example.com`) werden am Ende wieder gelöscht. Das Skript bricht ab, wenn App oder Supabase nicht lokal sind.

Der „andere Techniker“ beim Dokument-Download ist ein Demo-Techniker ohne Bezug zur Anfrage (weder zugewiesen noch mit einem Einsatz darauf), da Einsätze Lesezugriff gewähren und die Demo-Daten vom Zeitpunkt des Seeds abhängen.

Startseiten (task-15-5): Admin und Manager landen auf der Übersicht. Das Skript liest bis zu 1000 Konten und lädt Anfragen für die Technikerzählung seitenweise (API-Grenze `max_rows` 1000).

Verwaltung (task-8-1): öffentliche Registrierung über die Auth-API abgewiesen; Unterseiten der Verwaltung für Admin 200, Manager auf seine Startseite; eigenes Konto ohne Deaktivierung, unbekannte Person 404.

Übersicht, Auswertung und Rechnungsliste (task-7-2, 7-3): Manager erhält die Seiten ohne Fehlermeldung; Dispatcher und Techniker werden auf ihre Startseite umgeleitet. Die Navigation von Admin und Manager enthält „Auswertung“ und „Rechnungen“.

- Gesundheitsprüfung (task-17-4): `/api/health` ohne und mit falschem Token liefert nur `{"status":"ok"}` mit `no-store`; mit `HEALTH_TOKEN` aus `.env.local` Commit, Datenbank und n8n mit Laufzeit. Der Fall 503 (Datenbank nicht erreichbar) wurde einmalig mit `SUPABASE_SECRET_KEY=falsch next start -p 3301` geprüft, nicht in der Suite.

## Unit-Tests (`npm run test:unit`)

Laufen ohne App und Datenbank (`node --test` mit dem Test-Resolver `tests/unit/ts-resolve.mjs`, der TypeScript-Importe ohne Endung auflöst). Prüfen die Formatierung in `Europe/Berlin` einschließlich Zeitumstellung und Jahreswechsel, Beträge, Dauer, leere Werte, dass jeder Status Text und Ton hat sowie die Formular- und Fehlerhilfen, die Beschreibung der Verlaufsereignisse und den Wunschtermin des Formulars (`formatWish`). `unread.test.mjs` prüft, wann eine Kundennachricht als ungelesen gilt (task-20-14). `admin.test.mjs` prüft die Verwaltungshilfen (Wochenformular, Zusammenfassung der Arbeitszeit, Abwesenheit als ganze Tage über die Zeitumstellung, Kontoprüfung, Dezimaleingabe, Firmenangaben). `kpi-dictionary.test.mjs` hält die Dokumentation synchron: jede Kennzahl der Übersicht mit Art (Ereignis/Momentaufnahme) und jedes Zeitreihenfeld steht im Kennzahlen-Wörterbuch, der n8n-Vertrag enthält alle Abläufe aus Abschnitt 8, und als „vorhanden“ bzw. „zu bauen“ markierte Funktionen entsprechen den Migrationen. `analytics.test.mjs` prüft Zeitraum-Parameter, Titel (inkl. Kalenderwochen am Jahreswechsel), Bereiche, Werte je Einheit, Änderungen (Prozent, Punkte, Null-Basis ohne Prozentwert, fachliche Richtung) und dass jede Kennzahl Definition und Listen-Link hat. `insights.test.mjs` prüft die Diagrammdaten (kumulierter Vergleich, Saisonalität ohne erfundene Nullen, Automatisierung je Monat, Warteschlangen in breiter Form, Farbreihenfolge). `invoice-pdf.test.mjs` prüft das Rechnungs-PDF über den Test-Hook `onText` (eingebettete Schriften kodieren Glyphen, der Text ist nicht direkt lesbar): Kennzeichnung und Rechnungsdaten, Folgeseiten mit Übertrag und Positionsbereich, byte-identische Ausgabe, kein PDF für Entwürfe, Zeichen außerhalb des Schrift-Subsets, Ergänzung der Anfragenummer bei älteren Snapshots. Ergebnis ist unabhängig von der Zeitzone des Rechners (geprüft mit `TZ=America/New_York`). `inbox-extract.test.mjs` prüft die regelbasierte Vorbelegung aus E-Mails (task-10-10): klassische Signatur, beschriftete Angaben mit Adresse in einer Zeile und Wunschtermin, Stillstand und Gefahrenhinweis, übersprungener zitierter Verlauf mit Name aus der Absenderadresse, leeres Ergebnis bei Werbung, Termin ohne Jahr und Sammeladresse. `request-sort.test.mjs` prüft die Sortierung der Anfragenliste (task-12-12): Standard nicht in der Adresse, Parameter und ungültige Werte, nicht erlaubte Spalte, Richtungswechsel beim Klick, Beschriftung. `send-backlog.test.mjs` prüft den Hinweistext bei hängendem E-Mail-Versand (task-12-9): kein Hinweis ohne wartende E-Mails, Einzahl/Mehrzahl, Wartezeit in Minuten, Stunden und Tagen, keine negative Wartezeit.

## UI-Prüfung (`npm run test:ui`)

Voraussetzung wie bei `test:auth` sowie Google Chrome (anderer Pfad über `CHROME_PATH`). Das Skript meldet die Demo-Rollen über das echte Login-Formular an und steuert Chrome über das DevTools-Protokoll:

- alle Dashboard-Bereiche je Rolle sowie Anfrageliste, eine Anfrageseite (Manager, Techniker) und die Warteschlangen-Tabs (Dispatcher) bei 390×844, 768×1024 und 1440×900: Seitenbreite nicht größer als das Fenster;
- Bereich „System“ (task-17-7 bis 17-10, 17-15): Zusammenfassung wie die Anzahl offener Warnungen, Abschnitte Datensicherung, Zustand der Systeme (alle acht Systeme in fester Reihenfolge mit Zustand wie in `system_status.monitoring`), Systemversionen (jede Zeile mit Link zu den Release Notes, kein Installieren), „System prüfen“ nur für Admin bei 390/768/1440: der Klick legt eine Anfrage an, der Dienst `online.rheinwerk.systemcheck` muss sie innerhalb von 90 Sekunden abarbeiten (sonst scheitert die Prüfung; vorher `npm run ops:install`), Guthaben, Systemversionen, Warnungen; Breite 1680 px; mit einer Testwarnung (vorab als gemailt markiert, damit der laufende Wächter keine E-Mail schickt, danach gelöscht): Hinweis oben auf der Übersicht für Manager bei 390/1440 mit Link, kein Hinweis für Dispatcher, Manager ohne „Erledigt“ bei 390/768/1440, Admin verschiebt sie mit „Erledigt“ nach „Behoben“. Gegen `next start` mit `APP_URL=http://localhost:…`, nicht `127.0.0.1` (der Passwort-Link leitet auf `localhost` um, das Sitzungs-Cookie fehlt dann).
- Formular unter `/dashboard/bausteine`: Validierungsfehler und simulierter Versionskonflikt behalten alle Eingaben, markieren die Felder und setzen den Fokus; erfolgreiches Speichern zeigt „Gespeichert · HH:MM“.

- Prüfaktionen (task-5-2) als temporärer Dispatcher auf eigener Testanfrage, jeweils gegen die Datenbank geprüft: Korrektur ohne Grund behält die Auswahl, Korrektur markiert den Analyse-Lauf; E-Mail vorbereiten erzeugt nur einen Entwurf; Entwurf bearbeiten und direkt danach in die Warteschlange stellen (zweite Aktion mit aktualisierter Version); `sent_at` bleibt leer und die Oberfläche zeigt „In Warteschlange, nicht versendet“; Freigabe setzt `processed`/`human_review` und die Planungs-Warteschlange; Versionskonflikt beim Ablehnen behält den Grund und ändert nichts; Ablehnung danach erfolgreich.

- Einsatzplanung (task-5-3) in einer zufälligen Woche ab 2030: Klick in die Zeile eines Technikers übernimmt Techniker, Datum und 09:00–11:00; Buchung landet mit korrekter UTC-Umrechnung in der Datenbank, erscheint im Kalender und verlässt „Zu planen“; überschneidende Buchung einer zweiten Anfrage wird mit verständlicher Meldung abgelehnt (Eingaben bleiben, kein Einsatz); Buchung außerhalb der Arbeitszeit abgelehnt; direkt anschließender Termin möglich. Ziehen (task-10-7) mit echten Mausereignissen in der Tagesansicht: Auswahl zu einem anderen Techniker auf 10:15 (Zeitanzeige während des Ziehens, Formular im 15-Minuten-Raster); Ziehen auf einen bestehenden Einsatz zeigt den Konflikt rot und legt ins nächste freie Fenster (11:00–13:00); Pfeiltaste verschiebt um 15 Minuten, der Fokus bleibt auf der Auswahl. Geplanten Einsatz verschieben (task-10-8): Einsatz ist ziehbar; Ziehen zu einem anderen Techniker auf 14:00 zeigt Zeit am Zeiger und die Bestätigung „Bisher → Neu“ mit vorbelegtem Grund, „Abbrechen“ lässt die Datenbank unverändert; 4× → verschiebt auf 12:00–13:00, gespeichert über `reschedule_visit` mit eigenem Grund im Verlauf, Tafel zeigt den neuen Zeitraum; parallel geänderte Anfrage ergibt eine verständliche Versionsmeldung ohne Änderung, erneutes „Verschieben“ danach hängt Einsatz und Anfrage zum anderen Techniker um (Standardgrund protokolliert).

- Einsatzaktionen (task-6-2) als temporärer Techniker, jeweils gegen die Datenbank: fremder Techniker erhält 404; Arbeit starten; 1,5 h Arbeitszeit nach Tarif; Teil bestellt mit 48,90 €, dann verbaut; JPEG-Foto landet im privaten Bucket mit Metadaten, ist nicht öffentlich abrufbar und über die App ladbar; PDF als Foto abgelehnt; auf Teile warten und fortsetzen; Beenden mit Folgeeinsatz ohne Grund scheitert (Bericht bleibt), mit Grund: Einsatz beendet, Anfrage nicht abgeschlossen und wieder in der Planung.

- Abschluss und Rechnung (task-6-3) auf derselben Anfrage als Techniker: „Anfrage abschließen“ ist mit dem Bericht des letzten Einsatzes vorbelegt; ohne Bericht abgelehnt; Abschluss durch den Techniker (Ereignis `work_completed` mit seiner ID, keine Managerfreigabe); PDF vor Rechnung und für den Entwurf 404, kein PDF-Link; Ausstellung vergibt `RE-JJJJ-NNNNN` mit Arbeitszeit und verbautem Teil; PDF-Download 200 `application/pdf`, `no-store`, Dateiname mit Nummer, Titel „Musterrechnung / Demodaten <Nummer>“; ohne Anmeldung 401, fremder Techniker 404; nach Erhöhung des Stundensatzes ist das PDF byte-identisch (Tarif wird danach zurückgesetzt).

- Manager-Übersicht (task-7-2) als Demo-Manager: 16 Kennzahlen mit Listen-Link, Kennzeichnung Ereignis/Momentaufnahme; für Eingänge, Erstbearbeitung, Abschlüsse, offene Anfragen, ausgestellte Beträge, Zahlungseingang, offene und überfällige Forderungen entspricht die Anzahl bzw. Bruttosumme der verlinkten Liste dem Kennzahlwert; Zeitraum-Pfeil zurück führt zum vollständigen Vormonat mit Weiter-Pfeil. Übersicht (Monat, Jahr) und Rechnungsliste ohne horizontales Scrollen in allen drei Breiten.

- Auswertung (task-7-3) als Demo-Manager: sieben Diagramme mit SVG-Markierungen und Datentabelle; Eingänge des laufenden Monats in der Tabelle entsprechen einer direkten Zählung in der Datenbank (Monatsbeginn Europe/Berlin); Hover über eine Säule der Zeitersparnis zeigt „N Anfragen × Basiswert 15 min“. Seite ohne horizontales Scrollen in allen drei Breiten.
- Auswertung, Zeitraum je Karte (task-15-6): Durchsatz ohne Zeitraumwahl im Seitenkopf, Zeitraum in „Eingänge … kumuliert“, Monatsdiagramm mit 24 Monaten; „12 Monate“ kürzt die Tabelle auf 12 Zeilen, Zeitraum-Links und Seitenmenü behalten `monate=12`; Automatisierung mit Zeitraum in „Läufe“ und zwei Monatsschaltern. Kompakte Schalter (task-15-7): Titel „Eingänge kumuliert“ und Zeitraumschalter (32 px) bei 1440 px in einer Zeile. Zeitraumwechsel ohne Neuaufbau (task-15-8): Übersicht („Vorheriger Zeitraum“) und Auswertung („Woche“ in „Eingänge kumuliert“) – ein MutationObserver bestätigt `aria-busy` während des Ladens, keine Ladeplatzhalter und durchgehend vorhandene Schalter. Mit `UI_SCREENSHOTS` Aufnahmen der Karten, der Übersicht und des Telefon-Kopfs bei 390/768/1440.
- Kunden mit SLA-Vertrag (task-16-3): Ansicht „Mit SLA-Vertrag“ zeigt genau die aktiven Kunden mit heute gültigem Vertrag (Abgleich mit `service_contracts`), jede Zeile mit Kennzeichen; ein abgelaufener Vertrag erscheint als „SLA abgelaufen“ und nicht in der Ansicht; Kundenseite K-10000 mit SLA-2021-801, „SLA 24/7“, Laufzeit und Standorten bei 390/768/1440 ohne Querscrollen. Unit-Test `service-contract.test.mjs`: Status ohne Standort, Kennzeichen, Laufzeittext.

- Demo-Anruf (task-13-8, task-13-11): Kontaktseite mit Hinweis statt Widget-Karte; Klick auf die Service-Desk-Nummer öffnet den Dialog (Demo/KI, Datenschutz-Link, Restminuten), Schließen; bei 390 px öffnet die Anruf-Schaltfläche der unteren Leiste denselben Dialog ohne horizontales Scrollen; bei verbrauchtem Tagesbudget „Einverstanden, anrufen“ gesperrt; `POST /api/mira` von fremder Herkunft 403, ohne Budget 429 ohne signierte Adresse.

- Anrufe (task-13-7) als temporärer Dispatcher auf eigenem Testanruf mit Testanfrage: Navigation, Ansicht „Rückruf offen“ mit Suche, Vorschlag führt zum Anruf, Anrufseite mit Zusammenfassung, Transkript (Werkzeugzeile), „im Gespräch angelegt“ und `tel:`-Link; „Rückruf erledigt“ gegen die Datenbank, danach „Zurückgerufen“; Anfrage mit Quelle „Telefon (KI)“ und Block Telefonat; 390 px ohne Scrollen; Techniker ohne Bereich und mit 403 bei Vorschlägen. Auswertung „Telefon“ als Demo-Manager: 8 Kennzahlen, Anrufe des Monats gleich Datenbank.

- Posteingang (task-10-5) als temporärer Dispatcher: unzugeordnete Test-E-Mail erscheint in der Liste, Zähler in der Navigation; geöffnete E-Mail zeigt den Text, das Formular „Neue Anfrage“ ist mit dem Absender vorbelegt und die Anfrage derselben Adresse wird vorgeschlagen, leerer Eintrag „Anfrage wählen …“ zuerst; E-Mail nur mit gleicher Domain: Treffer gekennzeichnet, nichts vorausgewählt, Hinweis bei fehlender Anfrage (task-12-2); Antworten (task-12-3): Vorlage mit „AW: …“, „Senden“ stellt die Antwort in die Warteschlange, Hinweis und Antwort im Verlauf, Liste „Antwort wird gesendet“, Kundenantwort erscheint in derselben Unterhaltung mit „Neue Antwort“, ohne eigenen Eintrag (Testantworten werden danach gelöscht, nie versendet); Zuordnen setzt `request_id` über `link_message` mit Ereignis des Dispatchers; die E-Mail steht danach unter Korrespondenz der Anfrage und unter „Zuletzt zugeordnet“, nicht mehr unter „Offen“. Vorbelegung und Archiv (task-10-10): Suche mit Absender vorbelegt; zweite Test-E-Mail mit Signatur füllt Firma, Name, Straße, PLZ/Ort, Telefon, Anlagenart, Leistung, Produktionsstillstand, Hersteller und Typ vor, erkannte Felder markiert; Archivieren mit Grund über `archive_message` (Person, Zeit, aus „Offen“ verschwunden, „Rückgängig“ angeboten), im Archiv sichtbar, Wiederherstellen öffnet sie wieder unter „Offen“. Bei Abbruch ordnet das Skript die Test-E-Mails selbst zu, damit sie nicht in fremden Posteingängen bleibt.

- Telefonische Anfrage (task-11-4, task-15-4) als temporärer Dispatcher: Link aus der Erstbearbeitung, Formular ohne Dispatcher-Auswahl, ungültige PLZ mit Fehlermeldung und erhaltenen Eingaben, Anlage mit Quelle Telefon, RIS-Nummer, ohne Eingangsbestätigung und Weiterleitung. Bestandskunde bei 390/768/1440 px: Feld Kundennummer als erstes Feld, Vorschläge je Standort beim Tippen einer Demo-Kundennummer, Auswahl füllt Firma und Anschrift, Hinweis „Bestandskunde“, kein horizontales Scrollen; „Verknüpfung lösen“ leert Nummer und Verknüpfung; angelegte Anfrage in der Datenbank mit Kunde, Standort und Kundennummer verknüpft. Screenshots `telefon-bestandskunde-<Breite>.png`.

- Kundenstamm aus Anfragen (task-14-2, task-14-4) als temporärer Dispatcher: Kennzeichen „Kunde prüfen“ in Anfragenliste und Erstbearbeitung; Karte „Möglicher Bestandskunde“ bei 390/768/1440 px, „Zuordnen“ verknüpft, „Neuen Kunden anlegen“ legt einen Demo-Kunden an (Herkunft „Automatisch aus RIS-…“ mit Link); „Kunde anlegen“ mit Erklärtext, Herkunft in Liste und Kundenseite („Manuell angelegt“), Warnung „Ähnlicher Kunde vorhanden“ bei 390/768/1440 px ohne Anlage, Anlage erst mit „Trotzdem als neuen Kunden anlegen“. Ausschnitte `kundenvorschlag-*.png`, `kunde-dublette-*.png` bei gesetztem `UI_SCREENSHOTS`.

- Verwaltung (task-8-1) als Demo-Admin, jeweils gegen Datenbank bzw. Supabase Auth: Techniker und Dispatcher über das Formular angelegt (Profil ohne Passwortfeld, Anmeldung möglich); doppelte Adresse und zu kurzes Passwort abgewiesen; Wochenarbeitszeit mit Ende vor Beginn abgewiesen, Mo–Fr gespeichert und in der Übersicht zusammengefasst; Dispatcher mit offener Anfrage: Zuweisung angezeigt, Deaktivieren ohne Vertretung abgewiesen, mit Vertretung Anfrage übertragen, Profil inaktiv, Anmeldung gesperrt; Reaktivierung gibt sie frei; Tarif mit Komma-Preis angelegt, geändert und deaktiviert; Basiswert 0 abgewiesen, Änderung mit Autor gespeichert und wieder zurückgesetzt; Testkonten am Ende ohne Vertretung deaktiviert. Alle Verwaltungsseiten, auch die Personenseite eines Technikers, ohne horizontales Scrollen.

Plantafel (task-20-18): geschlossene Legende/Bedienung, bedarfsweises Aufklappen, fünf Datumsschaltflächen, Enter öffnet exakt Dienstag ohne Dokument-Neuladen, Rückkehr zur Arbeitswoche und Erhalt der ungespeicherten Techniker-/Datums-/Zeitauswahl beim Datumsklick. Responsive-Prüfung bei 390/768/1440 px. Mit `PLAN_BOARD_SCREENSHOTS=<Ordner>` nur drei gezielte Plantafel-Aufnahmen statt aller Seiten speichern.

Mit `UI_SCREENSHOTS=<Ordner>` wird je Seite und Breite ein Screenshot gespeichert, zusätzlich Aktionen und Rechnungsabschnitt (390, 1440) sowie das erzeugte PDF.

`test:ui` und `test:api` legen Testanfragen mit `is_demo = true` an (Ausnahme: die Prüfung des hängenden E-Mail-Versands, task-12-9, braucht eine echte Anfrage; sie legt Bestätigung und Versandsperre per `docker exec … psql` in einer Anweisung an, damit das laufende n8n nicht sendet, und löscht danach alles wieder – Container über `SUPABASE_DB_CONTAINER`, Standard `supabase_db_A.Sadkovojs_Project`; außerdem die telefonische Anfrage, task-11-4 und task-15-4: `create_phone_request` legt immer Live-Anfragen an, der Test storniert sie sofort mit `cancel_request`, damit n8n sie nicht weiter bearbeitet); `npm run demo:seed` entfernt sie samt Einsatzfotos wieder und löscht die Testkonten (`api-…`, `ui-…`, `e2e-…@example.com`). Beide Skripte deaktivieren ihre Konten am Ende selbst und sperren den Login, damit sie nicht als aktives Personal in Planung, Vertretungsauswahl oder Team-Auswertung erscheinen. `demo:verify` prüft, dass kein Testkonto aktiv ist und genau das Demo-Personal (1 Admin, 1 Manager, 3 Dispatcher, 3 Techniker) aktiv ist.

## Szenarien der Spezifikation (Abschnitt 10)

| Szenario | Abgedeckt durch |
| --- | --- |
| 1 Berechtigungen | `rls.test.sql`, `scenarios.test.sql`, `test:api` |
| 2 Planung, Konflikte, Nebenläufigkeit | `visit_operations.test.sql`, `scenarios.test.sql`, `test:api` |
| 3 Warten auf Teile, Folgeeinsatz, Abschluss | `scenarios.test.sql`, `work_operations.test.sql` |
| 4 Abrechnung, Wartung, Tarifänderung, Warteschlange, Versand nach Zahlung | `invoice_message_operations.test.sql`, `scenarios.test.sql` |
| 5 Automatisierungskennzahlen, 100 × 15 Minuten | `savings_fixture.test.sql` (Formel), `analytics.test.sql` (Zeitersparnis nur für korrekte automatische Erstbearbeitung, Detail mit Anzahl und Basiswert) |
| 6 Periodenvergleiche, Nullbasis | `analytics.test.sql` (unvollständige Monate, kürzerer Februar, Woche, Quartal, Nullbasis ohne Prozentwert) |
| 7 Historie aus Ereignissen, Fristen, Wiedereröffnung, Stornierung | `intake_operations.test.sql`, `scenarios.test.sql` |
| 8 Responsive-Prüfung | `test:ui` (alle Bereiche je Rolle bei 390/768/1440 px), Sichtprüfung je Rolle in der Gesamtprüfung (unten) |

## Gesamtprobe des Deployments 22.10.2026 (task-18-9)

Gegen die Produktion: VPS (`ssh vps`, Supabase, n8n, Tunnel, systemd-Dienste), Vercel (`rheinwerk-service.online`), GitHub Actions. Anforderungen aus dem Dashboard („Jetzt sichern“, „Update einspielen“, „Wiederherstellen“) mit denselben Datenbankfunktionen als Admin Clara Becker gestellt; ausgeführt hat sie der Dienst `rheinwerk-systemcheck`.

| Probe | Ablauf | Ergebnis |
| --- | --- | --- |
| 1 Push mit Migration bis Vercel | Migration `20261022210000_backups_comment` (Kommentar der Tabelle `backups`) gepusht | 16:48:43 Push → 16:50:28 Prüfungen grün → Sicherung vor der Migration (Zeile „Vor Migration“, `…-d72cbb6.dump`), Migration eingespielt → 16:53:18 Vercel „Ready“, Website 200; gesamt 4,5 Minuten |
| 2 Rückfall über Vercel | `vercel rollback` auf das vorige Production-Deployment, danach `vercel promote` des aktuellen | je 3 Sekunden, Domain zeigt auf das gewählte Deployment, Website und `/api/assistant` antworten; `promote` schaltet die automatische Zuweisung der Domain für die nächsten Deployments wieder ein |
| 3 Systemupdate mit Rückfall | n8n 2.44.4 → 2.44.6 in `docker-compose.yml` gepusht („Update bereit: 1“); erst mit `update-fail-selftest`, dann ohne | Probe: Rückfall in 140 s, n8n wieder 2.44.4 und gepinnt, `update:failed`; Update: 70 s, n8n 2.44.6, Pin entfernt, Warnung automatisch geschlossen |
| 4 Wiederherstellung | „Jetzt sichern“ (geprüft, 88 Kunden) → Testkunde `K-99189` (89) → „Wiederherstellen“ dieser Sicherung | 58 s, 88 Kunden, Testkunde weg, Sicherung „Vor Wiederherstellung“ in der Liste, Rollenrechte unverändert (`authenticated` ändert keine Profile, `anon` liest keine Anfragen), Liste der Wiederherstellungen erhalten |
| 5 Ausfall von n8n | `docker stop rheinwerk-n8n` 17:09:38; `docker start` 17:13:49 | 17:13:33 `n8n:down`, `mira:webhook`, `system:container` kritisch, E-Mail 17:13:34; nach dem Start alle drei um 17:18:34 automatisch behoben (3 Minuten Anlaufzeit plus Takt des Wächters) |

Dabei gefunden: Die erste Wiederherstellung lief mit einem Testkunden ohne gültige Kundennummer (Format `K-` und Ziffern), der Testkunde wurde nicht angelegt und die Probe zeigte nichts; mit `K-99189` wiederholt. Die Warnung `n8n:fehler:rwCallAnalysis26` (16:46, „The connection was aborted“ beim Abruf der Gespräche aus ElevenLabs) entstand vor den Proben und gehört nicht dazu; sie schließt sich nach einer Stunde ohne Fehler.

Am selben Tag in task-18-6 bis 18-10 außerdem: Wiederherstellung und Rückkehr auf einer Kopie (`docs/betrieb.md` 4.5), Systemupdates von envoy, Postgres, n8n, PostgREST und Storage (`docs/betrieb.md` 6), Website-Assistent mit Vergleich zu Oracle (`docs/n8n-workflows.md` 9). Lokal: `test:db` 1193 Tests in 53 Dateien, `test:api`, `test:unit` 146, `test:ui`, `lint`, `typecheck`, `build` bestanden.

## Gesamtprobe der Überwachung 21.10.2026 (task-17-11)

Auf dem Rechner gegen die laufenden Dienste (Supabase, n8n, Cloudflare-Tunnel, `next dev`, Wächter und Prüfdienst aus `npm run ops:install`). Jede Probe: Störung herbeiführen, Wächter oder „System prüfen“, Warnung, E-Mail und Bereich „System“ (1440 und 390 px) prüfen, Störung beheben, automatische Behebung prüfen. E-Mails an `ALERT_EMAILS`: in der Datenbank als versendet markiert (`notified_at`), keine Zeile „Warn-E-Mail nicht gesendet“ in den Protokollen; den Eingang bestätigt der Empfänger.

| Probe | Ablauf | Ergebnis |
| --- | --- | --- |
| 1 n8n fällt aus | `docker stop n8n`, `npm run watchdog`; `docker start n8n`, Wächter | `n8n:down`, `mira:webhook` (Werkzeuge laufen über n8n) und `system:container` kritisch mit E-Mail, Hinweis „4 Warnungen im System“ oben, Zeilen n8n, Mira und Docker „Gestört“; nach dem Start alle drei automatisch behoben (47 s Ausfall) |
| 2 Störung von Mira | `AGENT_WEBHOOK_SECRET=falsch… npm run watchdog` (nur für diesen Lauf, `.env.local` und ElevenLabs unverändert); danach normaler Lauf | `mira:webhook` kritisch mit E-Mail und Hinweis „n8n lehnt das Werkzeug-Secret ab“, Zeile „Telefonassistent (Mira)“ „Gestört“; nächster Lauf behebt sie |
| 3 nächtliche Sicherung scheitert | `SUPABASE_DB_CONTAINER=gibt-es-nicht npm run nightly`; danach `npm run nightly` | `backup:failed` kritisch mit E-Mail, Hinweis „Tägliche Sicherung fehlgeschlagen“ (Quelle Datensicherung); der normale Lauf erstellt die Sicherung (97 MB, 12 s), „Sicherung ist wiederherstellbar“ und behebt die Warnung |
| 4 Container fällt aus | `docker stop supabase_storage_…`, Admin klickt „System prüfen“; `docker start`, erneut „System prüfen“ | Knopf „Prüfung angefordert …“, nach 20 s fertig; `system:container` „Container supabase_storage_… gestört“ kritisch mit E-Mail, Zeile Docker „Gestört“; nach dem Start automatisch behoben |

Gefunden und behoben:

- Direkt nach einem Start von n8n antwortet `/healthz` schon, die API (HTTP 404) und die Webhooks aber noch nicht. Der Wächter meldete dann fälschlich „Wächter ohne Zugriff auf die n8n-API“ (mit dem irreführenden Hinweis, der Schlüssel werde abgelehnt) und „Werkzeuge nicht erreichbar“. Jetzt werden beide Prüfungen in den ersten 3 Minuten nach dem Containerstart übersprungen (`STARTUP_MINUTES` in `scripts/ops/n8n.mjs`, offene Warnungen bleiben dabei bestehen); „Schlüssel abgelehnt“ nur noch bei HTTP 401/403. Nachprobe mit `docker restart n8n`: keine Fehlwarnung.

Weitere Prüfungen am selben Stand: `lint`, `typecheck`, `build`, `test:unit` 127/127, `test:db` 1133 Tests in 49 Dateien, `test:api` alle bestanden, `test:ui` alle bestanden.

## Gesamtprüfung 13.10.2026 (task-9-2)

Stand: Commit `e8a6133` plus Migration `20261013120000_fix_mark_message_failed.sql`. Lokaler Supabase-Stack, Demodaten frisch geseedet, Dev-Server auf Port 3201, Produktionsserver (`next start`) auf Port 3202.

| Prüfung | Ergebnis |
| --- | --- |
| `npm run lint`, `npm run typecheck` | ohne Befund |
| `npm run build` | erfolgreich |
| `npm run test:unit` | 61/61 |
| `npm run test:db` | 568/568 in 17 Dateien |
| `supabase db lint` | keine Fehler; Warnungen zu den `lock_*`-Hilfsfunktionen (zusammengesetzte OUT-Variablen) und unbenutzten Variablen in `claim_queued_messages` und `record_incoming_message` |
| `npm run test:api` | alle Prüfungen bestanden (Rechte, gefälschte Schreibzugriffe, 10 gleichzeitige Buchungen, Buchung gegen Abwesenheit) |
| `npm run test:auth` gegen `next start` | 130 Prüfungen bestanden |
| `npm run test:ui` | 199 Prüfungen bestanden |
| `npm run demo:seed` + `npm run demo:verify` | 18/18 „ok“ |
| `npm run supabase:check` | Auth HTTP 200, Admin-API OK |

Gefunden und behoben:

- `supabase db lint` meldete in `mark_message_failed` eine mehrdeutige Spaltenreferenz (`message_id` als Parameter und als Spalte von `automation_runs`). Der Fehler trat erst zur Laufzeit auf, also bei jedem von n8n gemeldeten fehlgeschlagenen Gmail-Versand. Behoben mit Migration `20261013120000_fix_mark_message_failed.sql`; neuer pgTAP-Test in `payment_reminders.test.sql` führt den Zweig aus (Nachricht wieder `queued`, Versandlauf `failed` mit `GMAIL_SEND_FAILED`).
- `test:auth` prüfte noch Markup aus der Zeit vor der Design-Überarbeitung (Zählzeile, Plantafel, Technikerkalender, Abschnitte der Technikeransicht); auf die neuen Anker umgestellt, Prüfinhalt unverändert.

Hinweis zur Reihenfolge: `demo:verify` direkt nach `test:api` oder `test:ui` meldet deren Testanfragen (Basiswert 5 Minuten) als Abweichung vom Demo-Basiswert. Erst `demo:seed`, dann `demo:verify`.

### Szenarien der Spezifikation

| Szenario | Ergebnis 13.10.2026 |
| --- | --- |
| 1 Berechtigungen | bestanden: `rls.test.sql`, `scenarios.test.sql`, `test:api`, dazu Rollen- und Datensichtbarkeit über HTTP in `test:auth` |
| 2 Planung, Konflikte, Nebenläufigkeit | bestanden: `visit_operations.test.sql`, `scenarios.test.sql`, `test:api` (genau 1 von 10 gleichzeitigen Buchungen, nie Buchung und Abwesenheit zugleich), Planung über die Oberfläche in `test:ui` |
| 3 Warten auf Teile, Folgeeinsatz, Abschluss | bestanden: `scenarios.test.sql`, `work_operations.test.sql`, Einsatzaktionen und Abschluss in `test:ui` |
| 4 Abrechnung, Wartung, Tarifänderung, Warteschlange, Versand nach Zahlung | bestanden: `invoice_message_operations.test.sql`, `scenarios.test.sql`, `payment_reminders.test.sql`, Rechnung und PDF in `test:ui` |
| 5 Automatisierungskennzahlen, 100 × 15 Minuten | bestanden: `savings_fixture.test.sql`, `analytics.test.sql`, Tooltip „N Anfragen × Basiswert 15 min“ in `test:ui` |
| 6 Periodenvergleiche, Nullbasis | bestanden: `analytics.test.sql`, `test:unit` (`analytics.test.mjs`), Zeitraumwechsel der Übersicht in `test:ui` |
| 7 Historie aus Ereignissen, Fristen, Wiedereröffnung, Stornierung | bestanden: `intake_operations.test.sql`, `scenarios.test.sql` |
| 8 Responsive-Prüfung | bestanden: `test:ui` und Sichtprüfung je Rolle (unten) |

### Sichtprüfung je Rolle (Szenario 8)

Im Browser mit den Demo-Konten angemeldet, je Seite bei 390×844, 768×1024 und 1440×900 geprüft: Seitenbreite nicht größer als das Fenster und kein sichtbares Element außerhalb des Fensters (außer in eigenen Scrollbereichen wie der Navigationsleiste oder Tabellen). Zusätzlich Screenshots der Hauptseiten bei 390 px.

| Rolle | Seiten | Ergebnis |
| --- | --- | --- |
| Anmeldung | `/login` | in Ordnung |
| Techniker | Mein Tag, Kalender, Anfragen, Anfrageseite, Einsatzseite | 15/15 ohne Befund |
| Dispatcher | Erstbearbeitung (Prüfung, Planung), Anfragen (Offen, Sicherheitsgefahr), Einsatzplanung (Woche, Tag), Anfrageseite | 21/21 ohne Befund |
| Manager | Übersicht (Monat, Jahr), Auswertung (4 Bereiche), Rechnungen (Zu erledigen, Überfällig), Einsatzplanung, Anfragen (Alle), Anfrageseite | 33/33 ohne Befund |
| Admin | Verwaltung (Mitarbeitende aktiv/alle, Arbeitszeiten, Tarife, Einstellungen, Personenseite), Übersicht, Anfragen, UI-Bausteine | 27/27 ohne Befund |

Bekannte Grenze: Auf 768 px scrollt die Rechnungstabelle innerhalb ihrer Karte seitlich; die Seite selbst nicht.

### Nicht geprüft

- Echte Geräte: geprüft wurde in Chrome mit emulierten Fenstergrößen, nicht auf physischen Tablets oder Smartphones; andere Browser (Safari, Firefox) nicht geprüft.
- Barrierefreiheit über die Tastatur- und Fokusprüfung der Formulare in `test:ui` hinaus (Screenreader, automatischer Kontrast-Audit) nicht geprüft.
- n8n, Gmail und OpenAI in diesem Lauf nicht erneut ausgeführt; letzter echter Nachweis 12.10.2026 (siehe [n8n-contract.md](n8n-contract.md)). Die Korrektur von `mark_message_failed` ist in der Datenbank getestet, nicht mit einem echten fehlgeschlagenen Gmail-Versand.
- Website-Formular mit Vercel Blob und Turnstile in einer öffentlichen Umgebung; Supabase-Cloudprojekt und Deployment (alles lokal).


## Globale Dashboard-Aktualisierungen (task-20-17)

`APP_URL=http://localhost:3117 npm run test:notifications` läuft ausschließlich mit lokaler App und lokalem Supabase. Der Test startet Headless Chrome, erstellt eigene Mitarbeiter und Daten und entfernt seine Fixtures abschließend, ohne Datenbank-Reset. Ein Dispatcher bleibt im anderen Bereich; ein separat authentifizierter Manager archiviert E-Mails, markiert Nachrichten gelesen und erledigt Rückrufe/Terminwünsche über die bestehenden RPCs. Eingangsereignisse werden als lokale Fixtures erzeugt, Terminantworten über die n8n-Integrations-RPC. Es werden keine echten E-Mails/Anrufe versendet.

Geprüft werden der echte 20-Sekunden-Takt, getrennte Neu-/Antwortmarken, Formular/Email/Mira, wiederholte Antworten bei gleicher Anzahl ungelesener Anfragen, stille Erstöffnung, Deduplizierung, Offline/Online, automatische Aktualisierung sauberer Bereiche, geschützte Text-/Plantafeleingaben, explizite Aktualisierung, Terminwünsche/Storno, Rückrufe, Versandfehler, direkte RLS- und HTTP-Rollengrenzen sowie Seitenbreiten 390/768/1440. Screenshots liegen unter `UI_SCREENSHOTS` oder in einem eigenen `/tmp/rw-notifications-…`-Ordner. Die Unit-Tests in `dashboard-notifications.test.mjs` prüfen Identitäten unabhängig von Zählern und Links je Rückrufart/Rolle.

Lokale Abnahme am 23.10.2026 gegen `next start` auf 3117: `lint`, `typecheck`, `build`, 158 Unit-Tests, alle API-, 145 auth-, 460 UI- und 49 Benachrichtigungsprüfungen bestanden; `git diff --check` ohne Befund. Der separate Fehlerprozess im Notification-Test unterbricht nur dessen Profil-Fetch (kein Stop/Ändern von Supabase), prüft HTTP 503 und erhaltene Indikatoren und startet denselben Port anschließend ohne Fehler wieder: dieselbe Sitzung/dasselbe offene Dokument empfängt neue Ereignisse ohne Login/Reload. Die eigenen Prüfprozesse wurden beendet. Screenshots `/tmp/rw-notifications-mvl10a01`, zusätzlich Link/Schließen/Aktualisieren bei 390/768/1440 visuell geprüft.

Befunde der Gesamtprüfung: HTTP 414 im bestehenden Team-Block durch 254 UUIDs in einem GET-Filter, behoben durch Pakete zu 100. Bestehende UI-Tests setzen keinen leeren Versandstau mehr voraus und warten bei Entwurf/Plantafel nach einem Speichern oder Versionskonflikt auf die aktuelle Formularversion statt 500 ms. Nach strikter Verfügbarkeitsprüfung wurden build/lint/typecheck/unit und sämtliche 49 Notification-Szenarien erneut ausgeführt. Kein echter Gmail-/Mira-/Formular-End-to-End-Lauf, keine echten Geräte/Safari/Firefox/OS-Notifications und kein Deployment. Standard-API-/UI-Demodaten bleiben entsprechend dem bisherigen Testverfahren lokal erhalten; die Notification-Fixtures werden vollständig entfernt.
