# Entscheidungen

## 2026-10-07 – Website-Code im Workshop-Repository

### Kontext

Das Workshop-Repository enthielt nur die Workshop-Struktur; die Website liegt als separates Projekt vor.

### Entscheidung

Der Website-Code wird ohne Git-Historie in dieses Repository übernommen (Quelle `FuzzCube/rheinwerk-industrieservice`, Commit `39d9936`) und das Dashboard im selben Next.js-Projekt unter `/dashboard` umgesetzt.

### Begründung

Die Spezifikation verlangt das Dashboard im bestehenden Website-Projekt; Fortschritt soll zugleich im Workshop-Dashboard sichtbar sein.

## 2026-10-07 – Markenname RheinWerk

### Kontext

Die Spezifikation nennt „Rheinberg Industry Service“, Website und Designsystem verwenden „RheinWerk Industrieservice“.

### Entscheidung

Das Dashboard verwendet den Namen und das Designsystem von RheinWerk.

### Begründung

Einheitliches Erscheinungsbild mit der bestehenden Website.

## 2026-10-07 – Formularpfad bleibt bei Make

### Kontext

Das Formular leitet Anfragen derzeit über `/api/service-request` an Make weiter; die Spezifikation beschreibt eine künftige n8n-Anbindung und verbietet eine vorläufige direkte Speicherung in Supabase.

### Entscheidung

Der bestehende Pfad bleibt unverändert. Der n8n-Ein-/Ausgabevertrag wird nur dokumentiert.

### Begründung

Vorgabe der Spezifikation; die Umstellung gehört zu einer späteren Stufe.

Abgelöst am 08.10.2026 durch „Lokale n8n-Integration ausdrücklich beauftragt“: lokal läuft das Formular über `N8N_WEBHOOK_URL` zu n8n; die öffentliche Website nutzt weiterhin Make.

## 2026-10-07 – Entwicklung gegen lokales Supabase

### Kontext

Für die Supabase-Anbindung wird ein Projekt benötigt. Ein Cloud-Projekt ist noch nicht verknüpft; die Supabase CLI und Docker sind lokal vorhanden.

### Entscheidung

Entwicklung gegen den lokalen Supabase-Stack. Alle Schemaänderungen, RLS-Richtlinien und Storage-Buckets entstehen ausschließlich als Migrationen unter `supabase/migrations/`, keine manuellen Änderungen über Studio. Demo-Nutzer werden per Skript angelegt. Die spätere Übernahme in ein Cloud-Projekt erfolgt über `supabase link` und `supabase db push`.

### Begründung

Schnelle, kostenlose und jederzeit zurücksetzbare Entwicklung (`supabase db reset`); Migrationen halten lokale und spätere Cloud-Datenbank identisch.

## 2026-10-07 – Proxy erneuert nur die Sitzung

### Kontext

Next.js 16 ersetzt Middleware durch `proxy.ts`. Die Next.js-Dokumentation rät davon ab, Proxy als vollständige Autorisierungslösung zu verwenden.

### Entscheidung

`proxy.ts` erneuert ausschließlich die Supabase-Sitzungscookies und läuft nur auf `/dashboard`, `/login` und `/auth/*`. Weiterleitungen und Zugriffsschutz erfolgen serverseitig in jeder Dashboard-Seite und über RLS.

### Begründung

Öffentliche Website und `/api/service-request` bleiben unverändert und ohne zusätzlichen Auth-Aufruf; Berechtigungen werden dort durchgesetzt, wo sie nicht umgangen werden können.

## 2026-10-07 – RLS nur lesend, Schreiben über kontrollierte Operationen

### Kontext

Die Spezifikation verlangt Berechtigungen in der Datenbank, Prüfung der Elternzugehörigkeit, Statusübergänge und Audit-Ereignisse in derselben Transaktion.

### Entscheidung

RLS-Richtlinien gewähren nur `SELECT`. Client-Rollen erhalten keine Schreibrechte auf Tabellen; alle Änderungen erfolgen über `security definer`-Funktionen (Phase 2). Zugriffs-Hilfsfunktionen liegen im nicht exponierten Schema `private`. Dispatcher sehen fremde Einsätze nur über `technician_busy_intervals`.

### Begründung

Schreibregeln (Übergänge, Audit, Nebenläufigkeit) lassen sich in Funktionen vollständig und atomar prüfen; Insert-/Update-Richtlinien könnten diese Regeln nicht abbilden und würden direkte API-Umgehungen ermöglichen.

## 2026-10-07 – Demo-Basiswert manuelle Erstbearbeitung 15 Minuten

### Kontext

Die Spezifikation nennt als Demo-Basiswert 5 Minuten aktive Bearbeitungszeit je Anfrage und eine Prüf-Fixture von 100 × 5 Minuten (8 h 20 min).

### Entscheidung

Auf Wunsch des Nutzers beträgt der Basiswert 15 Minuten: Default von `settings.manual_intake_minutes`, Demo-Einstellungen und Snapshots im Seed. Die Prüf-Fixture ergibt damit 100 × 15 = 1.500 Minuten (25 h). Die Formel `sum(manual_minutes_baseline) / 60` bleibt unverändert.

### Begründung

Der Basiswert ist laut Spezifikation eine konfigurierbare Demo-Annahme; 15 Minuten entsprechen der Einschätzung des Nutzers für Lesen, Entscheiden, Antworten und Pflegen im System.

## 2026-10-07 – Route Groups und Zugriffsprüfung je Seite

### Kontext

Die Website nutzt eine Catch-all-Route und eine Hülle mit Kopf, Fuß und Assistent im Root-Layout. Das Dashboard braucht eine eigene Hülle und einen serverseitigen Zugriffsschutz.

### Entscheidung

Website und Dashboard liegen in den Route Groups `(site)` und `(dashboard)` unter einem gemeinsamen Root-Layout ohne Hülle. Jede Dashboard-Seite prüft Sitzung und Rolle selbst über `lib/auth/session.ts`; das Layout lädt nur Name und Rolle für Kopfzeile und Navigation. Bereiche, Startseiten und erlaubte Rollen stehen zentral in `lib/auth/roles.ts`.

### Begründung

Website-URLs und -Ausgabe bleiben unverändert, und `/dashboard` gewinnt als statisches Segment vor der Catch-all-Route. Layouts werden bei Client-Navigation nicht neu gerendert, deshalb reicht eine Prüfung im Layout laut Next.js-Dokumentation nicht aus.

## 2026-10-07 – Anfrageseite liest mit Nutzerrechten, Dokumente über die App

### Kontext

Die Anfrageseite bündelt zehn Abschnitte mit unterschiedlich vertraulichen Daten (Korrespondenz, interne Notizen, Rechnungen).

### Entscheidung

Alle Abschnitte werden mit dem Server-Client des angemeldeten Nutzers gelesen, nie mit dem Admin-Client. Abschnitte, die eine Rolle laut RLS nicht lesen darf (Techniker: Erstbearbeitung, Korrespondenz), werden zusätzlich weder abgefragt noch angezeigt. Dokumente werden über einen Route Handler mit Nutzerrechten gestreamt statt über signierte Storage-URLs ausgeliefert.

### Begründung

Die Datenbank bleibt die einzige Quelle für Berechtigungen; ein Fehler in der Oberfläche kann keine Daten freigeben. Gestreamte Downloads tragen `no-store` und lassen sich nicht als Link weitergeben.

## 2026-10-07 – Eigene Kalenderansicht statt Kalenderbibliothek

### Kontext

Die Einsatzplanung braucht eine Wochenansicht mit allen Technikern nebeneinander (Ressourcen), Darstellung in Europe/Berlin unabhängig von der Zeitzone des Browsers und Auswahl eines Zeitraums. Geprüft am 07.10.2026 gegen React 19.2 (npm-Metadaten):

| Bibliothek | React 19 (peerDependencies) | Lizenz | Ergebnis |
| --- | --- | --- | --- |
| `@fullcalendar/react` 7.1.1 | `^17 \|\| ^18 \|\| ^19` | MIT | kompatibel; Ressourcen-Ansichten (`@fullcalendar/resource-timeline`) jedoch kommerziell lizenziert |
| `react-big-calendar` 1.20.0 | `^16.14 \|\| … \|\| ^19` | MIT | kompatibel; Ressourcen frei, Darstellung aber in der Zeitzone des Browsers (Localizer), Server- und Client-Ausgabe weichen außerhalb Deutschlands ab |
| `@schedule-x/react` 4.1.0 | `^16.7 \|\| … \|\| ^19` | MIT | kompatibel; Ressourcen-Planer als Premium-Plugin |

### Entscheidung

Eigene, schlanke Zeitstrahl-Ansicht ohne zusätzliche Abhängigkeit (seit 12.10.2026 als Plantafel `components/dashboard/plan-board.tsx`; der Technikerkalender ist eine Tagesagenda ohne Zeitstrahl). Ursprünglich: Tage untereinander, je Techniker eine Zeile 06–20 Uhr, Positionen über `lib/berlin-time.ts` in Europe/Berlin. Ein Klick in eine Zeile übernimmt Techniker, Datum und Uhrzeit in das Buchungsformular; das Formular bleibt die vollständige, tastaturbedienbare Eingabe.

### Begründung

Keine Lizenzkosten, keine Zeitzonenabweichung, keine Hydration-Unterschiede zwischen Server und Browser und volle Kontrolle darüber, dass fremde Intervalle keine Details zeigen. Alle drei Bibliotheken wären mit React 19 installierbar; bei Bedarf (z. B. Drag-and-drop) kann FullCalendar mit Lizenz nachgerüstet werden.

## 2026-10-07 – Einsatzfotos: Upload durch den Server, Registrierung per RPC

### Kontext

Der Bucket `dashboard` ist privat und hat bewusst keine Schreibrichtlinie für Nutzer. Fotos sollen nur zum eigenen Einsatz gespeichert werden können.

### Entscheidung

Die Server Action lädt die geprüfte Datei mit dem Server-Schlüssel unter einem zufälligen Namen im Einsatzpfad hoch; anschließend registriert `add_visit_photo` sie mit den Rechten des Nutzers (Rolle, eigener Einsatz, Status, Typ, Größe, Pfad, Existenz der Datei). Schlägt die Registrierung fehl, löscht der Server die Datei.

### Begründung

Berechtigung und Metadaten entstehen atomar in der Datenbank; der Server-Schlüssel schreibt nur unter einem Pfad, den die Datenbankfunktion anschließend validiert. Keine Storage-Schreibrechte für Clients, keine öffentlichen URLs.

## 2026-10-08 – Rechnungs-PDF bei jedem Abruf aus der eingefrorenen Rechnung

### Kontext

Ausgestellte Rechnungen sollen als PDF (Musterrechnung / Demodaten) herunterladbar sein, und spätere Tarifänderungen dürfen ausgestellte PDFs nicht verändern. `issue_invoice` friert Positionen, Beträge sowie Verkäufer- und Kundendaten bereits ein; Trigger verhindern jede spätere Änderung.

### Entscheidung

Das PDF wird nicht gespeichert, sondern bei jedem Abruf deterministisch aus den eingefrorenen Daten erzeugt (`lib/invoice-pdf.ts`, Route mit Nutzerrechten). Bibliothek `pdf-lib` 1.17.1 (MIT, reines JavaScript ohne native Abhängigkeiten, keine React-Abhängigkeit, nur serverseitig genutzt).

### Begründung

Kein zweiter, nicht atomarer Schritt (Ausstellen und Hochladen) und keine Datei, die von der Datenbank abweichen kann. Unveränderlichkeit folgt aus den Datenbankgarantien und ist geprüft: `test:ui` vergleicht das PDF vor und nach einer Tarifänderung byte-genau. Eine Änderung der PDF-Vorlage im Code würde das Erscheinungsbild ausgestellter PDFs ändern, nicht aber deren Inhalt; für echte Rechnungen wäre eine Archivierung des PDFs bei Ausstellung (GoBD) nötig.

## 2026-10-08 – Rechnungs-PDF im RheinWerk-Design mit eingebetteten Schriften

### Kontext

Das PDF aus task-6-3 nutzte Helvetica ohne Logo und Markenfarben; der Projektbrief verlangt das RheinWerk-Designsystem. Die Vorlage entstand in Claude Design mit einer Maßtabelle für pdf-lib.

### Entscheidung

Umsetzung der Maßtabelle in `lib/invoice-pdf.ts`. Inter (400/500/600) und IBM Plex Mono (500) werden als auf Latein verkleinerte TTF-Dateien (zusammen rund 140 KB, SIL OFL) unter `assets/fonts/` versioniert und mit `@pdf-lib/fontkit` 1.1.1 (MIT) eingebettet. Die Wortmarke „RheinWerk“ (Manrope 800) ist als Umrisspfad hinterlegt, damit keine dritte Schrift eingebettet wird. Schriften erhalten feste Namen (`customName`), weil pdf-lib sonst einen zufälligen Suffix vergibt. Die Verkäuferdaten der Demo folgen der Website (Rheinwerkstraße 12, 68169 Mannheim, Geschäftsführung Dr. Lena Hartmann, Fiktiv-Hinweis).

### Begründung

Das Erscheinungsbild entspricht der freigegebenen Vorlage; die Ausgabe bleibt byte-identisch reproduzierbar (Unit-Test und Tarifänderungsprüfung in `test:ui`). Bereits ausgestellte Rechnungen erscheinen beim nächsten Abruf in der neuen Gestaltung; ihr Inhalt (Positionen, Beträge, Snapshots) bleibt unverändert.

## 2026-10-08 – Analytik als Datenbankfunktionen mit Nutzerrechten

### Kontext

Die Manager-Analytik (task-7-1) soll Kennzahlen mit Periodenvergleich, Zeitreihen und Warteschlangenhistorie liefern, ohne RLS zu umgehen. Unvollständige Zeiträume und kürzere Monate müssen fair verglichen werden.

### Entscheidung

`security invoker`-Funktionen im Schema `public`, nur für Manager und Admins. Vergleich über dieselbe verstrichene Zeit ab Beginn des vorherigen Zeitraums, begrenzt auf dessen Ende. Warteschlangenhistorie aus `request_events` rekonstruiert statt eigener Snapshot-Tabelle. Damit Auswertungen über alle Zeilen schnell sind, erhalten fünf Lese-Richtlinien eine vorgezogene, einmal je Anweisung ausgewertete Manager/Admin-Prüfung.

### Begründung

Keine zweite Datenquelle, die von den Ereignissen abweichen kann; RLS bleibt die einzige Berechtigungsquelle. Die Richtlinien behalten ihre Bedeutung (für Manager/Admins waren alle Prüfungen bereits wahr), was die bestehenden RLS-Tests bestätigen. Ohne die Änderung dauerte eine Kennzahlenabfrage rund 1,3 s, danach rund 0,1 s.

## 2026-10-08 – Abgeschlossene Zeiträume vergleichen ganze Vorzeiträume

### Kontext

Mit der Regel „gleiche verstrichene Zeit“ (task-7-1) verglich ein abgeschlossener September (30 Tage) nur mit dem 1.–30. August; der 31. August fehlte. Aufgefallen in der Manager-Übersicht (task-7-2).

### Entscheidung

Laufende Zeiträume behalten den Vergleich über die gleiche verstrichene Zeit; abgeschlossene Zeiträume vergleichen mit dem vollständigen Vorzeitraum. Umgesetzt als neue Migration, da die ursprüngliche bereits veröffentlicht war.

### Begründung

Für einen laufenden Monat ist nur der gleich lange Abschnitt fair; für abgeschlossene Monate erwartet die Leitung „September gegen August“. pgTAP prüft beide Fälle.

## 2026-10-08 – Diagramme mit Recharts, validierte Diagrammfarben

### Kontext

task-7-3 verlangt Diagramme aus Datenbankdaten und eine gegen React 19 geprüfte Bibliothek. Geprüft am 08.10.2026 (npm-Metadaten):

| Bibliothek | React 19 (peerDependencies) | Lizenz | Ergebnis |
| --- | --- | --- | --- |
| `recharts` 3.10.1 | `^16.8 … ^19.0` (react, react-dom, react-is) | MIT | gewählt: SVG, eigene Tooltip-Inhalte, Tastaturbedienung (`accessibilityLayer`) |
| `@visx/xychart` 4.0.0 | `^18 \|\| ^19`, zusätzlich `@react-spring/web` | MIT | kompatibel, mehr Eigenbau |
| `react-chartjs-2` 5.3.1 + `chart.js` 4.5.1 | `^16.8 … ^19` | MIT | kompatibel, Canvas (schlechter prüfbar, keine SVG-Elemente) |
| `@nivo/line` 0.99.0 | `^16.14 … ^19` | MIT | kompatibel, viele Pakete je Diagrammart |

### Entscheidung

`recharts` 3.10.1 als Client-Komponente; Daten werden serverseitig geladen und als einfache Arrays übergeben. Kategoriale Farben: RheinWerk blue-500 `#2F80C9`, danach `#EB6834`, `#4A3AA7`, `#008300` aus der Dataviz-Referenzpalette, weil die Markenrampen keine weiteren Töne mittlerer Helligkeit haben (Navy zu dunkel, Lime und Blau-300 auf der Fläche unter 3:1). Validiert mit dem Dataviz-Validator auf `#FCFBF7`: alle Prüfungen bestanden (benachbart CVD ΔE ≥ 21,9, Normalsicht ≥ 31,3, Kontrast ≥ 3:1); die ersten drei Farben bestehen auch alle Paare. Nur helle Darstellung, da das Dashboard kein dunkles Theme hat.

### Begründung

SVG-Ausgabe ist im Browser-Test prüfbar (Markierungen, Tooltip), die Bibliothek ist verbreitet und MIT-lizenziert. Ein Vergleich mit Grau (`#7A8B99`) fiel durch (zu geringer Unterschied zu Blau), daher Blau gegen Orange für aktuellen und Vorzeitraum.

## 2026-10-08 – Deaktivierung mit Neuzuweisung in einem Schritt

### Kontext

Mitarbeitende werden nicht gelöscht (Verlauf, Einsätze und Rechnungen verweisen auf sie). Offene Anfragen und geplante Einsätze einer deaktivierten Person wären sonst verwaist.

### Entscheidung

`admin_deactivate_employee` zeigt vorher die aktiven Zuweisungen und überträgt sie in derselben Transaktion auf eine gewählte aktive Vertretung derselben Rolle; geplante Einsätze nur, wenn sie in deren Arbeitszeit passen. Laufende Einsätze blockieren die Deaktivierung. Zusätzlich wird der Login in Supabase Auth gesperrt; ohne aktives Profil liefert RLS ohnehin keine Daten. Rollenwechsel sind nur ohne aktive Zuweisungen möglich, das eigene Konto kann weder die Rolle wechseln noch deaktiviert werden.

### Begründung

Ein Schritt statt „erst manuell umplanen, dann deaktivieren“ verhindert Zwischenzustände und ist für den Admin nachvollziehbar (Liste, Vertretung, Ergebnis mit Anzahl). Scheitert ein Einsatz an der Verfügbarkeit, ändert sich nichts und die Meldung nennt Einsatz und Grund.

## 2026-10-08 – Keine öffentliche Registrierung

Konten entstehen nur über die Verwaltung (Auth-Admin-API mit Secret Key, bestätigte Adresse, kein E-Mail-Versand). Lokal ist `[auth] enable_signup = false` gesetzt; `[auth.email] enable_signup` bleibt `true`, weil die lokale CLI sonst die E-Mail-Anmeldung insgesamt abschaltet (`email_provider_disabled`). Im Cloud-Projekt ist die Registrierung im Supabase-Dashboard abzuschalten.

## 2026-10-08 – Offene Punkte der Design-Spezifikation

Nutzerentscheidungen: Kennzahl-Richtungen wie in `KPI_INFO` (Automatisierungsanteil und Zeitersparnis „besser“ bei Anstieg; Warteschlangen, offene und überfällige Forderungen: niedriger ist besser). Ein einheitlicher Anzeigestatus aus Erstbearbeitung × Arbeit; nicht vorgesehene Kombinationen fallen auf die Erstbearbeitung zurück. „Zahlung erfassen“ (`record_payment`) in der Rechnungsliste und auf der Anfrageseite. Ein Foto beim Einsatzabschluss ist nicht Pflicht. Einsatzvorschläge: zuerst Techniker mit abgeschlossenen Einsätzen bei derselben Firma (Kundennummer, sonst Firmenname); bei Neukunden Erfahrung mit Anlagentyp und Hersteller, dann geringere Auslastung, dann frühestes Fenster.

## 2026-10-08: Lokale n8n-Integration ausdrücklich beauftragt

Der Nutzer ersetzt die frühere Beschränkung auf einen dokumentierten Vertrag: lokales n8n und Supabase auf dem Mac, eigenes Supabase-Credential, Gmail `rheinwerk.industrieservice@gmail.com`, Analyse von Formular und PDF/Fotos, Modellabgleich mit `docs/equipment/RheinWerk_Anlagenkatalog_DE.md`. Unbekannte Modelle und Serienübereinstimmungen gehen an Menschen; nie automatisch ablehnen. Nodes werden nicht gruppiert. Rückfragen bleiben Entwürfe zur Dispatcher-Freigabe.

Sechs n8n-Entwürfe und Integrations-RPCs sind angelegt. Die Website-Route unterstützt `N8N_WEBHOOK_URL` mit Vorrang vor dem bisherigen Make-Ziel; die aktive Umgebung wurde noch nicht umgestellt. Vor Aktivierung fehlen Gmail-OAuth, Zustimmung zu Gemini und der vollständige Echtlauf. Gemini-Nodes und Analyse-Zeitplan bleiben deaktiviert. Eine automatische Speicherlöschung wurde durch die Genehmigungsprüfung abgewiesen und nicht eingerichtet. Eine vorgeschlagene Änderung der Rollenprüfung wurde ebenfalls abgewiesen und verworfen; korrigiert wurden nur die Test-JWTs, die Datenbank prüft weiterhin strikt `service_role`.

## 2026-10-12: OpenAI und echte Portfolio-Integration

Nutzerentscheidung: OpenAI statt Gemini; ausschließlich Portfolio, keine realen Kunden. Technische Texte, Korrespondenz und PDF/Fotos werden mit GPT-4.1 mini über `OpenAI account 3` verarbeitet. Native Responses-Nodes mit strengem JSON-Schema und `store: false`; Gesprächspersistenz ausschließlich in Supabase. Separate Kontakt-/Standortfelder sind nicht Teil des KI-Eingangs, können jedoch in Nachrichtentexten und Dokumenten vorkommen.

Für Reparaturen ist mindestens ein konkretes beobachtbares Symptom oder ein Fehlercode notwendig; „kaputt“ löst eine gezielte Rückfrage aus. Bei Wartung/Inspektion keine Fehlerbeschreibung verlangen. Unbekannte/mehrdeutige Modelle bleiben menschliche Prüfung. Der Testempfänger `fuzz.cube.studio@gmail.com` wurde ausdrücklich freigegeben; Versandfreigabe erfolgte per echtem Demo-Dispatcher-Login und normalem `queue_message`, ohne Rollenlockerung. Echte Antwort und Supabase-Historie führten RIS-2026-00355 zu processed v6. Seed-Demo-Daten bleiben ausgeschlossen; fiktive Integrationsanfragen werden über den normalen Formularweg gespeichert.

Drei Workflows sind veröffentlicht (Analyse, Dokumentenanalyse, Gmail-Eingang); Haupt-/Upload-/Versandworkflow bleiben Entwürfe. Lokal fehlen Blob-Token und aktives Webhook-Ziel. Vor vollständiger Umstellung sind Website-Dateitransfer, Empfangs-Recovery vor erster RPC-Registrierung und Versand-Retry nach verlorenem Providerergebnis zu prüfen. Kein Make-Abschalten, Push oder Website-Deployment.

## 2026-10-12: Lokale Aktivierung nach vollständigem Dateitest

Lokale Integration abgeschlossen: sechs veröffentlichte ungruppierte MCP-Workflows; N8N_WEBHOOK_URL lokal gesetzt. OpenAI GPT-4.1 mini, echte Gmail-Rückfrage 6779 und Kundenantwortanalyse 6790/6791 (RIS-2026-00355) bestätigt. Blob-Token lokal vorhanden; PDF/PNG über den tatsächlichen /api/upload-Clientpfad in privaten Vercel Blob geladen. Formular-API → produktiver n8n-Webhooks → Dateikopie 6813/6814 → privater Supabase Storage → OpenAI-Analyse 6815: RIS-2026-00356 processed, KAESER SM 13/RW-002 aus Dokumenten extrahiert, Formularmodell leer. Fehler 6810 (URL-Konstruktor im Code-Sandbox nicht vorhanden) durch enge private Blob-URL-Prüfung behoben. Wiederholungen liefern HTTP 201 und dieselbe Anfrage; genau ein Datensatz, ein Eingangsereignis, ein Analyselauf und zwei private Dateien. Direkte Analyse bei Duplikaten ausgeschlossen (6833/6834). Gmail ersetzt benutzerdefinierte Message-ID: Versandwiederaufnahme jetzt über X-RheinWerk-Message-Id und tatsächliche Provider-MIME-ID. 6825 findet das echte bereits gesendete Mail ohne erneuten Send-Aufruf (Queue/Bestätigung für diesen Replay gepinnt); 6839 prüft den Annahme→Metadaten-Zweig mit gepinntem Send-Ergebnis und echtem Gmail-Get. 6828 liest echte RIS-Antwort erneut, duplicate=true; 15-Minuten-Recovery für letzte sieben Tage ergänzt. Send-Scheduler 6837 erfolgreich, genehmigte Queue leer. Node-/SDK-Validierung bestanden, lint/build/typecheck bestanden; DB 532/532 und Unit 58/58 aus der unmittelbar vorherigen Integrationsprüfung, Unit nach Doku-Sync erneut zu prüfen. Keine neue SQL-Migration in diesem Schritt. Kein DB-Reset und keine neue API/Auth/UI-Regression; keine Browser-Sichtprüfung der Formular-UI. Alle Tests synthetisch, keine realen Kunden. Öffentliche Website/Turnstile/Cloudflare-Maschinenzugriff nicht umgestellt; keine Make-Konto-Deaktivierung, kein Push/Website-Deployment.

## 2026-10-12: Eingangsbestätigung ohne manuelle Freigabe

Nutzerentscheidung: Kunden erhalten nach dem Absenden des Website-Formulars automatisch eine E-Mail mit der Anfragenummer. Sie entsteht aus einer festen Vorlage (keine KI-Texte) in derselben Transaktion wie die Anfrage, höchstens einmal je Anfrage, und wird vom bestehenden Gmail-Versand verschickt. Sie ist die einzige ausgehende Nachricht, die das System selbst freigibt (`approved_at` gesetzt, `approved_by` leer); Rückfragen, Rechnungen und freie Nachrichten bleiben freigabepflichtig. Gleichzeitig akzeptieren Formular und Datenbank geschäftliche Adressen mit Subdomain (`name@mail.firma.de`).

## 2026-10-12: Zahlungserinnerungen automatisch, täglicher Lauf in der Datenbank

Nutzerentscheidungen zu task-10-2: Erinnerungen und Mahnungen werden ohne manuelle Freigabe versendet (Systemfreigabe wie bei der Eingangsbestätigung); Manager und Admins können je Rechnung aussetzen oder die nächste Stufe sofort auslösen. Der tägliche Lauf ist ein pg_cron-Job in Supabase statt eines n8n-Workflows (testbar in SQL, kein Import in n8n nötig); der Versand nutzt den bestehenden Gmail-Workflow. Die E-Mail verwendet das Design der Eingangsbestätigung mit eigenen Texten je Stufe; die 2. Mahnung weist auf den Zahlungsverzug hin. Demo-Rechnungen erhalten eine erzeugte Historie, aber nie echte E-Mails.

## 2026-10-13: Posteingang regelbasiert vorbelegen, ohne KI

task-10-10: Beim Anlegen einer Anfrage aus einer E-Mail belegt `lib/inbox-extract.ts` Firma, Kontakt, Telefon, Adresse, Anlage, Leistung und Dringlichkeit mit festen Regeln vor und markiert erkannte Felder. Keine KI im Dashboard: nachvollziehbar, ohne Kosten und testbar; eine KI-Vorbelegung über n8n bleibt eine mögliche Ergänzung nach Rücksprache.

## 2026-10-15: Verzögerung statt Kontosperre bei falschen Passwörtern

task-11-6: Ab dem 5. Fehlversuch je Adresse wächst die Pause (30 s bis höchstens 15 min), es gibt keine harte Sperre und keine Auskunft, ob ein Konto existiert. Eine harte Sperre würde es Dritten erlauben, Mitarbeitende auszusperren.

## 2026-10-15: Telefonassistent mit ElevenLabs, Werkzeuge über n8n hinter Cloudflare-Tunnel

Phase 13 (Plan `docs/telefonassistent-plan.md`, Umsetzung `docs/telefonassistent/`): Sprachagent „Mira“ in ElevenLabs, nur Deutsch. Die Werkzeuge sind n8n-Webhooks hinter einem benannten Cloudflare-Tunnel (feste Adresse, nur `/webhook/agent-*` öffentlich, gemeinsames Geheimnis und Access-Service-Token); n8n ruft eigene `agent_*`-Funktionen mit `service_role` auf, keine direkten Tabellenzugriffe. Termine merkt Mira nur vor, ein Dispatcher bestätigt oder lehnt ab. Kein Audio wird gespeichert, Transkripte 30 Tage. Begründung: alles läuft lokal wie die übrige Integration; ein Server für 24/7-Betrieb wäre ein eigener späterer Schritt.

## 2026-10-15: Demo-Region Rhein-Neckar und SLA-Verträge als Stammdaten

task-13-9: Demo-Kunden und -Anfragen liegen um Mannheim, passend zu Website und Einsatzgebiet des Agenten. Die Tabelle `service_contracts` hält Demo-Verträge (mit/ohne 24/7, abgelaufen), damit Mira die Berechtigung für den Bereitschaftsdienst prüfen kann (`agent_check_contract`); die Auskunft nennt keine Firmendaten.

## 2026-10-15: Rückrufbitte an Techniker im Dashboard statt Telegram

Nutzerentscheidung zu task-13-4: Fragt ein Kunde nach einem verspäteten Techniker, erscheint die Rückrufbitte als Banner auf jeder Dashboard-Seite des Technikers (Abfrage alle 20 s, Browser-Benachrichtigung optional); nach 15 Minuten ohne Quittung geht sie dringend an den Dispatcher. Kein Telegram (im ursprünglichen Plan vorgesehen). Eine eigene Techniker-App mit Push ist eine spätere Möglichkeit.

## 2026-10-19: Sprachmodell, E-Mail aus der Buchstabierung, Kalender aus der Datenbank

Nutzerentscheidungen zu task-13-5 nach Browsertests: LLM `claude-sonnet-4-5` statt Haiku (verbindet Buchstabiertes zuverlässiger, etwas mehr Verzögerung akzeptiert), TTS `eleven_v3_conversational` mit Expressive Mode, `turn_eagerness: patient`. E-Mail-Adressen setzt die Datenbank deterministisch aus der Buchstabierung zusammen (`agent_check_email`), Wochentage und Daten liefert das Werkzeug `servicezeit`; das Sprachmodell rechnet weder Adressen noch Kalender selbst.

## 2026-10-19: Eigener Kundenstamm, Bestandskunden über Kundennummer und PLZ

task-13-10: Tabellen `customers` und `customer_sites`; Anfragen verweisen auf Kunde und Standort. Am Telefon identifiziert Mira einen Bestandskunden mit Kundennummer und PLZ als Prüfung (`kunde_finden`), liest die E-Mail-Adresse nicht vor und fragt Ansprechperson und Rückrufnummer weiterhin ab. Ein Treffer setzt voraus, dass die PLZ zu einem aktiven Standort passt; unbekannte Nummer und falsche PLZ sind für den Anrufer nicht unterscheidbar.

## 2026-10-19: Gesprächsauswertung per API-Abfrage statt Post-Call-Webhook

Nutzerentscheidung zu task-13-6: Der n8n-Workflow `rwCallAnalysis26` fragt alle 2 Minuten die letzten Gespräche bei ElevenLabs ab, OpenAI füllt ein festes Schema, `agent_record_call` speichert einmal je Gespräch; Fakten wie „Anfrage angelegt“ kommen aus der Datenbank, nicht vom Modell. Kein weiterer öffentlicher Pfad, und Gespräche aus Zeiten, in denen n8n aus war, werden nachgeholt.

## 2026-10-19: Demo-Anruf statt Telefonnummer, Weiterleitung als Demo

Nutzerentscheidungen zu task-13-8 und task-13-11: RheinWerk ist ein Portfolio-Projekt ohne Telefonleitung. Jeder Link auf die Service-Desk-Nummer öffnet einen simulierten Anruf bei Mira im Browser (`components/demo-call.tsx`); die signierte Adresse holt der Server (`app/api/mira`), das Budget liegt in `widget_sessions`: höchstens 3 Minuten je Gespräch, 10 Minuten je Tag, 3 Gespräche je Anschluss und Stunde. Das Werkzeug `weiterleiten` verbindet nicht, sondern sagt an, dass hier in einem echten Betrieb verbunden würde, und nimmt einen Rückruf auf. Eine echte Nummer (Twilio oder SIP-Trunk) ließe sich ohne Änderung am Agenten ergänzen; dann stünde dort `transfer_to_number`.

## 2026-10-19: Repository auf github.com/FuzzCube/RhenWerk-WebSite

Nutzerentscheidung: Weitergearbeitet wird nur im eigenen Repository (`origin`), nicht mehr im Organisationsrepo `Futureway-Akademie/A.Sadkovojs_Project`. Commits auf `main`; gepusht wird nur auf Wunsch des Nutzers.

## 2026-10-19: Diagrammlegende als Schalter

Nutzerwunsch, task-12-5: Bei zwei oder mehr Reihen ist die Legende eine Reihe von Schaltern (`aria-pressed`); ein Klick blendet eine Reihe aus, y-Achse und Tooltip folgen, die letzte sichtbare Reihe bleibt. Die Datentabelle zeigt immer alle Reihen, die Auswahl wird nicht gespeichert.

## 2026-10-20: Betrieb in zwei Stufen, Sicherung als geprüftes Archiv

Nutzerentscheidung, task-12-11: Stufe 1 ohne laufende Kosten – Website unter `rheinwerk-service.online`, Next.js, n8n und Supabase auf dem eigenen Rechner, öffentlich nur über den bestehenden Cloudflare Tunnel (keine offenen Ports, Supabase nicht veröffentlicht). Stufe 2 später ein Server; empfohlen ein virtueller Server in Deutschland mit denselben Containern, weil der Umzug dann mit den vorhandenen Sicherungsskripten gelingt. Die kostenlosen Oracle-Instanzen reichen bis auf die oft nicht verfügbare Ampere-A1-Instanz nicht. Sicherung: `npm run backup` erzeugt ein Archiv aus `pg_dump`, Storage-Dateien, n8n-Datenbank und – nur verschlüsselt (AES-256, `BACKUP_PASSPHRASE`) – n8n-Schlüssel und `.env.local`; `npm run backup:check` stellt es in eine getrennte Datenbank wieder her und vergleicht Zeilenzahlen. Begründung: Eine Sicherung zählt erst mit geprüfter Wiederherstellung; der n8n-Schlüssel ist ohne Sicherung unersetzlich. Details: `docs/betrieb.md`.

## 2026-10-20: Kunden entstehen aus bearbeiteten Anfragen (geplant, Phase 14)

Nutzerentscheidung: Kunden von Hand anzulegen ist doppelte Arbeit; bisher entstanden Kunden nur über „Kunde anlegen“ oder den Demo-Seed, Anfragen aus Formular, E-Mail und Telefon blieben ohne Kundenstamm. Künftig ordnet die Datenbank eine Live-Anfrage beim Übergang auf `processed` einem Kunden zu oder legt ihn an – für alle Eingangswege und unabhängig davon, ob KI oder Dispatcher die Erstbearbeitung abschließt (eine gemeinsame Funktion). Zeitpunkt bewusst nicht beim Eingang: Spam, Dubletten, Anfragen außerhalb des Einsatzgebiets und abgelehnte Anfragen sollen den Kundenstamm nicht füllen (auch Datensparsamkeit). Regeln: sicherer Treffer (gleiche E-Mail oder normalisierte Firma + PLZ eines aktiven Standorts) → verknüpfen, neue Adresse als Standort; kein Treffer → anlegen; unsicherer Treffer (gleiche Firma andere PLZ, gleiche Firmen-Domain ohne Freemail, mehrere Treffer) → nichts automatisch, Vorschlag an den Dispatcher. Begründung: in Field-Service-Systemen ist der Kunde das Stammobjekt, ein angenommener Auftrag gehört immer zu einem Kunden; falsche automatische Zusammenführungen („Müller GmbH“ in zwei Städten) wären schwerer zu korrigieren als ein Vorschlag. „Kunde anlegen“ bleibt für Kunden ohne Anfrage (Wartungs-/SLA-Vertrag vor dem ersten Auftrag, Übernahme von Bestandskunden) und erhält eine Dublettenprüfung. Umsetzung: task-14-1 bis 14-4.

## 2026-10-20: Kundennummer überall sichtbar, Identifikation bleibt Kundennummer + PLZ (geplant, Phase 15)

Nutzerentscheidung nach einem Testanruf: Ohne Kundennummer behandelt Mira den Anrufer als Neukunden und fragt die vollständige Adresse ab. Eine Erkennung nur über den Firmennamen bleibt ausgeschlossen – jeder könnte sich als Firma X ausgeben, Mira würde Standortdaten nennen und die Anfrage einem fremden Kunden zuordnen; dazu verhört die Spracherkennung Firmennamen. Stattdessen soll der Kunde seine Nummer kennen: Wie im papierbasierten Ablauf steht die Kundennummer in Stammdaten, Listen, Rechnungen, Einsatzansicht, Rechnungs-PDF (aus dem verknüpften Kunden) und in E-Mails an Kunden. Die Eingangsbestätigung nennt sie nur bei bereits verknüpften Anfragen, weil Neukunden erst beim Abschluss der Erstbearbeitung entstehen. Eine eigene Rechnungsanschrift je Kunde ist bewusst zurückgestellt (Rechnung geht weiter an die Standortadresse der Anfrage). Umsetzung: task-15-1 bis 15-3.

## 2026-10-20: Kundennummer nur aus dem Kundenstamm, genannte Nummer wird geprüft

Nutzerentscheidung, task-15-2: Die Kundennummer ist wie in einer Warenwirtschaft der feste Schlüssel des Kunden. Sie entsteht ausschließlich beim Anlegen in der Datenbank (fortlaufend aus der Sequenz) und ist danach unveränderlich; „Kunde anlegen“ hat kein Eingabefeld mehr (die frühere Übernahme alter Nummern entfällt). Die Nummer wird vor dem Speichern nicht angezeigt, weil zwei gleichzeitig geöffnete Formulare sonst dieselbe Nummer versprechen würden; sie erscheint danach im Hinweis und in den Stammdaten. Eine Anfrage trägt nur die Nummer ihres verknüpften Kunden. Was Kunde, Formular, E-Mail oder Telefon nennen, ist eine ungeprüfte Angabe (`stated_customer_number`) und wird wie am Telefon nur mit PLZ oder hinterlegter E-Mail anerkannt; passt sie nicht, entscheidet ein Mensch (Vorschlag), weil ein Tippfehler oder eine fremde Nummer sonst Anfrage und Rechnung dem falschen Kunden zuordnen würde. Die Webformular-Prüfung verrät nicht, ob eine Nummer existiert (keine Abfrage von Kundennummern durch Ausprobieren). Ausgestellte Rechnungen bleiben unverändert (festgeschrieben); neue Rechnungen erhalten die geprüfte Nummer.

## 2026-10-21: Bestandskunde in der telefonischen Anfrage über die Kundennummer

Nutzerentscheidung, task-15-4: Nennt ein Anrufer seine Kundennummer, tippt der Dispatcher sie in das hervorgehobene erste Feld der telefonischen Anfrage; während des Tippens erscheinen passende Kunden, die Auswahl füllt das Formular und verknüpft die Anfrage beim Anlegen mit dem Kunden. Einen eigenen Suchknopf oder Suchdialog gibt es bewusst nicht (Wunsch des Nutzers: ein Feld, Vorschläge beim Tippen). Bei Neukunden bleibt das Feld leer; die Nummer vergibt weiterhin die Datenbank beim Abschluss der Erstbearbeitung (task-15-2).

- Je Standort ein Vorschlag, damit Firma und Anschrift mit einer Auswahl stimmen; die Suche nach einem Ort grenzt die Standorte ein.
- Firma und Anschrift kommen aus dem Kundenstamm; Ansprechperson, E-Mail und Telefon nur in leere Felder, weil eine andere Person des Kunden anrufen kann. Alle Felder bleiben änderbar; eine abweichende Anschrift wird beim Abschluss der Erstbearbeitung als neuer Standort ergänzt.
- Anders als bei Mira (Kundennummer + PLZ) prüft die Datenbank hier keine PLZ: Der Dispatcher sieht Firma und Anschrift und gleicht sie im Gespräch ab. Die Vorschläge zeigen nur, was Dispatcher, Manager und Admin über RLS ohnehin lesen dürfen.
- Nur aktive Kunden; Demo-Kunden sind wie bei Mira zulässig (lokale Vorführung).
- Ohne Auswahl aus den Vorschlägen bleibt eine getippte Nummer eine ungeprüfte Angabe (`stated_customer_number`) und wird wie bisher beim Abschluss der Erstbearbeitung geprüft.

## 2026-10-21: Kundennummer in E-Mails an Kunden

Nutzerentscheidung, task-15-3: Kunden sollen ihre Kundennummer bei Rückfragen und Anrufen nennen. Deshalb enthalten Eingangsbestätigung, Rückfrage, Terminbestätigung (auch die Absage einer Vormerkung) und Zahlungserinnerungen den Satz „Ihre Kundennummer: K-… – bitte bei Rückfragen und Anrufen angeben“ vor dem Gruß, sofern die Anfrage mit einem Kunden verknüpft ist.

- Ohne Verknüpfung kein Satz: Neukunden entstehen erst beim Abschluss der Erstbearbeitung, ihre Eingangsbestätigung nennt daher keine Nummer.
- Zahlungserinnerungen nennen die Nummer der Rechnung (Snapshot beim Ausstellen), damit Erinnerung und Rechnung übereinstimmen; fehlt sie dort, die der Anfrage.
- Eine eigene Rechnungs-E-Mail gibt es nicht; das Rechnungs-PDF zeigt die Kundennummer bereits. Eine Rechnungs-E-Mail wurde nicht neu eingeführt.
- Die Vorlagen bleiben in `emails/`; der Satz kommt über den Platzhalter `{{customer_number_note}}`, der ohne Kunde leer bleibt.

## 2026-10-21: Übersicht als Startseite der Rolle Admin

Nutzerentscheidung, task-15-5: Admin landet nach der Anmeldung auf der Übersicht statt auf der Verwaltung; die Verwaltung bleibt über die Navigation erreichbar. Startseiten stehen weiter zentral in `lib/auth/roles.ts`.

## 2026-10-21: Zeitraumwahl in der Karte, die sie filtert

Nutzerentscheidung, task-15-6 bis 15-8: Ein Schalter im Seitenkopf wirkt wie ein globaler Filter. In der Auswertung steht die Zeitraumwahl deshalb in der Karte, die sie tatsächlich filtert („Eingänge kumuliert“, „Läufe“); nur beim Telefon betrifft sie den ganzen Bereich und bleibt im Kopf. Monatsdiagramme wählen 12 oder 24 Monate (`?monate=12`) aus den immer geladenen 24 Monaten. Alle Zeitraum- und Monatsschalter sind kompakt (32 px, auf Telefonen 44 px als Tippziel).

- Ein Zeitraumwechsel baut die Seite nicht neu auf: der Zeitraum steht nicht im `Suspense`-Key, die Links navigieren per Transition (`components/dashboard/pending-nav.tsx`), der bisherige Inhalt bleibt bis zu den neuen Daten stehen und wird abgeblendet. Ladeplatzhalter nur beim ersten Laden und beim Bereichswechsel.

## 2026-10-21: Anrufe ohne Anfrage nach 12 Monaten löschen

Nutzerentscheidung, task-16-1: Die im Datenschutzkonzept genannte Frist wird umgesetzt. Gelöscht wird die ganze Zeile (Zusammenfassung, Kategorie, Kennzahlen), nicht nur einzelne Felder; Anrufe mit Anfrage bleiben wie die Anfrage. Folge: Telefon-Kennzahlen für Zeiträume älter als 12 Monate zählen solche Anrufe nicht mehr.

## 2026-10-21: Kundennummer auch im Notfallablauf von Mira

Befund aus dem Sprachtest vom 20.10.2026, task-16-2: Gerade bei Notfällen soll ein Bestandskunde verknüpft sein. Mira fragt im Notfall deshalb zuerst nach der Kundennummer (`kunde_finden`) und erfragt bei Treffer weder Firma noch Adresse oder E-Mail. Die Notfallregel steht als Schrittfolge im Systemprompt; die zunächst nur ergänzte Fassung führte in der Simulation nachts zu verbotenen Rückrufzusagen.

- Mira sucht weiterhin nicht nach Firmennamen: ein Anrufer ohne Kundennummer wird wie ein Neukunde aufgenommen, der Kunde entsteht oder verknüpft sich beim Abschluss der Erstbearbeitung.

## 2026-10-21: SLA-Verträge in Kundenliste und Kundenseite, nur lesend

Nutzerentscheidung, task-16-3: Dispatcher, Manager und Admin sehen, welche Kunden einen SLA-Vertrag haben – Kennzeichen in der Kundenliste, Ansicht „Mit SLA-Vertrag“ (aktive Kunden mit heute gültigem Vertrag) und Vertragsangaben auf der Kundenseite. Zuordnung über die Kundennummer wie in `service_contracts`. Die Pflege der Verträge im Dashboard ist ein eigener, späterer Schritt.

## 2026-10-21: Betrieb aus einer Produktionskopie mit Releases je Commit

Nutzerentscheidung, task-17-1 (Phase 17 „Updates und Überwachung“): Der Betrieb läuft aus `~/RheinWerk-Prod`, nicht aus dem Entwicklungsordner. Ein automatisches Update darf nie auf laufende Entwicklungsarbeit treffen; Quelle ist ausschließlich `origin/main`.

- Jedes Release wird in einen eigenen Ordner gebaut und erst nach erfolgreichem Build über den Symlink `current` aktiviert. Der Rückweg ist ein Umschalten ohne Neubau; antwortet die App nach dem Umschalten nicht, schaltet das Skript selbst zurück.
- Es bleiben 3 Releases (je etwa 1,5 GB), nicht 5.
- Port 3200 für den Betrieb, Port 3000 bleibt `next dev`. Beide nutzen in Stufe 1 dieselbe lokale Datenbank.
- Der Rückweg betrifft nur den Code; Migrationen werden nicht zurückgenommen (sie sind nur vorwärts geschrieben). Daten zurück nur über die Wiederherstellung einer Sicherung.

## 2026-10-21: Sicherungen 14 Tage nach Alter aufbewahren

Nutzerentscheidung, task-17-1: Sicherungen werden nach 14 Tagen gelöscht, gemessen am Zeitstempel im Dateinamen (`BACKUP_KEEP_DAYS`), statt der 14 neuesten Archive. Zusätzliche Sicherungen vor Updates oder Datenübernahmen verdrängen so keine Tagessicherungen. Die neueste Sicherung bleibt immer, auch wenn sie älter ist (etwa nach einem längeren Ausfall).

## 2026-10-21: Updates und Warnungen in der Datenbank, Befehle nur auf dem Rechner

Nutzerentscheidung, task-17-2: Das Dashboard liest Updates, Releases und Warnungen nur und legt Anfragen an („Jetzt aktualisieren“, „Wiederherstellen“); ausgeführt werden sie von einem Skript auf dem Rechner, nie von der Web-App. Nur admin darf anfragen und Warnungen erledigen, manager liest mit.

- Empfänger der Warn-E-Mails stehen in `ALERT_EMAILS` (`~/RheinWerk-Prod/shared/.env.local`), nicht in einer Migration oder Tabelle: Das Repository ist öffentlich. Vorerst nur der Admin; Manager sehen Warnungen im Dashboard.
- Ein Vorfall ist eine offene Warnung je `alert_key`. E-Mail beim ersten Auftreten, Erinnerung frühestens nach 6 Stunden, „wieder in Ordnung“ nur, wenn vorher gemailt wurde. Ob gemailt wird, entscheidet die Datenbank; als gemailt gilt eine Warnung erst nach erfolgreichem Versand.
- Höchstens eine Anfrage wartet oder läuft und höchstens ein Lauf ist aktiv, durchgesetzt über Teilindizes statt nur im Skript.

## 2026-10-21: Warn-E-Mails per Gmail SMTP, nicht über n8n

Nutzerentscheidung, task-17-3: Warnungen gehen direkt aus den Skripten per Gmail SMTP (App-Passwort des Kontos `rheinwerk.industrieservice@gmail.com`) an `ALERT_EMAILS`. Über n8n ließe sich ein Ausfall von n8n selbst nicht melden. `nodemailer` ist exakt auf 10.0.14 gepinnt: Die 10.1.x-Reihe bekam am 18.10.2026 fünf Versionen an einem Tag, eine neue Abhängigkeit kommt erst nach zwei Wochen Reifezeit. Ausnahme vom Freigabegrundsatz für ausgehende E-Mails: Diese E-Mails gehen nur an den Betreiber, nie an Kunden.

## 2026-10-21: Nächtliches Update aus origin/main mit Sicherung und Rückfall

Nutzerentscheidung, task-17-5: Jede Nacht um 02:00 sichert ein Lauf zuerst die Daten mit Wiederherstellungstest und übernimmt danach den neuesten Stand von `origin/main` in den Betrieb. Die bisher getrennt geplante tägliche Sicherung ist Teil dieses Laufs.

- Ohne wiederherstellbare Sicherung kein Update.
- Migrationen laufen vor dem Umschalten und werden nie zurückgenommen; sie müssen mit dem vorherigen Code verträglich sein. So bleibt der Rückweg ein reines Umschalten des Codes.
- Ein Release, dessen Migration oder Gesundheitsprüfung scheitert, wird verworfen, damit nur lauffähige Releases als Rückweg bleiben.
- E-Mails nur bei Fehlern und nach einem Fehler die Entwarnung; erfolgreiche Updates stehen nur im Dashboard.
- npm-Pakete und n8n werden nur als verfügbar angezeigt und nie automatisch aktualisiert.

## 2026-10-21: Dashboard-Anfragen über einen Dienst auf dem Rechner, Rücksetzen hält nachts an

Nutzerentscheidung, task-17-6: Anfragen aus dem Dashboard führt ein LaunchAgent jede Minute aus; die Web-App bekommt keine Möglichkeit, Befehle auszuführen. Nacht, Terminal und Dashboard nutzen denselben Ablauf (`scripts/prod/runs.mjs`).

- Nach „Wiederherstellen“ überspringt die Nacht den verlassenen Commit, bis `origin/main` weiterzieht; sonst würde das nächste Update das Rücksetzen sofort aufheben.
- Update- und Anfrage-Skripte laufen aus dem neuesten gebauten Release (`tools`), nicht aus dem aktiven: Ein Rücksetzen der App darf keine älteren Update-Skripte (ohne diese Regel) zurückbringen.
- Ein abgebrochener Lauf blockiert höchstens bis zur nächsten Minute: Wer die Sperre hält, schließt verwaiste `running`-Einträge ab.


## 2026-10-21: Bereich „System“ statt „Updates“

Nutzerentscheidung, task-17-7: Updates, Versionen und später die Warnungen (task-17-10) stehen gemeinsam im Bereich „System“ (`/dashboard/system`) für admin und manager; manager sieht dieselben Inhalte ohne Schaltflächen.

- „Jetzt aktualisieren“ und „Wiederherstellen“ der Code-Version wurden mit task-17-12 wieder entfernt (siehe unten).

## 2026-10-21: Bereich „System“ für den Inhaber, Systemupdates mit Rückfall

Nutzerentscheidung nach Sichtung von task-17-7 (Roadmap v19/v20): Der Bereich „System“ richtet sich an den Inhaber, nicht an die Entwicklung.

- Code-Updates verschwinden aus dem Dashboard (keine Commits, Releases, „Jetzt aktualisieren“, „Wiederherstellen“ der Version). Das nächtliche Update aus `origin/main` und der Weg über das Terminal bleiben (task-17-12). Die Funktionen `request_update` und `request_rollback` bleiben, aber ohne Ausführungsrecht für Nutzer (Migration `20261021170000_system_owner_area.sql`); die Tabelle `update_requests` und der Dienst `online.rheinwerk.requests` tragen die künftigen Aktionen.
- Datensicherung einmal täglich genügt für das Demo-Projekt; der Nachtlauf bleibt, das Dashboard zeigt die Sicherungen und bietet „Jetzt sichern“ (task-17-13).
- Wiederherstellung der Daten nur als Ganzes aus einer geprüften Sicherung, nicht einzelner Datensätze; vorher sichert der Dienst den aktuellen Stand (task-17-14).
- n8n und Supabase werden mit einer Schaltfläche aktualisiert: Systemsicherung, Update, nur lesender Selbsttest, bei Fehler automatischer Rückfall auf Version und Daten von vorher (task-17-16). Das ersetzt für diese beiden „Updates nur anzeigen“. Docker Desktop und npm-Pakete werden weiterhin nur angezeigt.
- Wie bisher führt die Web-App keine Befehle aus; jede Aktion ist eine Anfrage an den Dienst auf dem Rechner.

## 2026-10-21: Überwachung von Mira durch den Wächter

task-17-9: Ein Wächter auf dem Rechner (`online.rheinwerk.watchdog`, alle 5 Minuten) prüft Mira; n8n folgt in task-17-8 im selben Skript.

- Die Werkzeugprobe ruft nur `agent-anlage-pruefen` auf (reiner Katalogabgleich in n8n): Werkzeuge mit `call_id` würden Gesprächszeilen in `phone_calls` anlegen.
- Fehlgeschlagene Werkzeugaufrufe stehen nicht in der Datenbank; der Wächter liest sie aus den Gesprächen der letzten Stunde bei ElevenLabs (höchstens 30 Gespräche am Tag). Ab 3 Fehlern je Stunde gibt es eine Warnung, einzelne Ausreißer nicht.
- Fehlt der Zugriff (Berechtigung „User: Read“ für das Guthaben, Secret, Datenbank), wird die Prüfung übersprungen statt gewarnt. Ohne Datenbank verschickt der Wächter keine E-Mail, sonst käme alle 5 Minuten eine; diesen Ausfall meldet `/api/health`.

## 2026-10-21: Kein Betrieb aus einer Produktionskopie bis Projektende

Nutzerentscheidung, task-17-17 (ersetzt den Abschnitt „Betrieb aus einer Produktionskopie“ von task-17-1): Bis zum Abschluss des Projekts läuft alles auf dem eigenen Rechner aus dem Entwicklungsordner. Die Website kommt erst danach unter die Domain, Supabase und n8n voraussichtlich auf einen Server.

- `~/RheinWerk-Prod` mit Releases je Commit, nächtlichem Code-Update aus `origin/main` und Rücksetzen ist entfernt (Papierkorb), ebenso die Dienste `online.rheinwerk.web`, `.update` und `.requests` und ihr Code (Git-Historie bis `284294f`, Vorlage für den Server).
- Weiter automatisch, jetzt aus dem Entwicklungsordner: nächtliche Sicherung mit Wiederherstellungstest (`online.rheinwerk.backup`, 02:00) und Wächter (`online.rheinwerk.watchdog`, alle 5 Minuten). `node` und `zsh` brauchen dafür Festplattenvollzugriff, weil macOS LaunchAgents sonst nicht in `~/Documents` lesen lässt (Nutzerentscheidung statt Umzug des Projektordners).
- Die Tabellen der Code-Updates (`system_releases`, `system_updates`, `update_requests`) bleiben vorerst ungenutzt in der Datenbank; Migrationen werden nicht zurückgenommen.

## 2026-10-21: Deployment auf Vercel und einen VPS, Sicherung erst dort

Nutzerentscheidung (Roadmap v22, Phase 18 „Deployment“): Nach Projektende kommt der Code auf GitHub, die Website auf Vercel (sofern der kostenlose Hobby-Tarif reicht; er erlaubt nur nicht-kommerzielle Nutzung, was für das Portfolio-Projekt passt), Supabase und n8n per Docker Compose auf einen VPS.

- Code-Updates: Push auf `main` → GitHub Actions prüfen und spielen Migrationen ein → Vercel deployt; Rückweg über Instant Rollback in Vercel.
- Versionen von Supabase und n8n stehen fest in `docker-compose.yml`; neue kommen als Renovate-PR und werden mit Sicherung, Selbsttest und automatischem Rückfall eingespielt (task-18-8, statt task-17-16 auf dem Rechner).
- Datensicherung im Dashboard und Datenwiederherstellung werden erst auf dem VPS gebaut (task-18-6, task-18-7 statt task-17-13, task-17-14). Bis dahin läuft die nächtliche Sicherung auf dem Rechner weiter (`online.rheinwerk.backup`).
- Für Vercel muss die Supabase-API öffentlich über HTTPS erreichbar sein (bisher nicht veröffentlicht); Absicherung wird in task-18-1 festgelegt.

## 2026-10-21: Überwachung von n8n

task-17-8: Der Wächter prüft n8n nur über dessen API (`N8N_API_KEY`) und die Datenbank, nie über die SQLite-Datei (am 20.10.2026 hing n8n dadurch zwei Stunden).

- Fehlgeschlagene Läufe meldet der Error-Workflow „RheinWerk · Fehlermeldung“ als Warnung in die Datenbank; die E-Mail verschickt der Wächter, nicht n8n, damit sie auch ankommt, wenn Gmail in n8n ausgefallen ist. Eine solche Warnung schließt nach einer Stunde ohne neuen Fehlerlauf des Workflows.
- n8n 2.x ruft einen Error-Workflow nur auf, wenn er veröffentlicht ist; der Wächter prüft ihn deshalb wie die übrigen Workflows.
- Kritisch sind Ausfälle, die Kunden sofort merken (n8n aus, Workflow aus, Versandstau, Fehler in Formular, Versand und Mira-Werkzeugen); KI-Analysen und Zeitpläne, die von selbst nachholen, sind Warnungen.
- Andere Workflows im selben n8n gehören nicht zum Projekt und werden weder geändert noch überwacht.

## 2026-10-21: Zustand der Systeme und Versionen nur anzeigen (task-17-15)

- Der Wächter prüft alle 5 Minuten zusätzlich Website, Datenbank, Cloudflare-Tunnel, SMTP, Docker und Speicherplatz (`scripts/ops/systems.mjs`); jede fehlgeschlagene Prüfung ist eine Warnung `system:*` mit E-Mail über `raise_alert`. SMTP meldet sich nur stündlich bei Gmail an, damit Google keine Anmeldung alle 5 Minuten sieht.
- Bei einem Ausfall der Datenbank gibt es keinen Warnungseintrag. Die E-Mail geht deshalb direkt raus, höchstens alle 6 Stunden, gemerkt in einer Datei neben den Protokollen.
- Docker: Pflicht sind nur die Container, die das Projekt braucht (Supabase db, kong, auth, rest, storage, realtime und n8n). Die Edge Runtime ist gestoppt und wird nicht genutzt (keine Edge Functions); sie löst keine Warnung aus.
- Speicherplatz in absoluten Gigabyte (Warnung unter 20 GB, kritisch unter 5 GB, einstellbar), weil Sicherung und Datenbank feste Mengen brauchen, nicht einen Anteil der Platte.
- Versionen (Docker Desktop, Supabase CLI und Images, n8n, Node.js, npm-Pakete) werden nur mit Empfehlung und Link zu den Release Notes angezeigt, nie installiert (Nutzerentscheidung 21.10.2026). Empfehlung: gleiche Hauptversion „Update empfohlen“, neue Hauptversion erst nach den Release Notes.
- „System prüfen“ (nur Admin) legt eine Anfrage in `system_status` an; der Dienst `online.rheinwerk.systemcheck` fragt alle 20 Sekunden mit einer kleinen Abfrage nach. Die Web-App führt weiterhin keine Befehle auf dem Rechner aus.

## 2026-10-21: Anlaufzeit von n8n im Wächter (task-17-11)

Die Gesamtprobe zeigte, dass n8n nach einem Start `/healthz` beantwortet, bevor API und Webhooks bereit sind. Der Wächter überspringt deshalb in den ersten 3 Minuten nach dem Containerstart die Prüfungen der n8n-API und der Werkzeuge von Mira, statt Warnungen mit E-Mail auszulösen. Ein abgelehnter Schlüssel (HTTP 401/403) und Cloudflare Access werden weiter sofort gemeldet. Läuft n8n danach nicht richtig, meldet der nächste Lauf den Fehler.

## 2026-10-21: Zielarchitektur des Deployments (task-18-1)

Nutzerentscheidung 21.10.2026, ausgearbeitet mit Preisen vom 21.10.2026 (Einzelheiten `docs/betrieb.md` 3):

- Website und Dashboard auf **Vercel Hobby** (Region am 22.10.2026 auf `cdg1` Paris festgelegt, siehe unten); Supabase (self-hosted) und n8n per **Docker Compose auf einem VPS** in der EU (am 22.10.2026 festgelegt: OVHcloud VPS-2 in Roubaix, siehe unten; zuerst geprüft: Hetzner CX33 8,99 € nicht lieferbar, netcup VPS 1000 14,50 €).
- Die Supabase-API wird **nicht öffentlich**: Sie liegt unter `api.rheinwerk-service.online` hinter Cloudflare Access, nur die Website auf Vercel kommt mit einem Service-Token durch. Das geht, weil der Browser die API nie direkt aufruft (alle Zugriffe auf dem Server, Passwort-Link über `/auth/bestaetigen`). Am Server ist außer SSH kein Port offen; alles läuft über den Cloudflare-Tunnel. Verworfen: Kong direkt öffentlich mit Reverse Proxy und Rate-Limits (größere Angriffsfläche, die Rate-Limit-Regeln im kostenlosen Cloudflare-Tarif sind sehr begrenzt).
- n8n bleibt hinter Cloudflare Access; neben ElevenLabs sendet auch die Website ihre Webhook-Aufrufe mit Service-Token.
- Der Hobby-Tarif erlaubt nur nicht-kommerzielle Nutzung. Für das Portfolio-Projekt reicht er, wenn die Website deutlich als Demo gekennzeichnet ist; vor echter Nutzung mit Kunden Wechsel auf Vercel Pro (20 $/Monat).
- Verworfen: Supabase Cloud und n8n Cloud (zweite Datenhaltung, Sicherungen erst im bezahlten Tarif, Umzug der Workflows); Oracle „Always Free“ (Ampere-Instanzen selten verfügbar).

## 2026-10-22: OVHcloud VPS-2 ohne Speicher außer Haus, Sicherung auf dem Rechner um 09:00

Nutzerentscheidungen 22.10.2026, ergänzen den Eintrag zu task-18-1:

- Server für Phase 18: **OVHcloud VPS-2** (4 vCore, 8 GB RAM, 75 GB NVMe, tägliche Sicherung des Anbieters inklusive, 8,58 € inkl. MwSt. im Monat bei 12 Monaten Vorauszahlung, im Konfigurator 10,10 € gesehen) im Rechenzentrum **Roubaix (Frankreich)**: das Angebot hat keinen deutschen Standort; die DSGVO verlangt nur EU, OVH ist ein französisches Unternehmen. Vercel-Funktionen deshalb in **`cdg1` (Paris)** statt `fra1`, damit die Abfragen zum Server kurz bleiben. Hosting und Auftragsverarbeitung kommen in die Datenschutzerklärung (task-18-4). Günstiger als Hetzner CX33 (derzeit nicht lieferbar) und netcup; VPS-1 mit 4 GB wäre das Minimum.
- **Keine Kopie der Sicherungen außer Haus** für das Demoprojekt: die tägliche Sicherung des Anbieters und die eigenen geprüften Sicherungen auf dem Server (14 Tage) reichen. Vor echter Nutzung nachrüsten (`docs/betrieb.md` 3.4).
- Die Website wird sichtbar als Portfolio-Projekt gekennzeichnet (task-18-4).
- Auf dem eigenen Rechner läuft die Sicherung `online.rheinwerk.backup` ab sofort um **09:00** statt 02:00, weil der Rechner nachts schläft.

## 22.10.2026: Ein Server für alle Projekte (task-18-2, Roadmap v23)

- Der VPS nimmt neben RheinWerk weitere Projekte auf; jedes Projekt hat einen eigenen Ordner `/opt/<projekt>`, ein eigenes Compose-Projekt mit eigenem Netz, Ports nur auf `127.0.0.1`, Speichergrenzen und eigene systemd-Units (`docs/betrieb.md` 3.5). Öffentlich nur über Cloudflare-Tunnel, `ufw` bleibt bei SSH.
- Vom Oracle-Server ziehen um: der RAG-Assistent der Website **in RheinWerk** (Tabelle mit pgvector in der RheinWerk-Datenbank, Workflows im n8n von RheinWerk, Aufruf über `/api/assistant` statt direkt mit CORS), der **House Items Bot** und **Personal Copilot** jeweils als **eigenes Projekt** (persönliche bzw. eigene Portfolio-Daten getrennt von RheinWerk, unabhängig aktualisierbar). Danach werden Oracle und die alte Vercel-Website `rheinwerk-industrieservice` abgeschaltet.

## 2026-10-22: Wiederherstellung nur vollständig und nur mit gleichem Migrationsstand (task-18-7)

- Nur Admin stellt im Bereich „System“ eine ganze Sicherung wieder her: Datenbank, Dateien und n8n auf einmal, keine einzelnen Datensätze (Nutzerentscheidung 21.10.2026). Rückfrage mit dem Wort `WIEDERHERSTELLEN`; die Web-App legt nur eine Anfrage an (`request_restore`), ausgeführt wird sie wie „Jetzt sichern“ vom Dienst `rheinwerk-systemcheck` auf dem VPS.
- Vorher immer eine geprüfte Sicherung des aktuellen Stands (Anlass „Vor Wiederherstellung“); scheitert sie, wird nichts verändert. Scheitert die Wiederherstellung oder die Gesundheitsprüfung danach, stellt der Dienst diese Sicherung selbst wieder her. Ergebnis per E-Mail an den Admin, ein Fehlschlag zusätzlich als kritische Warnung `restore:failed`.
- Die Tabellen `backups`, `restores`, `system_alerts` und `system_status` bleiben beim Wiederherstellen auf dem aktuellen Stand, sonst verschwänden die Anfrage selbst, die neuen Sicherungen und Warnungen. Die Schlüsseldateien auf dem Server (`.env`, `ops.env`) bleiben ebenfalls.
- Aus dem Dashboard nur Sicherungen mit demselben Migrationsstand wie die Datenbank (seit task-18-7 im Manifest). Eine ältere Sicherung hätte ein anderes Schema, die beibehaltenen Tabellen passten nicht mehr, und das nächste Deployment würde Migrationen erneut einspielen. Solche Sicherungen und die Sicherungen vor einer Migration (nur Postgres) nur von Hand nach `docs/betrieb.md` 4.5.
- Nach `pg_restore` werden die Rechte der neu angelegten Objekte auf die des Dumps zurückgesetzt (`applyDumpAcl` in `scripts/restore.mjs`). Ohne das gibt Supabase `anon` und `authenticated` beim Anlegen alle Rechte, und die `revoke`-Anweisungen der Migrationen gehen verloren; so war es auf dem VPS seit dem Import von task-18-3, behoben am 22.10.2026.

## 2026-10-22: Systemupdates per Knopf, Rückfall über Schnappschüsse der Volumes (task-18-8)

- Neue Image-Versionen kommen als Dependabot-PR; nach dem Merge legt das Deployment nur die Datei auf den Server. Eingespielt wird erst mit **Update einspielen** im Bereich „System“ (nur Admin), damit der Zeitpunkt bewusst gewählt ist und ein gescheitertes Update das Deployment nicht rot lässt.
- Rückfall über **Schnappschüsse aller Volumes** bei angehaltenen Diensten statt über die Sicherung: neue Images ändern selbst Daten (Migrationen von Auth, Storage und n8n, Erweiterungen von Postgres), die ein `pg_restore` mit dem alten Image nicht sauber zurücknimmt. Die geprüfte Sicherung davor bleibt für den Fall, dass auch der Rückfall scheitert.
- Nach einem Rückfall bleiben die geänderten Dienste in `images.override.yml` auf dem alten Image gepinnt, bis ein Update gelingt; die Compose-Datei im Repository zeigt weiter die neue Version.
- Der Selbsttest liest nur; Schreibproben (Testanfrage, Anmeldung mit Sitzung) würden Produktionsdaten erzeugen. Die Anmeldung wird über die Admin-API von Auth geprüft, die Credentials von n8n über den Workflow „RheinWerk · Selbsttest“.
- Wiederherstellung und Update schließen sich gegenseitig aus (`request_restore`, `request_image_update`) und teilen die Sperre `maintenance.lock` für Wächter und tägliche Sicherung.
- Dependabot-PR #3 (PostgREST v14 → v16) geprüft: keine der Änderungen betrifft RheinWerk (`jwt-role-claim-key` nicht gesetzt, `db-schemas` ohne `pg_catalog`, kein `Prefer: timezone`).

## 2026-10-22: Website-Assistent in RheinWerk (task-18-10)

- Die Website fragt den Assistenten nur noch über die eigene Route `/api/assistant`; n8n bleibt hinter Cloudflare Access, der Service-Token liegt nur auf dem Server. Prüfung der Frage (1–500 Zeichen) und 20 Fragen je Besucher in 10 Minuten (Speicher einer Server-Instanz; genügt für das Demoprojekt, sonst Upstash/Edge Config).
- Wissensbasis als Tabelle `rag_documents` in der RheinWerk-Datenbank, nur für `service_role`; die Embeddings werden in RheinWerk neu erzeugt statt kopiert, damit die Quelldatei in `metadata.file` steht. Dokumente und Systemprompt liegen im Repository (fiktive Daten).
- Gesprächsverlauf je Browser-Tab (`session_id`, UUID) statt eines festen Schlüssels für alle Besucher wie auf Oracle.
- Sprachmodell wie auf Oracle (`gpt-5.6-luna`), damit die Antworten gleich bleiben; OpenAI-Credential von RheinWerk.


## Wunschtermin aus dem Formular automatisch vormerken (task-19-3, 22.10.2026)

Nutzerentscheidung: Wie beim Telefonassistenten soll auch das Formular den Wunschtermin prüfen und vormerken, damit der Dispatcher nur noch prüft und mit einem Klick bestätigt.

- Das Formular fragt zusätzlich die Uhrzeit (beliebig, vormittags, nachmittags oder volle Stunde 07–14 Uhr). Frei → Vormerkung beim im Monat am wenigsten belegten Techniker; belegt → nächster freier Termin ab dem Wunschtag, in der Anfrage als „Zu dieser Zeit war niemand frei“ gekennzeichnet. Die Datenbank rechnet den Kalender, kein Sprachmodell.
- Notfälle bekommen keine Vormerkung (wie am Telefon); sie gehen sofort an Menschen.
- „Termin bestätigen“ schließt eine offene Erstbearbeitung mit der gewählten Priorität ab und plant den Einsatz; die Terminbestätigung gilt als von dieser Person freigegeben (Regel „Ausgehende E-Mails brauchen Freigabe“ bleibt).
- Auch die manuelle Planung auf der Plantafel schickt standardmäßig eine Terminbestätigung (abwählbar). Verschieben schickt keine neue Bestätigung.
- Die Auslastung des Monats entscheidet zuerst über den Techniker, danach die des Tages; das gilt auch für Mira.

## 22.10.2026 · Versionskonflikt nur bei echten Änderungen (task-20-8)

Der Versand einer E-Mail im Hintergrund (Eingangsbestätigung, Terminbestätigung) erhöht die Version der Anfrage einige Sekunden später. Alle Aktionen der Anfrageseite senden deshalb `seen_at` (updated_at der geladenen Seite) mit. Bei RW409 wird einmal mit der aktuellen Version wiederholt, wenn seitdem mindestens ein und ausschließlich Mail-Ereignisse der Automatisierung (`message_queued`, `message_sent`) geschahen und die Version höchstens um deren Anzahl stieg. Jede andere Änderung, auch ohne Ereignis, bleibt ein Konflikt.

## 23.10.2026 · Vormerkung nach Auslastung der Woche (task-20-11)

Nutzerentscheidung: Für die automatische Vormerkung (Formular und Mira) zählt der Anteil der Kalenderwoche (Montag bis Sonntag) des Fensters, nicht mehr des Monats; Abwesenheiten mindern die Kapazität wie bisher. Der Monatsanteil war ungerecht, weil ein Techniker mit voller Woche, aber leerem Restmonat weiter neue Einsätze bekam. Die Plantafel zeigt weiterhin die Auslastung des Monats; die Vorschläge der manuellen Planung bleiben unverändert.

## 23.10.2026 · Dispatcher nach Anfragen des Monats (task-20-12)

Nutzerentscheidung: Neue Anfragen gehen an den Dispatcher mit den wenigsten Anfragen im laufenden Kalendermonat, damit alle ungefähr gleich viele bearbeiten. Unbearbeitete Anfragen zählen mit, stornierte und abgelehnte nicht, nicht zugeordnete E-Mails im Posteingang ebenfalls nicht. Bei Gleichstand erhält sie, wer am längsten keine neue Anfrage bekommen hat. Vorher zählten nur offene Erstbearbeitungen; wer schnell bearbeitete, bekam jede neue Anfrage. Die E-Mails des Posteingangs werden weiter nach offener Last verteilt, damit sie nicht alle bei einer Person landen.

## 23.10.2026 · Kundenwunsch statt Vorschlägen auf der Plantafel (task-20-13)

Nutzerentscheidung: Hat der Kunde einen Termin gewünscht und es gibt eine Vormerkung, schlägt die Plantafel keine anderen Zeiten vor; sie zeigt nur die Vormerkung und den Wunsch des Kunden. Konnte der Wunsch nicht erfüllt werden, ist die Vormerkung orange und muss mit dem Kunden abgestimmt werden. Von Mira am Telefon vereinbarte Termine gelten als abgestimmt, sind aber als „Mira“ gekennzeichnet.

## 23.10.2026 · Arbeitswoche auf der Plantafel, ungelesene Kundennachrichten (task-20-14)

Nutzerentscheidung: Die Plantafel zeigt die Arbeitswoche Montag bis Freitag statt 7 Arbeitstage ab einem Tag; Vorschläge und die Kennzahlen im Kopf rechnen weiter mit den nächsten 7 Arbeitstagen ab heute. Schreibt der Kunde zu einer Anfrage, ist das ein Handlungsbedarf: roter Kreis mit der Zahl an Einsatz und Vormerkung auf der Plantafel, Marke und Ansicht „Ungelesen“ in der Anfragenliste, Hinweis oben auf der Anfrage. Ungelesen bleibt die Nachricht, bis eine Person „Als gelesen markieren“ wählt; das Öffnen der Anfrage allein markiert nicht, damit der Hinweis beim Öffnen sichtbar ist.

## 23.10.2026 · Techniker in zwei Stufen: Aufträge der Woche, dann Auslastung des Monats (task-20-15)

Nutzerentscheidung: Die automatische Vormerkung wählt zuerst nach der Zahl der Aufträge (Einsätze und offene Vormerkungen) in der Kalenderwoche des Fensters; der Techniker mit den wenigsten gewinnt, wenn er allein auf dem Minimum liegt. Nur bei Gleichstand entscheidet die Auslastung des Monats (wie auf der Plantafel). Ersetzt den Minutenanteil der Woche aus task-20-11, der lange Aufträge stärker gewichtete als die Zahl der Aufträge.

## 23.10.2026 · Verschiebewünsche der Kunden per E-Mail (task-20-16)

Nutzerentscheidung: Ein Kunde, der per E-Mail einen geplanten Termin verschieben will, bekommt sofort eine automatische Eingangsbestätigung; die Entscheidung trifft der Dispatcher auf der Plantafel (Wunschtermin frei: ein Klick, der Kunde bekommt die Bestätigung; sonst ein Alternativvorschlag per E-Mail, der Termin bleibt). Sagt der Kunde auf den Vorschlag „Ja“, verschiebt die Datenbank den Termin selbst, wenn das Fenster noch frei ist; „Nein“ lässt den Termin bestehen. Antwortet der Kunde nicht, erinnert ihn das System einmal, zwei Tage nach dem Vorschlag oder einen Tag vor dem Termin. Alle E-Mails sind feste Vorlagen, kein vom Sprachmodell geschriebener Text; das Sprachmodell erkennt nur Absicht, Wunschtag und Uhrzeit. Eine Stornierung bleibt automatisch.

## 23.10.2026: Gemeinsamer Dashboard-Abruf (task-20-17)

Nutzerauftrag: globale Ereignismarken und verlinkte Hinweise ohne Neuladen, ungefähr alle 20 Sekunden. Bestehendes Next.js/Supabase/n8n bleibt erhalten, Realtime und Infrastrukturänderungen sind ausgeschlossen. Ein gemeinsamer Shell-Abruf ersetzt deshalb den bisherigen eigenen Timer der Rückrufwarnungen. Bestehende RLS-, Quittierungs-, Lese- und Bearbeitungsregeln bleiben unverändert. Neu-/Antwortzahlen sind getrennt; automatische Planungsvorgänge zählen als neu zu bearbeiten, solange sie noch nicht eingeplant sind. Bei ungespeichertem Text oder Plantafelaktionen laufen globale Marken weiter, die Seite selbst wartet auf den bewussten Aktualisierungsklick. Fehler führen zum letzten bekannten Gesamtstand statt zu Nullwerten.

Die globale Route unterscheidet in der wiederverwendeten Sitzungsprüfung vorübergehende Backend-/Auth-Ausfälle (503, weiter versuchen) von ungültigen oder entzogenen Sitzungen (401). Die bisherigen Auth-Aufrufer behalten ihr Verhalten; ein optionaler strikter Modus dient nur dem Polling. So beendet ein Supabase-Ausfall den gemeinsamen Abruf nicht dauerhaft.

## 24.10.2026 · Ruhigere Benachrichtigungen (task-23-1, task-23-2)

Nutzerentscheidung: Reine Ergebnisse unten rechts (Terminänderungen) verschwinden nach einigen Sekunden von selbst; Hinweise mit Handlungsbedarf bleiben, bis sie angeklickt werden oder die Zielseite geöffnet wird. Die Navigation zeigt je Bereich nur einen Farbpunkt statt Zahlen und Wörtern, weil viele rote Zähler unruhig wirkten; die Einzelheiten zeigt der Bereich. Das Öffnen einer Anfrage markiert ihre Kundennachrichten als gelesen und ersetzt „Als gelesen markieren“ (ändert die Entscheidung vom 23.10.2026); der Hinweis mit den neuen Nachrichten bleibt für diesen Besuch sichtbar. Die Liste markiert weiterhin nichts.

## 24.10.2026 · Laufende Automatisierung sichtbar, Plantafel-Karte (task-24-1 bis 24-3)

Nutzerentscheidung nach dem Live-Test: Wer sofort reagiert, soll sehen, dass die Automatisierung noch arbeitet: Chip „KI arbeitet …“ mit drehendem Ring neben dem Status, höchstens 15 Minuten je Ereignis, damit ein Ausfall von n8n nicht als Dauerzustand erscheint. Die Kundennummer im KI-Entwurf setzt allein die Datenbank; Sätze des Modells mit einer Kundennummer werden entfernt statt geprüft. Plantafel: im Block nur die Anfragenummer, die wichtigsten Angaben zum Einsatz in der rechten Leiste nach Klick.

