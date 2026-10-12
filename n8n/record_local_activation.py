"""Record completed local runtime verification; preserve unrelated workshop work."""
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOW = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
summary = (
    'Lokale Integration abgeschlossen: sechs veröffentlichte ungruppierte MCP-Workflows; '
    'N8N_WEBHOOK_URL lokal gesetzt. OpenAI GPT-4.1 mini, echte Gmail-Rückfrage 6779 und '
    'Kundenantwortanalyse 6790/6791 (RIS-2026-00355) bestätigt. Blob-Token lokal vorhanden; '
    'PDF/PNG über den tatsächlichen /api/upload-Clientpfad in privaten Vercel Blob geladen. '
    'Formular-API → produktiver n8n-Webhooks → Dateikopie 6813/6814 → privater Supabase Storage '
    '→ OpenAI-Analyse 6815: RIS-2026-00356 processed, KAESER SM 13/RW-002 aus Dokumenten '
    'extrahiert, Formularmodell leer. Fehler 6810 (URL-Konstruktor im Code-Sandbox nicht '
    'vorhanden) durch enge private Blob-URL-Prüfung behoben. Wiederholungen liefern HTTP 201 '
    'und dieselbe Anfrage; genau ein Datensatz, ein Eingangsereignis, ein Analyselauf und '
    'zwei private Dateien. Direkte Analyse bei Duplikaten ausgeschlossen (6833/6834). '
    'Gmail ersetzt benutzerdefinierte Message-ID: Versandwiederaufnahme jetzt über '
    'X-RheinWerk-Message-Id und tatsächliche Provider-MIME-ID. 6825 findet das echte bereits '
    'gesendete Mail ohne erneuten Send-Aufruf (Queue/Bestätigung für diesen Replay gepinnt); '
    '6839 prüft den Annahme→Metadaten-Zweig mit gepinntem Send-Ergebnis und echtem Gmail-Get. '
    '6828 liest echte RIS-Antwort erneut, duplicate=true; 15-Minuten-Recovery für letzte '
    'sieben Tage ergänzt. Send-Scheduler 6837 erfolgreich, genehmigte Queue leer. '
    'Node-/SDK-Validierung bestanden, lint/build/typecheck bestanden; DB 532/532 und '
    'Unit 58/58 aus der unmittelbar vorherigen Integrationsprüfung, Unit nach Doku-Sync '
    'erneut zu prüfen. Keine neue SQL-Migration in diesem Schritt. Kein DB-Reset und keine '
    'neue API/Auth/UI-Regression; keine Browser-Sichtprüfung der Formular-UI. Alle Tests '
    'synthetisch, keine realen Kunden. Öffentliche Website/Turnstile/Cloudflare-Maschinenzugriff '
    'nicht umgestellt; keine Make-Konto-Deaktivierung, kein Push/Website-Deployment.'
)

contract_path = ROOT / 'docs/n8n-contract.md'
contract = contract_path.read_text()
begin = contract.index('> **Stand 12.10.2026:')
end = contract.index('\n\nDieser Vertrag beschreibt', begin)
contract = contract[:begin] + (
    '> **Stand 12.10.2026: lokale Integration aktiviert und real geprüft.** Alle sechs '
    'Workflows sind veröffentlicht. Gmail `rheinwerk.industrieservice@gmail.com`, '
    'OpenAI `gpt-4.1-mini` (`OpenAI account 3`) und lokale Supabase funktionieren. '
    'Die lokale Website nutzt `N8N_WEBHOOK_URL=http://127.0.0.1:5678/webhook/rheinwerk-service-request`; '
    'Blob-Token ist lokal konfiguriert. PDF/Foto wurden über API-Upload, privaten Blob, '
    'n8n-Dateikopie und echten OpenAI-Aufruf geprüft. Die öffentliche Website wurde nicht '
    'umgestellt, das externe Make-Konto nicht verändert.'
) + contract[end:]
contract = contract.replace('Die gespeicherte Anfrage wird über `Analyse asynchron starten` an den Analyse-Workflow übergeben.',
    'Eine neue gespeicherte Anfrage wird über `Analyse asynchron starten` an den Analyse-Workflow übergeben. Wiederholte Formulare geben dieselbe Anfrage zurück und starten keine neue direkte Analyse.')
contract = contract.replace('Unvollständige registrierte Gmail-Eingänge werden nach fünf Minuten erneut geladen;',
    'Unvollständige registrierte Gmail-Eingänge werden nach fünf Minuten erneut geladen. Zusätzlich werden alle 15 Minuten die neuesten bis zu 100 RIS-Antworten im Posteingang der letzten sieben Tage idempotent erneut eingelesen, auch wenn die erste RPC-Registrierung zuvor ausfiel;')
contract = contract.replace('- Serviceanfragen: `lw1QxoJbeSU0H17E`, Entwurf, 22 Nodes.',
    '- Serviceanfragen: `lw1QxoJbeSU0H17E`, veröffentlicht, 23 Nodes.')
contract = contract.replace('- Formularanhang speichern: `Tr5Ird7F1iSTQe0o`, Entwurf, 5 Nodes.',
    '- Formularanhang speichern: `Tr5Ird7F1iSTQe0o`, veröffentlicht, 5 Nodes.')
contract = contract.replace('- Gmail Eingang: `rGQGvOLDJUuHt4bO`, veröffentlicht, 23 Nodes, minütlicher Eingang und Wiederaufnahme nach fünf Minuten.',
    '- Gmail Eingang: `rGQGvOLDJUuHt4bO`, veröffentlicht, 27 Nodes, minütlicher Eingang, Wiederaufnahme nach fünf Minuten und RIS-Nachlesen alle 15 Minuten.')
contract = contract.replace('- Gmail Versand: `IlH4b7AKuSXyMiOd`, Entwurf, 14 Nodes; freigegebener Test manuell gesendet.',
    '- Gmail Versand: `IlH4b7AKuSXyMiOd`, veröffentlicht, 19 Nodes; freigegebene Nachrichten jede Minute, Wiederaufnahme über interne Header-ID.')
begin = contract.index('Gmail-Versand ist für die freigegebene Testnachricht')
contract = contract[:begin] + '''Gmail-Versand ist für die freigegebene Testnachricht **echt nachgewiesen**. Der Versandzeitplan ist veröffentlicht. Alle sechs Workflows sind veröffentlicht; die Exporte enthalten den tatsächlichen Aktivierungsstand. Die lokale Website nutzt den n8n-Webhooks, nicht den Make-Fallback.

Weitere echte Prüfung: privater PDF-/PNG-Upload mit dem unveränderten Client-SDK über `/api/upload` (HTTP 200), API-Formularübermittlung mit leeren Hersteller-/Modellfeldern (HTTP 201), Kopie beider Dateien (6813/6814), OpenAI-Dokumenten-/Anfrageanalyse 6815 und persistierte Modellfelder. RIS-2026-00356 ist processed; KAESER SM 13, Seriennummer DEMO-SM13-001, Katalog RW-002. Nach wiederholten Übermittlungen genau eine Anfrage, ein submission_received-Ereignis, ein Analyselauf und zwei Dateien/Anhänge. Ein Sandbox-Fehler bei `new URL` im Hauptworkflow wurde durch eine enge HTTPS-Private-Blob-Hostprüfung behoben; Weiterleitungen bleiben verboten. Eine neue Gate-Node verhindert direkte Neu-Analyse bei Formularduplikaten (6833/6834).

Gmail hat die originale MIME-Message-ID beim echten Versand ersetzt; `X-RheinWerk-Message-Id` blieb erhalten. Vor erneutem Senden werden bis zu 100 gesendete Nachrichten desselben Empfängers geladen und die exakte interne ID abgeglichen. Bei weiteren Seiten, mehrdeutigem Treffer oder Lesefehler wird nicht automatisch erneut gesendet. 6825 bestätigte dieses Verhalten gegen den echten Postausgang; Queue und DB-Bestätigung waren für den Replay gepinnt, der Send-Node wurde nicht erreicht. Nach Provider-Annahme wird die tatsächliche MIME-ID erneut gelesen und gespeichert. Dieser Zweig wurde mit gepinntem Send-Ergebnis und echtem Metadaten-Get in 6839 geprüft; keine zweite Test-E-Mail wurde versendet. Der veröffentlichte Versand-Scheduler 6837 lief erfolgreich, die genehmigte Warteschlange war leer.

Die neue 15-Minuten-RIS-Wiederaufnahme wurde in 6828 mit echten Gmail-Daten geprüft: die schon verarbeitete Antwort wurde korrekt als duplicate erkannt. Sie erfasst die letzten sieben Tage bis zu 100 Nachrichten; längere Ausfälle oder mehr Nachrichten benötigen eine gezielte Nachbearbeitung. Der eigentliche Erstversand ist real nachgewiesen; ein absichtlich herbeigeführter Bestätigungsverlust nach einem weiteren echten Versand wurde nicht getestet.

lint, build und typecheck bestanden. SQL-Smoke-Test mit ROLLBACK und test:db 532/532 wurden unmittelbar zuvor gegen dieselbe Datenbank geprüft; in diesem Schritt gab es keine SQL-Änderung. Unit-Checks werden nach dem Dokumentationsabgleich erneut ausgeführt. DB-Reset und API/Auth/UI-Regression wurden in diesem Schritt nicht wiederholt; keine Browser-Sichtprüfung der Upload-Oberfläche. Die öffentliche Website wurde nicht umgestellt: produktiver Turnstile-Schlüssel und geschützter Maschinenzugriff über Cloudflare sind gesonderte Deployment-Konfiguration. Kein Make-Szenario im externen Konto deaktiviert, kein Push und kein Website-Deployment.
'''
contract_path.write_text(contract)

testpath = ROOT / 'tests/unit/kpi-dictionary.test.mjs'
test = testpath.read_text().replace(
    '  assert.match(contract, /Der Versandzeitplan ist noch nicht veröffentlicht/);\n  assert.match(contract, /Website-Dateitransfer bleibt offen/);',
    '  assert.match(contract, /Der Versandzeitplan ist veröffentlicht/);\n  assert.match(contract, /Alle sechs Workflows sind veröffentlicht/);\n  assert.match(contract, /Die öffentliche Website wurde nicht umgestellt/);'
)
testpath.write_text(test)

ws = ROOT / '.workshop'
roadmap_path = ws / 'roadmap.json'
roadmap = json.loads(roadmap_path.read_text())
task = next(t for p in roadmap['phases'] for t in p['tasks'] if t['id'] == 'task-10-4')
assert task['status'] == 'blocked'
# Documented lifecycle correction: implementation had already started before the OAuth block.
# Runtime work was explicitly resumed by the user; no second in_progress task is introduced.
task.update(status='completed', completedAt=NOW)
task['verification'].update(status='passed', checkedAt=NOW, summary=summary)
roadmap_path.write_text(json.dumps(roadmap, ensure_ascii=False, indent=2) + '\n')
tasks = [t for p in roadmap['phases'] for t in p['tasks'] if t['status'] not in ('cancelled', 'superseded')]
completed = [t for t in tasks if t['status'] == 'completed']
progress_path = ws / 'progress.json'
progress = json.loads(progress_path.read_text())
progress.update(completedWeight=sum(t['weight'] for t in completed), totalWeight=sum(t['weight'] for t in tasks),
    completedTasks=len(completed), totalTasks=len(tasks), blockedTasks=sum(t['status'] == 'blocked' for t in tasks), updatedAt=NOW)
progress['overall'] = round(100 * progress['completedWeight'] / progress['totalWeight'], 2)
progress_path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
project_path = ws / 'project.json'
project = json.loads(project_path.read_text())
project['updatedAt'] = NOW
project['description'] = project['description'].replace('n8n und Gmail werden in einer späteren Stufe angebunden.',
    'Lokales n8n, OpenAI und Gmail sind für Formularverarbeitung und Rückfragen angebunden.')
project_path.write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n')

state_path = ws / 'CURRENT_STATE.md'
state = state_path.read_text().replace('Fortschritt 85,12 % (Gewicht 103 von 121, 31 von 35 Tasks).',
    f'Fortschritt {str(progress["overall"]).replace(".", ",")} % (Gewicht {progress["completedWeight"]} von {progress["totalWeight"]}, {progress["completedTasks"]} von {progress["totalTasks"]} Tasks).')
state = state.replace('`task-10-4`: OpenAI gewählt und eingebunden. Reale Rückfrage und Kundenantwort RIS-2026-00355 geprüft; drei Analyse-/Eingangsworkflows veröffentlicht. Vollständige Website-Umschaltung wartet auf Blob-Konfiguration und letzte Aktivierungsprüfungen.',
    '`task-10-4` ist lokal abgeschlossen: sechs veröffentlichte n8n-Workflows, lokaler Formularpfad zu n8n, echte Blob→Supabase→OpenAI-Dateiverarbeitung und Gmail-Antwortgedächtnis geprüft. Öffentliche Website nicht umgestellt.')
state = state.replace('## Zuletzt abgeschlossen\n\n',
    '## Zuletzt abgeschlossen\n\n`task-10-4`: lokale n8n/OpenAI/Gmail-Integration. Vollständiger API-Formularpfad mit privatem PDF und PNG: RIS-2026-00356 processed, KAESER SM 13 aus Dokumenten, keine Duplikate. Versandwiederaufnahme und verpasste RIS-Eingänge geprüft. Kein Push/Website-Deployment.\n\n')
begin = state.index('## Blockiert')
end = state.index('## Wichtige Entscheidungen', begin)
state = state[:begin] + '''## Blockiert

Keine blockierte Roadmap-Aufgabe. task-10-3 bleibt unverändert in_progress und wartet auf Design-Abnahme. Lokale Integration task-10-4 nach den tatsächlich geprüften Definition-of-Done-Punkten abgeschlossen; die frühere Blockierung ist behoben. Dokumentierte Lifecycle-Korrektur blocked → completed für die bereits begonnene und ausdrücklich wiederaufgenommene Arbeit; keine zweite Aufgabe in_progress eingeführt.

12.10.2026: Alle sechs Workflows veröffentlicht, Nodes ohne Gruppen. Lokales N8N_WEBHOOK_URL gesetzt. Echte E-Mail-Rückfrage und Antwortgedächtnis RIS-2026-00355 geprüft. Private Uploads über tatsächlichen API-/Clientpfad und OpenAI-Dateiauswertung RIS-2026-00356 geprüft. Send-Recovery nutzt den von Gmail erhaltenen internen Header; faktische MIME-ID wird nachgelesen. Inbox-Nachlesen für RIS-Antworten letzte sieben Tage alle 15 Minuten; vollständige registrierte Eingänge zusätzlich alle fünf Minuten. Details und Grenzen in docs/n8n-contract.md.

''' + state[end:]
state = state.replace('Sechs ungruppierte Workflows, davon Analyse, Dokumentenanalyse und Gmail-Eingang veröffentlicht;',
    'Sechs ungruppierte veröffentlichte Workflows;')
begin = state.index('## Prüfung der n8n-Integration')
state = state[:begin] + '''## Prüfung der n8n-Integration

Echte OpenAI-Textanalyse, Gmail-Rückfrage und Kundenantwort mit historischer Zuordnung; privates PDF und PNG aus dem API-Formularpfad vollständig in Supabase kopiert und ausgewertet. RIS-2026-00356 processed, Modell aus Dokumenten erkannt, zwei private Dateien; Wiederholung ohne zusätzliche Anfrage, Ereignisse oder Analyse. Tatsächliches bereits gesendetes Gmail-Mail per internem Header wiedergefunden ohne erneut zu senden; neue Provider-Metadaten-Strecke mit gepinntem Send-Ergebnis und echtem Get geprüft. Produktions-Send-/Analyse-Scheduler erfolgreich. Node-/SDK-Validierung, lint, build und typecheck bestanden. DB 532/532 und SQL-Smoke-Test ROLLBACK unmittelbar davor; keine neue SQL-Änderung. Unit-Doku-Abgleich wird abschließend erneut geprüft. DB-Reset und API/Auth/UI-Regression nicht wiederholt; keine Sichtprüfung der Formular-Oberfläche im Browser. Kein Push/Website-Deployment.

## Empfohlener nächster Schritt

Design task-10-3 abnehmen; danach task-9-2 Gesamtprüfung. task-10-2 Zahlungserinnerungen bleibt ready. Für eine spätere öffentliche Demonstration die Website mit produktivem Turnstile und geschütztem Zugriff auf das lokale n8n konfigurieren; nicht automatisch deployen.
'''
state_path.write_text(state)
constraints_path = ws / 'specialization/CONSTRAINTS.md'
constraints = constraints_path.read_text().replace(
    'Analyse, Dokumentenanalyse und Gmail-Eingang sind veröffentlicht; vollständige Website-Umschaltung noch offen.',
    'Alle sechs Workflows sind veröffentlicht. Lokaler Formularpfad einschließlich privater Vercel-Blob-Dateien wurde real geprüft und nutzt n8n; öffentliche Website-Umschaltung ist gesonderte Deployment-Konfiguration.')
constraints_path.write_text(constraints)
with (ROOT / 'docs/decisions.md').open('a') as file:
    file.write('\n## 2026-10-12: Lokale Aktivierung nach vollständigem Dateitest\n\n' + summary + '\n')
with (ws / 'activity.jsonl').open('a') as file:
    for kind, note in [
        ('roadmap_updated', 'Dokumentierte Lifecycle-Korrektur task-10-4 blocked → completed: bereits begonnene Integration vom Nutzer ausdrücklich wiederaufgenommen, OAuth/Blob-Blockaden beseitigt und Definition of Done real geprüft. task-10-3 bleibt unverändert in_progress; keine zweite aktive Aufgabe oder künstlicher Fortschritt.'),
        ('verification_passed', summary),
        ('task_completed', 'task-10-4 lokal abgeschlossen; Exporte und zentraler Zustand synchronisiert. Öffentliche Website nicht umgestellt, kein Push.')
    ]:
        file.write(json.dumps({'timestamp': NOW, 'type': kind, 'taskId': 'task-10-4', 'summary': note}, ensure_ascii=False) + '\n')
print(json.dumps({'localTaskStatus': task['status'], 'overall': progress['overall'], 'checkedAt': NOW}))
