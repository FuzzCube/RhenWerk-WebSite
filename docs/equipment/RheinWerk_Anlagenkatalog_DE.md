---
title: RheinWerk Anlagen- und Servicekatalog
language: de
version: 2026-10-08-v2
catalog_status: fictional_demo_service_scope
---

# RheinWerk Anlagen- und Servicekatalog

**Anlagenarten:** Kompressoren, Pumpen und industrielle Lüftungssysteme.

Dieser Katalog beschreibt den fiktiven Serviceumfang der RheinWerk Industrieservice GmbH für ein Portfolio- und Automatisierungsprojekt. Hersteller und Produktbezeichnungen sind real; die Zuordnung zum RheinWerk-Service ist eine Demo-Festlegung. Quellen belegen Produktbezeichnungen und Bauarten, nicht eine tatsächliche Serviceautorisierung der Firma.

Vorgesehene Leistungen: Inspektion, planmäßige Wartung sowie Diagnose und Prüfung einer Reparatur. Die Hersteller- und Baureihenauswahl ist repräsentativ; sie ist kein Ranking nach Marktanteilen. Frühere Generationen können enthalten sein.

Alle folgenden Datensätze tragen den Serviceumfang `in_scope_fictional_demo`. Modellbeispiele können Basisbezeichnungen, Baugrößen oder Unterbaureihen sein und ersetzen keine vollständige Ausführungsprüfung. Eine leere Modellliste ist kein Ausschluss einer gesamten Baureihe.

**Umfang:** 20 Hersteller, 74 Baureiheneinträge, 63 Modell-/Größenbeispiele.

## 1. Verbindliche Abgleichregeln

1. **Anlagenart feststellen:** Nur compressor, pump und ventilation liegen im Demo-Leistungsbereich. Geräte außerhalb dieser drei Anlagenarten erhalten out_of_scope. Eine unklare Anlagenart erhält needs_review.
2. **Hersteller und Baureihe verbinden:** Zuerst Hersteller oder expliziten Alias erkennen. Dann innerhalb dieser Marke die längste passende Baureihenbezeichnung mit Token-Grenzen zuordnen. IR, Atlas und ABS ohne passenden Produktkontext sind mehrdeutig.
3. **Schreibvarianten kontrolliert normalisieren:** Groß-/Kleinschreibung und überzählige Leerzeichen für die Suche ignorieren. SM13 und SM 13 abgleichen. Dezimalkomma und Dezimalpunkt nur in Dezimalzahlen gleichsetzen. Tausendertrennzeichen gesondert behandeln: 11.000 in CRL evo max 11.000 bedeutet Baugröße 11000. Originaleingabe erhalten.
4. **Suffixe nicht verlieren:** +, /, führende Nullen und Buchstaben erhalten. GA 37 VSD+ ist nicht GA 37 VSD; CR ist nicht automatisch CRN oder CRE; TP ist nicht automatisch TPE; Helix V ist nicht automatisch Helix VE.
5. **Modellmuster berücksichtigen:** CompAir D37H gehört zur DH-Baureihe; D37 zur D-Baureihe. NETZSCH NM045 BY ist ein NEMO-Modell. X-CUBE compact vor X-CUBE abgleichen. Baureihenaliase ersetzen keine Prüfung des vollständigen Modellcodes.
6. **Leere Beispiele richtig deuten:** Nur Baureihe bedeutet: Eine Referenz auf Serienebene ist vorhanden. Es bedeutet weder Modell unbekannt im gesamten Markt noch Service ausgeschlossen. Eine abweichende Modellnummer innerhalb einer bekannten Baureihe führt zunächst zu series_match.
7. **Komponente und Gesamtanlage trennen:** RadiPac, RadiCal, ZAbluefin und ZAplus sind Ventilatorreferenzen. Daraus keinen Hersteller oder Modelltyp der gesamten Lüftungsanlage ableiten. Komponententyp und übergeordnetes Gerät separat erfassen.
8. **Keine technischen Daten erfinden:** Modellziffern sind kein verlässlicher Ersatz für Leistung, Druck, Förderhöhe oder Volumenstrom. Bei Pumpen Medium, Dichtung und Werkstoff; bei RLT-Geräten Auftragsnummer, Sektionen und Regelung klären. Klassenbezeichnungen belegen keine Hygiene- oder Luftreinheitszertifizierung.
9. **Serviceumfang und Erkennung trennen:** Ein Treffer bestätigt einen Eintrag in diesem fiktiven RheinWerk-Katalog. Er bestätigt keine reale Herstellerautorisierung, Ersatzteilkompatibilität, Kosten, Termine oder Garantie. Servicebeurteilung erst mit den vollständigen Anlagenangaben.
10. **Unbekannte Modelle richtig weiterleiten:** Nicht gelistete Modelle innerhalb der drei Anlagenarten erhalten needs_review oder series_match, wenn eine bekannte Baureihe klar erkennbar ist. Spezialausführungen separat klären; keine pauschale Absage wegen fehlender Modellzeile.
11. **Kritische Anfragen menschlich prüfen:** Produktionsstillstand und bekannte oder unklare Sicherheitsgefahr erfordern eine menschliche Prüfung. Ein Katalogtreffer ist keine automatische Einsatzfreigabe und keine garantierte Ankunftszeit.

### Statuswerte

| Status | Bedeutung |
| --- | --- |
| `listed_model` | Hersteller und aufgeführte Modell-, Größen- oder Basisbezeichnung erkannt. Ausführung bei Bedarf bestätigen. |
| `series_match` | Hersteller und Baureihe erkannt; vollständigen Modellcode anfordern. |
| `brand_only` | Nur Hersteller erkannt; Anlagenart und vollständigen Modellcode anfordern. |
| `needs_review` | Anlagenart, Baureihe, Ausführung oder Angaben sind unklar beziehungsweise nicht gelistet; zur Klärung weiterleiten. |
| `out_of_scope` | Die Anlagenart liegt außerhalb von Kompressoren, Pumpen und industriellen Lüftungssystemen; Absage oder passende Empfehlung. |

### Anlagenarten und Abgrenzung

| Kategorie-ID | Anlagenart | Abgrenzung |
| --- | --- | --- |
| `compressor` | Kompressoren | Erfasst: stationäre Druckluftbaureihen. Prozessgas-, Kälte-, Atemluft-, Zentrifugal- und mobile Dieselkompressoren sind nicht in dieser Referenzauswahl und erfordern eine gesonderte Klärung. |
| `pump` | Pumpen | Erfasst: Kreisel- und ausgewählte Verdrängerpumpen für industrielle und gebäudetechnische Anwendungen. Medium, Dichtung und Werkstoff immer separat klären. |
| `ventilation` | Industrielle Lüftungssysteme | Erfasst: RLT-Geräte und ausdrücklich markierte Ventilatorkomponenten. Wohnraumlüftung ist nicht die Zielanwendung dieses Katalogs. |

## 2. Hersteller und Namensvarianten

| Hersteller-ID | Hersteller | Zulässige Suchvarianten |
| --- | --- | --- |
| `kaeser` | KAESER | Kaeser, Käser, Kaeser Kompressoren |
| `atlas_copco` | Atlas Copco | AtlasCopco, Atlas-Copco |
| `boge` | BOGE | Boge, Boge Kompressoren |
| `compair` | CompAir | Compair, Comp Air, Comp-Air |
| `ingersoll_rand` | Ingersoll Rand | Ingersoll-Rand, IngersollRand |
| `almig` | ALMiG | Almig, ALMIG Kompressoren |
| `renner` | RENNER | Renner, Renner Kompressoren |
| `abac` | ABAC | Abac |
| `grundfos` | Grundfos | Grundfos |
| `ksb` | KSB | KSB |
| `wilo` | Wilo | Wilo |
| `sulzer` | Sulzer | Sulzer, ABS |
| `netzsch` | NETZSCH | NETZSCH, Netzsch Pumps & Systems |
| `alfa_laval` | Alfa Laval | Alfa Laval, Alfa-Laval, AlfaLaval |
| `systemair` | Systemair | Systemair, System Air |
| `flaktgroup` | FläktGroup | FläktGroup, FlaktGroup, Fläkt Group |
| `trox` | TROX | TROX |
| `wolf` | WOLF | WOLF |
| `ziehl_abegg` | ZIEHL-ABEGG | ZIEHL-ABEGG, Ziehl Abegg, ZiehlAbegg |
| `ebm_papst` | ebm-papst | ebm-papst, ebm papst, ebmpapst |

## 3. Geräteklassen

| Klassen-ID | Bauart |
| --- | --- |
| `screw_oil_injected` | Öleingespritzter Schraubenkompressor |
| `screw_oil_free` | Ölfreier Schraubenkompressor |
| `scroll_oil_free` | Ölfreier Scrollkompressor |
| `piston_oil_lubricated` | Ölgeschmierter Kolbenkompressor |
| `piston_oil_free` | Ölfreier Kolbenkompressor |
| `tooth_oil_free` | Ölfreier Drehzahnkompressor |
| `centrifugal_end_suction` | Einstufige Kreiselpumpe / End-Suction |
| `centrifugal_inline` | Einstufige Inline-Kreiselpumpe |
| `centrifugal_multistage_vertical` | Mehrstufige vertikale Kreiselpumpe |
| `centrifugal_multistage_horizontal` | Mehrstufige horizontale Kreiselpumpe |
| `submersible_wastewater` | Tauchmotor-Abwasserpumpe |
| `progressing_cavity` | Exzenterschneckenpumpe |
| `rotary_lobe` | Drehkolbenpumpe |
| `multi_screw` | Mehrspindelige Schraubenspindelpumpe |
| `peristaltic_hose` | Schlauchpumpe / Peristaltikpumpe |
| `hygienic_centrifugal` | Hygienische Kreiselpumpe |
| `circumferential_piston` | Umfangskolbenpumpe |
| `ahu_modular` | Modulares raumlufttechnisches Gerät |
| `ahu_compact` | Kompaktes raumlufttechnisches Gerät |
| `centrifugal_fan_component` | Radialventilator / RLT-Komponente |
| `axial_fan_system_component` | Axialventilatorsystem / RLT-Komponente |

## 4. Kompressoren

**Kategorie-ID:** `compressor`. **Serviceumfang jeder Zeile:** `in_scope_fictional_demo`.

Jede Zeile ist ein eigener Datensatz. Quellenkennungen verweisen auf das Quellenverzeichnis. Nur Baureihe bedeutet: Es sind keine konkreten Modellbeispiele in diesem Datensatz hinterlegt.

| ID | Datensatzschlüssel | Hersteller | Baureihe | Klassen-ID | Modell-/Größenbeispiele | Objektebene | Suchvarianten / Tokens | Abgleichhinweis | Quellen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RW-001 | `kaeser_sx` | KAESER | SX | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1 |
| RW-002 | `kaeser_sm` | KAESER | SM | `screw_oil_injected` | SM 10; SM 13; SM 16 | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1, K2 |
| RW-003 | `kaeser_sk` | KAESER | SK | `screw_oil_injected` | SK 22; SK 25 | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1, K2 |
| RW-004 | `kaeser_ask` | KAESER | ASK | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1 |
| RW-005 | `kaeser_asd` | KAESER | ASD | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1 |
| RW-006 | `kaeser_bsd` | KAESER | BSD | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1 |
| RW-007 | `kaeser_csd` | KAESER | CSD | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | -; Ausführungstokens: T, SFC | Vollständigen Typ und Ausführung klären. | K1 |
| RW-008 | `atlas_copco_gx` | Atlas Copco | GX | `screw_oil_injected` | GX 2; GX 7; GX 11 | Gerät / Pumpe | - | Enthält auch frühere Generationen aus dem Gesamtkatalog. | A1 |
| RW-009 | `atlas_copco_g` | Atlas Copco | G | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | - | Vollständige Typenbezeichnung zur Bestimmung der Ausführung anfordern. | A1 |
| RW-010 | `atlas_copco_ga` | Atlas Copco | GA | `screw_oil_injected` | GA 37 VSD+; GA 160 VSD FF | Gerät / Pumpe | -; Ausführungstokens: +, VSD, VSD+, VSDs, FF | GA, GA+, VSD, VSD+, VSDs und FF als unterschiedliche Ausführungen erhalten. | A2 |
| RW-011 | `atlas_copco_zr_zt` | Atlas Copco | ZR / ZT | `screw_oil_free`; `tooth_oil_free` | Nur Baureihe | Gerät / Pumpe | ZR,ZT; Ausführungstokens: VSD, VSD+ | Technologie modellabhängig: Schraube oder Drehzahn. Vollständiges Modell anfordern. | A5 |
| RW-012 | `atlas_copco_sf` | Atlas Copco | SF | `scroll_oil_free` | SF 4+ | Gerät / Pumpe | SF+ | SF und SF+ sind Scrollkompressoren. Pluszeichen erhalten. | A3 |
| RW-013 | `atlas_copco_le` | Atlas Copco | LE | `piston_oil_lubricated` | Nur Baureihe | Gerät / Pumpe | - | Vollständigen Typ und Ausführung klären. | A4 |
| RW-014 | `atlas_copco_lf` | Atlas Copco | LF | `piston_oil_free` | Nur Baureihe | Gerät / Pumpe | - | Vollständigen Typ und Ausführung klären. | A4 |
| RW-015 | `boge_c` | BOGE | C | `screw_oil_injected` | C 7 PM; C 9 DR -350 | Gerät / Pumpe | - | C und C-2 als getrennte Baureihen behandeln. | B1, B4 |
| RW-016 | `boge_c_2` | BOGE | C-2 | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | C 2 | Vollständigen Typ und Ausführung klären. | B1 |
| RW-017 | `boge_s_4` | BOGE | S-4 | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | S 4 | Vollständigen Typ und Ausführung klären. | B1 |
| RW-018 | `boge_eo` | BOGE | EO | `scroll_oil_free` | EO 7 D; EO 17; EO 23 | Gerät / Pumpe | - | EO bezeichnet Scrollkompressoren; nicht als Schraubenkompressor klassifizieren. | B2, B3 |
| RW-019 | `compair_l` | CompAir | L | `screw_oil_injected` | L07; L11; L15; L22 | Gerät / Pumpe | -; Ausführungstokens: RS | RS ist eine drehzahlgeregelte Ausführung. Führende Null in L07 erhalten. | C1 |
| RW-020 | `compair_d` | CompAir | D | `screw_oil_free` | D37; D75; D160 | Gerät / Pumpe | -; Ausführungstokens: RS | D und DH unterscheiden. Ein H im Modellcode nicht entfernen. | C2 |
| RW-021 | `compair_dh` | CompAir | DH | `screw_oil_free` | D15H; D37H | Gerät / Pumpe | - | Wassereingespritzte, ölfreie Baureihe. Modellmuster D + Zahl + H der Baureihe DH zuordnen. | C2 |
| RW-022 | `compair_ultima` | CompAir | Ultima | `screw_oil_free` | U55; U160 | Gerät / Pumpe | ULTIMA | Modellbezeichnungen verwenden den Präfix U. | C2 |
| RW-023 | `ingersoll_rand_up6` | Ingersoll Rand | UP6 | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | - | UP6S nicht automatisch als Synonym von UP6 behandeln. | I1 |
| RW-024 | `ingersoll_rand_rs` | Ingersoll Rand | RS | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | Next Generation RS | Next Generation RS. Größe und Suffixe anhand des Typenschilds klären. | I1 |
| RW-025 | `ingersoll_rand_e_series` | Ingersoll Rand | E-Series | `screw_oil_free` | Nur Baureihe | Gerät / Pumpe | E Series | Referenz: E-Series 55-90 kW. Exakte Modellbezeichnung separat anfordern. | I2 |
| RW-026 | `almig_combi_xp` | ALMiG | COMBI XP | `screw_oil_injected` | COMBI XP 4; COMBI XP 11; COMBI XP 22 | Gerät / Pumpe | - | Kompakte Station. Behälterausstattung hängt von der Ausführung ab. | M1, M2 |
| RW-027 | `almig_f_drive` | ALMiG | F-Drive | `screw_oil_injected` | F-Drive 6; F-Drive 11; F-Drive 15 | Gerät / Pumpe | F Drive,FDRIVE | Schraubenbaureihe mit Drehzahlregelung. | M1, M3 |
| RW-028 | `almig_lento` | ALMiG | LENTO | `screw_oil_free` | LENTO 15; LENTO 22; LENTO 37 | Gerät / Pumpe | - | Ölfreie Verdichtung mit Wassereinspritzung. | M4 |
| RW-029 | `almig_simplexx` | ALMiG | SIMPLEXX | `screw_oil_free` | Nur Baureihe | Gerät / Pumpe | - | Industrielle ölfreie Schraubenbaureihe. | M1 |
| RW-030 | `renner_rs_pro` | RENNER | RS-PRO | `screw_oil_injected` | Nur Baureihe | Gerät / Pumpe | RS PRO | Riemengetriebene Baureihe. RSF-PRO separat behandeln. | R1 |
| RW-031 | `renner_rsf_pro` | RENNER | RSF-PRO | `screw_oil_injected` | RSF-PRO 55,0 D | Gerät / Pumpe | RSF PRO | Ausführung mit Frequenzregelung. | R1, R3 |
| RW-032 | `renner_reko` | RENNER | REKO | `piston_oil_lubricated` | REKO 410D/90; REKO 710-B; REKO 970-B | Gerät / Pumpe | - | W/D, H, Behältervolumen und weitere Suffixe erhalten. | R2, R3 |
| RW-033 | `renner_riko` | RENNER | RIKO | `piston_oil_lubricated` | RIKO H 960 B-S | Gerät / Pumpe | - | Vollständige Typenbezeichnung zur Bestimmung der Ausführung anfordern. | R3 |
| RW-034 | `abac_spinn` | ABAC | SPINN | `screw_oil_injected` | SPINN D2.2 | Gerät / Pumpe | -; Ausführungstokens: FS, VSD | Ausführungen mit fester und variabler Drehzahl. | Q1 |
| RW-035 | `abac_formula` | ABAC | FORMULA | `screw_oil_injected` | FORMULA E 30 13 400/50 CE | Gerät / Pumpe | -; Ausführungstokens: FS, VSD, PM | Vollständiger Code enthält Ausführungs- und elektrische Angaben. | Q1 |
| RW-036 | `abac_genesis` | ABAC | GENESIS | `screw_oil_injected` | GENESIS 7,5 13 400/50 500 CE; GENESIS EI 7.5 13 400/50 270CE | Gerät / Pumpe | -; Ausführungstokens: FS, VSD, PM | Stationen auf Behälter. Ausführungssuffixe erhalten. | Q1 |
| RW-037 | `abac_a29` | ABAC | A29 | `piston_oil_lubricated` | A29-50 CM2; A29B-100 CM3 | Gerät / Pumpe | A29B | A29 / A29B bezeichnen den Verdichterblock. Vollständigen Kompressorcode anfordern. | Q2 |
| RW-038 | `abac_a39` | ABAC | A39 | `piston_oil_lubricated` | Nur Baureihe | Gerät / Pumpe | A39B | A39 / A39B bezeichnen den Verdichterblock. Vollständigen Kompressorcode anfordern. | Q2 |
| RW-039 | `abac_a49` | ABAC | A49 | `piston_oil_lubricated` | Nur Baureihe | Gerät / Pumpe | A49B | A49 / A49B bezeichnen den Verdichterblock. Vollständigen Kompressorcode anfordern. | Q2 |

## 5. Pumpen

**Kategorie-ID:** `pump`. **Serviceumfang jeder Zeile:** `in_scope_fictional_demo`.

Jede Zeile ist ein eigener Datensatz. Quellenkennungen verweisen auf das Quellenverzeichnis. Nur Baureihe bedeutet: Es sind keine konkreten Modellbeispiele in diesem Datensatz hinterlegt.

| ID | Datensatzschlüssel | Hersteller | Baureihe | Klassen-ID | Modell-/Größenbeispiele | Objektebene | Suchvarianten / Tokens | Abgleichhinweis | Quellen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RW-040 | `grundfos_nb` | Grundfos | NB | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | - | Block-/Kupplungsausführung anhand des vollständigen Typs klären. | P01 |
| RW-041 | `grundfos_nk` | Grundfos | NK | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | - | Vollständigen Typ, Kupplung und Dichtung klären. | P01 |
| RW-042 | `grundfos_cr` | Grundfos | CR | `centrifugal_multistage_vertical` | CR 10-4 | Gerät / Pumpe | - | CR, CRI, CRN und CRE nicht pauschal gleichsetzen; Werkstoff und Antrieb prüfen. | P02 |
| RW-043 | `grundfos_tp` | Grundfos | TP | `centrifugal_inline` | Nur Baureihe | Gerät / Pumpe | - | TP und elektronisch geregelte TPE-Ausführung unterscheiden. | P03 |
| RW-044 | `grundfos_cm` | Grundfos | CM | `centrifugal_multistage_horizontal` | Nur Baureihe | Gerät / Pumpe | - | CM und CME unterscheiden; Werkstoff- und Dichtungscode erhalten. | P04 |
| RW-045 | `ksb_etanorm` | KSB | Etanorm | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | - | Norm-/Prozessbauweise. MyFlow und Pro als Ausführungen erhalten. | P05 |
| RW-046 | `ksb_etabloc` | KSB | Etabloc | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | - | Blockbauweise. Nicht mit Etanorm gleichsetzen. | P05 |
| RW-047 | `ksb_movitec` | KSB | Movitec | `centrifugal_multistage_vertical` | Nur Baureihe | Gerät / Pumpe | - | Diese Zeile gilt für die vertikale Basisbaureihe; H(S)I und VCI separat klären. | P05 |
| RW-048 | `ksb_amarex` | KSB | Amarex | `submersible_wastewater` | Nur Baureihe | Gerät / Pumpe | - | Laufradcode und Aufstellungsart klären; KRT, NS und Pro nicht gleichsetzen. | P05 |
| RW-049 | `wilo_atmos_giga_n` | Wilo | Atmos GIGA-N | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | Atmos GIGA N | Normpumpe; Baugröße, Dichtung und Antrieb anfordern. | P06 |
| RW-050 | `wilo_helix_v` | Wilo | Helix V | `centrifugal_multistage_vertical` | Helix V 1004-1/16/E/S/400-50 | Gerät / Pumpe | - | Vollständige Suffixe erhalten; V und VE nicht pauschal gleichsetzen. | P07 |
| RW-051 | `wilo_cronoline_il` | Wilo | CronoLine-IL | `centrifugal_inline` | CronoLine-IL 32/150-2,2/2 | Gerät / Pumpe | CronoLine IL | Trockenläufer-Inlinepumpe; IL, IL-E und ILD unterscheiden. | P08 |
| RW-052 | `sulzer_ahlstar_apt` | Sulzer | AHLSTAR APT | `centrifugal_end_suction` | Nur Baureihe | Gerät / Pumpe | - | Prozesspumpe; Fördermedium, Werkstoff und Dichtung klären. | P09 |
| RW-053 | `sulzer_abs_xfp` | Sulzer | ABS XFP | `submersible_wastewater` | Nur Baureihe | Gerät / Pumpe | XFP | Abwasser-Tauchmotorpumpe; vollständigen XFP-Typ und Laufradcode anfordern. | P10 |
| RW-054 | `netzsch_nemo` | NETZSCH | NEMO | `progressing_cavity` | NM045 BY | Gerät / Pumpe | NEMO NM | NM ist ein Modellpräfix. Stator, Rotor und Medium klären. | P11, P12 |
| RW-055 | `netzsch_tornado` | NETZSCH | TORNADO | `rotary_lobe` | Nur Baureihe | Gerät / Pumpe | - | Rotierende Verdrängerpumpe; genaue Baugröße und Ausführung klären. | P11 |
| RW-056 | `netzsch_notos` | NETZSCH | NOTOS | `multi_screw` | Nur Baureihe | Gerät / Pumpe | - | Mehrspindelige Pumpe; Spindel-/Baureihencode und Ausführung anfordern. | P11 |
| RW-057 | `netzsch_peripro` | NETZSCH | PERIPRO | `peristaltic_hose` | Nur Baureihe | Gerät / Pumpe | - | Schlauchpumpe; Schlauchwerkstoff und Medium anfordern. | P11 |
| RW-058 | `alfa_laval_lkh` | Alfa Laval | LKH | `hygienic_centrifugal` | LKH-10; LKH-20; LKH-25 | Gerät / Pumpe | - | Basisbaureihe; LKH Prime, UltraPure und Multistage separat klären. | P13, P14 |
| RW-059 | `alfa_laval_sru` | Alfa Laval | SRU | `rotary_lobe` | Nur Baureihe | Gerät / Pumpe | - | Hygienische Drehkolbenpumpe; Rotor-, Dichtungs- und Größenangaben erhalten. | P13 |
| RW-060 | `alfa_laval_duracirc` | Alfa Laval | DuraCirc | `circumferential_piston` | Nur Baureihe | Gerät / Pumpe | - | Umfangskolbenpumpe; nicht als SRU-Drehkolbenpumpe klassifizieren. | P13 |

## 6. Industrielle Lüftungssysteme

**Kategorie-ID:** `ventilation`. **Serviceumfang jeder Zeile:** `in_scope_fictional_demo`.

Jede Zeile ist ein eigener Datensatz. Quellenkennungen verweisen auf das Quellenverzeichnis. Nur Baureihe bedeutet: Es sind keine konkreten Modellbeispiele in diesem Datensatz hinterlegt.

| ID | Datensatzschlüssel | Hersteller | Baureihe | Klassen-ID | Modell-/Größenbeispiele | Objektebene | Suchvarianten / Tokens | Abgleichhinweis | Quellen |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| RW-061 | `systemair_geniox` | Systemair | Geniox | `ahu_modular` | Geniox 10 | Gerät / Pumpe | - | Baugröße allein beschreibt die Konfiguration nicht. Geräteauftrag und Sektionen anfordern. | V01 |
| RW-062 | `systemair_topvex` | Systemair | Topvex | `ahu_compact` | Topvex SR; Topvex SC | Gerät / Pumpe | - | SR/SC sind Unterbaureihen, keine vollständigen Gerätetypen; Größe und Ausführung klären. | V02 |
| RW-063 | `flaktgroup_eq_master` | FläktGroup | eQ Master | `ahu_modular` | Nur Baureihe | Gerät / Pumpe | eQMaster | Modular konfiguriert; Geräteauftrag, Sektionen und Regelung klären. | V03 |
| RW-064 | `flaktgroup_eq_prime` | FläktGroup | eQ Prime | `ahu_compact` | eQ Prime S; eQ Prime T | Gerät / Pumpe | eQPrime | S und T als Anschlussvarianten unterscheiden; vollständige Größe anfordern. | V04 |
| RW-065 | `trox_x_cube` | TROX | X-CUBE | `ahu_modular` | Nur Baureihe | Gerät / Pumpe | X CUBE | Anlagenspezifische Konfiguration; nicht mit X-CUBE compact gleichsetzen. | V05 |
| RW-066 | `trox_x_cube_compact` | TROX | X-CUBE compact | `ahu_compact` | Nur Baureihe | Gerät / Pumpe | X CUBE compact | Separate Kompaktbaureihe; längere Bezeichnung vor X-CUBE abgleichen. | V05 |
| RW-067 | `wolf_kg_top` | WOLF | KG Top | `ahu_modular` | Nur Baureihe | Gerät / Pumpe | KG TOP | Geräteauftrag, Baugröße und Sektionen anfordern. | V06 |
| RW-068 | `wolf_kg_flex` | WOLF | KG Flex | `ahu_modular` | Nur Baureihe | Gerät / Pumpe | - | Individuell konfiguriertes RLT-Gerät; Sektionen und Auftragsnummer klären. | V06 |
| RW-069 | `wolf_ckl_evo` | WOLF | CKL evo | `ahu_compact` | CKL evo 1400; CKL evo 2400 | Gerät / Pumpe | - | Plattenwärmetauscher; vollständige Innen-/Außenausführung bestätigen. | V07 |
| RW-070 | `wolf_crl_evo_max` | WOLF | CRL evo max | `ahu_compact` | CRL evo max 11.000; CRL evo max 13.500 | Gerät / Pumpe | - | Rotationswärmetauscher; CRL, CRL evo und CRL evo max nicht gleichsetzen. | V08 |
| RW-071 | `ziehl_abegg_zabluefin` | ZIEHL-ABEGG | ZAbluefin | `centrifugal_fan_component` | Nur Baureihe | Komponente | - | Nur Ventilatorkomponente: vollständigen Ventilatortyp und übergeordnetes RLT-Gerät anfordern. | V09 |
| RW-072 | `ziehl_abegg_zaplus` | ZIEHL-ABEGG | ZAplus | `axial_fan_system_component` | Nur Baureihe | Komponente | - | Axialventilatorsystem als Komponente; Hersteller der Gesamtanlage separat erfassen. | V09 |
| RW-073 | `ebm_papst_radipac` | ebm-papst | RadiPac | `centrifugal_fan_component` | Nur Baureihe | Komponente | - | Nur Ventilatorkomponente: Artikel-/Typnummer, Generation und Gesamtanlage klären. | V10 |
| RW-074 | `ebm_papst_radical` | ebm-papst | RadiCal | `centrifugal_fan_component` | Nur Baureihe | Komponente | - | Nur Ventilatorkomponente; nicht automatisch dem RadiPac zuordnen. | V11 |

## 7. Daten für die Anfrage

| Feldgruppe | Daten |
| --- | --- |
| common | Anlagenart, Hersteller, Vollständige Typ-/Modellbezeichnung, Serien-/Maschinennummer, Standort, Fehlerbeschreibung, Dringlichkeit |
| compressor | Betriebsdruck, Leistung, Betriebsstunden, Fehlercode, Öl-/Trocknerausführung |
| pump | Fördermedium, Temperatur, Fördermenge / Förderhöhe, soweit bekannt, Werkstoff-/Dichtungscode, Einbauart |
| ventilation | Geräte-/Auftragsnummer, Baugröße, Sektionen und Regelung, Störungscode, Hersteller und Typ der betroffenen Komponente |
| optional | Typenschildfoto, Baujahr, Vorhandene technische Unterlagen |

Fehlende Angaben gezielt anfordern. Unbekannte Messwerte nicht schätzen. Hersteller und Modell der Gesamtanlage bleiben getrennt von Hersteller und Typ eines eingebauten Bauteils.

## 8. Abgleichbeispiele

| Eingabe | Zuordnung | Status / Aktion |
| --- | --- | --- |
| Kaeser SM13 | RW-002 \| compressor \| KAESER \| SM \| SM 13 | listed_model |
| CompAir D37H | RW-021 \| compressor \| CompAir \| DH \| D37H | listed_model |
| Grundfos CR 10-4 | RW-042 \| pump \| Grundfos \| CR \| CR 10-4 | listed_model |
| KSB Etanorm, Typ unbekannt | RW-045 \| pump \| KSB \| Etanorm | series_match |
| Systemair Topvex SC | RW-062 \| ventilation \| Systemair \| Topvex \| Topvex SC | listed_model; vollständige Größe anfordern |
| ebm-papst RadiPac im WOLF-Gerät | RW-073 \| ventilation \| Ventilatorkomponente RadiPac; WOLF-Gesamtgerät separat klären | series_match |
| RS 15, Hersteller unbekannt | Keine automatische Herstellerzuordnung | needs_review |
| Hydraulikzylinder defekt | Keine der drei Anlagenarten | out_of_scope |

## 9. Empfohlenes Ergebnisformat

Die folgenden Schlüssel sind Integrationskonventionen für den KI-Agenten. In `model_full_raw` die vollständige Kundeneingabe zum Modell erhalten. Hersteller beziehungsweise Modell des Gesamtgeräts nicht aus einem Bauteiltreffer ergänzen.

```json
{
  "status": "series_match",
  "category": "ventilation",
  "catalog_row_id": "RW-073",
  "manufacturer": "ebm-papst",
  "series": "RadiPac",
  "model_full_raw": "RadiPac",
  "object_level": "component",
  "parent_equipment": {
    "manufacturer": null,
    "model_full_raw": null
  },
  "service_scope": "in_scope_fictional_demo",
  "missing_fields": [
    "Vollständiger Ventilatortyp",
    "Hersteller und Typ der Gesamtanlage"
  ],
  "reason_de": "Ventilatorbaureihe erkannt; Gesamtanlage noch nicht identifiziert."
}
```

Bei `out_of_scope` ist `service_scope` ebenfalls `out_of_scope`. Bei unklarer Zuordnung bleibt `service_scope` auf `needs_review`. Keine Datensatz-ID zuweisen, wenn keine eindeutige Katalogzeile vorliegt.

## 10. Quellenverzeichnis

Herstellerquellen; geprüft am 08.10.2026. Die Quellenkennungen sind in jeder Katalogzeile angegeben. Einzelne Seiten oder Broschüren können frühere Generationen dokumentieren.

- **K1:** [KAESER: öleingespritzte Schraubenbaureihen](https://at.kaeser.com/produkte/schraubenkompressoren/schraubenkompressoren-mit-fluidkuehlung/)
- **K2:** [KAESER: riemengetriebene Modelle SM und SK](https://at.kaeser.com/produkte/schraubenkompressoren/schraubenkompressoren-mit-fluidkuehlung/schraubenkompressoren-bis-zu-22-kw/mit-riemenantrieb/)
- **A1:** [Atlas Copco: Gesamtkatalog einschließlich früherer Generationen](https://www.atlascopco.com/content/dam/atlas-copco/compressor-technique/industrial-air/documents/brochures/CT%20Catalogue_Full.pdf)
- **A2:** [Atlas Copco: GA und VSD-Ausführungen](https://www.atlascopco.com/en-us/compressors/products/air-compressor/rotary-screw-compressor/ga-series)
- **A3:** [Atlas Copco: SF / SF+, Produktbroschüre](https://www.atlascopco.com/content/dam/atlas-copco/compressor-technique/industrial-air/documents/brochures/air-compressors/oil-free-compressors/SF1-22_leaflet_EN.pdf)
- **A4:** [Atlas Copco: Kolbenkompressoren LE und LF](https://www.atlascopco.com/content/dam/atlas-copco/compressor-technique/industrial-air/documents/leaflets/compressors/le-lt-lf-lb/l-range-%282023%29/LE-LT-LF-LB_EN.pdf)
- **A5:** [Atlas Copco: ZR / ZT, Schrauben- und Drehzahntechnologie](https://ebooks.atlascopco.com/story/atlas-copco-product-portfolio-en-nz/page/4)
- **B1:** [BOGE: Schraubenbaureihen C, C-2 und S-4](https://www.boge.com/de-de/produkte/kompressoren/schraubenkompressoren/)
- **B2:** [BOGE: ölfreie Scrollbaureihe EO](https://www.boge.com/de-de/produkte/kompressoren/scrollkompressoren/eo-baureihe-bis-30-kw/)
- **B3:** [BOGE: Modellbezeichnungen im Gebrauchtmaschinenkatalog](https://www.boge.com/de-de/produkte/kompressoren/gebrauchte-kompressoren/)
- **B4:** [BOGE: Modellbezeichnungen C 7 PM und C 9 DR](https://support.boge.com/www/support/usedequip.nsf/useden?Count=200&OpenForm=&ResortDescending=0&Seq=256)
- **C1:** [CompAir: L07 - L22 und RS-Ausführungen](https://www.compair.com/de-de/rotary-screw-air-compressors/7-22kw/)
- **C2:** [CompAir: ölfreie Baureihen D, DH und Ultima](https://www.compair.com/en/oil-free-compressors/)
- **I1:** [Ingersoll Rand: öleingespritzte Baureihen UP6 und RS](https://www.ingersollrand.com/en-us/products/air-compressors/oil-flooded-rotary-air-compressors/)
- **I2:** [Ingersoll Rand: ölfreie E-Series 55-90 kW](https://www.ingersollrand.com/en-us/products/air-compressors/oil-free-air-compressors/e-series-55-90-kw/)
- **M1:** [ALMiG: Übersicht der Schraubenbaureihen](https://www.almig.de/de/produkte/drucklufterzeugung/schraubenkompressoren)
- **M2:** [ALMiG: COMBI XP, Modelltabelle](https://www.almig.de/de/produkte/drucklufterzeugung/schraubenkompressoren/schraubenkompressor-combi-xp)
- **M3:** [ALMiG: F-Drive, Modelltabelle](https://www.almig.de/de/produkte/drucklufterzeugung/schraubenkompressoren/schraubenkompressor-f-drive)
- **M4:** [ALMiG: LENTO, Modelltabelle](https://www.almig.de/de/produkte/drucklufterzeugung/schraubenkompressoren/schraubenkompressor-lento)
- **R1:** [RENNER: RS-PRO und RSF-PRO](https://www.renner-kompressoren.de/produkte/rs-pro-30-550/)
- **R2:** [RENNER: Produktkatalog 2026, RSF-PRO und REKO](https://www.renner-kompressoren.de/fileadmin/DATA/Medien/Newsletter/Deutsch/03_2026/RENNER_-_Produktkatalog_-_2026_-_DE_3.pdf)
- **R3:** [RENNER: Modellbezeichnungen RSF-PRO, REKO und RIKO im Maschinenangebot](https://www.renner-kompressoren.de/fileadmin/DATA/Medien/AKTUELLES/GML/GML_NEU/Gebrauchtmaschinenliste_19.08.2025.pdf)
- **Q1:** [ABAC: SPINN, FORMULA und GENESIS](https://www.abacaircompressors.com/en-international/products/screw-compressors)
- **Q2:** [ABAC: Verdichterblöcke A29, A39 und A49, Archivkatalog](https://www.abacaircompressors.com/content/dam/brands/ABAC/spain/catalogs/Folleto-Promocion-2020-CAN.pdf)
- **P01:** [Grundfos: NB / NK, End-Suction-Baureihen](https://www.grundfos.com/sg/learn/ecademy/all-courses/grundfos-end-suction-pumps/grundfos-nb-nbs-nk-end-suction-series-performance-characteristic)
- **P02:** [Grundfos: CR, CRI, CRN, Datenheft](https://api.grundfos.com/literature/Grundfosliterature-2556.pdf)
- **P03:** [Grundfos: TP / TPE, einstufige Inline-Pumpen](https://www.grundfos.com/gh/products/products/tp-tpe)
- **P04:** [Grundfos: CM / CME, horizontale mehrstufige Kreiselpumpen](https://api.grundfos.com/literature/Grundfosliterature-3081234.pdf)
- **P05:** [KSB: Etanorm, Etabloc, Movitec und Amarex, Produktkatalog](https://www.ksb.com/de-de/produkte/produktkatalog?productType=PUMP)
- **P06:** [Wilo: Atmos GIGA-N, Normpumpe](https://wilo.com/gb/en/Products/en/products/atmos-giga-n_id272)
- **P07:** [Wilo: Helix V 1004-1/16/E/S/400-50](https://wilo.com/de/de/Katalog/de/produkte/helix-v_id586/4201287)
- **P08:** [Wilo: CronoLine-IL, Herstellerkatalog](https://cms.media.wilo.com/cdndoc/wilo353733/4083854/wilo353733.pdf)
- **P09:** [Sulzer: AHLSTAR APT, einstufige Prozess-Kreiselpumpe](https://www.sulzer.com/en/shared/products/ahlstar-app-t-range)
- **P10:** [Sulzer: Tauchmotor-Abwasserpumpe ABS XFP](https://www.sulzer.com/en/shared/products/submersible-sewage-pump-type-abs-xfp)
- **P11:** [NETZSCH: NEMO, TORNADO, NOTOS und PERIPRO, Produktportfolio](https://pumps-systems.netzsch.com/_Resources/Persistent/b/0/4/f/b04f9da07a629222a58e126b8d4afa5bf8be69e6/NETZSCH-300-Product-Portfolio-Brochure-EN-US.pdf)
- **P12:** [NETZSCH: NEMO in FSIP-Ausführung, Modell NM045 BY](https://pumps-systems.netzsch.com/en-IN/products-and-accessories/nemo-progressing-cavity-pumps/nemo-progressing-cavity-pump-in-fsip-design/)
- **P13:** [Alfa Laval: Pump Handbook 2024, LKH / SRU / DuraCirc](https://www.alfalaval.com/globalassets/documents/products/fluid-handling/pumps/pump-handbook-2024.pdf)
- **P14:** [Alfa Laval: LKH, Produktbroschüre und Modellgrößen](https://www.alfalaval.com/globalassets/documents/products/fluid-handling/pumps/centrifugal-pumps/lkh/alfa-laval-lkh-centrifugal-pump---product-leaflet---ese00263.pdf)
- **V01:** [Systemair: Geniox, modulare RLT-Geräte](https://www.systemair.com/en/products/air-handling-units/geniox/geniox-with-eco-heat-exchangers)
- **V02:** [Systemair: Topvex, Übersicht der Gerätefamilie](https://www.systemair.com/en-rs/products/air-handling-units/topvex)
- **V03:** [FläktGroup: eQ Master, modulares RLT-Gerät](https://www.flaktgroup.com/uk/products/air-treatment/modular-air-handling-units/eq-master-air-handling-unit/)
- **V04:** [FläktGroup: eQ Prime S / T](https://www.flaktgroup.com/en/solutions/eq-prime-air-handling-unit/)
- **V05:** [TROX: X-CUBE und X-CUBE compact](https://www.trox.de/rlt-zentrale-e6ede67eb398c68e)
- **V06:** [WOLF: KG Top / KG Flex, RLT-Produktübersicht](https://www.wolf.eu/de-de/professional/produkte-rlt)
- **V07:** [WOLF: CKL evo, Kompakt-Lüftungsgerät](https://www.wolf.eu/de-de/professional/produkte-rlt/kompaktgeraete/ckl-evo)
- **V08:** [WOLF: CRL evo max, Modellgrößen](https://www.wolf.eu/de-de/professional/produkte-rlt/kompaktgeraete/crl-evo-max)
- **V09:** [ZIEHL-ABEGG: Ventilatoren, ZAbluefin und ZAplus](https://www.ziehl-abegg.com/en-sg/product-range/ventilation-systems)
- **V10:** [ebm-papst: RadiPac, Radialventilatoren](https://www.ebmpapst.com/de/de/products/centrifugal-fans/radipac.html)
- **V11:** [ebm-papst: RadiCal, Radialventilatoren](https://www.ebmpapst.com/de/de/newsroom/news/2023/radical_generation2.html)

### RheinWerk-Leistungsabgrenzung

Die drei Anlagenarten und die menschliche Prüfung kritischer Anfragen entsprechen der vorliegenden Projektfassung der RheinWerk-Website. Der neu zusammengestellte Hersteller- und Modellkatalog ist eine Ergänzung für das Demo-Projekt und kein dort bereits bestätigtes Herstellerverzeichnis.
