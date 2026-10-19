# Regeln und Werkzeugverträge „Mira“ (task-13-1)

Verbindlich für Prompt, n8n-Webhooks (task-13-5) und Datenbankfunktionen (task-13-2 bis 13-4). Zeiten in Europe/Berlin.

## Servicezeit

Mo–Fr 07:00–18:00, ohne gesetzliche Feiertage in Baden-Württemberg. `in_servicezeit` berechnet n8n, nicht das Sprachmodell.

## Weiterleitung

| Fall | In der Servicezeit | Außerhalb, Anrufer nennt 24/7-SLA | Außerhalb, ohne SLA |
| --- | --- | --- | --- |
| Gefahr für Personen | fester Text, Ende, dringende Meldung | wie links | wie links |
| Produktionsstillstand | `weiterleiten(service_desk)` | `sla_pruefen` = `gueltig_24_7` → `weiterleiten(bereitschaft)`, sonst wie rechts | dringende Anfrage ohne Termin, Prüfung ab 07:00 |
| Sicherheitsgefahr bekannt/unklar | `weiterleiten(service_desk)` | `sla_pruefen` = `gueltig_24_7` → `weiterleiten(bereitschaft)`, sonst wie rechts | dringende Anfrage ohne Termin, Prüfung ab 07:00 |
| Beschwerde, „Mensch bitte“ | `weiterleiten(service_desk)` | Rückruf nächster Werktag | Rückruf nächster Werktag |
| Alles andere | Mira bearbeitet selbst | Mira bearbeitet selbst | Mira bearbeitet selbst |

- SLA (task-13-9): Mira fragt nach Vertragsnummer und PLZ des Standorts und ruft `sla_pruefen` auf (Vertragsbestand `service_contracts`). Nur `gueltig_24_7` führt nachts zur Bereitschaft. `gueltig_ohne_24_7`: „Ihr Vertrag umfasst keinen 24/7-Notdienst“; `abgelaufen`/`noch_nicht_gueltig`: Hinweis auf den Vertragsstand; `passt_nicht`/`unbekannt`: „Den Vertrag kann ich nicht bestätigen“ – jeweils dringende Anfrage. Mira nennt nie die Firma zu einer Nummer. `sla_verified` an der Anfrage setzt weiterhin ein Mensch; die Anfrage zeigt dazu „Vertragsbestand“. Testnummern: [testdaten.md](testdaten.md).
- Nicht erreicht (Besetzt, keine Annahme): Anfrage bzw. Rückrufwunsch als dringend, Text „Weiterleitung nicht erreicht“.
- Ziele (Telefonnummern) stehen in n8n, nicht im Prompt.

## Auskünfte zu einer Anfrage

Auskunft nur, wenn `anfrage_finden` genau einen Treffer liefert und der Anrufer den Standort bestätigt hat. Erlaubt sind nur die Felder der Antwort von `anfrage_finden`; nie Technikernamen, interne Notizen, Preise, Rechnungen oder andere Anfragen derselben Firma.

| `lage` | Bedingung (Reihenfolge) | Aussage |
| --- | --- | --- |
| `storniert` | Erstbearbeitung `cancelled` oder Arbeit `cancelled` | storniert |
| `abgelehnt` | Erstbearbeitung `rejected` | nicht übernommen, Grund nicht nennen, Rückruf anbieten |
| `abgeschlossen` | Arbeit `completed` | Arbeiten abgeschlossen |
| `vor_ort` | ein Einsatz `in_progress` | Techniker vor Ort eingetragen |
| `wartet_auf_teile` | Arbeit oder letzter Einsatz `waiting_parts` | wartet auf Ersatzteil |
| `ueberfaellig` | nächster Einsatz `scheduled`, Beginn vorbei, Ende + 2 h nicht vorbei | eingeplant, Techniker wird benachrichtigt → `rueckrufbitte_techniker` |
| `geplant` | nächster Einsatz `scheduled` in der Zukunft | Tag und Uhrzeit |
| `vorgemerkt` | offene Terminvormerkung (task-13-3) | vorgemerkt, Bestätigung durch Service Desk ausstehend |
| `wartet_auf_kunde` | Erstbearbeitung `awaiting_customer` | Rückfrage per E-Mail beantworten |
| `in_pruefung` | sonst | wird geprüft, Service Desk meldet sich |

## Terminvormerkung (task-13-3)

- Dauer nach Leistung: Inspektion 120 min, Wartung 180 min, Diagnose/Reparatur 120 min (erster Einsatz).
- Freie Fenster (`agent_free_slots`, umgesetzt in task-13-3): Arbeitszeiten aktiver Techniker abzüglich reservierender Einsätze (geplant, läuft), Abwesenheiten und offener Vormerkungen; Start im 30-Minuten-Raster ab Beginn der Arbeitszeit; frühestens ab dem nächsten Werktag, nicht weiter als 6 Wochen; je Tag der früheste Vormittags- und der früheste Nachmittagsbeginn, höchstens drei Fenster, frühester Tag zuerst. Den Techniker wählt die Datenbank (am wenigsten belegt an dem Tag). Feiertage kennt die Suche noch nicht; Fahrzeiten und die PLZ fließen noch nicht ein.
- Mira nennt Beginn und ungefähre Dauer, nie einen Technikernamen.
- Vormerkung blockiert das Fenster für andere Anrufer, bis der Dispatcher entscheidet, höchstens 2 Werktage. Danach verfällt sie; die Anfrage bleibt in der Erstbearbeitung mit Hinweis.
- Bestätigen plant den Einsatz mit Konfliktprüfung und sendet eine Bestätigung per E-Mail; Ablehnen verlangt einen Grund und optional einen Gegenvorschlag, der Kunde erhält eine E-Mail.
- Notfälle (Stillstand, Gefahr) bekommen keine Vormerkung: sie gehen sofort an Menschen (`termin_hinweis: notfall_ohne_vormerkung`).
- Ist das Fenster beim Anlegen schon vergeben, entsteht die Anfrage ohne Vormerkung (`termin_vorgemerkt: false`, `termin_hinweis: fenster_nicht_mehr_frei`); Mira bietet ein anderes Fenster an oder sagt, dass der Service Desk den Termin abstimmt.
- Bestätigen ist erst nach abgeschlossener Erstbearbeitung möglich (wie jede Einsatzplanung). Vormerkungen blockieren die manuelle Planung nicht; die Plantafel zeigt sie schraffiert.

## Rückrufbitte an Techniker (task-13-4)

- Nur bei `lage = ueberfaellig` und bestätigter Rückrufnummer; höchstens eine offene Bitte je Einsatz (Wiederholung liefert die bestehende).
- Empfänger: zugewiesener Techniker des Einsatzes, als Benachrichtigung im Dashboard (Banner auf jeder Seite, Aktualisierung alle 20 Sekunden, auf Wunsch Browser-Benachrichtigung). Inhalt: Firma, Standort, Rückrufnummer, geplanter Beginn. Kein Telegram (Nutzerentscheidung 15.10.2026); später ggf. Push über eine eigene Techniker-App.
- Quittung „Kunde angerufen“ durch den Techniker. Ohne Quittung nach 15 Minuten dringend an den Dispatcher der Anfrage (ersatzweise alle aktiven Dispatcher), ebenfalls als Banner mit Quittung. Beginnt der Einsatz, ist die Bitte erledigt.
- Werkzeug: `agent_request_callback` (Migration `20261016090000_callback_requests.sql`, [../database.md](../database.md)).

## Werkzeugverträge

Alle Werkzeuge sind POST-Webhooks in n8n (`/webhook/agent-<name>`, Bindestriche statt Unterstriche, z. B. `agent-freie-termine`) mit Header `x-agent-secret` und dem Service Token von Cloudflare Access; Einrichtung in [setup.md](setup.md). Umsetzung task-13-5: `wissen` entfällt (Wissensbasis im Prompt), `weiterleiten` ist im Web-Widget durch `rueckruf_service_desk` ersetzt, `servicezeit` liefert Datum, Uhrzeit, `in_servicezeit` und `kalender` (nächste 21 Tage mit Wochentag, KW und Feiertagen; der Agent liest Daten dort ab, statt zu rechnen), `gespraech_beenden` heißt `end_call`. Datenbankfunktionen dahinter (task-13-2, `docs/n8n-contract.md` Abschnitt 6): `freie_termine` → `agent_free_slots`, `anfrage_anlegen` → `agent_create_request` (mit `termin_beginn`), `anfrage_finden` → `agent_find_request`, `einsatzgebiet_pruefen` → `agent_check_area`, `sla_pruefen` → `agent_check_contract`; `anlage_pruefen` läuft in n8n mit dem bestehenden Katalogabgleich. Antwortzeit-Ziel unter 1,5 s. Jeder Aufruf trägt `call_id` (Gesprächs-ID der Plattform). Fehler: `{ "ok": false, "fehler": "<code>" }`; Mira nutzt dann den Text „Werkzeug gestört“.

| Werkzeug | Eingabe | Ausgabe |
| --- | --- | --- |
| `wissen` | `frage` | `antwort` (≤ 3 Sätze), `quelle` |
| `anlage_pruefen` | `anlagenart?`, `hersteller?`, `typ?` | `status` (`listed_model`, `series_match`, `brand_only`, `needs_review`, `out_of_scope`), `hersteller`, `baureihe`, `fehlende_angaben[]`, `aehnliche_baureihen[]` und `rueckfrage` („Meinen Sie die Baureihe CR?“, wenn bei bekanntem Hersteller die Buchstaben des Typs um höchstens einen von einer Baureihe abweichen, z. B. „CIR 32“ aus der Spracherkennung), `satz` (ein Satz für den Anrufer) – derselbe deterministische Abgleich wie in der Analyse (`docs/equipment/RheinWerk_Anlagenkatalog_DE.md`) |
| `email_pruefen` | `call_id`, `buchstaben` (wie gehört: „A, N, N, A, Punkt, M, at gmail Punkt com“) | `email`, `ansage` (zum Vorlesen) oder `fehler: email_ungueltig`; RPC `agent_check_email`. Das Sprachmodell setzt Adressen nie selbst zusammen: `anfrage_anlegen` speichert für das Gespräch immer die zuletzt geprüfte Adresse |
| `sla_pruefen` | `vertragsnummer`, `firma?`, `plz?` | `status` (`gueltig_24_7`, `gueltig_ohne_24_7`, `abgelaufen`, `noch_nicht_gueltig`, `passt_nicht`, `unbekannt`, `angaben_fehlen`), `gueltig_bis?`; RPC `agent_check_contract`, nennt keine Firma |
| `einsatzgebiet_pruefen` | `plz` | `ergebnis` (`in_gebiet`, `nur_mit_vertrag`, `ungueltig`), `ort` |
| `freie_termine` | `von_tag`, `bis_tag?`, `leistung`, `plz` | `fenster[]` mit `beginn` (ISO), `dauer_minuten`, `ansage` („Mittwoch, der 21. Oktober, um 13 Uhr“) |
| `anfrage_anlegen` | `call_id`, Felder wie Telefonanfrage (Firma, Kontakt, Telefon, E-Mail, Kundennummer, Straße, PLZ, Ort, Anlagenart, Hersteller, Typ, Leistung, Beschreibung, Dringlichkeit, Sicherheitsgefahr, Wunschtermin), `termin_beginn?`, `sla_vertragsnummer?` | `anfrage_nummer`, `termin_vorgemerkt` (bool), `termin_ansage?`; gleicher `call_id` liefert dieselbe Anfrage |
| `anfrage_finden` | `nummer?`, `firma?`, `plz`, `strasse?` | `treffer` (0, 1, mehrere), bei 1: `anfrage_id`, `anfrage_nummer`, `standort` („Pumpe, Hafenstraße 12, Mannheim“), `lage`, `termin_ansage?` |
| `rueckrufbitte_techniker` | `call_id`, `anfrage_id`, `rueckrufnummer` | `ok`, `bereits_offen` (bool) |
| `weiterleiten` | `ziel` (`service_desk`, `bereitschaft`) | Systemfunktion der Plattform; Nummer aus n8n-Konfiguration |
| `gespraech_beenden` | – | Systemfunktion der Plattform |

Pflichtfelder von `anfrage_anlegen` entsprechen `private.validate_request_fields` (wie Telefonanfrage, task-11-4); fehlt etwas, antwortet das Werkzeug mit `fehlende_felder[]`, Mira fragt nach.

## Gesprächsauswertung (task-13-6)

Nach jedem Gespräch: Transkript → JSON nach Schema in [../telefonassistent-plan.md](../telefonassistent-plan.md) (Abschnitt 4) → `phone_calls`. Dringend gemeldet werden Gefahr für Personen, Stillstand und Sicherheitsgefahr außerhalb der Servicezeit sowie nicht erreichte Weiterleitungen.
