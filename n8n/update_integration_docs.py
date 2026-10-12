from pathlib import Path

root = Path(__file__).resolve().parent.parent
p = root / 'docs/n8n-contract.md'
s = p.read_text()
s = s.replace('# n8n-Vertrag (künftige Integration)', '# n8n-Vertrag (lokale Integration in Vorbereitung)')
old = s[s.index('> **Stand:'):s.index('\n\nDieser Vertrag')]
s = s.replace(old, '''> **Stand 08.10.2026: lokale RPC-Integration und sechs n8n-Entwürfe vorhanden, noch nicht aktiviert.** Das separate Credential `RheinWerk Supabase Lokal` funktioniert. `RheinWerk Gmail` benötigt noch die Anmeldung als `rheinwerk.industrieservice@gmail.com`. Gemini ist bis zur Zustimmung zur externen Datenverarbeitung deaktiviert; die automatische Prüfung hat die Verbindung zwischen Formular und Gemini-Analyse abgewiesen. Das Formular nutzt weiterhin Make, solange `N8N_WEBHOOK_URL` nicht gesetzt ist. E-Mails werden **nicht versendet**. Eine echte PDF-/Bildanalyse, Gmail-Zustellung und vollständige Umstellung sind noch nicht verifiziert.''')
s = s.replace('wie ein n8n-Workflow in einer späteren Stufe', 'wie die lokale n8n-Integration')
s = s.replace('| zu bauen |', '| **vorhanden**, nur `service_role` |')
s = s.replace('## Vorhandene und noch zu bauende Funktionen', '## Integrationsfunktionen')
s = s.replace('finish_automation_run(run_id, status, decision?, confidence?, result?, error_code?, error_text?)', 'finish_automation_run(run_id, status, decision?, confidence?, result?, error_code?, error_text?, workflow_execution_id?)')
s = s.replace('claim_queued_messages(limit, lease_seconds)', 'claim_queued_messages(batch_limit, lease_seconds)')
extra = '''| `find_submission(submission_id)` | **vorhanden**, nur `service_role` | vor dem Dateikopieren auf Wiederholung prüfen |
| `get_analysis_context(request_id, message_id?)` | **vorhanden**, nur `service_role` | Anfrage, letzte 20 Nachrichten und private Anhänge lesen |
| `list_pending_analyses(batch_limit?)` | **vorhanden**, nur `service_role` | unbearbeitete Anfragen und vollständige Kundenantworten |
| `register_incoming_attachment(message_id, file_name, mime_type, size_bytes, storage_path)` | **vorhanden**, nur `service_role` | eingehenden Anhang idempotent registrieren |
| `complete_incoming_message(message_id, warnings?)` | **vorhanden**, nur `service_role` | Antwort erst nach allen Anhängen zur Analyse freigeben; Dateiprobleme menschlich prüfen |
| `list_incomplete_incoming(batch_limit?)` | **vorhanden**, nur `service_role` | abgebrochene Verarbeitung eingehender Anhänge erneut aufnehmen |
| `list_orphaned_integration_files()` | **vorhanden**, nur `service_role` | verwaiste Speicherobjekte nur auflisten; keine Löschung |
'''
s = s.replace('\nDie vorhandenen Tabellen', '\n'+extra+'\nDie vorhandenen Tabellen', 1)
s = s.replace('3. Anhänge in den privaten Bucket `dashboard` unter `staging/<submission_id>/<datei>` kopieren (Speicher ist nicht Teil der Datenbanktransaktion).', '3. Nach `find_submission` die Anhänge in den privaten Bucket `dashboard` unter `requests/<submission_id>/<index>_<datei>` kopieren. Die UUID der Einreichung wird auch die `requests.id`; ein Verschieben ist nicht nötig. Speicher ist nicht Teil der Datenbanktransaktion. HTTPS-URLs müssen zu Vercel Blob gehören; Dateisignatur und 5-MB-Grenze werden geprüft.')
s = s.replace('(Pfade nach `requests/<request_id>/…` verschieben bzw. registrieren)', '(private Pfade unter `requests/<request_id>/…` registrieren)')
s = s.replace('Die Analyse startet danach asynchron.', 'Nach der späteren Aktivierung übernimmt der Analyse-Worker die Anfrage asynchron. Die direkte Verbindung zum Worker ist bis zur Gemini-Zustimmung noch nicht eingerichtet.')
s = s.replace('**Dateien:** Schlägt die Transaktion fehl, löscht der Workflow `staging/<submission_id>/`. Ein täglicher Aufräumlauf entfernt Staging-Dateien älter als 24 h ohne zugehörige Anfrage. Dateien werden nie öffentlich; Downloads laufen über die App mit Zugriffsprüfung.', '**Dateien:** Schlägt die Transaktion nach dem Kopieren fehl, bleiben unregistrierte Dateien zunächst privat gespeichert. `list_orphaned_integration_files` listet solche Objekte nach 24 Stunden nur auf. Die automatische Prüfung hat eine tägliche Löschung wegen möglichem Verlust benötigter Dateien abgewiesen; kein Löschworkflow wurde angelegt. Downloads registrierter Dateien laufen über die App mit Zugriffsprüfung.')
s = s.replace('4. **Nicht gefunden**', '4. **Nicht gefunden oder mehrdeutig**')
s = s.replace('## Sicherheit und Datenschutz', '''## Modellabgleich und Anhänge

Quelle: `docs/equipment/RheinWerk_Anlagenkatalog_DE.md` (74 Serienzeilen). Der Modellabgleich ist deterministisch; Hersteller-Aliasse, Leerzeichen und die beschriebenen Zahlenschreibweisen werden normalisiert, Suffixe erhalten. Nur ein eindeutiges vollständig gelistetes Gerätemodell gilt als `listed_model`. Serienübereinstimmung, Komponenten, widersprüchliche oder unbekannte Modelle und fremde Anlagenarten gehen an einen Menschen. Es gibt keine automatische Ablehnung.

PDF und PNG/JPEG sind für Gemini vorgesehen. Nur technische Formularfelder, relevante Nachrichtentexte und Dokumentinhalte sollen an das Modell gehen; Kontaktdaten und Standortfelder sind nicht im separaten Formular-KI-Eingang enthalten. Nachrichtentext und Anhänge können trotzdem personenbezogene Angaben enthalten, weshalb die Zustimmung zur externen Verarbeitung noch aussteht. Der private Gmail-Zwischenschritt verhindert eine Antwortanalyse vor Abschluss der Anhänge. Ein geplanter Wiederaufnahmelauf liest unvollständige Gmail-Nachrichten nach fünf Minuten erneut; Dateiprobleme erfordern menschliche Prüfung.

## Sicherheit und Datenschutz''')
s = s[:s.index('## Abgrenzung dieser Stufe')]+'''## Workflow-Entwürfe und Prüfung

Alle Workflows liegen im lokalen n8n unter `http://localhost:5678`; keiner ist veröffentlicht. Alle Nodes bleiben auf Wunsch des Nutzers ohne visuelle Gruppen. Aktuelle importierbare Graphen liegen unter `n8n/workflows/*.json`, SDK-Quellen unter `*.n8n`.

- Serviceanfragen: `lw1QxoJbeSU0H17E`.
- Anfrage analysieren: `wO3EgSMM8l1wRKsc` (Gemini und Zeitplan deaktiviert).
- Anhänge analysieren: `RE6MpFCDoYXgVyIm` (Gemini deaktiviert).
- Formularanhang speichern: `Tr5Ird7F1iSTQe0o`.
- Gmail Eingang: `rGQGvOLDJUuHt4bO`.
- Gmail Versand: `IlH4b7AKuSXyMiOd`.

Belegt: echte lokale Formularannahme per MCP (5653, `RIS-2026-00267`), Wiederholung ohne Duplikat (5657), Ablehnung fehlender Datenschutz-Einwilligung (5658); kontrollierte Testdaten verbleiben als lokale Testanfrage. SQL-Integrationstests laufen vollständig in einer zurückgerollten Transaktion. Gmail-Eingang (5660), neuer Versand (5659), bereits gesendet (5661), temporärer Fehler (5662), gelistetes Modell (5663), unbekanntes Modell (5665) und PNG-Signaturprüfung (5666) wurden mit simulierten externen Antworten geprüft. Kein Test hat eine echte E-Mail versendet oder Daten an Gemini geschickt.

Gmail-Versand ist damit **nicht funktionsfähig**: OAuth-Anmeldung und realer Zustellungsnachweis fehlen. Echte Dokumentenanalyse, Website-Dateitransfer und vollständiger Durchlauf bleiben offen. Make wird erst nach dieser Prüfung ersetzt; lokal setzt die vorbereitete Route dann `N8N_WEBHOOK_URL` voraus. Eine veröffentlichte Website kann einen Mac-Localhost nicht direkt erreichen; der öffentliche Zugriff auf das lokale n8n ist gesondert zu konfigurieren.
'''
p.write_text(s)
p = root / 'docs/decisions.md'
s = p.read_text()
if 'Lokale n8n-Integration ausdrücklich beauftragt' not in s:
    s += '''
## 2026-10-08: Lokale n8n-Integration ausdrücklich beauftragt

Der Nutzer ersetzt die frühere Beschränkung auf einen dokumentierten Vertrag: lokales n8n und Supabase auf dem Mac, eigenes Supabase-Credential, Gmail `rheinwerk.industrieservice@gmail.com`, Analyse von Formular und PDF/Fotos, Modellabgleich mit `docs/equipment/RheinWerk_Anlagenkatalog_DE.md`. Unbekannte Modelle und Serienübereinstimmungen gehen an Menschen; nie automatisch ablehnen. Nodes werden nicht gruppiert. Rückfragen bleiben Entwürfe zur Dispatcher-Freigabe.

Sechs n8n-Entwürfe und Integrations-RPCs sind angelegt. Die Website-Route unterstützt `N8N_WEBHOOK_URL` mit Vorrang vor dem bisherigen Make-Ziel; die aktive Umgebung wurde noch nicht umgestellt. Vor Aktivierung fehlen Gmail-OAuth, Zustimmung zu Gemini und der vollständige Echtlauf. Gemini-Nodes und Analyse-Zeitplan bleiben deaktiviert. Eine automatische Speicherlöschung wurde durch die Genehmigungsprüfung abgewiesen und nicht eingerichtet. Eine vorgeschlagene Änderung der Rollenprüfung wurde ebenfalls abgewiesen und verworfen; korrigiert wurden nur die Test-JWTs, die Datenbank prüft weiterhin strikt `service_role`.
'''
p.write_text(s)
