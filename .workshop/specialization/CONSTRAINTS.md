# Technische Rahmenbedingungen

Diese Rahmenbedingungen ergänzen den zentralen Workshop-Workflow und dürfen ihn nicht überschreiben.

- Next.js 16 weicht von älteren Versionen ab: vor Codeänderungen die Dokumentation unter `node_modules/next/dist/docs/` lesen (siehe `nextjs-agent-rules` in `AGENTS.md`). Cookie-Handling über die Proxy-Konvention.
- Nutzerauftrag vom 08.10.2026 (task-10-4): Make durch lokales n8n ersetzen; Supabase auf dem Mac. Route unterstützt N8N_WEBHOOK_URL, aktives Make bleibt bis zum vollständigen Integrationstest bestehen. Schreiben nur über kontrollierte RPCs.
- Keine Geheimnisse im Repository. `.env.local` ist ignoriert; `.env.example` enthält nur Variablennamen ohne Werte. Service-Role-Schlüssel nur serverseitig.
- Berechtigungen werden in der Datenbank (RLS) und in kontrollierten Serveroperationen durchgesetzt; ausgeblendete UI-Elemente sind keine Berechtigung.
- Supabase ist der einzige Datenspeicher des Dashboards; kein localStorage-Ersatz.
- Nutzerauftrag task-10-4 erlaubt Gmail-Anbindung an rheinwerk.industrieservice@gmail.com. OAuth und die ausdrücklich gewählte OpenAI-Verarbeitung sind verifiziert; Versand nur für freigegebene Nachrichten. Ein autorisiertes Testmail wurde real zugestellt und die echte Antwort derselben Anfrage zugeordnet und analysiert. Alle sechs Workflows sind veröffentlicht. Lokaler Formularpfad einschließlich privater Vercel-Blob-Dateien wurde real geprüft und nutzt n8n; öffentliche Website-Umschaltung ist gesonderte Deployment-Konfiguration.
- Dashboard-Oberfläche auf Deutsch, Formatierung `de-DE`, Zeitzone `Europe/Berlin`.
- Neue Abhängigkeiten nur bei Bedarf und nach Prüfung der Kompatibilität mit React 19 / Next.js 16.
