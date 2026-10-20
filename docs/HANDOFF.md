# Übergabe: nächste Schritte (Stand 20.10.2026)

Roadmap v15: Phasen 0–13 abgeschlossen, Phase 14 „Kundenstamm aus Anfragen“ geplant (startbar `task-14-1`); Stand und bekannte Probleme in `.workshop/CURRENT_STATE.md`, Übersicht mit `npm run workshop:status`. Jeder Schritt wird erst nach Rücksprache ein neuer Task.

0. Phase 14 umsetzen: Kunden automatisch aus bearbeiteten Anfragen (`task-14-1` … `14-4`, Regeln in `docs/decisions.md`).
1. Sprachtest von Mira, sobald ElevenLabs-Guthaben da ist: Szenarien aus `docs/telefonassistent/testprotokoll.md` per Demo-Anruf (`localhost:3000`, Klick auf die Service-Desk-Nummer), Ergebnisse dort eintragen.
2. Anrufzusammenfassungen ohne Anfrage nach 12 Monaten löschen (pg_cron wie `call-transcripts-30-days`, Vorgabe in `docs/telefonassistent/datenschutz.md`).
3. Deployment nach `docs/betrieb.md` (Nutzerentscheidung 20.10.2026): Stufe 1 Website unter `rheinwerk-service.online` über den Cloudflare Tunnel vom eigenen Rechner (Tunnel-Route, Turnstile-Produktionsschlüssel, `site_url`, launchd), tägliche Sicherung per launchd mit `BACKUP_PASSPHRASE` einrichten; Stufe 2 Server später. `ELEVENLABS_API_KEY` für den Demo-Anruf.
4. SMTP für echte Passwort-Mails (`docs/setup.md`).
5. Ideen: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.

Vor dem Start: Docker und `supabase start`, `next dev` läuft im Terminal des Nutzers; nie `supabase db reset`; Push nur auf Wunsch.
