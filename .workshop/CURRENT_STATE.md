# Aktueller Projektstand

## Projekt und verbindliche Quellen

RheinWerk Service-Dashboard: geschützter Mitarbeiterbereich `/dashboard` der bestehenden Next.js-16-Website mit Supabase, n8n und Telefonassistent Mira. Portfolio-Projekt mit Demodaten. Zentraler Zustand ausschließlich unter `.workshop/`; Übersicht und aus der Roadmap neu berechneter Fortschritt: `npm run workshop:status`. Ältere Abschlüsse stehen im `verification`-Objekt der Roadmap und in `activity.jsonl`, dauerhafte Entscheidungen in `docs/decisions.md`, Dokumentenkarte in `README.md`.

Roadmap v29, 23 Phasen, 140 Tasks. Alle 140 Tasks abgeschlossen, Gewicht 322/322, Fortschritt 100 %. Letzter Abschluss `task-22-3`: KI-Antwortassistent. Commit 94fc4b8 und Bounce-Fix auf origin/main, CI grün, auf dem VPS aktiv. Der Nutzer erlaubt Push zum Live-Test (Portfolio ohne echte Kunden).

Laut bisherigem Betriebsstand laufen Supabase und n8n seit 22.10.2026 auf dem VPS (`ssh vps`), Website auf Vercel. Lokal bleibt die Entwicklungs-/Prüfumgebung. Der aktuelle Monitoringauftrag ergänzt einen eigenen Stack in /opt/monitoring; bestehende Projekte, n8n-Workflows und Datenbankschema bleiben unverändert.

## Letzter Abschluss: Antwortassistent

`task-22-3`: Workflow 14 „RheinWerk · Antwortassistent“ (`rwReplyAssist2026`, `n8n/generate_reply_assist_workflow.py`) schreibt zu unbeantworteten Kunden-E-Mails nach der Erstbearbeitung einen Entwurf (Kennzeichen „KI-Entwurf“ mit Begründung in der Korrespondenz). Datenbank: `reply_assist_pending`, `reply_assist_slots` (freie Termine zum Wunsch), `save_reply_assist` (Entwurf, Lauf `reply_assist`, Rückrufbitte an den Techniker bei überfälligem Einsatz, `conversation_id` `email:<id>`). Workflow 13 geht vor; Bounces/Abwesenheit/No-Reply werden ignoriert (Migration 20261024000400 nach dem ersten Live-Lauf). Versand nur über „Senden“. Details docs/n8n-workflows.md Abschnitt 14.

Vorher `task-22-1`/`22-2`: Anfrage-Seite ohne „Nächster Schritt“, Aktionen in den Abschnitten, Entwürfe löschbar (`delete_message_draft`), Kontaktknöpfe untereinander.

Prüfung: test:db (1309 + 22), test:unit 158, test:ui 476, lint/typecheck/build; Live-Lauf auf dem VPS mit 5 Mails geprüft. Rückrufbitte per E-Mail nur per pgTAP geprüft (kein überfälliger Einsatz live). Auf dem VPS liegt noch ein Entwurf zur Gmail-Unzustellbarkeitsmeldung von RIS-2026-02167 aus dem ersten Lauf (bei Bedarf in der Korrespondenz löschen).

## Letzte drei abgeschlossene Tasks

- `task-22-3` (24.10.2026): KI-Antwortassistent, live auf dem VPS.
- `task-22-2` (24.10.2026): Kontaktknöpfe untereinander, neue E-Mail unter den Nachrichten.
- `task-22-1` (24.10.2026): Anfrage-Seite, Aktionen in den Abschnitten, Entwürfe löschbar; mit 22-3 gepusht.

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

Keine offenen/startbaren Tasks; Stand auf origin/main und dem VPS. Keine weiteren Aufgaben automatisch beginnen.

Vorherige, in diesem Auftrag nicht erneut geprüfte Betriebsnotizen: OpenAI-Admin-Key für Costs auf dem VPS hinterlegen; alte Oracle-Instanz erst löschen, wenn nichts mehr benötigt wird. Optionale spätere Themen aus dem bisherigen Stand: SLA-Vertragspflege, eigene Rechnungsanschrift, SMTP für echte Passwort-E-Mails, KI-Vorbelegung im Posteingang und optionale E-Mail-Adresse bei Telefonanfragen.
