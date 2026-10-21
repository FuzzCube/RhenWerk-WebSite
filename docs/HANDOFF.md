# Übergabe: nächste Schritte (Stand 21.10.2026, Roadmap v22)

Roadmap v22: Phasen 0–16 abgeschlossen, Phase 17 „Updates und Überwachung“ weitgehend (offen `task-17-15` Zustand der Systeme und Versionen, danach `task-17-11` Gesamtprobe auf dem Rechner), Phase 18 „Deployment“ geplant. Stand und bekannte Probleme in `.workshop/CURRENT_STATE.md`, Übersicht mit `npm run workshop:status`.

Was Phase 17 gebracht hat (Entscheidungen in `docs/decisions.md`):

- Bis Projektende läuft alles aus dem Entwicklungsordner (`task-17-17`); die frühere Produktionskopie `~/RheinWerk-Prod` mit nächtlichem Code-Update ist entfernt, ihr Code steht in der Git-Historie bis `284294f`.
- Dienste auf dem Rechner (`npm run ops:install`, Protokolle `~/Library/Logs/RheinWerk/`): nächtliche Sicherung mit Wiederherstellungstest um 02:00 (`online.rheinwerk.backup`) und Wächter alle 5 Minuten (`online.rheinwerk.watchdog`) für n8n und Mira. node und zsh brauchen dafür Festplattenvollzugriff (nach `brew upgrade node` erneuern).
- Warnungen gehen per Gmail SMTP an `ALERT_EMAILS` und erscheinen für Manager und Admin oben auf jeder Dashboard-Seite und im Bereich „System“ (`/dashboard/system`); der n8n-Error-Workflow „RheinWerk · Fehlermeldung“ meldet fehlgeschlagene Läufe.

Nächste Schritte (die mit Task-ID stehen in der Roadmap, die übrigen werden erst nach Rücksprache ein Task):

1. `task-17-15`: Zustand von Website, Datenbank, Docker, Tunnel, E-Mail-Versand und Speicherplatz sowie Systemversionen im Bereich „System“, „System prüfen“ für Admin.
2. `task-17-11`: Gesamtprobe auf dem Rechner (n8n-Ausfall, Störung von Mira, scheiternde Sicherung, Ausfall eines Containers).
3. Phase 18 „Deployment“ zum Projektende: Website auf Vercel, Supabase und n8n per Docker Compose auf einem VPS, GitHub Actions und Renovate; Sicherung im Dashboard, Datenwiederherstellung und Systemupdates mit Rückfall dort (`task-18-1` bis `task-18-9`).
4. Sprachtests mit Stimme, die noch fehlen (`docs/telefonassistent/testprotokoll.md`, Abschnitt „Offen“): Notfall eines Bestandskunden (task-16-2), Anruf mit Demo-Weiterleitung, Unterbrechen und Stille, ein Gespräch über das Widget.
5. SLA-Verträge im Dashboard pflegen (anlegen, verlängern, beenden); bisher nur Migration und Demo-Seed.
6. Eigene Rechnungsanschrift je Kunde (Rechnungen nehmen bisher die Anschrift der Anfrage).
7. SMTP für echte Passwort-Mails (`docs/setup.md`), bei Phase 18 ohnehin nötig.
8. Ideen: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.

Vor dem Start: Docker und `supabase start`, `next dev` läuft im Terminal des Nutzers; nie `supabase db reset` (neue Migrationen mit `supabase migration up`); Prüfungen gegen `next start` (z. B. `npx next start -p 3202` und `APP_URL=http://localhost:3202`, nicht `127.0.0.1`); `test:ui` und `test:api` hinterlassen Testdaten, `npm run demo:seed` räumt sie ab; Push nur auf Wunsch.
