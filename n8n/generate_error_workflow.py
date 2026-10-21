"""Workflow "RheinWerk · Fehlermeldung" (task-17-8).

Error workflow of all RheinWerk workflows (settings.errorWorkflow, set by n8n/assign_error_workflow.mjs): every
failed execution becomes a warning in system_alerts via raise_alert (one open warning per workflow,
alert_key n8n:fehler:<workflow id>; repetitions only count). The e-mail to the admin is sent by the watchdog
(scripts/ops/watchdog.mjs, alerts_to_notify), not by n8n, so it also goes out when Gmail in n8n is broken; the
watchdog closes the warning after an hour without a new failed execution.

Writes n8n/workflows/rheinwerk-error-alerts.workflow.json (import format: n8n import:workflow).
"""
import json
import pathlib
import uuid

BASE = pathlib.Path(__file__).resolve().parent
OUT = BASE / "workflows"
WORKFLOW_ID = "rwFehlerMeldung1"
SUPA = {"supabaseApi": {"id": "rwdda8aefff1e947", "name": "RheinWerk Supabase Lokal"}}
RPC_URL = "http://host.docker.internal:54321/rest/v1/rpc/"
# Customers notice these at once (form, e-mails, phone); the others catch up on their next schedule
CRITICAL = ["lw1QxoJbeSU0H17E", "IlH4b7AKuSXyMiOd", "rwAgentTools2026"]


def stable_id(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "rheinwerk-error-alerts/" + name))


nodes = [
    {"parameters": {}, "id": stable_id("trigger"), "name": "Fehler in einem Workflow", "type": "n8n-nodes-base.errorTrigger", "typeVersion": 1, "position": [0, 0]},
    {"parameters": {"mode": "runOnceForAllItems", "jsCode": """const e=$input.first().json;const wf=e.workflow??{};const ex=e.execution??{};
const critical=%s;
const step=ex.lastNodeExecuted??e.trigger?.error?.node?.name??'unbekannt';
const message=String(ex.error?.message??e.trigger?.error?.message??'ohne Meldung').slice(0,1500);
return [{json:{source:'n8n',alert_key:'n8n:fehler:'+(wf.id??'unbekannt'),severity:critical.includes(wf.id)?'critical':'warning',
  title:'Automatisierung: „'+(wf.name??'Workflow')+'“ fehlgeschlagen',
  detail:'Schritt: '+step+'\\nFehler: '+message+(ex.url?'\\nAusführung: '+ex.url:'')+'\\nIn n8n unter Executions den roten Lauf öffnen; die Warnung schließt sich, wenn der Workflow eine Stunde ohne Fehler läuft.'}}];""" % json.dumps(CRITICAL)},
     "id": stable_id("message"), "name": "Warnung aufbauen", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0]},
    {"parameters": {"method": "POST", "url": RPC_URL + "raise_alert", "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
                    "sendBody": True, "specifyBody": "json", "jsonBody": "={{ $json }}", "options": {"timeout": 10000}},
     "id": stable_id("raise"), "name": "Warnung speichern (raise_alert)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.5, "position": [440, 0], "credentials": SUPA},
]
connections = {
    "Fehler in einem Workflow": {"main": [[{"node": "Warnung aufbauen", "type": "main", "index": 0}]]},
    "Warnung aufbauen": {"main": [[{"node": "Warnung speichern (raise_alert)", "type": "main", "index": 0}]]},
}
workflow = {
    "id": WORKFLOW_ID,
    "name": "RheinWerk · Fehlermeldung",
    "active": False,
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "callerPolicy": "workflowsFromSameOwner"},
    "description": "Error-Workflow aller RheinWerk-Workflows (task-17-8): fehlgeschlagene Läufe als Warnung in system_alerts; E-Mail verschickt der Wächter.",
}
(OUT / "rheinwerk-error-alerts.workflow.json").write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
print("rheinwerk-error-alerts.workflow.json:", len(nodes), "Knoten")
