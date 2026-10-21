# Aktueller Projektstand

Kurzfassung für den Einstieg. Übersicht über Phasen und Tasks: `npm run workshop:status`; ältere Abschlüsse mit Prüfergebnissen im `verification`-Objekt der Roadmap (`npm run workshop:status -- <task-id>`) und in `activity.jsonl`; dauerhafte Entscheidungen in `docs/decisions.md`; welche Dokumentation was enthält: Dokumentenkarte in `README.md`.

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website (Next.js 16, lokales Supabase), dazu lokale n8n/OpenAI/Gmail-Integration und der KI-Telefonassistent „Mira“ (ElevenLabs). Portfolio-Projekt mit Demodaten. Roadmap v22, 19 Phasen, 109 Tasks, Fortschritt 92,05 % (Gewicht 243 von 264).

Repository: `github.com/FuzzCube/RhenWerk-WebSite` (`origin`), Commits auf `main`, Push nur auf Wunsch des Nutzers (Stand mit `git status` prüfen).

## Aktive Phase und Aufgabe

**Phase 17 „Updates und Überwachung“** (Roadmap v22). Abgeschlossen: `task-17-1` bis `task-17-10`, `task-17-12`, `task-17-15`, `task-17-17`. Nutzerentscheidungen 21.10.2026 (`docs/decisions.md`): Bereich „System“ für den Inhaber ohne Code-Updates; bis Projektende läuft alles aus dem Entwicklungsordner, die Produktionskopie `~/RheinWerk-Prod` ist entfernt (Papierkorb). Dienste aus dem Entwicklungsordner (`npm run ops:install`, Protokolle `~/Library/Logs/RheinWerk/`): `online.rheinwerk.backup` (02:00, Sicherung mit Prüfung, Versionen) und `online.rheinwerk.watchdog` (alle 5 Minuten: Mira, n8n über die n8n-API mit `N8N_API_KEY`, dazu Website, Datenbank, Tunnel, Docker, Speicherplatz, SMTP stündlich; Error-Workflow `rwFehlerMeldung1` für alle RheinWerk-Workflows) und `online.rheinwerk.systemcheck` (alle 20 Sekunden, „System prüfen“ aus dem Dashboard); node und zsh haben dafür Festplattenvollzugriff. Offen in Phase 17: Gesamtprobe auf dem Rechner (`task-17-11`, startbar). Danach **Phase 18 „Deployment“** (Roadmap v22): Website auf Vercel, Supabase und n8n per Docker Compose auf einem VPS, GitHub Actions und Renovate; Sicherung im Dashboard, Datenwiederherstellung und Systemupdates mit Rückfall dort (`task-18-6` bis `18-8`, ersetzen `task-17-13`, `17-14`, `17-16`). E-Mails nur an `ALERT_EMAILS` in `.env.local`.

Phasen 0–16 abgeschlossen (zuletzt Phase 16 „Datenschutz und Telefonassistent“, Phase 15 „Kundennummer sichtbar“, Phase 14 „Kundenstamm aus Anfragen“); Einzelheiten im `verification`-Objekt der Roadmap und in `docs/decisions.md`.

Achtung Betrieb: Nie mit Werkzeugen des Rechners auf die laufende n8n-Datenbank (`~/n8n/data/database.sqlite`) zugreifen – am 20.10.2026 hing n8n dadurch zwei Stunden (Details `docs/betrieb.md`). Lesen nur über `docker cp` einer Kopie.

## Zuletzt abgeschlossen

- `task-17-15` (21.10.2026): Zustand aller acht Systeme mit Prüfzeit im Bereich „System“, Warnung `system:*` mit E-Mail (`scripts/ops/systems.mjs`); Versionen von Docker Desktop, Supabase CLI und Images, n8n, Node.js und npm-Paketen mit Empfehlung und Release Notes, nur angezeigt (`scripts/ops/versions.mjs`); „System prüfen“ nur Admin.
- `task-17-10` (21.10.2026): Hinweis auf offene Warnungen oben auf jeder Seite für Manager und Admin, Liste offener und behobener Warnungen im Bereich „System“, „Erledigt“ nur Admin.
- `task-17-8` (21.10.2026): Error-Workflow „RheinWerk · Fehlermeldung“ für alle RheinWerk-Workflows (`n8n/assign_error_workflow.mjs`), Wächter prüft n8n (Erreichbarkeit, aktive Workflows, Zeitpläne, Versand- und Analysestau) und mailt Fehlerläufe; Zeile „Automatisierung (n8n)“ im Bereich „System“.

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

- Die Domain `rheinwerk-service.online` ist noch nicht auf diesen Rechner geschaltet (Cloudflare 522); erst nach Projektende (`docs/betrieb.md` 2.2). n8n ist über `n8n.rheinwerk-service.online` erreichbar.
- Nur noch etwa 12 GB frei auf dem Rechner: offene Warnung „Wenig Speicherplatz“ (Schwelle 20 GB). Platz schaffen (`docker system df`, `docker image prune`, alte Container wie `n8n-old` entfernen) oder `DISK_WARN_GB` anpassen.
- Nach `brew upgrade node` den Festplattenvollzugriff für node erneuern, sonst laufen Sicherung und Wächter nicht (Bereich „System“: „Prüfung veraltet“).

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

Phase 17 abschließen: `task-17-11` (Gesamtprobe); `task-18-1` ist startbar, aber erst zum Umzug. Weitere mögliche Tasks nur nach Rücksprache: Pflege der SLA-Verträge im Dashboard, eigene Rechnungsanschrift je Kunde, SMTP für echte Passwort-Mails, KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.
