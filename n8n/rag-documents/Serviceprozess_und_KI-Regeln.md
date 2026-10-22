---
document_id: RW-006
title: Serviceprozess und Regeln für automatisierte Verarbeitung
version: "1.0"
valid_from: 2026-09-01
approval_status: approved
owner: Serviceleitung und interne IT
last_updated: 2026-09-01
next_review: 2027-09-01
protection_class: internal
source_system: documentation
rag_status: active
---

# Serviceprozess und Regeln für automatisierte Verarbeitung

> Fiktives internes Beispieldokument für ein Portfolio- und RAG-Projekt.

- Version: 1.0
- Gültig ab: 01.09.2026
- Dokumentverantwortung: Serviceleitung und interne IT
- Geltungsbereich: Service Desk, Einsatzplanung und automatisierte Verarbeitung

## Pflichtangaben einer Anfrage

- Firma und Kontaktperson
- Standort der Maschine
- Maschinentyp und Maschinennummer
- Fehlerbild und Zeitpunkt des Auftretens
- Betriebszustand und Produktionsauswirkung
- bekannte Sicherheitsgefahr
- gewünschter Termin und vorhandene Vertrags- oder SLA-Nummer

Zulässige Anhänge sind PDF, JPG und PNG bis 20 MB je Datei. Fehlende Pflichtangaben werden vor einer verbindlichen Termin- oder Preiszusage nachgefordert. Verdächtige Anhänge werden isoliert und an die IT gemeldet.

## Standardprozess

1. Eingang per E-Mail oder Webformular.
2. Prüfung von Pflichtangaben, Anhängen und Duplikaten.
3. Extraktion von Kunde, Maschine, Fehlerbild und Dringlichkeit.
4. Abgleich mit Auftrag, Wartungsunterlagen und SLA.
5. Menschliche Prüfung bei Unsicherheit oder erhöhtem Risiko.
6. Erstellung oder Aktualisierung des Servicevorgangs.
7. Versand einer bestätigten Eingangs- oder Kundenantwort.
8. Protokollierung von Zeit, Fehlern, Korrekturen und Bearbeitungsstatus.

## Erlaubte Automatisierung

Die automatisierte Verarbeitung darf:

- Daten in strukturierte Felder übertragen
- mögliche Duplikate markieren
- eine Priorität vorschlagen
- relevante Vertrags-, SLA- und Handbuchstellen suchen
- Eingangsbestätigungen und Antwortentwürfe erstellen
- einen Vorgang im führenden Ticketsystem anlegen oder ergänzen

Sie darf keine nicht dokumentierten Preise, Fristen oder Garantien erfinden.

## Konfidenz und Human Review

- Ab 85 % Konfidenz: strukturierte Erfassung und neutraler Eingangsbestätigungsentwurf sind zulässig.
- 65 % bis unter 85 %: ein Mensch prüft Daten, Priorität und Antwort vor externer Verwendung.
- Unter 65 %: vollständige manuelle Bearbeitung.

Unabhängig von der Konfidenz brauchen folgende Fälle eine menschliche Freigabe:

- P1-Fälle und Sicherheitsgefahren
- Ablehnung eines Auftrags
- individuelle Preis-, Rabatt- oder Terminzusagen
- Gewährleistung, Haftung, Beschwerden und Gutschriften
- Widersprüche zwischen Auftrag, SLA und Wissensquelle
- ungewöhnliche oder möglicherweise sensible personenbezogene Daten

## Priorität und Eskalation

- Produktionsstillstand oder Sicherheitsgefahr: sofort P1 und Serviceleitung informieren
- erhebliche Einschränkung: P2 zur zeitnahen Disposition
- unvollständige Anfrage: fehlende Angaben anfordern
- Preis- oder Vertragsabweichung: Vertrieb einschalten
- Datenschutz- oder Sicherheitsvorfall: interne IT und datenschutz@rheinwerk-industrieservice.example informieren

Eine automatisierte Einstufung darf P1 nicht ohne menschliche Prüfung herabsetzen.

## Antwortregeln für den Serviceagenten

Informationsrangfolge:

1. bestätigter Kundenauftrag
2. individueller SLA
3. Dokumente dieses RAG-Pakets
4. menschliche Klärung

Der Agent antwortet kurz, nennt nur belegte Preise und Zeiten und kennzeichnet Zielzeiten nicht als Garantie. Fehlt eine Information oder widersprechen sich Quellen, verspricht der Agent nichts und übergibt an einen Menschen.

## Protokollierung und Ausfall

Gespeichert werden erkannte Felder, vorgeschlagene Priorität, Konfidenz, verwendete Wissensquellen, menschliche Korrekturen und Versandstatus. Bei Ausfall der Automatisierung arbeitet der Service Desk manuell weiter. Kritische Anfragen dürfen nicht auf die Wiederherstellung des Systems warten.

## Kontrolle und Änderung

Die Serviceleitung prüft monatlich Fehlerquote, Korrekturen, Reaktionszeiten und Eskalationen. Prozess- oder Schwellenwertänderungen benötigen die Freigabe von Serviceleitung und interner IT. Verbunden: `Leistungen_und_Preise.md`, `SLA_und_Bearbeitungszeiten.md` und `Datenschutz_kurz.md`.
