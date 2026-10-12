import datetime
import json
from pathlib import Path

root = Path(__file__).resolve().parent.parent
w = root / '.workshop'
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
roadmap = json.loads((w / 'roadmap.json').read_text())
phase = next(p for p in roadmap['phases'] if p['id'] == 'phase-10')
task = next(t for t in phase['tasks'] if t['id'] == 'task-10-4')
task['status'] = 'blocked'
task['verification'] = {
    'status': 'partial',
    'summary': 'Sechs lokale n8n-Entwürfe per MCP, ohne Gruppen; eigene Supabase- und Gmail-Credentials. RPCs mit Idempotenz, Versionsschutz, Audit, Freigabe und Eingangs-Stage vorhanden. Echte Formularannahme 5653 (RIS-2026-00267), Wiederholung 5657 mit genau einer Anfrage/einem Ereignis, ungültige Einwilligung 5658. SQL-Smoke-Test mit ROLLBACK: Analyse, unbekanntes Modell, Freigabe, bestätigter Status, Thread-/Sender-Abgrenzung, Anhänge, Versions-/JWT-Schutz und Wiederaufnahme. test:db 521/521; test:unit 40/40; lint, typecheck und build erfolgreich. MCP-Tests mit simulierten externen Antworten: Gmail Eingang 5660, Versand 5659, bereits gesendet 5661, Backoff 5662, Katalog gelistet 5663/Serie unbekannt 5665, PNG-Dateisignatur 5666, Wiederaufnahme 5669. Kein echtes Senden und keine Gemini-Datenübertragung. Blockiert: Anmeldung RheinWerk Gmail (5670: kein Access-Token) und ausdrückliche Zustimmung zu Google Gemini. Genehmigungsprüfung hat die externe Analyseverbindung sowie automatische Speicherlöschung abgewiesen; Gemini/Analyse-Zeitplan deaktiviert, keine Löschroutine. Rollenprüfungsänderung verworfen, nur Test-JWTs korrigiert. Formularroute für N8N_WEBHOOK_URL vorbereitet; aktive Umgebung/Make unverändert. Echte PDF-/Bildanalyse, Dateiübertragung aus der Website, OAuth-/Zustellnachweis, kompletter Echtlauf, API/Auth/UI-Regression und DB-Neuanwendung mit Reset noch nicht ausgeführt. Keine Veröffentlichung, kein Push.',
    'commands': ['npm run lint', 'npm run typecheck', 'npm run build', 'npm run test:unit', 'npm run test:db', 'supabase migration up --local', 'supabase gen types typescript --local', 'docker exec -i supabase_db_A.Sadkovojs_Project psql -U postgres -v ON_ERROR_STOP=1 < n8n/test_integration.sql', 'n8n MCP validate_node_config / validate_workflow / test_workflow / execute_workflow / get_workflow_execution'],
    'checkedAt': now,
}
phase['status'] = 'blocked'
(w / 'roadmap.json').write_text(json.dumps(roadmap, ensure_ascii=False, indent=2) + '\n')
tasks = [t for p in roadmap['phases'] for t in p['tasks'] if t['status'] not in ('cancelled', 'superseded')]
total = sum(t['weight'] for t in tasks)
done = sum(t['weight'] for t in tasks if t['status'] == 'completed')
progress = {'schemaVersion': 1, 'overall': round(done / total * 100, 2), 'completedWeight': done, 'totalWeight': total, 'currentPhaseId': 'phase-10', 'currentTaskId': task['id'], 'completedTasks': sum(t['status'] == 'completed' for t in tasks), 'totalTasks': len(tasks), 'blockedTasks': sum(t['status'] == 'blocked' for t in tasks), 'updatedAt': now}
(w / 'progress.json').write_text(json.dumps(progress, indent=2) + '\n')
project = json.loads((w / 'project.json').read_text())
project['updatedAt'] = now
(w / 'project.json').write_text(json.dumps(project, ensure_ascii=False, indent=2) + '\n')
state = (w / 'CURRENT_STATE.md').read_text()
state = state.replace('`task-10-4`: lokale n8n/Gmail-Integration für Serviceanfragen (vom Nutzer ausdrücklich beauftragt).', '`task-10-4` ist blockiert bis zur Gmail-OAuth-Anmeldung und Zustimmung zur externen Gemini-Analyse. Keine andere Aufgabe begonnen.')
state = state.replace('## Blockiert\n\nNichts.', '## Blockiert\n\n`task-10-4`: Credential „RheinWerk Gmail“ benötigt Anmeldung als rheinwerk.industrieservice@gmail.com; Diagnoselauf 5670 meldet fehlenden Access-Token. Die automatische Genehmigungsprüfung verlangt Zustimmung, bevor technische Antragstexte, E-Mail-Texte und PDF/Fotos an Google Gemini gehen. Gemini-Nodes und Analyse-Zeitplan deaktiviert; keine Analyseverbindung vom Formular, keine Aktivierung. Make bleibt bis zur vollständigen Prüfung aktiv.')
state = state.replace('- n8n-Vertrag: n8n schreibt nur über RPC-Funktionen mit Idempotenzschlüsseln (`source_event_key`, `operation_key`, `(mailbox_key, gmail_message_id)`, `messages.id`) und `expected_version`; vorhanden ist nur `confirm_message_sent`, die übrigen Integrationsfunktionen sind als „zu bauen“ markiert. Team-Kennzahlen zählen nach aktueller Zuweisung.', '- n8n-Vertrag: lokale Integrations-RPCs mit Idempotenz, `expected_version`, Audit und Versandfreigabe sind vorhanden. Sechs ungruppierte Entwürfe; aktuelle JSON-Graphen unter n8n/workflows/*.workflow.json. Unbekannte/mehrdeutige Modelle gehen an Menschen, nie automatisch ablehnen. Anhänge privat, Antwortanalyse erst nach abgeschlossener Registrierung. Unfertige Gmail-Eingänge werden erneut aufgenommen. Keine automatische Speicherlöschung (Genehmigungsprüfung abgewiesen); Rollenprüfung weiterhin strikt service_role. Test-JWTs für service_role korrigiert. Team-Kennzahlen zählen nach aktueller Zuweisung.')
marker = '## Empfohlener nächster Schritt'
state = state[:state.index(marker)] + '''## Prüfung der n8n-Integration

Echte lokale Webhook-Annahme RIS-2026-00267, genau eine Anfrage/ein Ereignis bei Wiederholung; ungültige Einwilligung abgewiesen. SQL-Integrationstests zurückgerollt; test:db 521/521, test:unit 40/40, lint/typecheck/build erfolgreich. Gmail- und Modellzweige sowie PNG-Dateisignatur und Wiederaufnahme mit simulierten externen Antworten geprüft. Kein echtes Gmail-Senden und keine Gemini-Abfrage. Vollständiger Echtlauf, Website-Dateitransfer, PDF-/Bildanalyse und OAuth-Zustellung offen. DB-Reset sowie API/Auth/UI-Regression nicht ausgeführt. Kein Push oder Deployment.

## Empfohlener nächster Schritt

Ausstehende Nutzereingaben zu Gmail und Gemini abwarten; anschließend task-10-4 wieder aufnehmen, Konto verifizieren, reale Analyse und freigegebenen Versand prüfen und erst dann Make ersetzen. task-10-2 und task-10-3 sind weiterhin ready; nicht automatisch starten.
'''
(w / 'CURRENT_STATE.md').write_text(state)
with (w / 'activity.jsonl').open('a') as f:
    f.write(json.dumps({'timestamp': now, 'type': 'task_blocked', 'taskId': task['id'], 'summary': 'Lokale n8n-Entwürfe und RPCs erstellt und teilweise geprüft; wartet auf RheinWerk-Gmail-OAuth und Zustimmung zur externen Gemini-Verarbeitung. Keine automatische Speicherlöschung, keine Rollenlockerung, kein echter Versand/Modellaufruf und keine Make-Umschaltung.'}, ensure_ascii=False) + '\n')
p = w / 'specialization/CONSTRAINTS.md'
s = p.read_text().replace('- Der Formularpfad `/api/service-request` → Make bleibt unverändert. Keine direkte Speicherung des Formulars in Supabase in dieser Stufe.', '- Nutzerauftrag vom 08.10.2026 (task-10-4): Make durch lokales n8n ersetzen; Supabase auf dem Mac. Route unterstützt N8N_WEBHOOK_URL, aktives Make bleibt bis zum vollständigen Integrationstest bestehen. Schreiben nur über kontrollierte RPCs.').replace('- Kein echter E-Mail-Versand; n8n und Gmail werden nicht angebunden.', '- Nutzerauftrag task-10-4 erlaubt Gmail-Anbindung an rheinwerk.industrieservice@gmail.com. Reale Verarbeitung bleibt bis OAuth-Verifikation und nötiger Zustimmung zur externen KI blockiert; Versand nur für freigegebene Live-Nachrichten. Aktuell kein Versand, keine veröffentlichten Workflows.')
p.write_text(s)
print(json.dumps({'task': task['status'], 'verification': task['verification']['status'], 'progress': progress['overall']}))
