import datetime
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
w = root / ".workshop"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
roadmap = json.loads((w / "roadmap.json").read_text())
task_id = "task-10-4"
tasks = [t for p in roadmap["phases"] for t in p["tasks"]]
if any(t["status"] == "in_progress" and t["id"] != task_id for t in tasks):
    raise RuntimeError("Another task is already active")
if not any(t["id"] == task_id for t in tasks):
    phase = next(p for p in roadmap["phases"] if p["id"] == "phase-10")
    phase["tasks"].append({"id": task_id, "title": "Lokale n8n-Integration für Serviceanfragen", "description": "Vom Nutzer am 08.10.2026 beauftragt: lokales n8n und Supabase auf dem Mac; Make ersetzen; Gmail rheinwerk.industrieservice@gmail.com; Formular und Anhänge analysieren; Hersteller/Modell gegen docs/equipment/RheinWerk_Anlagenkatalog_DE.md prüfen; unbekannte Modelle nur menschlich prüfen; Rückfragen als freizugebende Entwürfe; Kundenantworten mit der ursprünglichen Anfrage verbinden.", "order": 4, "weight": 8, "status": "in_progress", "dependsOn": ["task-9-1", "task-1-5"], "definitionOfDone": ["RPC-Integration mit Idempotenz, Versionsschutz und Audit geprüft", "Workflow über lokalen MCP erstellt und mit sicheren Daten getestet", "Formular speichert in Supabase und liefert den erwarteten Antwortvertrag", "PDF- und Bildanalyse sowie Katalogabgleich geprüft", "Gmail-Konto verifiziert; Antwortzuordnung und freigegebener Versand geprüft oder benötigte OAuth-Anmeldung ausdrücklich benannt", "Keine automatische Ablehnung, keine Verarbeitung oder Versand von Demo-Anfragen", "Zentraler Projektzustand und Integrationsvertrag aktualisiert"], "startedAt": now, "completedAt": None, "verification": {"status": "not_run", "summary": None, "commands": [], "checkedAt": None}})
    phase["weight"] += 8
    phase["status"] = "in_progress"
    roadmap["roadmapVersion"] += 1
    (w / "roadmap.json").write_text(json.dumps(roadmap, ensure_ascii=False, indent=2) + "\n")
    with (w / "activity.jsonl").open("a") as f:
        f.write(json.dumps({"timestamp": now, "type": "task_started", "taskId": task_id, "summary": "Nutzer autorisiert die lokale n8n/Gmail-Integration und ersetzt die frühere Beschränkung auf einen dokumentierten Vertrag. Eigenes Supabase-Credential beauftragt."}, ensure_ascii=False) + "\n")
    project = json.loads((w / "project.json").read_text())
    project["updatedAt"] = now
    (w / "project.json").write_text(json.dumps(project, ensure_ascii=False, indent=2) + "\n")
tasks = [t for p in roadmap["phases"] for t in p["tasks"]]
total = sum(t["weight"] for t in tasks if t["status"] not in ("cancelled", "superseded"))
done = sum(t["weight"] for t in tasks if t["status"] == "completed")
progress = {"schemaVersion": 1, "overall": round(done / total * 100, 2), "completedWeight": done, "totalWeight": total, "currentPhaseId": "phase-10", "currentTaskId": task_id, "completedTasks": sum(t["status"] == "completed" for t in tasks), "totalTasks": len(tasks), "blockedTasks": sum(t["status"] == "blocked" for t in tasks), "updatedAt": now}
(w / "progress.json").write_text(json.dumps(progress, indent=2) + "\n")
state = (w / "CURRENT_STATE.md").read_text().replace("## Aktive Aufgabe\n\nKeine.", "## Aktive Aufgabe\n\n`task-10-4`: lokale n8n/Gmail-Integration für Serviceanfragen (vom Nutzer ausdrücklich beauftragt).")
state = state.replace("Roadmap v2 mit 11 Phasen und 34 Tasks. Fortschritt 91,15 % (Gewicht 103 von 113, 31 von 34 Tasks).", "Roadmap v3 mit 11 Phasen und 35 Tasks. Fortschritt 85,12 % (Gewicht 103 von 121, 31 von 35 Tasks).")
state = state.replace("- Der Formularpfad zu Make bleibt unverändert; der künftige n8n-Vertrag wird nur dokumentiert.", "- Nutzerentscheidung 08.10.2026: Make durch lokales n8n ersetzen; Supabase ebenfalls lokal auf dem Mac. Gmail: rheinwerk.industrieservice@gmail.com. Unbekannte Modelle gehen an Menschen, keine automatische Ablehnung. Katalog: docs/equipment/RheinWerk_Anlagenkatalog_DE.md.")
(w / "CURRENT_STATE.md").write_text(state)
print(task_id + " in_progress")
