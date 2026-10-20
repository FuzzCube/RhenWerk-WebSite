# Übergabe: nächste Schritte (Stand 20.10.2026)

Roadmap v14 vollständig abgeschlossen; Stand und bekannte Probleme in `.workshop/CURRENT_STATE.md`, Übersicht mit `npm run workshop:status`. Jeder Schritt wird erst nach Rücksprache ein neuer Task.

1. Sprachtest von Mira, sobald ElevenLabs-Guthaben da ist: Szenarien aus `docs/telefonassistent/testprotokoll.md` per Demo-Anruf (`localhost:3000`, Klick auf die Service-Desk-Nummer), Ergebnisse dort eintragen.
2. Anrufzusammenfassungen ohne Anfrage nach 12 Monaten löschen (pg_cron wie `call-transcripts-30-days`, Vorgabe in `docs/telefonassistent/datenschutz.md`).
3. Deployment: Supabase-Cloud-Projekt (`supabase link`, `db push`), Website auf n8n statt Make, `ELEVENLABS_API_KEY` für den Demo-Anruf, Agent-Werkzeuge ohne laufenden Mac erreichbar.
4. SMTP für echte Passwort-Mails (`docs/setup.md`).
5. Ideen: KI-Vorbelegung im Posteingang über n8n, optionale E-Mail-Adresse bei telefonischen Anfragen.

Vor dem Start: Docker und `supabase start`, `next dev` läuft im Terminal des Nutzers; nie `supabase db reset`; Push nur auf Wunsch.
