# RheinWerk Industrieservice – Website und Service-Dashboard

Next.js-16-Website der fiktiven RheinWerk Industrieservice (Portfolio-Projekt mit Demodaten) mit Mitarbeiterbereich unter `/dashboard` (Erstbearbeitung, Einsatzplanung, Techniker, Rechnungen, Auswertung, Verwaltung, Anrufe), lokalem Supabase, lokaler n8n/OpenAI/Gmail-Integration und dem KI-Telefonassistenten „Mira“ (ElevenLabs). Projektstand, Roadmap und Fortschritt stehen unter `.workshop/`; Kurzübersicht mit `npm run workshop:status`.

## Dokumentenkarte

Für den Einstieg genügen `.workshop/CURRENT_STATE.md` und `npm run workshop:status`. Danach nur die Datei öffnen, die zur Aufgabe passt; große Dateien (`database.md`, `architecture.md`, `n8n-contract.md`, `testing.md`) über ihre Überschriften (`grep -n '^## ' <datei>`) gezielt lesen statt vollständig.

| Datei | Inhalt | Lesen, wenn … |
| --- | --- | --- |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Nächste Schritte nach Roadmap v18 | eine neue Arbeit auswählen |
| [docs/setup.md](docs/setup.md) | Lokale Einrichtung, Umgebungsvariablen, Start, SMTP, Sicherheitsupdates | Umgebung einrichten oder starten |
| [docs/supabase-lokal.md](docs/supabase-lokal.md) | Lokales Supabase Schritt für Schritt: Dienste und Ports, Schlüssel, Migrationen, Demodaten, pg_cron, Verbindung zu n8n, Fehlerbehebung | Datenbank einrichten oder Störung suchen |
| [docs/architecture.md](docs/architecture.md) | Aufbau der App: Routen, Rollen, Bereiche, UI-Bausteine, Diagramme, Posteingang, Einsatzplanung, Anrufe | Dashboard-Code ändern |
| [docs/database.md](docs/database.md) | Tabellen, RLS, RPCs mit Fehlercodes, Warteschlangen, Cron-Jobs, Agent-Funktionen | Schema, Migrationen oder RPCs ändern |
| [docs/decisions.md](docs/decisions.md) | Entscheidungen mit Begründung, chronologisch | vor Änderungen an Grundsätzlichem |
| [docs/testing.md](docs/testing.md) | Testsuiten, was sie prüfen, Gesamtprüfung | Tests schreiben oder ausführen |
| [docs/kpi-dictionary.md](docs/kpi-dictionary.md) | Kennzahlen, Formeln, Richtungen | Auswertung oder Übersicht ändern |
| [docs/demo-data.md](docs/demo-data.md) | Demo-Nutzer, Demo-Seed, Prüfung `demo:verify` | Demodaten ändern |
| [docs/betrieb.md](docs/betrieb.md) | Betriebskonzept: Stufe 1 (eigener Rechner, Cloudflare Tunnel, Domain, Dienste `npm run ops:install` für nächtliche Sicherung und Wächter), Stufe 2 (Server), Datensicherung mit `npm run backup`/`backup:check`, Wiederherstellung, Überwachung, Wartungsplan, Notfälle | Betrieb, Sicherung, Wartung oder Umzug |
| [docs/n8n-workflows.md](docs/n8n-workflows.md) | Die acht n8n-Workflows: Gesamtbild, Steckbrief je Workflow, Verbindungen (Credentials, RPCs, Netzwerk), Abläufe als Sequenzdiagramme, Einrichtung von Grund auf, Störungen | n8n verstehen, einrichten oder Störung suchen |
| [docs/n8n-contract.md](docs/n8n-contract.md) | n8n-Workflows, Formularpfad, Gmail, OpenAI, Integrations-RPCs | n8n oder E-Mail-Verarbeitung ändern |
| [docs/website.md](docs/website.md) | Öffentliche Website, Formular, Demo-Anruf | Website ändern |
| [docs/telefonassistent/setup.md](docs/telefonassistent/setup.md) | Einrichtung des Agenten, Werkzeuge, Tunnel, Demo-Anruf, Skripte | Telefonassistent einrichten oder ändern |
| [docs/telefonassistent/regeln.md](docs/telefonassistent/regeln.md) | Gesprächsregeln, Werkzeugverträge, Weiterleitung, Gesprächsauswertung | Verhalten von Mira ändern |
| [docs/telefonassistent/systemprompt.md](docs/telefonassistent/systemprompt.md), [leitfaden.md](docs/telefonassistent/leitfaden.md), [wissensbasis.md](docs/telefonassistent/wissensbasis.md) | Prompt, Gesprächsleitfaden, Wissensbasis | Prompt oder Wissen ändern |
| [docs/telefonassistent/datenschutz.md](docs/telefonassistent/datenschutz.md) | Speicherung, Löschfristen, AI Act | Daten des Telefonassistenten |
| [docs/telefonassistent/testdaten.md](docs/telefonassistent/testdaten.md), [testprotokoll.md](docs/telefonassistent/testprotokoll.md) | Testanrufe und Ergebnisse | Telefonassistent testen |
| [docs/telefonassistent-plan.md](docs/telefonassistent-plan.md) | Ursprünglicher Plan der Phase 13 (Russisch, historisch) | nur zur Herkunft von Entscheidungen |
| [docs/equipment/](docs/equipment/) | Anlagenkatalog (Hersteller, Baureihen) | Modellabgleich |
| [docs/design/](docs/design/) | Rechnungsvorlage (Maßtabelle des PDFs) | Rechnungs-PDF ändern |

## Futureway Workshop Repository

Dieses Repository ist das technologie- und KI-anbieterunabhängige Master-Template für einen geführten Futureway-Workshop. Die konkrete Projektidee wird erst nach dem Klonen in einem daraus erzeugten Teilnehmer-Repository definiert.

Coding-Agenten müssen vor jeder Änderung die Workshop-Dateien lesen. Projektplanung, Fortschritt und wichtige Entscheidungen werden zentral im Repository dokumentiert, damit jederzeit zwischen kompatiblen Coding-Agenten gewechselt werden kann. Eine vorherige Chat-Historie ist nicht erforderlich.

## Für Coding-Agenten

- Codex: Lies zuerst `AGENTS.md`.
- Claude Code: Lies zuerst `CLAUDE.md`.
- Andere Coding-Agenten: Lies zuerst `.agents/generic/INSTRUCTIONS.md`.

Danach gelten für alle Agenten dieselben autoritativen Dateien unter `.workshop/`.

## Verwendung

Dieses Repository wird als Master-Template gepflegt. Erst in einem abgeleiteten Teilnehmer-Repository werden Projektidee, Workshop-Typ, Technologie, Starter-Code und projektspezifische Rahmenbedingungen festgelegt.

## Workshop Repository Standard v1.1

Der Standard trennt den zentralen Projektzustand unter `.workshop/` von den schlanken, tool-spezifischen Adaptern. Roadmap, Task-Verifikation und abgeleiteter Fortschritt bleiben dadurch auch bei einem Agentenwechsel nachvollziehbar. Das Dashboard arbeitet mit dem synchronisierten Repository-Stand; lokale, noch nicht synchronisierte Änderungen sind dort nicht automatisch sichtbar.

Dieses Master-Template wird später in konkrete Workshop-Repositories abgeleitet. Workshop-Typ, Technologien, Starter-Code, Setup, technische Constraints, Quality Gate und erlaubte Tools oder Libraries werden dort primär unter `.workshop/specialization/` ergänzt. Der zentrale Workflow in `.workshop/AGENT_PROTOCOL.md` bleibt davon unabhängig und darf durch die Spezialisierung nicht überschrieben werden.

## Erwarteter Erststart

Wenn ein frisch erzeugtes Teilnehmerrepository noch nicht initialisiert ist und der Nutzer beispielsweise `starte` eingibt, lautet die erwartete Agent-Antwort: `Was möchtest du entwickeln?`

Danach wartet der Agent auf die Projektidee.
