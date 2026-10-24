# Aktueller Projektstand

## Projekt und verbindliche Quellen

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` der bestehenden Next.js-16-Website mit Supabase, n8n und Telefonassistent Mira. Portfolio-Projekt mit Demodaten. Zentraler Zustand ausschließlich unter `.workshop/`; Übersicht und aus der Roadmap neu berechneter Fortschritt: `npm run workshop:status`. Ältere Abschlüsse stehen im `verification`-Objekt der Roadmap und in `activity.jsonl`, dauerhafte Entscheidungen in `docs/decisions.md`, Dokumentenkarte in `README.md`.

Roadmap v33, 27 Phasen, 149 Tasks (ohne ersetzte). Alle 149 Tasks abgeschlossen, Gewicht 338/338, Fortschritt 100 %. Letzter Abschluss `task-26-3`: „KI arbeitet …“ mit schnellerem Abruf, automatische Mails gekennzeichnet. Der Nutzer erlaubt Push zum Live-Test (Portfolio ohne echte Kunden).

Laut bisherigem Betriebsstand laufen Supabase und n8n seit 22.10.2026 auf dem VPS (`ssh vps`), Website auf Vercel. Lokal bleibt die Entwicklungs-/Prüfumgebung. Der aktuelle Monitoringauftrag ergänzt einen eigenen Stack in /opt/monitoring; bestehende Projekte, n8n-Workflows und Datenbankschema bleiben unverändert.

## Letzter Abschluss: Tempo und Plantafel nach dem Live-Test (phase-26)

`task-26-1`: Zugriffsregeln prüften je Zeile (can_read_message, can_access_request, Rolle je Aufruf); der gemeinsame Abruf zählte auf dem VPS ~3.100 Nachrichten in 1,3 s. Migration `20261024000700_rls_per_statement.sql`: Rolle einmal je Anweisung, erlaubte Anfragen als Menge `private.accessible_request_ids()`. Gleiche Sichtbarkeit (zeilengenau je Nutzer verglichen); VPS jetzt 1–5 ms (Admin), ~27 ms (Dispatcher).

`task-26-2`: `history.replaceState` während eines Seitenwechsels bricht ihn in Next.js ab (Router-Restore) – die Tafel blieb auf dem alten Tag. Plantafel schreibt die URL erst nach dem Wechsel, der gewählte Tag ist sofort markiert, die Tafel beim Laden abgeblendet.

`task-26-3`: Stand meldet `automationPending`, dann Abruf alle 5 s statt 20 s. Vom System ohne Person freigegebene Mails tragen „Automatisch versendet“. Sehr kurze Analysen (~6 s) können weiter zwischen zwei Abrufen liegen.

Hinweis des Nutzers zur Kundennummer K-20181 (RIS-2026-02771) war ein Irrtum; Mail und Daten stimmen, keine Änderung.

## Letzte drei abgeschlossene Tasks

- `task-26-3` (24.10.2026): „KI arbeitet …“ mit 5-s-Abruf, automatische Mails gekennzeichnet.
- `task-26-2` (24.10.2026): Plantafel-Tageswechsel ohne Zurückspringen.
- `task-26-1` (24.10.2026): Zugriffsregeln einmal je Abfrage, auf dem VPS.

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

Keine offenen/startbaren Tasks; Stand auf origin/main und dem VPS.  Keine weiteren Aufgaben automatisch beginnen.

Vorherige, in diesem Auftrag nicht erneut geprüfte Betriebsnotizen: OpenAI-Admin-Key für Costs auf dem VPS hinterlegen; alte Oracle-Instanz erst löschen, wenn nichts mehr benötigt wird. Optionale spätere Themen aus dem bisherigen Stand: SLA-Vertragspflege, eigene Rechnungsanschrift, SMTP für echte Passwort-E-Mails, KI-Vorbelegung im Posteingang und optionale E-Mail-Adresse bei Telefonanfragen.
