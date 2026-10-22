"""Workflows of the website assistant (task-18-10), moved from the Oracle server ("RheinWerk Local Assistant" and
"RheinWerk Documents Import") into the n8n of RheinWerk.

"RheinWerk · Assistent": webhook POST /webhook/rheinwerk-assistant {question, session_id} → AI agent with the system
prompt n8n/assistant_prompt.md (unchanged from Oracle), memory per session_id (on Oracle one fixed key for every
visitor), tool "knowledge base" = Supabase Vector Store on rag_documents → {answer}. Called only by the website route
/api/assistant (Cloudflare Access service token on the server).

"RheinWerk · Dokumente importieren": manual start (ops/vps/rag-import.sh): deletes all rows of rag_documents, reads
n8n/rag-documents/*.md (copied to /home/node/.n8n-files/rag-documents, the folder n8n 2.x may read) and writes the
sections with embeddings (text-embedding-3-large) and metadata.file = file name.

Writes n8n/workflows/rheinwerk-assistant.workflow.json and rheinwerk-rag-import.workflow.json (n8n import:workflow).
"""
import json
import pathlib
import uuid

BASE = pathlib.Path(__file__).resolve().parent
OUT = BASE / "workflows"
SUPA = {"supabaseApi": {"id": "rwdda8aefff1e947", "name": "RheinWerk Supabase Lokal"}}
OPENAI = {"openAiApi": {"id": "qK86QY5Bm6EfR9Zz", "name": "OpenAI account 3"}}
# Same chat model as on Oracle, so the answers stay as before
CHAT_MODEL = {"__rl": True, "value": "gpt-5.6-luna", "mode": "list", "cachedResultName": "gpt-5.6-luna"}
EMBEDDINGS = "text-embedding-3-large"
TABLE = {"__rl": True, "value": "rag_documents", "mode": "list", "cachedResultName": "rag_documents"}
SETTINGS = {"executionOrder": "v1", "binaryMode": "separate", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "callerPolicy": "workflowsFromSameOwner"}


def stable_id(workflow, name):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"rheinwerk-{workflow}/{name}"))


def node(workflow, name, kind, version, params, position, credentials=None, **extra):
    entry = {"parameters": params, "id": stable_id(workflow, name), "name": name, "type": kind, "typeVersion": version, "position": position}
    if credentials:
        entry["credentials"] = credentials
    entry.update(extra)
    return entry


def link(target, kind="main"):
    return {kind: [[{"node": target, "type": kind, "index": 0}]]}


prompt = (BASE / "assistant_prompt.md").read_text().rstrip("\n")
a = "assistant"
assistant = {
    "id": "rwAssistent2026",
    "name": "RheinWerk · Assistent",
    "active": False,
    "nodes": [
        node(a, "Frage annehmen", "n8n-nodes-base.webhook", 2.1, {"httpMethod": "POST", "path": "rheinwerk-assistant", "responseMode": "responseNode", "options": {}},
             [0, 0], webhookId=stable_id(a, "webhook-path")),
        node(a, "Assistent", "@n8n/n8n-nodes-langchain.agent", 3.1,
             {"promptType": "define", "text": "={{ $json.body.question }}", "options": {"systemMessage": "=" + prompt}}, [260, 0]),
        node(a, "Antwort", "n8n-nodes-base.respondToWebhook", 1.5, {"respondWith": "json", "responseBody": "={{ { answer: $json.output } }}", "options": {}}, [620, 0]),
        node(a, "Sprachmodell", "@n8n/n8n-nodes-langchain.lmChatOpenAi", 1.3, {"model": CHAT_MODEL, "builtInTools": {}, "options": {}}, [120, 240], OPENAI),
        node(a, "Gesprächsverlauf je Besucher", "@n8n/n8n-nodes-langchain.memoryBufferWindow", 1.4,
             {"sessionIdType": "customKey", "sessionKey": "={{ $json.body.session_id }}", "contextWindowLength": 6}, [280, 240]),
        node(a, "Wissensbasis (rag_documents)", "@n8n/n8n-nodes-langchain.vectorStoreSupabase", 1.3,
             {"mode": "retrieve-as-tool",
              "toolDescription": "Search the RheinWerk knowledge base for information needed to answer customer questions. Always use this tool before answering questions about RheinWerk, its services, prices, service times or processes.",
              "tableName": TABLE, "options": {"queryName": "match_rag_documents"}}, [440, 240], SUPA),
        node(a, "Embeddings", "@n8n/n8n-nodes-langchain.embeddingsOpenAi", 1.2, {"model": EMBEDDINGS, "options": {}}, [440, 440], OPENAI),
    ],
    "connections": {
        "Frage annehmen": link("Assistent"),
        "Assistent": link("Antwort"),
        "Sprachmodell": link("Assistent", "ai_languageModel"),
        "Gesprächsverlauf je Besucher": link("Assistent", "ai_memory"),
        "Wissensbasis (rag_documents)": link("Assistent", "ai_tool"),
        "Embeddings": link("Wissensbasis (rag_documents)", "ai_embedding"),
    },
    "settings": SETTINGS,
    "description": "Website-Assistent (task-18-10): beantwortet Fragen aus der Wissensbasis rag_documents; Aufruf nur über /api/assistant.",
}

i = "rag-import"
rag_import = {
    "id": "rwRagImport2026",
    "name": "RheinWerk · Dokumente importieren",
    "active": False,
    "nodes": [
        node(i, "Start", "n8n-nodes-base.manualTrigger", 1, {}, [0, 0]),
        node(i, "Wissensbasis leeren", "n8n-nodes-base.httpRequest", 4.5,
             {"method": "DELETE", "url": "http://kong:8000/rest/v1/rag_documents?id=gte.0", "authentication": "predefinedCredentialType",
              "nodeCredentialType": "supabaseApi", "sendHeaders": True,
              "headerParameters": {"parameters": [{"name": "Prefer", "value": "return=minimal"}]}, "options": {"timeout": 15000}},
             [220, 0], SUPA, alwaysOutputData=True),
        node(i, "Dokumente lesen", "n8n-nodes-base.readWriteFile", 1.1, {"fileSelector": "/home/node/.n8n-files/rag-documents/*.md", "options": {}}, [440, 0],
             executeOnce=True),
        node(i, "Wissensbasis füllen (rag_documents)", "@n8n/n8n-nodes-langchain.vectorStoreSupabase", 1.3,
             {"mode": "insert", "tableName": TABLE, "options": {"queryName": "match_rag_documents"}}, [680, 0], SUPA),
        node(i, "Embeddings", "@n8n/n8n-nodes-langchain.embeddingsOpenAi", 1.2, {"model": EMBEDDINGS, "options": {}}, [600, 220], OPENAI),
        node(i, "Abschnitte mit Quelldatei", "@n8n/n8n-nodes-langchain.documentDefaultDataLoader", 1.1,
             {"dataType": "binary", "options": {"metadata": {"metadataValues": [{"name": "file", "value": "={{ $binary.data.fileName }}"}]}}}, [780, 220]),
    ],
    "connections": {
        "Start": link("Wissensbasis leeren"),
        "Wissensbasis leeren": link("Dokumente lesen"),
        "Dokumente lesen": link("Wissensbasis füllen (rag_documents)"),
        "Embeddings": link("Wissensbasis füllen (rag_documents)", "ai_embedding"),
        "Abschnitte mit Quelldatei": link("Wissensbasis füllen (rag_documents)", "ai_document"),
    },
    "settings": SETTINGS,
    "description": "Wissensbasis des Website-Assistenten neu aufbauen (task-18-10): ops/vps/rag-import.sh.",
}

for workflow, file in ((assistant, "rheinwerk-assistant.workflow.json"), (rag_import, "rheinwerk-rag-import.workflow.json")):
    (OUT / file).write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
    print(f"{file}: {len(workflow['nodes'])} Knoten")
