# Aktueller Projektstand

Kurzfassung für den Einstieg. Übersicht über Phasen und Tasks: `npm run workshop:status`; ältere Abschlüsse mit Prüfergebnissen im `verification`-Objekt der Roadmap (`npm run workshop:status -- <task-id>`) und in `activity.jsonl`; dauerhafte Entscheidungen in `docs/decisions.md`; welche Dokumentation was enthält: Dokumentenkarte in `README.md`.

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website (Next.js 16; Supabase und n8n seit 22.10.2026 auf dem VPS `ssh vps`, lokal nur Entwicklungsumgebung), dazu n8n/OpenAI/Gmail-Integration und der KI-Telefonassistent „Mira“ (ElevenLabs). Portfolio-Projekt mit Demodaten. Roadmap v25, 21 Phasen, 121 Tasks, Fortschritt 99,3 % (Gewicht 284 von 286).

Repository: `github.com/FuzzCube/RhenWerk-WebSite` (`origin`), Commits auf `main`, Push nur auf Wunsch des Nutzers (Stand mit `git status` prüfen).

## Aktive Phase und Aufgabe

**Phase 17 „Updates und Überwachung“ abgeschlossen** (21.10.2026, Gesamtprobe `task-17-11`, Ergebnis in `docs/testing.md`). Nutzerentscheidungen 21.10.2026 (`docs/decisions.md`): Bereich „System“ für den Inhaber ohne Code-Updates, Versionen nur angezeigt; bis Projektende läuft alles aus dem Entwicklungsordner. Dienste aus dem Entwicklungsordner (`npm run ops:install`, Protokolle `~/Library/Logs/RheinWerk/`): `online.rheinwerk.backup` (09:00, weil der Rechner nachts schläft; Sicherung mit Prüfung, Versionen), `online.rheinwerk.watchdog` (alle 5 Minuten: Mira, n8n über die n8n-API mit `N8N_API_KEY`, Website, Datenbank, Tunnel, Docker, Speicherplatz, SMTP stündlich; 3 Minuten Anlaufzeit nach einem Start von n8n) und `online.rheinwerk.systemcheck` (alle 20 Sekunden, „System prüfen“). node und zsh haben Festplattenvollzugriff. Nächste Phase: **Phase 18 „Deployment“** (Roadmap v22): Website auf Vercel, Supabase und n8n per Docker Compose auf einem VPS, GitHub Actions und Renovate; Sicherung im Dashboard, Datenwiederherstellung und Systemupdates mit Rückfall dort (`task-18-6` bis `18-8`, ersetzen `task-17-13`, `17-14`, `17-16`). E-Mails nur an `ALERT_EMAILS` in `.env.local`.

Phasen 0–17 abgeschlossen (zuletzt Phase 17 „Updates und Überwachung“, davor Phase 16 „Datenschutz und Telefonassistent“, Phase 15 „Kundennummer sichtbar“, Phase 14 „Kundenstamm aus Anfragen“); Einzelheiten im `verification`-Objekt der Roadmap und in `docs/decisions.md`.

Achtung Betrieb: Nie mit Werkzeugen des Rechners auf die laufende n8n-Datenbank (`~/n8n/data/database.sqlite`) zugreifen – am 20.10.2026 hing n8n dadurch zwei Stunden (Details `docs/betrieb.md`). Lesen nur über `docker cp` einer Kopie.

Roadmap v23 (22.10.2026): zusätzlich Umzug vom Oracle-Server (`ssh oracle-n8n`): RAG-Assistent der Website in RheinWerk (`task-18-10`), House Items Bot (`task-18-11`) und Personal Copilot (`task-18-12`) als eigene Projekte auf dem VPS, danach Oracle und die alte Vercel-Website abschalten (`task-18-13`). Bestand Oracle: drei Supabase-Stacks (je 11–13 MB), n8n 2.37.10 mit 3 Workflows, Caddy mit sslip.io und offenen Ports 80/443.

## Phase 19 „Feinschliff vor der Präsentation“ (Roadmap v24, 22.10.2026, abgeschlossen)

Nutzerrundgang vor der Präsentation, fünf Blöcke: `task-19-1` Oberfläche (erledigt), `task-19-2` Einsatzplanung für Admin und Knopf aus der Anfrage (erledigt), `task-19-3` Wunschtermin aus dem Formular vormerken und Terminbestätigung (erledigt), `task-19-4` Plantafel rastet animiert auf Viertelstunden ein (erledigt), `task-19-5` Kosten von OpenAI im Bereich System (erledigt; Costs-API mit Admin-Key; Restguthaben nur aus eingetragenem Guthaben, OpenAI hat keine Guthaben-API).

## Phase 20 „Rückmeldungen nach dem Rundgang“ (Roadmap v25, 22.10.2026)

`task-20-1` Formular (erledigt), `task-20-2` Anfrage → Einsatzplanung mit Vormerkung als Auswahl (erledigt), `task-20-3` Plantafel: Farben nach Zeit, Länge per Griffen ändern, Doppelklick öffnet die Anfrage.

## Zuletzt abgeschlossen

- `task-20-2` (22.10.2026): **Vormerkung in der Einsatzplanung**: „Zur Einsatzplanung“ öffnet die Plantafel mit der Vormerkung als Auswahl, Planung schließt sie (Migration `20261022235000_plan_takes_hold.sql`), Anfrage ohne „Termin bestätigen“, „Terminwunsch ablehnen“ bleibt.
- `task-20-1` (22.10.2026): **Formular**: Pfeile der Auswahllisten mit Abstand, Uhrzeit 07:00–14:00 im 30-Minuten-Raster mit Hinweis, Dateien per Drag and Drop.
- `task-18-13` (22.10.2026): **Oracle-Server still**: letzte Sicherung verschlüsselt auf dem VPS (`/opt/rheinwerk/backups/oracle-final/`), alle Container gestoppt ohne Neustart, altes Repository archiviert; alte Vercel-Adresse zeigt die neue Website (`docs/betrieb.md` 3.9).

## Wo was dokumentiert ist (Telefonassistent)

Einrichtung und Betrieb `docs/telefonassistent/setup.md`; Regeln, Werkzeugverträge, Weiterleitung, Gesprächsauswertung `docs/telefonassistent/regeln.md`; Speicherung und Löschfristen `docs/telefonassistent/datenschutz.md`; Systemprompt, Leitfaden, Wissensbasis, Testdaten und Testprotokoll im selben Ordner; Tabellen und Funktionen `docs/database.md`; Dashboard „Anrufe“ `docs/architecture.md`. Der ursprüngliche Plan `docs/telefonassistent-plan.md` ist historisch.

## Arbeitsregeln (Kurzfassung, Details in `docs/decisions.md`)

- Schema nur als Migration unter `supabase/migrations/`; geänderte Funktionen bereits angewandter Migrationen per `psql` einspielen, nie `supabase db reset` (löscht lokale Daten). Nach Schemaänderungen `npm run db:types`.
- RLS nur lesend; Schreiben über `security definer`-RPCs mit `expected_version` (Fehlercodes `42501`, `RW409`, `RW422`). Agent und n8n nur über eigene Funktionen mit `service_role`.
- Zugriffsschutz in jeder Dashboard-Seite (`lib/auth/session.ts`, Rollen in `lib/auth/roles.ts`) und über RLS; `proxy.ts` erneuert nur die Sitzung.
- UI-Bausteine `components/dashboard/ui/`, Formatierung `lib/format.ts`, Status `lib/status.ts`, Diagrammfarben `lib/chart-colors.ts`, Designtokens unter `_ds/`. Nur helle Darstellung. Technikerseiten zuerst bei 390/768 px prüfen.
- Sprachmodell rechnet weder E-Mail-Adressen noch Kalender: beides bestimmt die Datenbank. Fakten der Gesprächsauswertung kommen aus der Datenbank, nicht vom Modell.
- Ausgehende E-Mails brauchen Freigabe; Ausnahmen mit Systemfreigabe: Eingangsbestätigung und Zahlungserinnerungen.
- Tests: `test:db`, `test:unit`, `test:auth`, `test:ui`, `test:api`, `test:agent`, `test:calls`, `agent:simulate`, `demo:verify`, dazu `lint`, `typecheck`, `build` (`docs/testing.md`). Nicht ausgeführte Tests nie als bestanden melden.

## Bekannte Probleme

- Mit `test:api`/`test:ui` nur gegen das lokale Supabase arbeiten: `.env.local` zeigt weiterhin auf den lokalen Stack, die Produktivdaten liegen auf dem VPS.
- `test:api` und `test:ui` legen Testnutzer und Testanfragen an; `npm run demo:seed` räumt die Anfragen ab (danach meldet `demo:verify` keine Chronologie-Abweichungen mehr). Testnutzer bleiben bis zu einem Reset in Namenslisten.
- `test:ui` wählt für die Einsatzplanung eine zufällige Woche ab 2030; trifft sie eine Woche mit Buchungen früherer Läufe, scheitern die Plantafel-Prüfungen – Lauf wiederholen.
- `test:auth`: 6 Cache-Control-Prüfungen schlagen unter `next dev` fehl; gegen `next start` bestanden. `test:ui` gegen `next start` mit `APP_URL=http://localhost:…`, nicht `127.0.0.1` (Passwort-Reset leitet auf `localhost` um, Cookie fehlt).
- Nach `npm install` liefert ein laufendes `next dev` teils HTTP 500 („module factory is not available“); `next dev` neu starten (läuft im Terminal des Nutzers).
- `next dev` liefert Client-Skripte nur an `localhost`; über die LAN-Adresse funktioniert nichts Interaktives (`allowedDevOrigins` in `next.config.ts` ergänzen).
- Port 3000 kann belegt sein: `PORT=3100 npm run start` (`-p` wird nicht angenommen) und `APP_URL=http://localhost:3100` (nicht `127.0.0.1`, sonst gehen Sitzungs-Cookies verloren).
- Lokale Entwicklung braucht Docker und `supabase start`; `.env.local` aus `supabase status` (`docs/setup.md`).
- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern von `private.lock_*` (ohne Auswirkung).

## Empfohlener nächster Schritt

Phase 20: `task-20-3`. Phasen 18 und 19 abgeschlossen und deployt; OpenAI-Admin-Key auf dem VPS eintragen; Oracle-Instanz in der Oracle Cloud löschen, wenn nichts mehr gebraucht wird. Alle Tasks der Roadmap v24 erledigt. Weitere mögliche Tasks nur nach Rücksprache: Pflege der SLA-Verträge im Dashboard, eigene Rechnungsanschrift je Kunde, SMTP für echte Passwort-Mails, KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.
