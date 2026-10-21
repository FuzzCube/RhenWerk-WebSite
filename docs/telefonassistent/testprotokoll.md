# Testprotokoll Telefonassistent „Mira“ (task-13-8)

Stand 19.10.2026. Szenarien aus [../telefonassistent-plan.md](../telefonassistent-plan.md), Abschnitt 7. Agent `agent_5101m504vtn2f80thr39rbtqv6ws` (LLM `claude-sonnet-4-5`, TTS `eleven_v3_conversational`), Werkzeuge über n8n hinter dem Tunnel.

## Methode

- **Simulation** (`npm run agent:simulate`): echter Agent in ElevenLabs, der Anrufer ist ein zweites Sprachmodell mit Rollenbeschreibung, nur Text. Werkzeugantworten sind die echten Antworten der lokalen Webhooks; Lagen, die die Datenbank nicht auf Abruf liefert (kein freies Fenster, überfälliger Einsatz, gestörtes Werkzeug, Nacht), sind fest vorgegeben im Format des echten Webhooks. Geprüft werden erwartete und verbotene Werkzeuge, Parameter und bei einzelnen Fällen Aussagen. Es entstehen keine Anfragen und keine E-Mails.
- **Live**: Gespräche im Browser über ElevenLabs (15. und 19.10.2026, 7 Gespräche), ausgewertet von `rwCallAnalysis26`; Liste im Dashboard unter „Anrufe“.
- **Datenbank und Oberfläche**: `test:db` (pgTAP), `test:agent` (Webhooks), `test:ui`.

Nicht geprüft werden konnte die Sprachebene der letzten Änderungen: das ElevenLabs-Guthaben ist seit 19.10.2026 aufgebraucht (Live-Gespräche und Web-Widget). Die Simulation lief weiter.

## Ergebnisse

Läufe der Simulation am 19.10.2026: fünf vollständige Läufe aller 16 Fälle (der zweite teils mit dem Prompt vor den Nachbesserungen, die letzten beiden mit Demo-Weiterleitung) und Wiederholungen der nachgebesserten Fälle. „Bestanden“ heißt: im letzten vollständigen Lauf und in den Wiederholungen nach der letzten Änderung wie erwartet.

| Nr. | Szenario | Prüfung | Ergebnis | Status |
| ---: | --- | --- | --- | --- |
| 1 | Neue Anfrage mit Terminvormerkung | Simulation `neu` (Neukunde, E-Mail buchstabiert) und `bestand` (Kundennummer + PLZ, keine Adress- und E-Mail-Fragen); Live 15. und 19.10. (3 Anfragen angelegt); `visit_holds.test.sql` | Werkzeuge in der Reihenfolge Anlage → Gebiet/Kunde → E-Mail → freie Termine → Zusammenfassung → Anlegen; Straße und geprüfte E-Mail übergeben; 3/3 | bestanden |
| 2 | „Nächste Woche Mittwoch“, alles belegt | Simulation `ausgebucht` (keine Fenster) | Mira prüft genau den Mittwoch aus dem Kalender, bietet einen anderen Zeitraum an und legt die Anfrage ohne Termin an. Vor den Nachbesserungen wertete sie die leere Liste in 2 von 5 Läufen als Störung; danach 7 von 8 – die eine Abweichung kam von der festen Simulationsantwort mit widersprüchlichem Datum, ohne Datum 3/3 | bestanden nach Nachbesserung |
| 3 | Unterbrechen und Fensterwechsel | Simulation `umbuchen` (erst erstes Fenster, dann „der zweite passt doch besser“) | Gewechseltes Fenster neu zusammengefasst und vorgemerkt; 3/3 (eine Fehlmeldung kam von einer zu strengen Prüfung, die „das zweite Fenster“ als zweites der Liste statt als zweites angebotenes las). Unterbrechen während Mira spricht ist nur mit Sprache prüfbar | Text bestanden, Sprache offen |
| 4 | Status per Anfragenummer | Simulation `status`; Live 15.10. | Auskunft nur nach bestätigtem Standort, kein Technikername; 3/3, live korrekt | bestanden |
| 5 | Status per Firma und PLZ | Simulation `status_firma` | `anfrage_finden` mit Firma, PLZ und Straße ohne Nummer, Termin „Donnerstag, der 22. Oktober, um 9 Uhr“ genannt; im Verhalten 3/3 (eine Fehlmeldung kam von der Textprüfung, siehe unten) | bestanden |
| 6 | Verspätung → Rückrufbitte → Eskalation | Simulation `verspaetung`; `callback_requests.test.sql`, `test:ui` (Banner, Quittung, Eskalation nach 15 Minuten) | `rueckrufbitte_techniker` mit `anfrage_id` und bestätigter Nummer; 3/3 | bestanden |
| 7 | Preisfrage | Simulation `preis` | Ausgangswerte aus dem Wissen (290 € netto, Anfahrt 1,20 €/km, mind. 45 €), keine Datenaufnahme; im Verhalten 3/3 (zwei Fehlmeldungen kamen von der Textprüfung) | bestanden |
| 8 | Produktionsstillstand am Tag | Simulation `stillstand_tag` | Seit task-13-11 erst `weiterleiten(service_desk)` mit Demo-Ansage, dann `rueckruf_service_desk` mit `dringend: true` und Rückrufnummer, kein Termin; 3/3 | bestanden |
| 9 | Produktionsstillstand nachts mit und ohne SLA | Simulation `notfall` (SLA 24/7) und `notfall_ohne_sla`; Live 15.10. 18:25 (Notfall, dringender Rückruf) | Mit SLA: `sla_pruefen`, Bereitschaft ruft zurück, 3/3. Ohne SLA: dringende Anfrage ohne Termin, Prüfung ab 7 Uhr. Vor den Nachbesserungen fragte Mira nach einem Terminwunsch und rief `freie_termine` wiederholt auf bzw. versprach nachts einen Rückruf „in wenigen Minuten“; seit die Notfallregel im Schritt „Terminwunsch“ steht 5/5. Mit SLA seit task-13-11: Demo-Weiterleitung an die Bereitschaft, dann Rückruf, 3/3 | bestanden nach Nachbesserung |
| 10 | Außerhalb des Gebiets | Simulation `gebiet` (10115 Berlin) | `einsatzgebiet_pruefen` → `nur_mit_vertrag`, keine Anfrage, kein Termin; 3/3 nach Korrektur der Simulation | bestanden |
| 11 | Verärgerter Kunde | Simulation `beschwerde` | Keine Diskussion, in der Servicezeit Demo-Weiterleitung, dann Rückruf durch den Service Desk; 3/3 | bestanden |
| 12 | Werkzeug nicht erreichbar | Simulation `stoerung` (`werkzeug_gestoert`); `test:agent` (Datenbankfehler → `werkzeug_gestoert`) | Fester Text „Ich komme gerade nicht an unser System …“ und `rueckruf_service_desk`; 3/3 | bestanden |
| 13 | Stille | Konfiguration (`agent:sync`) | Bisher endete ein Gespräch bei Stille nie (`silence_end_call_timeout: -1`). Jetzt: Nachfrage nach 7 s, Ende nach 30 s ohne Sprache. Nur mit Sprache prüfbar | konfiguriert, Sprache offen |
| 14 | Spam | Simulation `spam` | Keine Daten, höfliches Ende mit `end_call`; 3/3 | bestanden |
| – | Anlage außerhalb des Leistungsumfangs | Simulation `anlage` (Kälteanlage Bitzer) | Freundliche Absage ohne Datenaufnahme; 3/3 | bestanden |

### Nachbesserungen aus den Läufen

- Leere Liste von `freie_termine` ist keine Störung: anderen Zeitraum anbieten, sonst Anfrage ohne Termin (Systemprompt, Schritt 7 und Werkzeugregel).
- Notfälle: nie nach einem Terminwunsch fragen und nie `freie_termine` aufrufen; ohne Vertrag direkt dringende Anfrage; außerhalb der Servicezeit ohne `gueltig_24_7` kein `rueckruf_service_desk` und kein Versprechen „in wenigen Minuten“.
- Stille: `turn_timeout` 7 s, `silence_end_call_timeout` 30 s (auch wegen des Minutenbudgets des Widgets).
- Simulation: Standardantworten für `anlage_pruefen` und `kunde_finden` (unvorbereitete Werkzeuge beantwortet die Simulation mit einem Fehler; der simulierte Anrufer erfindet manchmal Typ oder Kundennummer). Textprüfungen ignorieren Leerzeichen, weil die Plattform gestreamte Wörter trennt („zwe ihundertneunzig“).

## Latenz

Gemessen mit `npm run agent:latency -- --runs 10 --markdown` am 19.10.2026. Live-Werte stammen aus den Metriken, die ElevenLabs je Gesprächsrunde speichert (7 Gespräche).

**Live-Gespräche (7)**

| Messgröße | n | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| Antwortzeit (Ende der Rede bis erstes Audio) | 86 | 1217 ms | 3936 ms | 21855 ms |
| Sprachmodell bis erstes Token | 105 | 368 ms | 885 ms | 4757 ms |
| Sprachmodell bis erster Satz | 98 | 539 ms | 858 ms | 4890 ms |
| Sprachsynthese bis erstes Audio | 105 | 126 ms | 478 ms | 773 ms |
| Spracherkennung nach Redeende | 60 | 68 ms | 103 ms | 131 ms |
| Werkzeuge gesamt, von ElevenLabs gemessen (30 Aufrufe, 10 Werkzeuge) | 30 | ca. 600 ms | ca. 710 ms | 741 ms |

**Webhooks lokal und durch den Tunnel (10 Aufrufe je Werkzeug, 8 lesende Werkzeuge)**

| Messgröße | n | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| lokal, alle Werkzeuge | 80 | 74 ms | 100 ms | 207 ms |
| Tunnel (Cloudflare Access), alle Werkzeuge | 80 | 162 ms | 288 ms | 454 ms |

Bewertung: Die typische Antwortzeit von 1,2 s liegt im Rahmen eines Telefongesprächs; die langen Ausreißer entstehen in Runden mit Werkzeugaufrufen und Nachdenken des Sprachmodells (Mira sagt dort „Einen Moment, ich schaue nach“). Die Werkzeuge bleiben mit rund 0,6 s klar unter dem Ziel von 1,5 s; davon entfallen etwa 0,16 s auf n8n und Tunnel, der Rest auf den Weg der Plattform. Größter Hebel wäre ein schnelleres Sprachmodell (Haiku statt Sonnet, Nutzerentscheidung 19.10.2026 für Sonnet wegen besserer Gesprächsführung).

## Demo-Anruf und Demo-Weiterleitung (task-13-11)

Die Widget-Karte der Kontaktseite wurde durch einen simulierten Anruf über die Service-Desk-Nummer ersetzt ([setup.md](setup.md)). Geprüft: `widget_sessions.test.sql` (Budget, Reservierung, echte Dauer nach Auswertung, 3 Sitzungen je Anschluss und Stunde), `agent_forward.test.sql`, `test:agent` (Werkzeug `weiterleiten`), `test:ui` (Dialog über die Nummer bei 1440 px und die Anruf-Schaltfläche bei 390 px, Hinweis, Schließen, gesperrt ohne Budget, API 403/429, Demo-Weiterleitung im Bereich „Anrufe“).

Simulation mit Demo-Weiterleitung (19.10.2026): `stillstand_tag` (Service Desk am Tag), `beschwerde` (Service Desk) und `notfall` (nachts mit SLA 24/7: Bereitschaft) rufen `weiterleiten` auf, lesen die Demo-Ansage vor und nehmen danach den Rückruf auf; `notfall_ohne_sla` und `spam` leiten nicht weiter. Dabei fiel `notfall_ohne_sla` erneut einmal in die Terminsuche zurück; die Notfallregel steht seitdem direkt im Schritt „Terminwunsch“ des Ablaufs, danach 5/5. Weiterleitung: `stillstand_tag`, `beschwerde` und `notfall` je 3/3.

Offen: ein Anruf mit Stimme (Freizeichen, Verbindung, Ansage der Demo-Weiterleitung) – Guthaben.

Sprachtest mit Stimme (20.10.2026, Nutzer): vier Anrufe, darunter ein Neukunde mit Termin (Neckarauer Gießerei) und ein Produktionsstillstand nachts ohne SLA (Müller Technik, RIS-2026-02185) – Ablauf wie erwartet. Befund: im Notfallablauf fragte Mira nicht nach der Kundennummer, ein Bestandskunde wäre nicht verknüpft worden (Müller Technik war Neukunde, daher dort korrekt ohne Verknüpfung; der Kunde entsteht beim Abschluss der Erstbearbeitung).

Kundennummer im Notfallablauf (task-16-2, 21.10.2026): Notfallregel im Systemprompt als Schrittfolge a–d (Kundennummer, kurze Aufnahme, Servicezeit, außerhalb mit/ohne SLA). Neues Szenario `notfall_bestand` (K-10000, nachts ohne SLA): `kunde_finden`, Anfrage mit Kundennummer und `production_stop`, ohne Adress- und E-Mail-Fragen. Nach der ersten, nur ergänzten Fassung riefen `notfall_bestand` und `notfall_ohne_sla` nachts `rueckruf_service_desk` bzw. `sla_pruefen` ohne Vertragsnummer auf (2 von 3 Läufen); mit der Schrittfolge 3/3 bzw. 3/3, danach alle 17 Szenarien bestanden.

## Offen

- Sprachtests mit Stimme noch offen: Szenarien 3 (Unterbrechen) und 13 (Stille), ein Gespräch über das Widget, ein Notfall eines Bestandskunden (task-16-2); ElevenLabs-Guthaben ist seit 20.10.2026 wieder vorhanden.
- AV-Verträge und Prüfung der US-Übermittlung (ElevenLabs, OpenAI) vor einem echten Betrieb.
