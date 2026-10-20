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

Die übrigen Variablen (`N8N_WEBHOOK_URL`, `BLOB_READ_WRITE_TOKEN`, Turnstile, Make) sind nur für das Website-Formular und die Automatisierung nötig, siehe unten. Ohne sie läuft der Mitarbeiterbereich vollständig.

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

Startseiten je Rolle: Admin → Verwaltung, Manager → Übersicht, Dispatcher → Erstbearbeitung, Techniker → Mein Tag. Die Techniker-Seiten sind für Tablet und Smartphone gestaltet.

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
supabase db reset                    # alle Migrationen neu, löscht alle Daten und Demo-Nutzer
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

## Sicherung

`npm run backup` sichert Datenbank, Dateien und n8n in ein Archiv, `npm run backup:check` prüft die Wiederherstellung in einer getrennten Datenbank. Vor `supabase db reset` und vor Updates ausführen. Einstellungen, Zeitplan und Wiederherstellung: [betrieb.md](betrieb.md#4-datensicherung).

## Ports des lokalen Stacks

| Dienst | Port |
| --- | --- |
| Supabase API | 54321 |
| Postgres | 54322 |
| Studio | 54323 |
| Mailpit (lokale Auth-Mails) | 54324 |
| n8n | 5678 |
