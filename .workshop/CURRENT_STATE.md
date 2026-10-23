# Aktueller Projektstand

## Projekt und verbindliche Quellen

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` der bestehenden Next.js-16-Website mit Supabase, n8n und Telefonassistent Mira. Portfolio-Projekt mit Demodaten. Zentraler Zustand ausschließlich unter `.workshop/`; Übersicht und aus der Roadmap neu berechneter Fortschritt: `npm run workshop:status`. Ältere Abschlüsse stehen im `verification`-Objekt der Roadmap und in `activity.jsonl`, dauerhafte Entscheidungen in `docs/decisions.md`, Dokumentenkarte in `README.md`.

Roadmap v27, 22 Phasen, 137 Tasks. Alle 137 Tasks abgeschlossen, Gewicht 313/313, Fortschritt 100 %. Letzter Abschluss `task-20-18`: kompaktere Plantafel mit Tageswechsel. Monitoring-Commit cf8ef6d ist in origin/main synchronisiert; Commit und Push der UI-Änderungen vom Nutzer beauftragt; synchronisierten Stand über Git prüfen.

Laut bisherigem Betriebsstand laufen Supabase und n8n seit 22.10.2026 auf dem VPS (`ssh vps`), Website auf Vercel. Lokal bleibt die Entwicklungs-/Prüfumgebung. Der aktuelle Monitoringauftrag ergänzt einen eigenen Stack in /opt/monitoring; bestehende Projekte, n8n-Workflows und Datenbankschema bleiben unverändert.

## Letzter Abschluss: Plantafel

`task-20-18`: Legende und Bedienung als standardmäßig geschlossene native Menüs. Datumsköpfe der Woche öffnen per Klick oder Enter genau den Tag über bestehende Navigation; Anfrage, Dauer und ungespeicherte Auswahl bleiben erhalten. Wochenansicht mit durchgehenden wechselnden Tagesflächen, eigenen Rändern und Abständen; Heute weiter lime. Keine Änderungen an Schema, Serverrechten oder Infrastruktur.

Prüfung: build/lint/typecheck, 13 fokussierte UI-Prüfungen und der gesamte Plantafel-Block von test-ui (34 Prüfungen) bestanden, Screenshots 390/768/1440 angesehen. Erster voller UI-Lauf traf alte Buchungen einer zufälligen Testwoche; Testfixture-Auswahl und Sichtbarkeits-/Enter-Prüfung korrigiert. Alle betroffenen Planungsszenarien gezielt wiederholt; vollständige Gesamtsuite danach nicht wiederholt. Nur lokale Prüfung; keine Browser-Automation in Nutzer-Tabs, Commit/Push anschließend vom Nutzer beauftragt; Deployment nicht separat geprüft. Prüfprotokolle /tmp/rw-plan-*.log, Screenshots /tmp/rw-plan-board-20261023.

Vorherige Abschlüsse: Monitoring läuft auf dem VPS unter /opt/monitoring, beide Domains durch Access geschützt, 7/7 Monitore; Nutzer bestätigt Login/Ansichten. Zugang/Geheimnisse ausschließlich auf dem VPS, Betrieb/Rückweg in docs/betrieb.md 3.10. Globale Dashboard-Benachrichtigungen (task-20-17) dokumentiert in docs/architecture.md und Roadmap.

## Letzte drei abgeschlossene Tasks

- `task-20-18` (23.10.2026): kompaktere Plantafel, Datumsklick, sichtbare Tagestrennung; lokal geprüft.
- `task-21-1` (23.10.2026): Beszel/Kuma auf dem VPS, Access, 7/7 Monitore, Admin-E-Mail; Nutzer bestätigt beide Ansichten.
- `task-20-17` (23.10.2026): Globale Aktualisierungen, siehe oben; lokal verifiziert, anschließend Commit und Push beauftragt.

## Arbeitsregeln

- Schema nur über neue Migrationen; niemals `supabase db reset` auf bestehenden Daten. Typen nach Schemaänderungen mit `npm run db:types`.
- RLS beim Lesen; Schreiben über kontrollierte RPCs mit Versionsprüfung. Agent/n8n nur über ihre Integrationsfunktionen. Zugriffsschutz je Dashboard-Seite und Route (`lib/auth/session.ts`, Rollen `lib/auth/roles.ts`). Proxy erneuert nur die Sitzung.
- Keine Service-Role oder Geheimnisse im Browser/Repository. `.env.local` bleibt ignoriert.
- UI auf Deutsch, `de-DE`, `Europe/Berlin`, bestehendes helles Designsystem. Bausteine unter `components/dashboard/ui/`.
- E-Mails nur nach Freigabe, bestehende Ausnahmen für Eingangsbestätigung/Zahlungserinnerungen bleiben bestehen. Unbekannte Anlagen und unklare fachliche Entscheidungen gehen an Menschen.
- Nie mit Rechnerwerkzeugen auf die laufende n8n-SQLite-Datenbank zugreifen: am 20.10.2026 hing n8n dadurch zwei Stunden. Lesen nur aus einer Kopie per `docker cp`; Einzelheiten `docs/betrieb.md`.

## Prüfungen und Grenzen

- Tests mit Schreibzugriff nur gegen lokalen Supabase: `.env.local` wurde dafür auf Loopback geprüft. Standardtests `test:api`/`test:ui` hinterlassen teils Demodaten und deaktivierte Testkonten bis zum üblichen `demo:seed`; keine pauschale Bereinigung oder kein Reset in diesem Auftrag. `test:notifications` entfernt seine eigenen Fixtures über den bestehenden transaktionslokalen Demo-Purge-Mechanismus, alle Constraints bleiben aktiv.
- `test:auth` für Cache-Control gegen `next start`, nicht `next dev`. `APP_URL=http://localhost:…`, nicht `127.0.0.1`, damit Sitzungs-Cookies zu Passwort-Links passen. Eigene Prüfserver (3117 und isolierte Fehlerprozess-Ports) sind nach den Tests beendet; vorhandene Nutzer-Server wurden nicht beendet.
- `test:ui` wählt eine zufällige zukünftige Woche; vorhandene Buchungen können Planungsprüfungen beeinflussen. Keine solchen Daten automatisch löschen.
- Nach `npm install` einen laufenden `next dev` bei „module factory is not available“ neu starten. Browser-Interaktionen über localhost; LAN braucht passende `allowedDevOrigins`.
- Hinweise sind keine dauerhafte persönliche Benachrichtigungshistorie. Browser können Hintergrund-Timer drosseln; Rückkehr/Online lösen zusätzlich einen Abruf aus. Sehr lange rückdatierte Transaktionen über die 60-Sekunden-Überlappung hinaus können einen Popup-Hinweis verpassen; aktuelle Marken bleiben maßgeblich.
- Sichtprüfung per Chrome-Emulation 390/768/1440, keine echten Mobilgeräte, Safari/Firefox oder OS-Benachrichtigungen geprüft. Öffentliche Gmail-/Mira-/Formularstrecke und Deployment gehören nicht zur lokalen Verifikation dieses Auftrags.

## Nächster Schritt

Lokal abgeschlossen, keine offenen/startbaren Tasks. Commit und Push gemäß Nutzerauftrag; synchronisierten Stand über Git prüfen. Keine weiteren Aufgaben automatisch beginnen.

Vorherige, in diesem Auftrag nicht erneut geprüfte Betriebsnotizen: OpenAI-Admin-Key für Costs auf dem VPS hinterlegen; alte Oracle-Instanz erst löschen, wenn nichts mehr benötigt wird. Optionale spätere Themen aus dem bisherigen Stand: SLA-Vertragspflege, eigene Rechnungsanschrift, SMTP für echte Passwort-E-Mails, KI-Vorbelegung im Posteingang und optionale E-Mail-Adresse bei Telefonanfragen.
