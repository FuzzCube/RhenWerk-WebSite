"""Workflow "RheinWerk · Telefonassistent Auswertung" (task-13-6).

Every 2 minutes: list the latest conversations of the agent "RheinWerk Mira" in ElevenLabs, ask the database which
finished ones are not evaluated yet (agent_calls_pending), fetch each (at most 10 per run), turn the transcript into
text, let OpenAI fill the fixed schema of docs/telefonassistent-plan.md and store it with agent_record_call. A failed
step leaves the conversation pending, so the next run tries again; a stored one is never evaluated twice.

Writes n8n/workflows/rheinwerk-call-analysis.workflow.json (import format: n8n import:workflow).
"""
import json
import pathlib
import uuid

from openai_config import OPENAI, RESPONSE_TEXT, obj, response_params

BASE = pathlib.Path(__file__).resolve().parent
ROOT = BASE.parent
OUT = BASE / "workflows"
WORKFLOW_ID = "rwCallAnalysis26"
SUPA = {"supabaseApi": {"id": "rwdda8aefff1e947", "name": "RheinWerk Supabase Lokal"}}
ELEVEN = {"httpHeaderAuth": {"id": "rwElevenLabs0001", "name": "RheinWerk ElevenLabs"}}
RPC_URL = "http://host.docker.internal:54321/rest/v1/rpc/"
API = "https://api.elevenlabs.io/v1/convai/conversations"
AGENT_ID = json.loads((ROOT / "docs/telefonassistent/elevenlabs.json").read_text())["agent_id"]

TEXT = {"type": "string"}
NULL_TEXT = {"type": ["string", "null"]}
BOOL = {"type": "boolean"}
CALL_SCHEMA = obj({
    "kategorie": {"type": "string", "enum": ["neue_anfrage", "termin", "status", "verspaetung", "frage", "notfall", "beschwerde", "ausserhalb_gebiet", "spam", "sonstiges"]},
    "dringlichkeit": {"type": "string", "enum": ["planbar", "zeitnah", "erheblich", "production_stop"]},
    "sicherheitsgefahr": {"type": "string", "enum": ["none_known", "known", "unclear"]},
    "firma": NULL_TEXT,
    "kontakt": NULL_TEXT,
    "rueckrufnummer": NULL_TEXT,
    "anfrage_nummer": NULL_TEXT,
    "zusammenfassung": TEXT,
    "rueckruf_noetig": BOOL,
    "stimmung": {"type": "string", "enum": ["positiv", "neutral", "negativ"]},
})
INSTRUCTIONS = """Du wertest ein beendetes Gespräch des KI-Telefonassistenten Mira der RheinWerk Industrieservice GmbH aus
(Kompressoren, Pumpen, industrielle Lüftung; Region Rhein-Neckar). Antworte nur mit dem JSON-Schema.
- kategorie: Hauptanliegen. neue_anfrage = neue Service-Anfrage aufgenommen oder gewünscht; termin = Terminfrage zu
  bestehender Anfrage; status = Stand einer Anfrage; verspaetung = Techniker kommt zu spät; frage = allgemeine Frage
  (Leistungen, Preise, Zeiten); notfall = Gefahr für Personen oder Stillstand mit sofortigem Handlungsbedarf;
  beschwerde; ausserhalb_gebiet = Standort außerhalb des Einsatzgebiets; spam = Werbung, kein Anliegen;
  sonstiges = alles andere, auch abgebrochene Gespräche.
- dringlichkeit: wie der Anrufer es schildert; ohne Angabe planbar. production_stop nur bei stehender Produktion.
- sicherheitsgefahr: known nur bei genannter Gefahr (Brand, Gas, austretende Stoffe, Verletzte), unclear bei
  Unsicherheit, sonst none_known.
- firma, kontakt, rueckrufnummer, anfrage_nummer: nur wenn im Gespräch genannt oder bestätigt, sonst null.
  anfrage_nummer im Format RIS-JJJJ-NNNNN, z. B. aus der Antwort eines Werkzeugs.
- zusammenfassung: 1–2 sachliche deutsche Sätze für den Service Desk (was wollte der Anrufer, was ist passiert,
  was bleibt offen). Keine E-Mail-Adressen.
- rueckruf_noetig: true, wenn ein Mensch zurückrufen muss (ausdrücklicher Wunsch, Werkzeugstörung, Beschwerde,
  Anliegen offen geblieben). false, wenn eine Anfrage angelegt wurde und der Service Desk sie wie üblich bearbeitet.
- stimmung: Stimmung des Anrufers am Ende."""


def stable_id(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "rheinwerk-call-analysis/" + "/".join(parts)))


nodes, connections = [], {}


def add(name, typ, version, params, position, credentials=None, extra=None):
    n = {"parameters": params, "id": stable_id(name), "name": name, "type": typ, "typeVersion": version, "position": position}
    if credentials:
        n["credentials"] = credentials
    n.update(extra or {})
    nodes.append(n)
    return name


def link(a, b):
    connections.setdefault(a, {"main": [[]]})["main"][0].append({"node": b, "type": "main", "index": 0})


def rpc(name, fn, body, position):
    return add(name, "n8n-nodes-base.httpRequest", 4.5, {
        "method": "POST", "url": RPC_URL + fn, "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
        "sendBody": True, "specifyBody": "json", "jsonBody": "=" + body, "options": {"timeout": 10000},
    }, position, SUPA)


def eleven(name, url, position):
    return add(name, "n8n-nodes-base.httpRequest", 4.5, {
        "method": "GET", "url": url, "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth", "options": {"timeout": 15000},
    }, position, ELEVEN)


trigger = add("Alle 2 Minuten", "n8n-nodes-base.scheduleTrigger", 1.2, {"rule": {"interval": [{"field": "minutes", "minutesInterval": 2}]}}, [0, 0])
listing = eleven("Gespräche abrufen", f"{API}?agent_id={AGENT_ID}&page_size=30", [220, 0])
finished = add("Beendete Gespräche", "n8n-nodes-base.code", 2, {"mode": "runOnceForAllItems", "jsCode": """const list=$input.first().json.conversations??[];
const ids=list.filter(c=>c.status==='done'||c.status==='failed').map(c=>c.conversation_id);
return ids.length?[{json:{conversation_ids:ids}}]:[];"""}, [440, 0])
pending = rpc("Noch nicht ausgewertet", "agent_calls_pending", "{{ { conversation_ids: $json.conversation_ids } }}", [660, 0])
split = add("Einzeln (höchstens 10)", "n8n-nodes-base.code", 2, {"mode": "runOnceForAllItems", "jsCode": """const ids=$input.first().json.ids??[];
return ids.slice(0,10).map(id=>({json:{id}}));"""}, [880, 0])
detail = eleven("Gespräch laden", "={{ '" + API + "/' + $json.id }}", [1100, 0])
prepare = add("Transkript aufbereiten", "n8n-nodes-base.code", 2, {"mode": "runOnceForEachItem", "jsCode": """const c=$json;const m=c.metadata??{};
const lines=[];
for(const t of c.transcript??[]){
  for(const call of t.tool_calls??[]) if(call.tool_name) lines.push(`[Werkzeug ${call.tool_name}: ${String(call.params_as_json??'').slice(0,300)}]`);
  for(const r of t.tool_results??[]) if(r.tool_name) lines.push(`[Ergebnis ${r.tool_name}: ${String(r.result_value??'').slice(0,300)}]`);
  if(t.message) lines.push(`${t.role==='agent'?'Mira':'Anrufer'}: ${t.message}`);
}
const transcript=lines.join('\\n');
let price=0;
for(const u of Object.values(m.charging?.llm_usage?.irreversible_generation?.model_usage??{})) for(const part of Object.values(u)) price+=Number(part?.price??0);
return {json:{call_id:c.conversation_id,started_at:m.start_time_unix_secs?new Date(m.start_time_unix_secs*1000).toISOString():null,
  duration_seconds:m.call_duration_secs??0,credits:Number.isFinite(m.cost)?m.cost:null,cost_cents:Math.round(price*100),
  transcript,prompt:transcript.slice(0,30000)||'(leeres Gespräch)'}};"""}, [1320, 0])
analyse = add("Auswerten (OpenAI)", "@n8n/n8n-nodes-langchain.openAi", 2.3,
              response_params([{"type": "text", "role": "user", "content": "={{ $json.prompt }}"}], INSTRUCTIONS, CALL_SCHEMA, "rheinwerk_call", 800),
              [1540, 0], OPENAI, {"onError": "continueRegularOutput"})
merge = add("Ergebnis zusammenführen", "n8n-nodes-base.code", 2, {"mode": "runOnceForEachItem", "jsCode": ("""const raw=$json;RESPONSE_TEXT_HERE
let analysis=null;try{analysis=typeof text==='object'?text:JSON.parse(String(text).replace(/^```(?:json)?\\s*/,'').replace(/\\s*```$/,''));}catch{analysis=null;}
// Without a valid evaluation nothing is stored: the conversation stays pending for the next run
if(!analysis||!analysis.kategorie) return null;
const call=$('Transkript aufbereiten').item.json;
return {json:{call_id:call.call_id,started_at:call.started_at,duration_seconds:call.duration_seconds,transcript:call.transcript,analysis,credits:call.credits,cost_cents:call.cost_cents}};""").replace("RESPONSE_TEXT_HERE", RESPONSE_TEXT)}, [1760, 0])
record = rpc("Speichern", "agent_record_call", "{{ $json }}", [1980, 0])

for a, b in [(trigger, listing), (listing, finished), (finished, pending), (pending, split), (split, detail), (detail, prepare), (prepare, analyse), (analyse, merge), (merge, record)]:
    link(a, b)

workflow = {
    "id": WORKFLOW_ID,
    "name": "RheinWerk · Telefonassistent Auswertung",
    "active": False,
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "callerPolicy": "workflowsFromSameOwner"},
    "description": "Auswertung beendeter Gespräche von Mira (task-13-6): ElevenLabs-API alle 2 Minuten, OpenAI nach festem Schema, agent_record_call.",
}
(OUT / "rheinwerk-call-analysis.workflow.json").write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
print("rheinwerk-call-analysis.workflow.json:", len(nodes), "Knoten")
