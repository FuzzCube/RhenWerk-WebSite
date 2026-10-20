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
