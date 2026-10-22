# Setup und Start

Lokale Einrichtung von Website und Mitarbeiterbereich (`/dashboard`) mit lokalem Supabase-Stack und Demodaten. Ausführlich: Datenbank in [supabase-lokal.md](supabase-lokal.md), n8n in [n8n-workflows.md](n8n-workflows.md), Betrieb und Sicherung in [betrieb.md](betrieb.md). Alle Schritte laufen auf einem Rechner; es werden keine echten E-Mails versendet, solange n8n nicht eingerichtet ist.

## Voraussetzungen

| Werkzeug | Version (geprüft) | Zweck |
| --- | --- | --- |
| Node.js | 20.9 oder neuer (geprüft mit 26.7) | Next.js 16, Skripte |
| Docker | Desktop oder Engine (geprüft mit 29.8) | lokaler Supabase-Stack |
| Supabase CLI | 2.x (geprüft mit 2.120) | `supabase start`, Migrationen, pgTAP |
| Chrome oder Chromium | aktuell | nur für `npm run test:ui` (headless) |

## Erstinstallation

```bash
npm install
supabase start                       # startet Postgres, Auth, Storage, Studio; wendet alle Migrationen an
supabase status                      # zeigt API-URL und Schlüssel
cp .env.example .env.local
```

In `.env.local` eintragen:

| Variable | Wert |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API URL` aus `supabase status` (lokal `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `Publishable key` aus `supabase status` |
| `SUPABASE_SECRET_KEY` | `Secret key` aus `supabase status`; nur serverseitig, nie mit `NEXT_PUBLIC_` |
| `DEMO_USER_PASSWORD` | frei gewähltes Passwort für alle Demo-Nutzer, mindestens 12 Zeichen |

Die übrigen Variablen (`N8N_WEBHOOK_URL`, `BLOB_READ_WRITE_TOKEN`, Turnstile, Make) sind nur für das Website-Formular und die Automatisierung nötig, siehe unten. Ohne sie läuft der Mitarbeiterbereich vollständig. Für die Dienste auf dem Rechner (`npm run ops:install`, [betrieb.md](betrieb.md#23-dauerbetrieb-des-rechners)): `BACKUP_PASSPHRASE`, `SMTP_USER`, `SMTP_APP_PASSWORD`, `ALERT_EMAILS` (unten), `N8N_API_KEY` (n8n → Settings → n8n API, für den Wächter und `n8n/assign_error_workflow.mjs`), optional `MIRA_CREDIT_MIN`; Beschreibung in `.env.example`.

Verbindung prüfen:

```bash
npm run supabase:check               # Auth health: HTTP 200, Admin API: OK
```

## Demo-Nutzer und Demodaten

```bash
npm run demo:users                   # 8 Demo-Nutzer (Admin, Manager, 3 Dispatcher, 3 Techniker)
npm run demo:seed                    # rund 600 Anfragen über 24 Monate, idempotent
npm run demo:verify                  # jede Zeile muss "ok" zeigen
```

Anmeldung mit `admin.demo@example.com`, `manager.demo@example.com`, `dispo1…3.demo@example.com` oder `technik1…3.demo@example.com` und dem Passwort aus `DEMO_USER_PASSWORD`. Rollen, Umfang und Bereinigung: [demo-data.md](demo-data.md).

## Start

Entwicklung:

```bash
npm run dev                          # http://localhost:3000, Anmeldung unter /login
```

Produktionsbuild lokal:

```bash
npm run build                        # Webpack-Build (siehe website.md)
npm run start                        # http://localhost:3000
```

Ein anderer Port: `npm run dev -- -p 3201` bzw. `npx next start -p 3202`.

Bis zum Projektende läuft alles aus diesem Ordner (task-17-17). Nächtliche Sicherung und Wächter als Dienste: `npm run ops:install`; dafür brauchen node und zsh Festplattenvollzugriff ([betrieb.md](betrieb.md#23-dauerbetrieb-des-rechners)).

Startseiten je Rolle: Admin und Manager → Übersicht, Dispatcher → Erstbearbeitung, Techniker → Mein Tag. Die Techniker-Seiten sind für Tablet und Smartphone gestaltet.

## Prüfungen

Befehle, Dauer und Abdeckung stehen in [testing.md](testing.md). Kurzfassung in sinnvoller Reihenfolge:

```bash
npm run lint && npm run typecheck && npm run test:unit
npm run test:db                      # pgTAP, Szenarien 1–7
supabase db lint                     # Schema-Linter; nur Warnungen erlaubt
npm run test:api                     # REST/RPC/Storage mit echten Logins, Nebenläufigkeit
npm run build && npx next start -p 3202 &
APP_URL=http://127.0.0.1:3202 npm run test:auth   # Cache-Header nur im Produktionsserver korrekt
APP_URL=http://127.0.0.1:3201 npm run test:ui     # laufende App (dev oder start), ca. 8 Minuten
npm run demo:seed && npm run demo:verify          # Testdaten von test:api/test:ui entfernen, dann prüfen
```

`demo:verify` direkt nach `test:api` oder `test:ui` meldet deren Testanfragen (Basiswert 5 Minuten) als Abweichung; das ist erwartet und verschwindet mit dem nächsten `demo:seed`.

## Abhängigkeiten und Sicherheitsmeldungen

Dependabot meldet Schwachstellen aus `package-lock.json`. Stand 13.10.2026 (task-10-9): `next` und `eslint-config-next` auf 16.3.8 (u. a. RCE in `next/og`, SSRF in der Bildoptimierung, Cache-Poisoning), transitiv `sharp` 0.35.5, `undici` 6.29.0 (über `@vercel/blob`), `source-map-js` 1.2.2, `brace-expansion` 1.1.21/5.0.12. Offen bleibt nur `braces` 3.0.3 (DoS bei tief verschachtelten Mustern): ohne behobene Version, nur Entwicklungsabhängigkeit (`eslint-config-next` → `fast-glob` → `micromatch`), verarbeitet keine Eingaben von außen und ist nicht Teil der ausgelieferten App. `npm audit fix --force` würde `eslint-config-next` auf 14.x zurückstufen und ist deshalb nicht anzuwenden. Prüfen mit `npm audit` (erwartet: nur `braces` und die davon abhängigen Pakete).

## Datenbank zurücksetzen und Schemaänderungen

```bash
npm run backup                       # vorher sichern
supabase db reset                    # alle Migrationen neu, löscht alle Daten und Demo-Nutzer (nur mit Absicht)
npm run demo:users && npm run demo:seed
npm run db:types                     # nach Schemaänderungen: lib/supabase/database.types.ts neu erzeugen
```

Neue Schemaänderungen nur als Migration unter `supabase/migrations/`; eine einzelne neue Migration ohne Datenverlust mit `supabase migration up`.

## Optional: Website-Formular und Automatisierung

- **Website-Formular:** Upload über Vercel Blob (`BLOB_READ_WRITE_TOKEN`) und Spam-Schutz über Turnstile; Details in [website.md](website.md).
- **n8n (lokal, `http://localhost:5678`):** sechs Workflows für Eingang, Analyse, Anhänge und Gmail, zwei für den Telefonassistenten; Aufbau und Einrichtung in [n8n-workflows.md](n8n-workflows.md). Importierbare Graphen unter `n8n/workflows/*.workflow.json`, Vertrag und Prüfungen in [n8n-contract.md](n8n-contract.md). Danach `N8N_WEBHOOK_URL` in `.env.local` setzen. Ohne diese Variable leitet das Formular an `MAKE_WEBHOOK_URL` weiter; ist keine der beiden gesetzt, antwortet `/api/service-request` mit 503 (`not_configured`).
- **Zahlungserinnerungen:** pg_cron-Job `payment-reminders` täglich 06:00 UTC, wird von den Migrationen angelegt; Versand nur über den n8n-Gmail-Workflow.

## Passwort-E-Mails (Supabase Auth)

Lokal landen die E-Mails „Neues Passwort festlegen“ und „Ihr Passwort wurde geändert“ in Mailpit unter `http://127.0.0.1:54324`, nicht im echten Postfach. Für echte Zustellung braucht Supabase einen SMTP-Server, z. B. Gmail mit App-Passwort (Google-Konto → Sicherheit → App-Passwörter), in `supabase/config.toml` bzw. im Supabase-Projekt (Authentication → SMTP):

```toml
[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"
port = 587
user = "rheinwerk.industrieservice@gmail.com"
pass = "env(SUPABASE_AUTH_SMTP_PASSWORD)"
admin_email = "rheinwerk.industrieservice@gmail.com"
sender_name = "RheinWerk Service Desk"
```

Das App-Passwort gehört nur in die Umgebung, nie ins Repository. Ohne eigenen SMTP-Server begrenzt Supabase den Versand stark (`[auth.rate_limit] email_sent`). Im Betrieb außerdem `site_url` und `additional_redirect_urls` auf die echte Domain setzen, sonst verweist der Link auf eine lokale Adresse. Wer keinen Link nutzen kann, erhält vom Admin ein vorläufiges Passwort (Verwaltung → Person → Passwort).

**Im Betrieb (seit 22.10.2026, task-18-4):** Supabase Auth auf dem VPS versendet über Gmail-SMTP (`SMTP_*` in `/opt/rheinwerk/.env`) und lädt die Vorlagen von der Website (`/auth-mail/…`, Kopien von `supabase/templates`, Test `tests/unit/auth-mail.test.mjs`). Der Link führt immer auf `SITE_URL` (`https://rheinwerk-service.online/auth/bestaetigen`); die Vercel-Adresse `*.vercel.app` steht nicht auf der Liste erlaubter Ziele.

## Deployment auf Vercel

Projekt `rheinwerk-industrieservice` (Team `fuzz-cube`), verbunden mit `FuzzCube/RhenWerk-WebSite`, Branch `main`. Veröffentlicht wird seit task-18-5 nur über GitHub Actions nach grünen Prüfungen und Migrationen (betrieb.md 3.8), nicht mehr direkt bei jedem Push. Funktionen in `cdg1` (Paris, `vercel.json`). Domain `rheinwerk-service.online` (DNS in Cloudflare: `A @ 216.198.79.1`, `CNAME www` auf Vercel, beide „DNS only“), `www` leitet mit 308 auf die Domain um. Lokaler Ordner per `vercel link` verbunden (`.vercel/`, nicht im Repository).

Umgebungsvariablen (nur Production, alle „sensitive“, Werte nie ins Repository):

| Variable | Wert |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://api.rheinwerk-service.online` (hinter Cloudflare Access) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` | neue Schlüssel aus `/opt/rheinwerk/.env` |
| `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` | Service Token „ElevenLabs Mira“ (Supabase-API und n8n) |
| `N8N_WEBHOOK_URL` | `https://n8n.rheinwerk-service.online/webhook/rheinwerk-service-request` |
| `SITE_URL` | `https://rheinwerk-service.online` |
| `ELEVENLABS_API_KEY`, `HEALTH_TOKEN` | wie `.env.local` |
| `BLOB_READ_WRITE_TOKEN`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | Blob-Speicher und Produktionsschlüssel von Turnstile |

Setzen ohne Anzeige des Werts: `printf '%s' "$WERT" | vercel env add NAME production --force`, danach neu veröffentlichen (`vercel redeploy https://rheinwerk-service.online --target production`); Variablen gelten erst für neue Deployments. **Rückweg:** Vercel → Deployments → älteres Deployment → *Instant Rollback* (ohne neuen Build; Datenbankänderungen werden nicht zurückgedreht).

**Grenzen des Hobby-Tarifs** (geprüft 22.10.2026): 100 GB Datenübertragung, 1 Mio. Funktionsaufrufe und 4 h aktive CPU im Monat, 1 Stunde Laufzeitprotokolle; bei Überschreitung pausiert das Projekt. Erwartete Last einer Portfolio-Demo liegt weit darunter (Seiten statisch, Dashboard-Seiten je wenige Abfragen); Nutzung monatlich unter Vercel → Usage prüfen. Nur nicht-kommerziell: die Website ist im Fußbereich und im Impressum als fiktives Portfolio-Projekt gekennzeichnet (betrieb.md 3.4).

## Warn-E-Mails an den Betreiber (Gmail SMTP)

Warnungen aus Updates und Überwachung (Phase 17) gehen direkt per Gmail SMTP an den Betreiber, nicht über n8n, damit auch ein Ausfall von n8n gemeldet werden kann (`scripts/lib/notify.mjs`, nur Skripte auf dem Rechner).

1. Im Google-Konto **`rheinwerk.industrieservice@gmail.com`** (dem Absender, nicht dem Empfänger) die Bestätigung in zwei Schritten einschalten.
2. Als dieses Konto angemeldet unter <https://myaccount.google.com/apppasswords> ein App-Passwort „RheinWerk Alerts“ erzeugen (16 Buchstaben).
3. In `.env.local` eintragen (Leerzeichen im Passwort sind erlaubt):

   ```bash
   SMTP_USER=rheinwerk.industrieservice@gmail.com
   SMTP_APP_PASSWORD=xxxx xxxx xxxx xxxx
   ALERT_EMAILS=andrejs.sadkovojs@gmail.com      # kommagetrennt; Nutzerentscheidung 21.10.2026: nur der Admin
   ```

4. Prüfen: `npm run notify:test`.

`535 5.7.8 Username and Password not accepted`: Das App-Passwort gehört zu einem anderen Konto als `SMTP_USER`, ist widerrufen oder wurde nach einer Passwortänderung ungültig; neues App-Passwort im Absenderkonto erzeugen. Ein fehlgeschlagener Versand bricht keine Prüfung ab; die Datenbank versucht die E-Mail bei der nächsten Prüfung erneut.

## Sicherung

`npm run backup` sichert Datenbank, Dateien und n8n in ein Archiv und löscht Sicherungen, die älter als 14 Tage sind (die neueste bleibt immer), `npm run backup:check` prüft die Wiederherstellung in einer getrennten Datenbank. Vor `supabase db reset` und vor Updates ausführen; jeden Tag um 09:00 automatisch über `online.rheinwerk.backup` (`npm run nightly` von Hand). Einstellungen, Zeitplan und Wiederherstellung: [betrieb.md](betrieb.md#4-datensicherung).

## Ports des lokalen Stacks

| Dienst | Port |
| --- | --- |
| Supabase API | 54321 |
| Postgres | 54322 |
| Studio | 54323 |
| Mailpit (lokale Auth-Mails) | 54324 |
| n8n | 5678 |
