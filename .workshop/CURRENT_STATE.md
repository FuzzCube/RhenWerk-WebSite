# Aktueller Projektstand

## Projekt und verbindliche Quellen

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` der bestehenden Next.js-16-Website mit Supabase, n8n und Telefonassistent Mira. Portfolio-Projekt mit Demodaten. Zentraler Zustand ausschließlich unter `.workshop/`; Übersicht und aus der Roadmap neu berechneter Fortschritt: `npm run workshop:status`. Ältere Abschlüsse stehen im `verification`-Objekt der Roadmap und in `activity.jsonl`, dauerhafte Entscheidungen in `docs/decisions.md`, Dokumentenkarte in `README.md`.

Roadmap v26, 22 Phasen, 136 Tasks. Alle 136 Tasks abgeschlossen, Gewicht 311/311, Fortschritt 100 %. `task-21-1` auf dem VPS eingerichtet und geprüft; Nutzer bestätigt beide Ansichten. Commit der Monitoring-Änderungen vom Nutzer beauftragt; Push nicht beauftragt.

Laut bisherigem Betriebsstand laufen Supabase und n8n seit 22.10.2026 auf dem VPS (`ssh vps`), Website auf Vercel. Lokal bleibt die Entwicklungs-/Prüfumgebung. Der aktuelle Monitoringauftrag ergänzt einen eigenen Stack in /opt/monitoring; bestehende Projekte, n8n-Workflows und Datenbankschema bleiben unverändert.

## Letzter Abschluss: VPS-Monitoring

`task-21-1` abgeschlossen: Serverteil eingerichtet und geprüft: Beszel up mit Metriken, Kuma 7/7 up, SMTP-Tests angenommen. Bestehende Container nicht neu gestartet, nur Loopback-Ports. Eigener Health-Dienst prüft feste Container ohne Datenbankschlüssel. Nutzer akzeptiert heutige OVH-Sicherung statt kostenpflichtigem Snapshot und untersagt Browser-Automation. Nutzer meldet Cloudflare Access als eingerichtet (noch nicht extern geprüft). Token vom Nutzer auf dem VPS gespeichert; dedizierter Monitoring-Tunnel gestartet. Hostname-Routen eingerichtet; Access-Abdeckung nach Nutzerkorrektur für beide Domains per anonymem HTTPS geprüft (302 zu Cloudflare Access). Tunnel wieder gestartet. Nutzer bestätigt erfolgreichen Login, Beszel-Grafiken und sieben grüne Kuma-Prüfungen. Öffentlicher Zugang über `monitor.rheinwerk-service.online` und `uptime.rheinwerk-service.online`, jeweils Cloudflare Access; alternativ SSH-Tunnel; Logins ausschließlich /opt/monitoring/access.json (0600). Betriebsdetails und Rückweg in docs/betrieb.md 3.10. lint/typecheck/build bestanden. Commit auf Nutzerauftrag; Push nicht beauftragt.

## Vorheriger Abschluss: Dashboard-Benachrichtigungen

**task-20-17: Globale Dashboard-Benachrichtigungen ohne Neuladen.** Nutzerauftrag mit konkretem Umsetzungsweg: ein gemeinsamer geschützter Abruf ungefähr alle 20 Sekunden, kein Realtime, bestehende Rollen/RLS und Bearbeitungsregeln.

Implementiert: gemeinsame Shell `DashboardUpdates`, Route `/dashboard/aktualisierungen`, Navigation mit getrennten Neu-/Antwortmarken, Posteingang, Terminwünsche und Verarbeitungsergebnisse, Rückrufe, Versandprobleme und Systemwarnungen. Stabile Ereignis-IDs, stille Erstöffnung, keine wiederholten Hinweise, Fehler behalten den letzten Gesamtstand. Ein Timer einschließlich Hintergrund-Tab, Fokus/Sichtbarkeit und Wiederverbindung; `CallbackAlerts` ohne eigenen Timer. `router.refresh()` erhält Browser-/React-Zustand, bei schmutzigen Formularen, fokussierten Feldern oder Plantafelaktionen erscheint ein separater Aktualisierungsknopf. Details in `docs/architecture.md`.

Zusätzlicher kleiner Prüfungsbefund: `getTeamNow` erzeugte bei vielen Planungsanfragen HTTP 414; der bestehende Besuchsabruf ist jetzt in Pakete zu 100 IDs aufgeteilt. Die UI-Tests berücksichtigen vorhandenen Versandstau und warten auf die tatsächlich aktualisierte Formularversion statt auf pauschale 500 ms.

Prüfstand: build, lint, typecheck, 158 Unit-Tests, API-Prüfungen, 145 auth-, 460 UI- und 49 Benachrichtigungsprüfungen bestanden. Zusätzlich nachgewiesen: Next→Supabase-Ausfall ergibt 503 und erhält die offene Sitzung; nach Wiederherstellung laufen dieselbe Seite und ihre Indikatoren ohne Neuladen/erneuten Login weiter. Die vorhandene Sitzungsprüfung hat dafür einen strikten Modus, normale Aufrufer bleiben unverändert. Neue Tests: `APP_URL=http://localhost:3117 npm run test:notifications`. Echte Gmail-/Mira-Vorgänge wurden nicht ausgelöst; lokale Ereignis-Fixtures und dieselbe Integrations-RPC wie n8n wurden geprüft.

## Letzte drei abgeschlossene Tasks

- `task-21-1` (23.10.2026): Beszel/Kuma auf dem VPS, Access, 7/7 Monitore, Admin-E-Mail; Nutzer bestätigt beide Ansichten.
- `task-20-17` (23.10.2026): Globale Aktualisierungen, siehe oben; lokal verifiziert, anschließend Commit und Push beauftragt.
- `task-20-16` (23.10.2026): Verschiebewünsche per E-Mail, Wunsch und Zeit in Workflow 13, Eingangsbestätigung, Plantafel mit Optionen, Annahme des Vorschlags und Erinnerung. Laut bisherigem Projektstand ist `rwVisitReply2026` auf dem VPS importiert und aktiv.

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

Abgeschlossen; keine offenen/startbaren Tasks. Keine weiteren Aufgaben automatisch beginnen. Monitoring-Konfiguration und Dokumentation gemäß Nutzerauftrag committen; Push nicht beauftragt.

Vorherige, in diesem Auftrag nicht erneut geprüfte Betriebsnotizen: OpenAI-Admin-Key für Costs auf dem VPS hinterlegen; alte Oracle-Instanz erst löschen, wenn nichts mehr benötigt wird. Optionale spätere Themen aus dem bisherigen Stand: SLA-Vertragspflege, eigene Rechnungsanschrift, SMTP für echte Passwort-E-Mails, KI-Vorbelegung im Posteingang und optionale E-Mail-Adresse bei Telefonanfragen.
