# Datenschutzkonzept Telefonassistent (task-13-1)

Fiktives Portfolio-Projekt; das Konzept beschreibt, wie der Assistent in einem echten Betrieb DSGVO- und AI-Act-konform gestaltet wäre. Keine Rechtsberatung.

## Zweck und Rechtsgrundlage

Aufnahme von Serviceanfragen, Terminvormerkung, Auskunft zu bestehenden Anfragen und Weiterleitung von Notfällen für Firmenkunden. Rechtsgrundlage: vorvertragliche Maßnahmen und Vertragserfüllung (Art. 6 Abs. 1 lit. b DSGVO) sowie berechtigtes Interesse an einer erreichbaren Serviceannahme (lit. f).

## Transparenz

- Erster Satz: Mira ist eine KI (Art. 50 AI Act); das Gespräch wird als Text protokolliert; Hinweis auf die Datenschutzerklärung der Website (Art. 13 DSGVO).
- Auf Nachfrage nennt Mira den Zweck und dass ein Mensch Termine und kritische Fälle prüft.

## Datenminimierung

- Erfasst werden nur die Felder einer Serviceanfrage: Firma, Ansprechperson, geschäftliche Telefonnummer und E-Mail, Standort, Anlage, Anliegen, Dringlichkeit, Sicherheitsgefahr, Terminwunsch, Kunden- oder SLA-Nummer.
- Keine Gesundheitsdaten, keine privaten Adressen, keine Zahlungsdaten.
- Bestandsauskünfte nur nach eindeutigem Treffer und bestätigtem Standort; nie Technikernamen, interne Notizen, Preise oder andere Anfragen.

## Speicherung und Löschung

| Daten | Ort | Frist |
| --- | --- | --- |
| Audio | keine Aufzeichnung (Speicherung auf der Plattform deaktiviert; § 201 StGB) | – |
| Transkript | Supabase `phone_calls` | 30 Tage, automatische Löschung per pg_cron |
| Zusammenfassung, Kategorie, Kennzahlen | Supabase `phone_calls` | wie die zugehörige Anfrage; ohne Anfrage 12 Monate (Löschung noch nicht umgesetzt, Stand 19.10.2026) |
| Anfrage | Supabase `requests` | wie alle Serviceanfragen |
| Rückrufbitte an Techniker | Supabase (Benachrichtigung im Dashboard) | Rückrufnummer nur für diesen Einsatz; Benachrichtigung nur mit Firma, Standort, Nummer und geplantem Beginn |
| Sitzungen des Web-Widgets (task-13-8) | Supabase `widget_sessions` | gesalzener Hash der IP-Adresse (nie die Adresse), Reservierung, Gesprächs-ID; 90 Tage, automatische Löschung per pg_cron |
| Gesprächsdaten bei der Plattform | ElevenLabs | Aufbewahrung minimal einstellen (Zero-Retention, soweit verfügbar) |

## Auftragsverarbeitung (Art. 28 DSGVO)

AV-Verträge mit ElevenLabs (Sprachplattform), dem LLM-Anbieter der Plattform und der Auswertung (OpenAI), Supabase und, falls später genutzt, dem Telefonieanbieter. Für Anbieter mit Verarbeitung in den USA: EU-US Data Privacy Framework oder Standardvertragsklauseln prüfen; EU-Hosting bevorzugen, wo verfügbar.

## Sicherheit

- Werkzeug-Webhooks nur mit gemeinsamem Geheimnis, nur die Agentenpfade über den Cloudflare-Tunnel erreichbar; Supabase nicht öffentlich.
- Datenbankzugriff des Agenten nur über eigene Funktionen mit `service_role`; keine direkten Tabellenzugriffe, keine Auskunft ohne eindeutigen Treffer.
- Minutenlimit für das Web-Widget gegen Missbrauch und Kosten.

## Rechte der Betroffenen

Auskunft, Berichtigung und Löschung über den Service Desk; Transkripte sind über die Gesprächs-ID auffindbar.
