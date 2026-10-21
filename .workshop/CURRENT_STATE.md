# Aktueller Projektstand

Kurzfassung für den Einstieg. Übersicht über Phasen und Tasks: `npm run workshop:status`; ältere Abschlüsse mit Prüfergebnissen im `verification`-Objekt der Roadmap (`npm run workshop:status -- <task-id>`) und in `activity.jsonl`; dauerhafte Entscheidungen in `docs/decisions.md`; welche Dokumentation was enthält: Dokumentenkarte in `README.md`.

## Projekt

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` in der RheinWerk-Website (Next.js 16, lokales Supabase), dazu lokale n8n/OpenAI/Gmail-Integration und der KI-Telefonassistent „Mira“ (ElevenLabs). Portfolio-Projekt mit Demodaten. Roadmap v16, 16 Phasen, 83 Tasks, Fortschritt 100 % (Gewicht 210 von 210).

Repository: `github.com/FuzzCube/RhenWerk-WebSite` (`origin`), Commits auf `main`, Push nur auf Wunsch des Nutzers (Stand mit `git status` prüfen).

## Aktive Phase und Aufgabe

Phasen 0–15 abgeschlossen; zuletzt **Phase 15 „Kundennummer sichtbar“** (Roadmap v16, Nutzerentscheidung 20.10.2026 nach Testanruf): Kundennummer in Stammdaten (`task-15-1`), Kundennummer nur aus dem Kundenstamm mit Prüfung der angegebenen Nummer und Anzeige in Listen, Rechnungen und Einsatz (`task-15-2`), Bestandskunde in der telefonischen Anfrage über Vorschläge zur Kundennummer (`task-15-4`, Nutzerentscheidung 21.10.2026) und Übersicht als Startseite der Rolle Admin (`task-15-5`, Nutzerentscheidung 21.10.2026), Kundennummer in E-Mails an Kunden (`task-15-3`), und Auswertung mit Zeitraum je Karte und Schalter 12/24 Monate (`task-15-6`) kompakte Zeitraumschalter (`task-15-7`) und Zeitraumwechsel ohne Neuaufbau (`task-15-8`), alle abgeschlossen; keine Aufgabe offen. Zuvor **Phase 14 „Kundenstamm aus Anfragen“** (Regeln in `docs/decisions.md` und `docs/database.md`): Kunden entstehen beim Abschluss der Erstbearbeitung automatisch (`task-14-1`), unsichere Treffer erscheinen als Karte „Möglicher Bestandskunde“ (`task-14-2`), bestehende Anfragen sind nachgetragen (`task-14-3`, `npm run customers:backfill`), „Kunde anlegen“ warnt vor ähnlichen Kunden und jeder Kunde zeigt seine Herkunft (`task-14-4`).

Achtung Betrieb: Nie mit Werkzeugen des Rechners auf die laufende n8n-Datenbank (`~/n8n/data/database.sqlite`) zugreifen – am 20.10.2026 hing n8n dadurch zwei Stunden (Details `docs/betrieb.md`). Lesen nur über `docker cp` einer Kopie.

## Zuletzt abgeschlossen

- `task-15-8` (21.10.2026): Zeitraumwechsel auf Übersicht und Auswertung ohne Neuaufbau – Inhalt bleibt stehen, wird während des Ladens abgeblendet (`components/dashboard/pending-nav.tsx`, Zeitraum nicht mehr im `Suspense`-Key).
- `task-15-7` (21.10.2026): Zeitraum- und Monatsschalter überall kompakt (32 px, Telefon 44 px); Karte „Eingänge kumuliert“ mit Titel und Schalter in einer Zeile.
- `task-15-6` (21.10.2026): Auswertung – Zeitraumwahl in der Karte, die sie filtert (Durchsatz: „Eingänge … kumuliert“, Automatisierung: „Läufe“; Telefon weiter im Seitenkopf), Monatsdiagramme mit Schalter 12/24 Monate (`?monate=12`).

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

- ElevenLabs-Guthaben seit 19.10.2026 aufgebraucht: keine Sprachtests. Offen ist ein Anruf mit Stimme nach den letzten Änderungen (Sonnet, Kalender, ASR-Schlüsselwörter, Bestandskunde, Demo-Weiterleitung). API-Lesen, `agent:sync` und `agent:simulate` funktionieren weiter.
- Zusammenfassungen von Anrufen ohne Anfrage sollen nach 12 Monaten gelöscht werden (`docs/telefonassistent/datenschutz.md`); noch nicht umgesetzt.
- Demo-Anruf funktioniert nur lokal (Budget in Supabase, `/api/mira`); auf der öffentlichen Website erst nach Anbindung von Supabase und `ELEVENLABS_API_KEY` im Deployment.
- Kein Supabase-Cloud-Projekt verknüpft (für ein Deployment `supabase login`, `supabase link`); öffentliche Website nutzt weiterhin Make, nicht n8n.
- `test:api` und `test:ui` legen Testnutzer und Testanfragen an; `npm run demo:seed` räumt die Anfragen ab (danach meldet `demo:verify` keine Chronologie-Abweichungen mehr). Testnutzer bleiben bis zu einem Reset in Namenslisten.
- `test:ui` wählt für die Einsatzplanung eine zufällige Woche ab 2030; trifft sie eine Woche mit Buchungen früherer Läufe, scheitern die Plantafel-Prüfungen – Lauf wiederholen.
- `test:auth`: 5 Cache-Control-Prüfungen schlagen unter `next dev` fehl; gegen `next start` bestanden.
- Nach `npm install` liefert ein laufendes `next dev` teils HTTP 500 („module factory is not available“); `next dev` neu starten (läuft im Terminal des Nutzers).
- `next dev` liefert Client-Skripte nur an `localhost`; über die LAN-Adresse funktioniert nichts Interaktives (`allowedDevOrigins` in `next.config.ts` ergänzen).
- Port 3000 kann belegt sein: `PORT=3100 npm run start` (`-p` wird nicht angenommen) und `APP_URL=http://localhost:3100` (nicht `127.0.0.1`, sonst gehen Sitzungs-Cookies verloren).
- Lokale Entwicklung braucht Docker und `supabase start`; `.env.local` aus `supabase status` (`docs/setup.md`).
- `supabase db lint` meldet `warning extra` zu Composite-OUT-Parametern von `private.lock_*` (ohne Auswirkung).

## Empfohlener nächster Schritt

Alle Tasks der Roadmap v16 abgeschlossen; neue Aufgaben nur nach Rücksprache. Weitere mögliche Tasks nur nach Rücksprache: eigene Rechnungsanschrift je Kunde, Sprachtest von Mira nach neuem ElevenLabs-Guthaben, Löschung von Anrufzusammenfassungen ohne Anfrage nach 12 Monaten, Deployment (Supabase Cloud, öffentliche Website auf n8n und Demo-Anruf), SMTP für echte Passwort-Mails, KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.
