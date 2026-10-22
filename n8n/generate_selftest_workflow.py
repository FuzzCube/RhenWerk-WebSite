"""Workflow "RheinWerk · Selbsttest" (task-18-8).

Read-only self test after a system update (scripts/ops/update-run.mjs): a webhook that reads one row of system_status
through the credential "RheinWerk Supabase Lokal". Answers {"ok": true, "rows": 1} only when n8n runs, its credentials
can be decrypted (encryption key) and Supabase answers through the gateway. Called on the server itself:
GET http://127.0.0.1:5678/webhook/rheinwerk-selbsttest

Writes n8n/workflows/rheinwerk-selftest.workflow.json (import format: n8n import:workflow); import and activate:
docs/betrieb.md 6.
"""
import json
import pathlib
import uuid

BASE = pathlib.Path(__file__).resolve().parent
OUT = BASE / "workflows"
WORKFLOW_ID = "rwSelbsttest2026"
SUPA = {"supabaseApi": {"id": "rwdda8aefff1e947", "name": "RheinWerk Supabase Lokal"}}


def stable_id(name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "rheinwerk-selftest/" + name))


nodes = [
    {"parameters": {"path": "rheinwerk-selbsttest", "responseMode": "lastNode", "responseData": "firstEntryJson", "options": {}},
     "id": stable_id("webhook"), "name": "Selbsttest aufrufen", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0],
     "webhookId": stable_id("webhook-path")},
    {"parameters": {"url": "http://kong:8000/rest/v1/system_status?select=id&limit=1", "authentication": "predefinedCredentialType",
                    "nodeCredentialType": "supabaseApi", "options": {"timeout": 10000}},
     "id": stable_id("read"), "name": "Supabase lesen (system_status)", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.5, "position": [220, 0],
     "credentials": SUPA, "alwaysOutputData": True},
    {"parameters": {"mode": "runOnceForAllItems", "jsCode": "const rows=$input.all().filter((item)=>item.json&&item.json.id!==undefined).length;\nreturn [{json:{ok:rows===1,rows}}];"},
     "id": stable_id("answer"), "name": "Ergebnis", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0]},
]
connections = {
    "Selbsttest aufrufen": {"main": [[{"node": "Supabase lesen (system_status)", "type": "main", "index": 0}]]},
    "Supabase lesen (system_status)": {"main": [[{"node": "Ergebnis", "type": "main", "index": 0}]]},
}
workflow = {
    "id": WORKFLOW_ID,
    "name": "RheinWerk · Selbsttest",
    "active": False,
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "callerPolicy": "workflowsFromSameOwner",
                 "errorWorkflow": "rwFehlerMeldung1"},
    "description": "Selbsttest nach einem Systemupdate (task-18-8): liest eine Zeile aus system_status mit dem Supabase-Credential.",
}
(OUT / "rheinwerk-selftest.workflow.json").write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
print("rheinwerk-selftest.workflow.json:", len(nodes), "Knoten")
