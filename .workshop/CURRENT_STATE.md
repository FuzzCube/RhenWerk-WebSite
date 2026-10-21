# Aktueller Projektstand

Kurzfassung für den Einstieg. Übersicht über Phasen und Tasks: `npm run workshop:status`; ältere Abschlüsse mit Prüfergebnissen im `verification`-Objekt der Roadmap (`npm run workshop:status -- <task-id>`) und in `activity.jsonl`; dauerhafte Entscheidungen in `docs/decisions.md`; welche Dokumentation was enthält: Dokumentenkarte in `README.md`.

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website (Next.js 16, lokales Supabase), dazu lokale n8n/OpenAI/Gmail-Integration und der KI-Telefonassistent „Mira“ (ElevenLabs). Portfolio-Projekt mit Demodaten. Roadmap v20, 18 Phasen, 102 Tasks, Fortschritt 92,03 % (Gewicht 231 von 251).

Repository: `github.com/FuzzCube/RhenWerk-WebSite` (`origin`), Commits auf `main`, Push nur auf Wunsch des Nutzers (Stand mit `git status` prüfen).

## Aktive Phase und Aufgabe

**Phase 17 „Updates und Überwachung“** (Roadmap v18, Nutzerentscheidung 21.10.2026), `task-17-1` bis `task-17-7` und `task-17-12` abgeschlossen. Inhalt: tägliches automatisches Update um 02:00 ausschließlich aus `origin/main` mit Sicherung vorab und automatischem Rückfall auf das vorherige Release; Betrieb aus einer eigenen Produktionskopie `~/RheinWerk-Prod` (Releases je Commit, Symlink `current`); Bereich „System“ im Dashboard (`/dashboard/system`, admin: „Jetzt aktualisieren“, „Wiederherstellen“; manager nur lesend); die Web-App führt keine Befehle aus, ein launchd-Auftrag übernimmt Anfragen aus der Datenbank; npm- und n8n-Updates nur als „verfügbar“ anzeigen, nicht installieren; Rücksetzen schaltet nur den Code um (Migrationen bleiben, Datenwiederherstellung manuell); Überwachung von n8n (Error-Workflow, Wächter alle 5 Minuten) und Mira (Agent, Guthaben, Webhooks, Auswertungen); E-Mails per Gmail SMTP (App-Passwort, unabhängig von n8n) nur an den Admin `andrejs.sadkovojs@gmail.com`, Warnungen im Dashboard für admin und manager. Roadmap v20 (Nutzerentscheidung nach Sichtung von task-17-7, `docs/decisions.md`): Bereich „System“ für den Inhaber ohne Code-Updates (`task-17-12`), Datensicherungen im Dashboard (`task-17-13`), Datenwiederherstellung als Ganzes (`task-17-14`), Zustand der Systeme und Versionen (`task-17-15`), Systemupdate von n8n und Supabase mit Sicherung, Selbsttest und Rückfall (`task-17-16`). Startbar: `task-17-8` (Überwachung von n8n), `task-17-9` (Überwachung von Mira), `task-17-13` (Datensicherungen im Dashboard), `task-17-15` (Zustand der Systeme und Versionen). Dienste: `online.rheinwerk.web`, `online.rheinwerk.update` (02:00), `online.rheinwerk.requests` (jede Minute); Betrieb mit `d3e8952`. E-Mail-Empfänger als `ALERT_EMAILS` in `shared/.env.local`, nicht in der Datenbank (öffentliches Repository).

Phasen 0–16 abgeschlossen (zuletzt Phase 16 „Datenschutz und Telefonassistent“, Phase 15 „Kundennummer sichtbar“, Phase 14 „Kundenstamm aus Anfragen“); Einzelheiten im `verification`-Objekt der Roadmap und in `docs/decisions.md`.

Achtung Betrieb: Nie mit Werkzeugen des Rechners auf die laufende n8n-Datenbank (`~/n8n/data/database.sqlite`) zugreifen – am 20.10.2026 hing n8n dadurch zwei Stunden (Details `docs/betrieb.md`). Lesen nur über `docker cp` einer Kopie.

## Zuletzt abgeschlossen

- `task-17-12` (21.10.2026): Bereich „System“ für den Inhaber: Zusammenfassung aus offenen Warnungen, Abschnitte Datensicherung, Zustand der Systeme, Guthaben, Systemversionen; keine Code-Updates im Dashboard mehr (`request_update`/`request_rollback` für Nutzer gesperrt, Migration `20261021170000`).
- `task-17-7` (21.10.2026): Bereich „System“ (`/dashboard/system`, admin und manager, manager ohne Schaltflächen): Version im Betrieb, noch nicht installierte Commits, Releases, Verlauf mit Logauszug, npm/n8n nur angezeigt; „Jetzt aktualisieren“ und „Wiederherstellen“ mit Rückfrage legen nur Anfragen an; bei offener Anfrage Banner und Neuladen alle 5 s (`docs/architecture.md`).
- `task-17-6` (21.10.2026): Dashboard-Anfragen (`update_requests`) führt `online.rheinwerk.requests` jede Minute aus (`scripts/prod/requests.mjs`, gemeinsamer Ablauf `runs.mjs`); Wiederherstellen ohne Build, danach überspringt die Nacht den verlassenen Commit; Skripte laufen aus `tools` (neuestes Release); verwaiste Läufe schließt `abandon_stale_runs`.

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

- Entwicklung (Port 3000) und Betrieb (`~/RheinWerk-Prod`, Port 3200) nutzen dieselbe lokale Datenbank; Testläufe hinterlassen Testdaten auch im Betrieb. Die Cloudflare-Tunnel-Route muss beim Deployment auf `host.docker.internal:3200` zeigen.

- Demo-Anruf funktioniert nur lokal (Budget in Supabase, `/api/mira`); auf der öffentlichen Website erst nach Anbindung von Supabase und `ELEVENLABS_API_KEY` im Deployment.
- Kein Supabase-Cloud-Projekt verknüpft (für ein Deployment `supabase login`, `supabase link`); öffentliche Website nutzt weiterhin Make, nicht n8n.
- `test:api` und `test:ui` legen Testnutzer und Testanfragen an; `npm run demo:seed` räumt die Anfragen ab (danach meldet `demo:verify` keine Chronologie-Abweichungen mehr). Testnutzer bleiben bis zu einem Reset in Namenslisten.
- `test:ui` wählt für die Einsatzplanung eine zufällige Woche ab 2030; trifft sie eine Woche mit Buchungen früherer Läufe, scheitern die Plantafel-Prüfungen – Lauf wiederholen.
- `test:auth`: 6 Cache-Control-Prüfungen schlagen unter `next dev` fehl; gegen `next start` bestanden. `test:ui` gegen `next start` mit `APP_URL=http://localhost:…`, nicht `127.0.0.1` (Passwort-Reset leitet auf `localhost` um, Cookie fehlt).
- Nach `npm install` liefert ein laufendes `next dev` teils HTTP 500 („module factory is not available“); `next dev` neu starten (läuft im Terminal des Nutzers).
- `next dev` liefert Client-Skripte nur an `localhost`; über die LAN-Adresse funktioniert nichts Interaktives (`allowedDevOrigins` in `next.config.ts` ergänzen).
- Port 3000 kann belegt sein: `PORT=3100 npm run start` (`-p` wird nicht angenommen) und `APP_URL=http://localhost:3100` (nicht `127.0.0.1`, sonst gehen Sitzungs-Cookies verloren).
- Lokale Entwicklung braucht Docker und `supabase start`; `.env.local` aus `supabase status` (`docs/setup.md`).
- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern von `private.lock_*` (ohne Auswirkung).

## Empfohlener nächster Schritt

Phase 17 fortsetzen: `task-17-13`, `task-17-15`, `task-17-8` oder `task-17-9` (startbar). Gepushte Commits gehen nachts automatisch in den Betrieb. Für den Betrieb aktuelle Stände nach `origin/main` pushen und `npm run prod:release` ausführen (ab task-17-5 nächtlich automatisch). Weitere mögliche Tasks nur nach Rücksprache: Pflege der SLA-Verträge im Dashboard (bisher nur Migration/Demo-Seed), eigene Rechnungsanschrift je Kunde, Deployment (Supabase Cloud, öffentliche Website auf n8n und Demo-Anruf), SMTP für echte Passwort-Mails, KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.
