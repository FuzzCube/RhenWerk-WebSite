# Technischer Stack

Der technische Stack ergänzt den zentralen Workshop-Workflow und darf ihn nicht überschreiben.

## Installiert (Stand task-0-1)

- Next.js 16.3.4 (App Router), Build mit Webpack (`next build --webpack`)
- React 19.2.8, React DOM 19.2.8
- TypeScript 5.9, ESLint 9 mit `eslint-config-next` 16.3.4
- Tailwind CSS 4.3.3 über `@tailwindcss/postcss`
- lucide-react 1.40.0 (Icons)
- @vercel/blob 2.8.0 (private Formularanhänge)
- RheinWerk-Designsystem: CSS-Tokens unter `_ds/`, eingebunden über `app/globals.css`

## Supabase (Stand task-0-2)

- `@supabase/ssr` 0.12.7, `@supabase/supabase-js` 2.117.2, `server-only` 0.0.1
- Lokaler Stack über Supabase CLI 2.120.0 (Docker): API `http://127.0.0.1:54321`, Studio `http://127.0.0.1:54323`
- Umgebungsvariablen: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`

## Rechnungs-PDF (Stand task-6-3)

- `pdf-lib` 1.17.1 (MIT, reines JavaScript, nur serverseitig in `lib/invoice-pdf.ts`)
- `@pdf-lib/fontkit` 1.1.1 (MIT) zum Einbetten von Inter und IBM Plex Mono (`assets/fonts/`, SIL OFL 1.1, Stand task-6-4)

## Diagramme (Stand task-7-3)

- `recharts` 3.10.1 (MIT, React 19 laut peerDependencies), nur in `components/dashboard/charts.tsx`
- Kalender: eigene Komponente ohne Bibliothek (task-5-3)

## Warn-E-Mails (Stand task-17-3)

- `nodemailer` 10.0.14 (MIT-0, ohne eigene Abhängigkeiten, exakt gepinnt; neuere 10.1.x erst nach zwei Wochen Reifezeit), nur in `scripts/lib/notify.mjs`, nicht in der Web-App

## Externe Dienste

- Make: Webhook für das Website-Formular (bestehend)
- Cloudflare Turnstile: Bot-Schutz des Formulars
- Vercel: Hosting und Blob-Speicher
- Gmail SMTP (`smtp.gmail.com:465`, App-Passwort): Warn-E-Mails an den Betreiber, unabhängig von n8n
