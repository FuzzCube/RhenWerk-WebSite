"""Record verified local integration state without changing other workshop tasks."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

contract = ROOT / 'docs/n8n-contract.md'
text = contract.read_text()
start = text.index('Dieser Vertrag beschreibt')
text = '# n8n-Vertrag (lokale Integration mit OpenAI)\n\n' + (
    '> **Stand 12.10.2026: OpenAI und Gmail sind mit echten Aufrufen geprüft.** '
    '`RheinWerk Supabase Lokal` und `RheinWerk Gmail` funktionieren; Absender und Empfangsfach sind '
    '`rheinwerk.industrieservice@gmail.com`. OpenAI nutzt `gpt-4.1-mini` über `OpenAI account 3`. '
    'Veröffentlicht sind Analyse, Dokumentenanalyse und Gmail-Eingang. Formular-Webhook, '
    'Dateikopie und Versand bleiben Entwürfe; der freigegebene Testversand wurde manuell gestartet. '
    'Die Website-Umgebung wurde nicht umgestellt: lokal sind weder `N8N_WEBHOOK_URL` noch '
    '`MAKE_WEBHOOK_URL` gesetzt. Für den echten Website-Dateitransfer fehlt `BLOB_READ_WRITE_TOKEN`.\n\n'
) + text[start:]
text = text.replace(
    'Nach der späteren Aktivierung übernimmt der Analyse-Worker die Anfrage asynchron. Die direkte Verbindung zum Worker ist bis zur Gemini-Zustimmung noch nicht eingerichtet.',
    'Die gespeicherte Anfrage wird über `Analyse asynchron starten` an den Analyse-Workflow übergeben. Der veröffentlichte Worker prüft außerdem alle zwei Minuten offene Anfragen und vollständig registrierte Kundenantworten.'
)
old = 'PDF und PNG/JPEG sind für Gemini vorgesehen.'
begin = text.index(old)
end = text.index('\n\n## Sicherheit und Datenschutz', begin)
text = text[:begin] + (
    'PDF und PNG/JPEG werden mit dem nativen OpenAI-Responses-Node ausgewertet '
    '(`gpt-4.1-mini`, striktes JSON-Schema, `store: false`). Die Projektentscheidung für OpenAI '
    'und die Verarbeitung technischer Texte, Korrespondenz und Dokumente wurden vom Nutzer '
    'am 12.10.2026 bestätigt. Supabase bleibt die einzige Projekt-Persistenz für die '
    'Gesprächshistorie; keine OpenAI-Konversation wird als Gedächtnis verwendet. Nur technische '
    'Formularfelder, relevante Nachrichtentexte und Dokumentinhalte gehen an das Modell; separate '
    'Kontakt- und Standortfelder sind nicht im KI-Eingang enthalten. Nachrichtentexte und Anhänge '
    'können dennoch personenbezogene Angaben enthalten. Bei Reparaturen genügt „kaputt“ oder '
    '„funktioniert nicht richtig“ nicht: mindestens ein konkretes beobachtbares Symptom oder '
    'ein Fehlercode ist nötig. Wartung und Inspektion benötigen keine Fehlerbeschreibung. '
    'Der private Gmail-Zwischenschritt verhindert die Antwortanalyse vor Abschluss der Anhänge. '
    'Unvollständige registrierte Gmail-Eingänge werden nach fünf Minuten erneut geladen; '
    'Dateiprobleme erfordern menschliche Prüfung.'
) + text[end:]
text = text.replace('- Demo-Daten (`is_demo`) werden nie versendet und nie analysiert.',
    '- Gesäte Dashboard-Demo-Daten (`is_demo = true`) werden nie versendet und nie analysiert. Die ausdrücklich autorisierten Integrationstests verwenden fiktive Kontakt-/Anlagendaten über den normalen Formularpfad (`is_demo = false`); Testempfänger ist die eigene Adresse des Nutzers.')
begin = text.index('## Workflow-Entwürfe und Prüfung')
text = text[:begin] + '''## Workflows und Prüfung

Alle Workflows liegen im lokalen n8n unter `http://localhost:5678`. Alle Nodes bleiben auf Wunsch des Nutzers ohne visuelle Gruppen. Aktuelle importierbare Graphen liegen unter `n8n/workflows/*.workflow.json`, SDK-Quellen unter `*.n8n`; die Exporte enthalten den tatsächlichen Aktivierungsstand.

- Serviceanfragen: `lw1QxoJbeSU0H17E`, Entwurf, 22 Nodes.
- Anfrage analysieren: `wO3EgSMM8l1wRKsc`, veröffentlicht, 18 Nodes, OpenAI und Zwei-Minuten-Worker aktiv.
- Anhänge analysieren: `RE6MpFCDoYXgVyIm`, veröffentlicht, 7 Nodes, OpenAI für PDF/Foto.
- Formularanhang speichern: `Tr5Ird7F1iSTQe0o`, Entwurf, 5 Nodes.
- Gmail Eingang: `rGQGvOLDJUuHt4bO`, veröffentlicht, 23 Nodes, minütlicher Eingang und Wiederaufnahme nach fünf Minuten.
- Gmail Versand: `IlH4b7AKuSXyMiOd`, Entwurf, 14 Nodes; freigegebener Test manuell gesendet.

Historische Prüfung vom 08.10.2026: echte lokale Formularannahme per MCP (5653, `RIS-2026-00267`), Wiederholung ohne Duplikat (5657), Ablehnung fehlender Einwilligung (5658). Gmail-/Katalog-/Dateizweige wurden damals mit simulierten Providerantworten geprüft. Diese damaligen Tests waren kein echter Versand und kein Modellaufruf.

Echte Prüfung vom 12.10.2026:

- Gmail/Supabase-Diagnose 6762 bestätigte das richtige Postfach und die lokale Datenbank.
- OpenAI-Textanalyse 6768; JSON-Adapter 6769 mit der zuvor tatsächlich gelieferten Antwort geprüft. Der native Responses-Node liefert den JSON-Schema-Inhalt als Objekt, nicht immer als String.
- 6770 und 6771: echte OpenAI-Aufrufe mit synthetischem PDF und Typenschild-PNG erkannten KAESER SM 13, Seriennummer und E42. Die Prüfungen verwenden die Fixtures unter `n8n/tests/fixtures/`; die Formular-Dateikopie selbst ist noch nicht echt geprüft.
- 6774/6775: eine zu ungenaue Reparaturbeschreibung wurde zunächst fälschlich als vollständig angesehen (`RIS-2026-00354`). Danach wurde die Symptomregel im Prompt verschärft. 6772 und der neue echte Formularlauf 6777/6778 bestätigten eine konkrete Rückfrage für „kaputt“ (`RIS-2026-00355`). Die frühere Testzeile bleibt als Nachweis dieser Regression erhalten.
- Der Entwurf wurde über einen echten Dispatcher-Demo-Login und `queue_message` regulär freigegeben. 6779 hat genau das autorisierte Testmail an `fuzz.cube.studio@gmail.com` gesendet; Gmail-ID `1a12f64a6abf0475`, Status `sent`, Anfrage `awaiting_customer`. Der Nutzer bestätigte den Empfang.
- Gmail-Trigger 6782 empfing die echte Antwort `1a12f680da8197ad`. Dabei wurden ein fehlender `payload`-Wrapper beim RPC und eine falsche Workflow-ID-Darstellung im Analyse-Scheduler entdeckt und behoben. 6789 spielte die bereits empfangene Nachricht erneut ein; es war keine simulierte Kundenantwort. Sie wurde der bestehenden Anfrage über Thread-ID zugeordnet.
- 6790/6791 analysierten die echte Antwort samt Supabase-Historie mit OpenAI: Druck nur 5 statt 8 bar, Abschaltung nach zehn Minuten, Zischen; Katalog `listed_model`/`RW-002`, Entscheidung `ready_for_planning`. `RIS-2026-00355` ist `processed`, Version 6, eingehende Nachricht behandelt; kein zweiter Anfrage-Datensatz und kein neuer Rückfrage-Entwurf.
- 6797 wiederholte denselben realen Eingang ohne Duplikat. Produktions-Scheduler 6787, 6794 und 6795 liefen nach der Korrektur erfolgreich. 6796 prüfte OpenAI live mit synthetischem SM 999 und gepinnten Datenbankknoten: die deterministische Regel setzte `human_review`/`series_match`.
- SQL-Smoke-Test mit ROLLBACK, `test:db` 532/532, `test:unit` 58/58, lint, typecheck und build bestanden. SDK-Validierung: Analyse, Dokumentenanalyse und Gmail-Eingang gültig.

Gmail-Versand ist für die freigegebene Testnachricht **echt nachgewiesen**. Der Versandzeitplan ist noch nicht veröffentlicht. Vollständige Umstellung einschließlich Website-Dateitransfer bleibt offen: `BLOB_READ_WRITE_TOKEN` fehlt, ebenso ein aktives Webhook-Ziel in der lokalen Website-Umgebung. Bei einem Abbruch vor der ersten RPC-Registrierung muss eine Gmail-Nachricht erneut eingelesen werden; die bisherige Wiederaufnahme deckt nur bereits registrierte unvollständige Eingänge ab. Ein Wiederholungsversand nach verlorener Providerbestätigung ist noch nicht mit echten Gmail-Antworten geprüft. Make wurde nicht deaktiviert, kein Push und kein Website-Deployment ausgeführt. Eine veröffentlichte Website kann einen Mac-Localhost nicht direkt erreichen; öffentlicher Maschinenzugriff auf n8n ist gesondert zu konfigurieren, der bestehende Cloudflare-Access-Schutz bleibt aktiv.
'''
contract.write_text(text)

testfile = ROOT / 'tests/unit/dictionary.test.mjs'
if not testfile.exists():
    matches = [p for p in (ROOT / 'tests/unit').glob('*.mjs') if 'Gmail-Versand ist damit' in p.read_text()]
    if len(matches) != 1:
        raise RuntimeError('Expected one existing contract test')
    testfile = matches[0]
test = testfile.read_text().replace('n8n-Vertrag deckt Abschnitt 8 ab und beschreibt Gmail nicht als funktionsfähig',
    'n8n-Vertrag deckt Abschnitt 8 ab und trennt echte Tests von offener Aktivierung')
test = test.replace('  assert.match(contract, /Gmail-Versand ist damit \\*\\*nicht funktionsfähig\\*\\*/);',
    '  assert.match(contract, /Gmail-Versand ist für die freigegebene Testnachricht \\*\\*echt nachgewiesen\\*\\*/);\n'
    '  assert.match(contract, /Der Versandzeitplan ist noch nicht veröffentlicht/);\n'
    '  assert.match(contract, /Website-Dateitransfer bleibt offen/);')
testfile.write_text(test)

workshop = ROOT / '.workshop'
roadmap_path = workshop / 'roadmap.json'
roadmap = json.loads(roadmap_path.read_text())
task = next(t for p in roadmap['phases'] for t in p['tasks'] if t['id'] == 'task-10-4')
assert task['status'] == 'blocked', 'Do not silently change the existing lifecycle'
task['verification'].update(status='partial', checkedAt=NOW, summary=(
    'OpenAI GPT-4.1 mini nach Nutzerentscheidung eingebunden (OpenAI account 3); Gemini entfernt. '
    'Drei Workflows veröffentlicht: Analyse, Dokumentenanalyse, Gmail-Eingang. Formularannahme '
    '6777/6778, gezielte Rückfrage RIS-2026-00355; freigegebener echter Versand 6779 und Empfang '
    'vom Nutzer bestätigt. Echte Antwort durch Gmail 6782 empfangen; RPC-Envelope und Scheduler-'
    'Workflow-ID korrigiert; reale Nachricht erneut eingelesen 6789. OpenAI-Reanalyse 6790/6791 '
    'mit Supabase-Historie: listed_model RW-002, ready_for_planning, processed v6, Antwort behandelt. '
    'Wiederholung 6797 ohne Duplikat; Produktions-Scheduler 6787/6794/6795 erfolgreich. Live-PDF '
    '6770 und PNG 6771 mit synthetischen Fixtures korrekt; unbekanntes Modell 6796 human_review '
    '(Datenbank gepinnt, OpenAI echt). Zu vage Reparaturbeschreibung in erstem Echtlauf 6775 '
    'falsch als vollständig behandelt; Prompt verschärft und in 6772 sowie 6778 korrekt geprüft. '
    'SQL-Integrationstest ROLLBACK, DB 532/532, Unit 58/58, lint/typecheck/build bestanden. '
    'Noch offen: Website-Dateitransfer (BLOB_READ_WRITE_TOKEN fehlt), Webhook-Ziel lokal '
    'nicht gesetzt, Haupt-/Upload-/Versandworkflow noch Entwürfe, echter Versand-Retry nach '
    'verlorener Bestätigung und Recovery vor erster Eingangsregistrierung. API/Auth/UI-Regression '
    'und DB-Reset diesmal nicht ausgeführt; keine Make-Deaktivierung, kein Push/Website-Deployment. '
    'task-10-3 bleibt unverändert in_progress und wartet auf Design-Abnahme.'
))
roadmap_path.write_text(json.dumps(roadmap, ensure_ascii=False, indent=2) + '\n')

project_path = workshop / 'project.json'
project = json.loads(project_path.read_text())
project['updatedAt'] = NOW
project_path.write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n')
progress_path = workshop / 'progress.json'
progress = json.loads(progress_path.read_text())
progress['updatedAt'] = NOW
progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n')

state_path = workshop / 'CURRENT_STATE.md'
state = state_path.read_text()
state = state.replace('`task-10-4`: Gmail-OAuth durch Lauf 6762 verifiziert; Gemini-Datenverarbeitung am 12.10.2026 erlaubt. Anbieterwahl Gemini/OpenAI vor Aktivierung klären.',
    '`task-10-4`: OpenAI gewählt und eingebunden. Reale Rückfrage und Kundenantwort RIS-2026-00355 geprüft; drei Analyse-/Eingangsworkflows veröffentlicht. Vollständige Website-Umschaltung wartet auf Blob-Konfiguration und letzte Aktivierungsprüfungen.')
begin = state.index('`task-10-4`:', state.index('## Blockiert'))
end = state.index('\n## Wichtige Entscheidungen', begin)
state = state[:begin] + '''`task-10-4`: OAuth und OpenAI-Verarbeitung sind nicht mehr blockiert. Reales Gmail-Senden, Empfang, historische Zuordnung und OpenAI-Reanalyse wurden bestätigt (RIS-2026-00355, processed v6). Noch offen: Website-Dateitransfer, da BLOB_READ_WRITE_TOKEN lokal fehlt; aktive Website-Webhook-Umgebung nicht gesetzt; Haupt-/Upload-/Versandworkflow noch Entwürfe. Kein Make-Szenario deaktiviert, kein Push oder Website-Deployment. Nutzer wurde um lokale Blob-Konfiguration oder Präferenz für direkten Supabase-Upload gebeten. Versand-Retry bei verlorener Bestätigung und Recovery vor erster Eingangsregistrierung bleiben noch zu prüfen/ergänzen.

12.10.2026: Nutzer entscheidet sich ausdrücklich für OpenAI im reinen Portfolio-Demoprojekt. GPT-4.1 mini über OpenAI account 3 läuft mit striktem JSON und store: false. PDF-/PNG-Extraktion real getestet. Supabase speichert Gesprächshistorie. Veröffentlichte Workflows: Analyse (alle zwei Minuten), Dokumentenanalyse und Gmail-Eingang; Nodes weiterhin ohne Gruppen. Freigegebener Testversand 6779 an fuzz.cube.studio@gmail.com zugestellt und vom Nutzer bestätigt. Antwort 6782 empfangen; RPC-Wrapper und Scheduler-ID korrigiert. Replay derselben realen Nachricht 6789, Analyse 6790/6791 mit konkreten Symptomen, catalog listed_model/RW-002, processed v6. Wiederholung 6797 ohne Duplikat. Produktions-Scheduler 6787, 6794 und 6795 erfolgreich.
''' + state[end:]
state = state.replace('Sechs ungruppierte Entwürfe; aktuelle JSON-Graphen unter n8n/workflows/*.workflow.json.',
    'Sechs ungruppierte Workflows, davon Analyse, Dokumentenanalyse und Gmail-Eingang veröffentlicht; aktuelle JSON-Graphen unter n8n/workflows/*.workflow.json.')
begin = state.index('## Prüfung der n8n-Integration')
state = state[:begin] + '''## Prüfung der n8n-Integration

Reale OpenAI-Textanalyse, PDF-/PNG-Fixtures, gezielte Rückfrage, Dispatcher-Freigabe, Gmail-Zustellung und echte Antwortanalyse belegt. RIS-2026-00355 bleibt dieselbe Anfrage; Antwort verarbeitet, keine zweite Rückfrage. Erstes vages Reparaturbeispiel wurde fälschlich als vollständig klassifiziert; Symptomregel anschließend verschärft und mit neuem Echtlauf korrekt verifiziert. SQL-Smoke-Test ROLLBACK; test:db 532/532, test:unit 58/58, lint/typecheck/build erfolgreich. API/Auth/UI-Regression und DB-Reset diesmal nicht ausgeführt. Dateiübertragung aus der Website, vollständige Aktivierung und Wiederholungsversand bei verlorenem Providerergebnis noch offen. Details: docs/n8n-contract.md. Kein Push oder Website-Deployment.

## Empfohlener nächster Schritt

Website-Dateispeicher konfigurieren und echten Formular-Dateitransfer prüfen; fehlende Eingangs-Recovery und Versand-Retry prüfen, dann Haupt-/Upload-/Versandworkflow aktivieren und lokales N8N_WEBHOOK_URL setzen. task-10-3 wartet weiterhin auf Design-Abnahme; keine andere Aufgabe automatisch starten.
'''
state_path.write_text(state)

constraints_path = workshop / 'specialization/CONSTRAINTS.md'
constraints = constraints_path.read_text().replace(
    'Reale Verarbeitung bleibt bis OAuth-Verifikation und nötiger Zustimmung zur externen KI blockiert; Versand nur für freigegebene Live-Nachrichten. Aktuell kein Versand, keine veröffentlichten Workflows.',
    'OAuth und die ausdrücklich gewählte OpenAI-Verarbeitung sind verifiziert; Versand nur für freigegebene Nachrichten. Ein autorisiertes Testmail wurde real zugestellt und die echte Antwort derselben Anfrage zugeordnet und analysiert. Analyse, Dokumentenanalyse und Gmail-Eingang sind veröffentlicht; vollständige Website-Umschaltung noch offen.'
)
constraints_path.write_text(constraints)

decision = '''
## 2026-10-12: OpenAI und echte Portfolio-Integration

Nutzerentscheidung: OpenAI statt Gemini; ausschließlich Portfolio, keine realen Kunden. Technische Texte, Korrespondenz und PDF/Fotos werden mit GPT-4.1 mini über `OpenAI account 3` verarbeitet. Native Responses-Nodes mit strengem JSON-Schema und `store: false`; Gesprächspersistenz ausschließlich in Supabase. Separate Kontakt-/Standortfelder sind nicht Teil des KI-Eingangs, können jedoch in Nachrichtentexten und Dokumenten vorkommen.

Für Reparaturen ist mindestens ein konkretes beobachtbares Symptom oder ein Fehlercode notwendig; „kaputt“ löst eine gezielte Rückfrage aus. Bei Wartung/Inspektion keine Fehlerbeschreibung verlangen. Unbekannte/mehrdeutige Modelle bleiben menschliche Prüfung. Der Testempfänger `fuzz.cube.studio@gmail.com` wurde ausdrücklich freigegeben; Versandfreigabe erfolgte per echtem Demo-Dispatcher-Login und normalem `queue_message`, ohne Rollenlockerung. Echte Antwort und Supabase-Historie führten RIS-2026-00355 zu processed v6. Seed-Demo-Daten bleiben ausgeschlossen; fiktive Integrationsanfragen werden über den normalen Formularweg gespeichert.

Drei Workflows sind veröffentlicht (Analyse, Dokumentenanalyse, Gmail-Eingang); Haupt-/Upload-/Versandworkflow bleiben Entwürfe. Lokal fehlen Blob-Token und aktives Webhook-Ziel. Vor vollständiger Umstellung sind Website-Dateitransfer, Empfangs-Recovery vor erster RPC-Registrierung und Versand-Retry nach verlorenem Providerergebnis zu prüfen. Kein Make-Abschalten, Push oder Website-Deployment.
'''
with (ROOT / 'docs/decisions.md').open('a') as file:
    file.write(decision)
with (workshop / 'activity.jsonl').open('a') as file:
    file.write(json.dumps({'timestamp': NOW, 'type': 'verification_passed', 'taskId': 'task-10-4',
        'summary': task['verification']['summary']}, ensure_ascii=False) + '\n')
print(json.dumps({'recordedAt': NOW, 'taskStatus': task['status'], 'contractTest': str(testfile.relative_to(ROOT))}))
