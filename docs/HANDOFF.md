# Übergabe: nächste Schritte (Stand 21.10.2026)

Roadmap v17: alle 17 Phasen und 86 Tasks abgeschlossen, zuletzt Phase 15 „Kundennummer sichtbar“ und Phase 16 „Datenschutz und Telefonassistent“ (Löschfrist für Anrufe ohne Anfrage, Kundennummer im Notfallablauf von Mira, SLA-Verträge in der Kundenliste). Stand und bekannte Probleme in `.workshop/CURRENT_STATE.md`, Übersicht mit `npm run workshop:status`. Jeder Schritt wird erst nach Rücksprache ein neuer Task.

1. Sprachtests mit Stimme, die noch fehlen (`docs/telefonassistent/testprotokoll.md`, Abschnitt „Offen“): Notfall eines Bestandskunden (task-16-2), Anruf mit Demo-Weiterleitung, Unterbrechen und Stille, ein Gespräch über das Widget. ElevenLabs-Guthaben ist seit 20.10.2026 wieder vorhanden.
2. SLA-Verträge im Dashboard pflegen (anlegen, verlängern, beenden); bisher nur Migration und Demo-Seed, die Kundenliste zeigt sie nur an.
3. Eigene Rechnungsanschrift je Kunde (Rechnungen nehmen bisher die Anschrift der Anfrage).
4. Deployment nach `docs/betrieb.md` (Nutzerentscheidung 20.10.2026): Stufe 1 Website unter `rheinwerk-service.online` über den Cloudflare Tunnel vom eigenen Rechner (Tunnel-Route, Turnstile-Produktionsschlüssel, `site_url`, launchd), tägliche Sicherung per launchd mit `BACKUP_PASSPHRASE`; Stufe 2 Server später. `ELEVENLABS_API_KEY` für den Demo-Anruf.
5. SMTP für echte Passwort-Mails (`docs/setup.md`).
6. Ideen: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.

Vor dem Start: Docker und `supabase start`, `next dev` läuft im Terminal des Nutzers; nie `supabase db reset` (geänderte Migrationen per `supabase migration up` bzw. `psql`); Prüfungen gegen `next start` mit `PORT=3100 npm run start` und `APP_URL=http://localhost:3100`; Push nur auf Wunsch.
