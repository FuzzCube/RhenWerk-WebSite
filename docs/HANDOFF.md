# Übergabe (Stand 22.10.2026, Roadmap v25)

Phase 18 „Deployment“, Phase 19 „Feinschliff vor der Präsentation“ und Phase 20 „Rückmeldungen nach dem Rundgang“ (Plantafel, E-Mails an Kunden, Storno per E-Mail-Antwort über den Workflow „RheinWerk · Kundenantwort zum Termin“) sind abgeschlossen; der Oracle-Server ist seit 22.10.2026 still (`task-18-13`, `docs/betrieb.md` 3.9). Die Gesamtprobe des Deployments (`task-18-9`) steht in `docs/testing.md`. Stand und Übersicht: `.workshop/CURRENT_STATE.md`, `npm run workshop:status`.

## So läuft es

| Teil | Wo | Dokumentation |
| --- | --- | --- |
| Website und Dashboard | Vercel Hobby, Region `cdg1`, `rheinwerk-service.online` (`www` leitet weiter) | `docs/betrieb.md` 3.7 |
| Supabase (Datenbank, Auth, REST, Storage) und n8n | OVHcloud VPS-2 Roubaix (`ssh vps`), Docker Compose `/opt/rheinwerk` (`ops/vps/compose.sh`) | `docs/betrieb.md` 3.5 |
| Zugang von außen | nur Cloudflare-Tunnel (`api.` → Supabase, `n8n.` → n8n) hinter Cloudflare Access; offen ist nur Port 22 | `docs/betrieb.md` 3.5, 3.6 |
| Deployment | Push auf `main` → GitHub Actions: Prüfungen → Sicherung und neue Migrationen auf dem VPS (`ops/vps/migrate.sh`) → `vercel deploy --prod`; Vercel baut nicht selbst | `docs/betrieb.md` 3.8 |
| Dienste auf dem VPS (systemd) | `rheinwerk-watchdog` (alle 5 Minuten), `rheinwerk-systemcheck` (alle 20 Sekunden: „System prüfen“, „Jetzt sichern“, „Wiederherstellen“, „Update einspielen“), `rheinwerk-backup` (03:00) | `docs/betrieb.md` 4–6 |
| Website-Assistent | `/api/assistant` → n8n „RheinWerk · Assistent“ → Wissensbasis `rag_documents` | `docs/n8n-workflows.md` 9 |
| Entwicklung | Mac mit lokalem Supabase (`supabase start`) und `next dev`; das lokale n8n bleibt gestoppt (sonst liest Gmail doppelt) | `docs/setup.md` |

Weitere Projekte auf demselben VPS (eigene Compose-Projekte, nicht Teil dieses Repositorys): `/opt/houseitems` (House Items Bot), `/opt/personal-copilot`.

## Alltag des Betreibers

- Bereich „System“ (`/dashboard/system`, Admin): Zustand aller Systeme, Datensicherung (täglich 03:00, geprüft, 14 Tage), Warnungen; Warnungen kommen zusätzlich per E-Mail an `ALERT_EMAILS`.
- Updates: montags Dependabot-PRs. Images (`ops/vps/docker-compose.yml`): Release Notes lesen, mergen, nach dem Deployment „Update einspielen“ (Sicherung, Schnappschuss, Selbsttest, Rückfall). npm und GitHub Actions: mergen, wenn die Prüfungen grün sind; Hauptversionen einzeln.
- Daten zurückholen: „Wiederherstellen“ an einer Sicherung (nur Admin, Wort `WIEDERHERSTELLEN`), vorher wird automatisch gesichert.
- Wissensbasis des Assistenten ändern: Datei in `n8n/rag-documents/`, pushen, auf dem VPS `sh /opt/rheinwerk/app/ops/vps/rag-import.sh`.
- Notfälle: `docs/betrieb.md` 7.

## Zugänge (Geheimnisse nie im Repository)

| Wo | Was |
| --- | --- |
| VPS `/opt/rheinwerk/.env` | Schlüssel von Supabase, Postgres-Passwort, Tunnel-Token |
| VPS `/opt/rheinwerk/ops.env` | Dienste: Supabase-Schlüssel, SMTP, `ALERT_EMAILS`, `BACKUP_PASSPHRASE`, `N8N_API_KEY`, OVHcloud-API (nur lesend) |
| Vercel (Environment Variables) | Supabase-URL und Schlüssel, Cloudflare-Access-Service-Token, `N8N_WEBHOOK_URL`, Turnstile, Blob, `SITE_URL` |
| GitHub Secrets | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `VPS_HOST`, `VPS_SSH_KEY` (darf nur `migrate.sh` ausführen), `VPS_KNOWN_HOSTS` |
| Cloudflare Zero Trust | Tunnel `rheinwerk-vps`, Access-Anwendungen „api“, „RheinWerk Webhook“ (Formular, Anhänge, Assistent), „n8n“ (Mira), „n8n Editor“, „n8n OAuth callback“ |
| Passwort-Manager | `BACKUP_PASSPHRASE` (ohne sie ist keine Sicherung lesbar), n8n-Besitzerkonto, Demo-Passwort, OVHcloud-Konto |

Konten: GitHub, Cloudflare, Vercel, OVHcloud, Google Cloud/Gmail, OpenAI, ElevenLabs (`docs/betrieb.md` 8).

## Nächste Schritte

1. Kosten von OpenAI im Bereich „System“: `OPENAI_ADMIN_KEY` und `OPENAI_BUDGET_USD` in `/opt/rheinwerk/ops.env` eintragen (`docs/betrieb.md` 3.5). Oracle-Instanz in der Oracle Cloud löschen, sobald nichts mehr davon gebraucht wird (Container gestoppt, letzte Sicherung auf dem VPS, `docs/betrieb.md` 3.9).
2. Dependabot-PRs #6–#10: #6–#8 (Actions, npm-Minor) grün; #9 TypeScript 7 und #10 eslint 10 scheitern an den Prüfungen und brauchen Anpassungen.
3. Vor echter Nutzung mit Kunden: Vercel Pro (Hobby nur nicht-kommerziell), Kopie der Sicherungen außer Haus (`docs/betrieb.md` 3.4), Begrenzung von `/api/assistant` über die Server-Instanz hinaus.
4. Offen aus früheren Phasen: Sprachtests mit Stimme (`docs/telefonassistent/testprotokoll.md`, „Offen“), SLA-Verträge im Dashboard pflegen, eigene Rechnungsanschrift je Kunde, Ideen: KI-Vorbelegung im Posteingang, optionale E-Mail-Adresse bei telefonischen Anfragen.

Arbeitsregeln: nie `supabase db reset`; neue Migrationen nur hinzufügend (DROP bricht das Deployment ab); jeder Push auf `main` geht in die Produktion; nie mit Werkzeugen des Rechners auf eine laufende n8n-Datenbank zugreifen.
