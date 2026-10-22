# Aktueller Projektstand

Kurzfassung für den Einstieg. Übersicht über Phasen und Tasks: `npm run workshop:status`; ältere Abschlüsse mit Prüfergebnissen im `verification`-Objekt der Roadmap (`npm run workshop:status -- <task-id>`) und in `activity.jsonl`; dauerhafte Entscheidungen in `docs/decisions.md`; welche Dokumentation was enthält: Dokumentenkarte in `README.md`.

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website (Next.js 16; Supabase und n8n seit 22.10.2026 auf dem VPS `ssh vps`, lokal nur Entwicklungsumgebung), dazu n8n/OpenAI/Gmail-Integration und der KI-Telefonassistent „Mira“ (ElevenLabs). Portfolio-Projekt mit Demodaten. Roadmap v23, 19 Phasen, 113 Tasks, Fortschritt 93,7 % (Gewicht 253 von 270).

Repository: `github.com/FuzzCube/RhenWerk-WebSite` (`origin`), Commits auf `main`, Push nur auf Wunsch des Nutzers (Stand mit `git status` prüfen).

## Aktive Phase und Aufgabe

**Phase 17 „Updates und Überwachung“ abgeschlossen** (21.10.2026, Gesamtprobe `task-17-11`, Ergebnis in `docs/testing.md`). Nutzerentscheidungen 21.10.2026 (`docs/decisions.md`): Bereich „System“ für den Inhaber ohne Code-Updates, Versionen nur angezeigt; bis Projektende läuft alles aus dem Entwicklungsordner. Dienste aus dem Entwicklungsordner (`npm run ops:install`, Protokolle `~/Library/Logs/RheinWerk/`): `online.rheinwerk.backup` (09:00, weil der Rechner nachts schläft; Sicherung mit Prüfung, Versionen), `online.rheinwerk.watchdog` (alle 5 Minuten: Mira, n8n über die n8n-API mit `N8N_API_KEY`, Website, Datenbank, Tunnel, Docker, Speicherplatz, SMTP stündlich; 3 Minuten Anlaufzeit nach einem Start von n8n) und `online.rheinwerk.systemcheck` (alle 20 Sekunden, „System prüfen“). node und zsh haben Festplattenvollzugriff. Nächste Phase: **Phase 18 „Deployment“** (Roadmap v22): Website auf Vercel, Supabase und n8n per Docker Compose auf einem VPS, GitHub Actions und Renovate; Sicherung im Dashboard, Datenwiederherstellung und Systemupdates mit Rückfall dort (`task-18-6` bis `18-8`, ersetzen `task-17-13`, `17-14`, `17-16`). E-Mails nur an `ALERT_EMAILS` in `.env.local`.

Phasen 0–17 abgeschlossen (zuletzt Phase 17 „Updates und Überwachung“, davor Phase 16 „Datenschutz und Telefonassistent“, Phase 15 „Kundennummer sichtbar“, Phase 14 „Kundenstamm aus Anfragen“); Einzelheiten im `verification`-Objekt der Roadmap und in `docs/decisions.md`.

Achtung Betrieb: Nie mit Werkzeugen des Rechners auf die laufende n8n-Datenbank (`~/n8n/data/database.sqlite`) zugreifen – am 20.10.2026 hing n8n dadurch zwei Stunden (Details `docs/betrieb.md`). Lesen nur über `docker cp` einer Kopie.

Roadmap v23 (22.10.2026): zusätzlich Umzug vom Oracle-Server (`ssh oracle-n8n`): RAG-Assistent der Website in RheinWerk (`task-18-10`), House Items Bot (`task-18-11`) und Personal Copilot (`task-18-12`) als eigene Projekte auf dem VPS, danach Oracle und die alte Vercel-Website abschalten (`task-18-13`). Bestand Oracle: drei Supabase-Stacks (je 11–13 MB), n8n 2.37.10 mit 3 Workflows, Caddy mit sslip.io und offenen Ports 80/443.

## Zuletzt abgeschlossen

- `task-18-12` und `task-18-11` (22.10.2026): Personal Copilot (`/opt/personal-copilot`, nur Datenbank, kein öffentlicher Zugang) und House Items Bot (`/opt/houseitems`, eigenes n8n, Tunnel `houseitems-vps`, `bot.rheinwerk-service.online` nur `/webhook/`, in Telegram geprüft) vom Oracle-Server auf den VPS; Projekte und Ports in `docs/betrieb.md` 3.5. Auf Oracle läuft nur noch der RAG-Assistent der Website (bis task-18-10).
- `task-18-3` (22.10.2026): **Produktivbetrieb auf dem VPS.** Daten des Rechners per `ops/vps/import-backup.sh` übernommen (Zeilenzahlen wie im Manifest), n8n (9 Workflows, Supabase über `http://kong:8000`) und Mira über Tunnel `rheinwerk-vps`, Formular-Webhook und Gmail-Versand geprüft, Wächter auf dem VPS mit E-Mails (`docs/betrieb.md` 3.6). Auf dem Rechner n8n gestoppt und launchd-Dienste entfernt; lokales Supabase nur noch Entwicklungsumgebung mit veraltetem Datenstand.
- `task-18-2` (22.10.2026): VPS mit Docker Compose (`docs/betrieb.md` 3.5, `ops/vps/`): Server `ssh vps` (OVHcloud VPS-2, Ubuntu 26.04), Swap, Docker mit Ports nur auf 127.0.0.1, Node.js 24; Compose-Projekt `rheinwerk` (Supabase ohne Realtime, n8n 2.40.7, Tunnel `rheinwerk-vps`) mit festen Versionen und neuen Schlüsseln, 68 Migrationen eingespielt; Wächter und „System prüfen“ als systemd-Timer, ohne E-Mails bis task-18-3; Neustart geprüft. Weitere Projekte auf dem Server vorgesehen (Regeln in 3.5).

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

Phase 18 „Deployment“: startbar `task-18-4` (Website auf Vercel, legt `api.rheinwerk-service.online` mit Access an), `task-18-6` (Sicherung auf dem VPS, bis dahin **keine eigene tägliche Sicherung**, nur die des Anbieters) und `task-18-10` (RAG-Assistent). Vorher empfohlen: Speicherplatz schaffen und die Updates aus dem Bereich „System“ einspielen (`docs/HANDOFF.md`). Weitere mögliche Tasks nur nach Rücksprache: Pflege der SLA-Verträge im Dashboard, eigene Rechnungsanschrift je Kunde, SMTP für echte Passwort-Mails, KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.
