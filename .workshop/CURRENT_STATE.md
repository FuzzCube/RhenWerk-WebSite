# Aktueller Projektstand

## Projekt und verbindliche Quellen

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` der bestehenden Next.js-16-Website mit Supabase, n8n und Telefonassistent Mira. Portfolio-Projekt mit Demodaten. Zentraler Zustand ausschließlich unter `.workshop/`; Übersicht und aus der Roadmap neu berechneter Fortschritt: `npm run workshop:status`. Ältere Abschlüsse stehen im `verification`-Objekt der Roadmap und in `activity.jsonl`, dauerhafte Entscheidungen in `docs/decisions.md`, Dokumentenkarte in `README.md`.

Roadmap v38, 32 Phasen, 155 Tasks (ohne ersetzte). Alle 155 Tasks abgeschlossen, Gewicht 349/349, Fortschritt 100 %. Letzter Abschluss task-31-1: Wiederherstellung bei n8n-Workflows ohne gespeicherte Erfolge erkannt und zwei alte Warnungen auf VPS automatisch geschlossen. Änderung lokal und direkt auf VPS installiert; Nutzer hat Commit und Push dieses Fixes nach origin/main freigegeben. Vorheriger GitHub-/Deployment-Stand bis d25cc14 am 04.11.2026 erfolgreich (Lauf 41862625748).

Supabase und n8n laufen seit 22.10.2026 auf dem VPS (`ssh vps`), Website auf Vercel. Lokal bleibt die Entwicklungs-/Prüfumgebung. Der bestehende Zusatz-Stack liegt in /opt/monitoring. Phase 30 ändert die Skripte des RheinWerk-Wächters; n8n-Workflows und Datenbankschema bleiben unverändert.

## Aktuell: n8n-Fehlerwarnungen (phase-31)

17.11.2026, `task-31-1` abgeschlossen nach ausdrücklicher VPS-Freigabe: `n8n-events.mjs` liest begrenzte Enden der JSON-Ereignislogs als Erfolgsnachweis für Workflows ohne gespeicherte Erfolge. Weiterhin gültige API-Antworten, frischer Erfolg und eine ruhige Stunde erforderlich. Alte Warnungen von `rwCallAnalysis26` und `rwVisitReply2026` vom 12./13.11. wurden durch den regulären Wächter am 17.11. um 13:01:52/54 UTC automatisch geschlossen. Zwei Wächterläufe exit 0, erneute Prüfung 13:03:09 UTC: n8n `ok`, keine offenen Fehler oder fälligen n8n-Erinnerungen. Timer aktiv. Sicherung `/opt/rheinwerk/state/n8n-recovery.Zbszxf`; zwei Module und zwei Tests SHA-256-identisch lokal/VPS. Kein n8n-Neustart, keine Workflow-/Schemaänderung und kein SQLite-Zugriff.

22 gezielte Tests lokal und auf VPS erfolgreich; lint/typecheck/build vor Installation erfolgreich, Quellstand unverändert. Isolierter vollständiger Commit-Stand: 174/174 Unit-Tests erfolgreich. Der vorherige Fehler in `kpi-dictionary.test.mjs:41` betraf ausschließlich separate, nicht mitveröffentlichte Dokumentationsentwürfe. Keine sechsstündige Nachbeobachtung oder Postfachprüfung; produktive Auswahl fälliger Erinnerungen geprüft. Installation zunächst direkt auf VPS; anschließend Commit und Push nach origin/main vom Nutzer freigegeben.

## Vorher: Gmail und n8n-Warnungen (phase-30)

`task-30-1` abgeschlossen: unbekannte API-Daten erzeugen keine Stillstandsmeldung; Zeitplan-Ausfall braucht drei getrennte Prüfungen. Gemeinsamer Gmail-Zugangsfehler: eine Warnung ohne Erinnerungen und eine Entwarnung erst nach erfolgreichen authentifizierten Profilaufrufen beider Workflows. Bestehende Einzelwarnungen werden übernommen. 169 Unit-Tests sowie lint/typecheck/build grün; 17 gezielte Tests zusätzlich auf VPS. Commit 95b8353 per Git-Bundle auf VPS, watchdog exit 0, n8n ohne Neustart; Backup `/opt/rheinwerk/state/monitor-fix.SZ9GpJ`. Anschließender Commit und Push am 04.11.2026 vom Nutzer freigegeben.

`task-30-2` abgeschlossen: Nutzer bestätigte Google Cloud In production und Gmail-Reconnect. Versand 91232 am 04.11.2026 15:44:01 UTC und Eingang 91233 um 15:44:20 UTC jeweils success mit authentifiziertem Gmail-Profilaufruf des richtigen Postfachs. Watchdog exit 0, beide Einzelwarnungen und gemeinsamer Vorfall um 15:44:51 UTC automatisch geschlossen. Gespeicherter n8n-Zustand ok, keine Fehlerchecks; Versand- und Analysewarteschlange leer. Keine zusätzlichen Kunden-Testmails gesendet; Zustellung der gemeinsamen Entwarnungsmail nicht im Postfach geprüft.

## Letzter Abschluss vor phase-30: Systemupdates mit einem Klick (phase-29)

`task-29-1`: Dependabot sammelt Minor/Patch der Server-Images in einem PR, CI mergt ihn nach grünen Prüfungen selbst und startet das Deployment (workflow_dispatch); danach E-Mail „Systemupdate bereit“ einmal je Versionsstand. Betreiber drückt nur „Update einspielen“. Hauptversionen und npm-PRs bleiben manuell. Live geprüft mit PR #17. Offen: „Update einspielen“ für db/kong/rest/storage durch den Nutzer. Einzelheiten `docs/betrieb.md` 6.

## Davor: Startseite für den Server (phase-28)

`task-28-1`: Homepage v2.7.0 und docker-socket-proxy (nur lesend) im Stack `/opt/monitoring` laufen, Konfiguration in `ops/monitoring/homepage/`, Kuma-Statusseite `vps` angelegt; Containerstatus, Kuma- und Beszel-Widget lokal geprüft. `https://home.rheinwerk-service.online` hinter Cloudflare Access (Tunnel `vps-monitoring`). Einzelheiten `docs/betrieb.md` 3.11.

## Letzte drei abgeschlossene Tasks

- `task-31-1` (17.11.2026): n8n-Erfolg aus JSON-Log erkannt; zwei Altwarnungen auf VPS automatisch geschlossen.
- `task-30-2` (04.11.2026): Gmail-OAuth In production, Reconnect und beide Richtungen live geprüft.
- `task-30-1` (04.11.2026): n8n-Warnungen ohne Fehlalarme, gemeinsamer Gmail-Zugangsvorfall.

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

Keine offenen/startbaren Tasks. task-31-1 auf VPS installiert und live verifiziert. Nutzer hat Commit und Push des Fixes nach origin/main freigegeben; CI und Git-Synchronisierung werden getrennt geprüft.

Vorherige, in diesem Auftrag nicht erneut geprüfte Betriebsnotizen: OpenAI-Admin-Key für Costs auf dem VPS hinterlegen; alte Oracle-Instanz erst löschen, wenn nichts mehr benötigt wird. Optionale spätere Themen aus dem bisherigen Stand: SLA-Vertragspflege, eigene Rechnungsanschrift, SMTP für echte Passwort-E-Mails, KI-Vorbelegung im Posteingang und optionale E-Mail-Adresse bei Telefonanfragen.
