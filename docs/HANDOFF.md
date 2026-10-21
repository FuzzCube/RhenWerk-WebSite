# Übergabe: nächste Schritte (Stand 21.10.2026, Roadmap v22)

Roadmap v22: Phasen 0–17 abgeschlossen (zuletzt Phase 17 „Updates und Überwachung“ mit der Gesamtprobe `task-17-11` am 21.10.2026, Ergebnis in `docs/testing.md`), Phase 18 „Deployment“ geplant. Stand und bekannte Probleme in `.workshop/CURRENT_STATE.md`, Übersicht mit `npm run workshop:status`.

Was Phase 17 gebracht hat (Entscheidungen in `docs/decisions.md`):

- Bis Projektende läuft alles aus dem Entwicklungsordner (`task-17-17`); die frühere Produktionskopie `~/RheinWerk-Prod` mit nächtlichem Code-Update ist entfernt, ihr Code steht in der Git-Historie bis `284294f`.
- Dienste auf dem Rechner (`npm run ops:install`, Protokolle `~/Library/Logs/RheinWerk/`): nächtliche Sicherung mit Wiederherstellungstest und Versionen um 02:00 (`online.rheinwerk.backup`), Wächter alle 5 Minuten (`online.rheinwerk.watchdog`) für n8n, Mira, Website, Datenbank, Tunnel, Docker, Speicherplatz und stündlich SMTP, „System prüfen“ aus dem Dashboard (`online.rheinwerk.systemcheck`, alle 20 Sekunden). node und zsh brauchen dafür Festplattenvollzugriff (nach `brew upgrade node` erneuern).
- Der Bereich „System“ zeigt alle acht Systeme mit Zustand und Prüfzeit und die Versionen von Docker Desktop, Supabase CLI und Images, n8n, Node.js und npm-Paketen mit Empfehlung und Release Notes (nur Anzeige, `task-17-15`).
- Warnungen gehen per Gmail SMTP an `ALERT_EMAILS` und erscheinen für Manager und Admin oben auf jeder Dashboard-Seite und im Bereich „System“ (`/dashboard/system`); der n8n-Error-Workflow „RheinWerk · Fehlermeldung“ meldet fehlgeschlagene Läufe.

Nächste Schritte (die mit Task-ID stehen in der Roadmap, die übrigen werden erst nach Rücksprache ein Task):

1. Speicherplatz schaffen: auf dem Rechner sind nur etwa 12 GB frei, die Warnung „Wenig Speicherplatz“ ist offen (Schwelle 20 GB, `docker system df`, alte Container wie `n8n-old` entfernen).
2. Updates nach den Empfehlungen im Bereich „System“ (Stand 21.10.2026: Docker Desktop, Supabase CLI, n8n, Node.js, 14 npm-Pakete), jeweils mit Sicherung vorher und „System prüfen“ danach.
3. Phase 18 „Deployment“ zum Projektende: Website auf Vercel, Supabase und n8n per Docker Compose auf einem VPS, GitHub Actions und Renovate; Sicherung im Dashboard, Datenwiederherstellung und Systemupdates mit Rückfall dort (`task-18-1` bis `task-18-9`).
4. Sprachtests mit Stimme, die noch fehlen (`docs/telefonassistent/testprotokoll.md`, Abschnitt „Offen“): Notfall eines Bestandskunden (task-16-2), Anruf mit Demo-Weiterleitung, Unterbrechen und Stille, ein Gespräch über das Widget.
5. SLA-Verträge im Dashboard pflegen (anlegen, verlängern, beenden); bisher nur Migration und Demo-Seed.
6. Eigene Rechnungsanschrift je Kunde (Rechnungen nehmen bisher die Anschrift der Anfrage).
7. SMTP für echte Passwort-Mails (`docs/setup.md`), bei Phase 18 ohnehin nötig.
8. Ideen: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.

Vor dem Start: Docker und `supabase start`, `next dev` läuft im Terminal des Nutzers; nie `supabase db reset` (neue Migrationen mit `supabase migration up`); Prüfungen gegen `next start` (z. B. `npx next start -p 3202` und `APP_URL=http://localhost:3202`, nicht `127.0.0.1`); `test:ui` und `test:api` hinterlassen Testdaten, `npm run demo:seed` räumt sie ab; Push nur auf Wunsch.
