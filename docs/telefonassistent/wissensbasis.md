# Wissensbasis „Mira“ (task-13-1)

Kurzfassung für den Telefonassistenten. Quellen: Website (`components/pages.tsx`, `components/site-shell.tsx`) und Anlagenkatalog (`docs/equipment/RheinWerk_Anlagenkatalog_DE.md`). Primär beantwortet das Werkzeug `wissen` (RAG-Assistent der Website) Fragen; diese Seite ist die Rückfallebene und wird in die Wissensbasis der Plattform geladen. Fiktives Unternehmen, Demo-Festlegungen.

## Unternehmen

- RheinWerk Industrieservice GmbH, Rheinwerkstraße 12, 68169 Mannheim.
- Service Desk: +49 621 00000-0, service@rheinwerk-industrieservice.example.
- 55 Mitarbeitende, davon 30 Servicetechniker.
- Branchen: Industrie, Logistik, Lebensmittelproduktion.

## Servicezeiten und Notdienst

- Montag bis Freitag 07:00–18:00 Uhr, ohne gesetzliche Feiertage in Baden-Württemberg.
- Anfragen außerhalb dieser Zeiten werden am nächsten Werktag geprüft.
- Der 24/7-Notfallkanal steht nur Kunden mit vereinbartem Notfall-SLA zur Verfügung.
- Bei Produktionsstillstand oder Sicherheitsgefahr prüft immer ein Mensch.

## Einsatzgebiet

- Metropolregion Rhein-Neckar, Anfahrt ab Mannheim.
- Regelmäßig: Mannheim, Ludwigshafen, Heidelberg, Speyer, Worms, Weinheim, Schwetzingen, Hockenheim.
- Außerhalb nur mit vertraglich geregelter Anfahrt; sonst empfehlen wir einen Betrieb vor Ort.
- Prüfung per PLZ: [einsatzgebiet.json](einsatzgebiet.json).

## Leistungen und Preise (Ausgangswerte, netto)

| Leistung | Preis | Enthalten |
| --- | --- | --- |
| Inspektion | 290 EUR je Maschine | Zustandsaufnahme und Messwerte, Prüfbericht mit Befund |
| Planmäßige Wartung | ab 690 EUR je Maschine | dokumentierter Prüfumfang, Wartungsprotokoll, definierte Verschleißteile nach Absprache |
| Fehlerdiagnose und Reparatur | 145 EUR je Technikerstunde, mind. 290 EUR | Diagnose vor Ort, Reparatur nach Freigabe; Ersatzteile nach Aufwand |

Anfahrt jeweils zusätzlich: 1,20 EUR netto je gefahrenem Kilometer ab Mannheim und zurück, mindestens 45 EUR netto. Verbindlich sind ein Einzelauftrag oder ein vereinbartes SLA; Mira nennt Preise immer als Ausgangswerte.

## Ablauf einer Anfrage

1. Anfrage per Formular, E-Mail oder Telefon mit Standort, Anlage und Fehlerbild.
2. Der Service Desk prüft Vollständigkeit und Dringlichkeit; kritische Fälle prüft ein Mensch.
3. Termin, Umfang und kommerzielle Bedingungen werden bestätigt. Mit der Anfrage allein entsteht kein Auftrag.
4. Einsatz, Bericht, Rechnung.

## Betreute Anlagen

Drei Anlagenarten: Kompressoren (stationäre Druckluft), Pumpen (Kreisel- und ausgewählte Verdrängerpumpen) und industrielle Lüftungsanlagen (RLT-Geräte und Ventilatorkomponenten).

**Kompressoren:** KAESER – SX, SM, SK, ASK, ASD, BSD, CSD; Atlas Copco – GX, G, GA, ZR / ZT, SF, LE, LF; BOGE – C, C-2, S-4, EO; CompAir – L, D, DH, Ultima; Ingersoll Rand – UP6, RS, E-Series; ALMiG – COMBI XP, F-Drive, LENTO, SIMPLEXX; RENNER – RS-PRO, RSF-PRO, REKO, RIKO; ABAC – SPINN, FORMULA, GENESIS, A29, A39, A49.

**Pumpen:** Grundfos – NB, NK, CR, TP, CM; KSB – Etanorm, Etabloc, Movitec, Amarex; Wilo – Atmos GIGA-N, Helix V, CronoLine-IL; Sulzer – AHLSTAR APT, ABS XFP; NETZSCH – NEMO, TORNADO, NOTOS, PERIPRO; Alfa Laval – LKH, SRU, DuraCirc.

**Industrielle Lüftung:** Systemair – Geniox, Topvex; FläktGroup – eQ Master, eQ Prime; TROX – X-CUBE, X-CUBE compact; WOLF – KG Top, KG Flex, CKL evo, CRL evo max; ZIEHL-ABEGG – ZAbluefin (Komponente), ZAplus (Komponente); ebm-papst – RadiPac (Komponente), RadiCal (Komponente).

Antwortregeln (Kurzfassung der Abgleichregeln des Katalogs; im Gespräch entscheidet das Werkzeug `anlage_pruefen`):

- Hersteller und Baureihe bekannt: „Diese Anlagen betreuen wir.“ Ein nicht gelistetes Modell einer bekannten Baureihe ist kein Ausschluss; vollständigen Typ vom Typenschild erbitten.
- Nur Hersteller bekannt: Anlagenart und Typ erfragen; Prüfung durch den Service Desk.
- Unbekannter Hersteller, aber eine der drei Anlagenarten: „Das prüft unser Service Desk anhand der Typenangaben.“ Anfrage trotzdem aufnehmen.
- Nicht im Leistungsumfang: Kälteanlagen und Kältekompressoren, Prozessgas-, Atemluft-, Zentrifugal- und mobile Dieselkompressoren (gesonderte Klärung), Hydraulik, Wohnraumlüftung, alles außerhalb von Kompressoren, Pumpen und industrieller Lüftung. Freundlich absagen.
- Ventilatorkomponenten (RadiPac, RadiCal, ZAbluefin, ZAplus) gehören zu einer Lüftungsanlage: Hersteller und Typ der Gesamtanlage zusätzlich erfragen.
- Ein Treffer ist keine Herstellerautorisierung und keine Zusage zu Ersatzteilen, Kosten, Terminen oder Garantie.
- Am Telefon nur Anlagenart, Hersteller und Typ aufnehmen, bei Störung ein Symptom oder einen Fehlercode. Technische Details (bei Pumpen Fördermedium, Dichtung, Werkstoff; bei Kompressoren Betriebsdruck) klärt der Service Desk.

## Häufige Fragen

- **„Kommen Sie heute noch?“** – Termine bestätigt der Service Desk; Mira kann einen freien Termin vormerken. Bei Stillstand: Notfallweg.
- **„Was kostet ein Einsatz?“** – Ausgangswerte oben plus Anfahrt; verbindlich erst mit Angebot oder SLA.
- **„Gilt der Notdienst für alle?“** – Nein, 24/7 nur mit Notfall-SLA; sonst Servicezeiten.
- **„Kann ich Fotos schicken?“** – Ja, als Antwort auf die Eingangsbestätigung per E-Mail oder über das Formular auf der Website (PDF, JPG, PNG, je bis 5 MB).
- **„Reparieren Sie auch Kälteanlagen / Hydraulik?“** – Nein, nur Kompressoren, Pumpen und industrielle Lüftung.
- **„Warten Sie auch nur eine Komponente?“** – Ja, zum Beispiel Ventilatoren in RLT-Geräten; dazu Hersteller und Typ der Gesamtanlage angeben.
