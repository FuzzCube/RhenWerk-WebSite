# Testdaten für Anrufe (task-13-9)

Feste Demo-Daten für Tests des Telefonassistenten. Die Verträge und ihre Kunden ändern sich bei `npm run demo:seed` nicht (Quelle: `SERVICE_CONTRACTS` in `scripts/demo/catalog.mjs`); Ansprechpersonen und Telefonnummern der Demo-Kunden werden je Seed neu erzeugt. Alle Demo-Standorte liegen im Einsatzgebiet um Mannheim ([einsatzgebiet.json](einsatzgebiet.json)).

## SLA-Verträge

| Vertragsnummer | Firma | Standort | 24/7 | Gültigkeit | Erwartete Prüfung |
| --- | --- | --- | --- | --- | --- |
| SLA-2021-801 | Neckartal Brauerei GmbH | Bergheimer Straße 120, 69115 Heidelberg | ja | seit 01.03.2021 | `gueltig_24_7` |
| SLA-2022-176 | Kurpfalz Präzisionsteile KG | Rhenaniastraße 30, 68219 Mannheim | ja | seit 01.01.2022 | `gueltig_24_7` |
| SLA-2022-340 | Rheinhafen Logistikzentrum GmbH & Co. KG | Hafenstraße 12, 68159 Mannheim | ja | seit 01.07.2022 | `gueltig_24_7` |
| SLA-2023-512 | Pfälzer Lebensmittelwerke AG | Industriestraße 8, 67059 Ludwigshafen am Rhein | ja | seit 01.02.2023 | `gueltig_24_7` |
| SLA-2023-627 | Bergsträßer Kunststofftechnik GmbH | Gewerbering 4, 69469 Weinheim | ja | seit 01.05.2023 | `gueltig_24_7` |
| SLA-2024-118 | Hardt Getränke AG | Carl-Benz-Straße 21, 68766 Hockenheim | ja | seit 01.01.2024 | `gueltig_24_7` |
| SLA-2024-328 | Speyerer Papierfabrik GmbH & Co. KG | Am Hafen 5, 67346 Speyer | ja | seit 01.04.2024 | `gueltig_24_7` |
| SLA-2025-205 | Odenwald Molkerei GmbH | Werkstraße 17, 69168 Wiesloch; zweiter Standort 69190 Walldorf | ja | seit 01.01.2025 | `gueltig_24_7` für beide PLZ |
| SLA-2021-373 | Wormser Glaswerk GmbH | Siemensstraße 9, 67547 Worms | nein | seit 01.06.2021 | `gueltig_ohne_24_7` |
| SLA-2022-558 | Schwetzinger Druckerei KG | Robert-Bosch-Straße 3, 68723 Schwetzingen | nein | seit 01.09.2022 | `gueltig_ohne_24_7` |
| SLA-2023-905 | Ladenburger Galvanik GmbH | Fabrikweg 2, 68526 Ladenburg | nein | seit 01.03.2023 | `gueltig_ohne_24_7` |
| SLA-2025-751 | Frankenthaler Verpackungen GmbH | Lagerstraße 11, 67227 Frankenthal (Pfalz) | nein | seit 01.02.2025 | `gueltig_ohne_24_7` |
| SLA-2020-433 | Viernheimer Metallverarbeitung GmbH | Max-Planck-Ring 6, 68519 Viernheim | ja | abgelaufen am 30.06.2026 | `abgelaufen` |
| SLA-2026-990 | Lampertheimer Recycling GmbH | Kanalstraße 40, 68623 Lampertheim | ja | erst ab 01.01.2027 | `noch_nicht_gueltig` |

## Bestandskunden (task-13-10)

Die Vertragskunden haben feste Kundennummern (`K-10000` + 7 × Position in `SERVICE_CONTRACTS`); weitere Demo-Kunden mit Nummer stehen unter `/dashboard/kunden`. `kunde_finden` braucht die Kundennummer und die PLZ eines aktiven Standorts.

| Kundennummer | Firma | Standort | Erwartung |
| --- | --- | --- | --- |
| K-10000 | Neckartal Brauerei GmbH | Bergheimer Straße 120, 69115 Heidelberg | Treffer mit PLZ 69115 |
| K-10007 | Kurpfalz Präzisionsteile KG | Rhenaniastraße 30, 68219 Mannheim | Treffer mit PLZ 68219 |
| K-10014 | Rheinhafen Logistikzentrum GmbH & Co. KG | Hafenstraße 12, 68159 Mannheim | Treffer mit PLZ 68159 |
| K-10000 mit PLZ 68159 | – | – | kein Treffer (PLZ passt nicht) |
| K-99999 | – | – | kein Treffer |

## Negativfälle

| Eingabe | Erwartete Prüfung |
| --- | --- |
| SLA-2019-999, beliebige PLZ | `unbekannt` |
| SLA-2024-000 | `unbekannt` |
| SLA-2021-801 mit PLZ 68159 | `passt_nicht` (Standort nicht im Vertrag) |
| SLA-2021-801 mit Firma „Hardt Getränke“ | `passt_nicht` |
| SLA-2021-801 ohne Firma und PLZ | `angaben_fehlen` |
| „S L A 2021 801“ gesprochen, PLZ 69115 | `gueltig_24_7` (Schreibweise wird normalisiert) |

## Testanrufe außerhalb der Servicezeit (Produktionsstillstand)

| Anrufer nennt | Erwartung |
| --- | --- |
| SLA-2022-340, Hafenstraße 12, 68159 Mannheim | Weiterleitung an die Bereitschaft |
| SLA-2021-373, 67547 Worms | dringende Anfrage ohne Termin, Prüfung ab 07:00 (Vertrag ohne 24/7) |
| SLA-2020-433, 68519 Viernheim | dringende Anfrage, Hinweis: Vertrag abgelaufen |
| kein Vertrag | dringende Anfrage, Hinweis: 24/7 nur mit Notfall-SLA |

## Statusauskunft

Bestehende Demo-Anfragen dieser Kunden haben die Vertragsnummer im Feld „SLA-Vertrag“; in der Anfrage zeigt „Vertragsbestand“ das Ergebnis des Abgleichs. Für Status- und Verspätungstests eine aktuelle Demo-Anfrage in der Einsatzplanung wählen (Nummer und PLZ des Standorts nennen).
