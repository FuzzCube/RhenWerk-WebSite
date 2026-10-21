"""Workflow "RheinWerk · Telefonassistent Werkzeuge" (task-13-5).

One POST webhook per tool of the voice agent Mira (/webhook/agent-<name>). Every webhook requires the header
x-agent-secret (n8n header auth credential, value only in n8n and .env.local), calls exactly one service_role
database function or the catalog matcher, and answers with the short JSON of docs/telefonassistent/regeln.md.
Errors answer {ok:false, fehler:"werkzeug_gestoert"} so the agent offers a callback instead of guessing.

Writes n8n/workflows/rheinwerk-agent-tools.workflow.json (import format: n8n import:workflow).
"""
import json
import pathlib
import uuid

BASE = pathlib.Path(__file__).resolve().parent
OUT = BASE / "workflows"
WORKFLOW_ID = "rwAgentTools2026"
SUPA = {"supabaseApi": {"id": "rwdda8aefff1e947", "name": "RheinWerk Supabase Lokal"}}
SECRET = {"httpHeaderAuth": {"id": "rwAgentSecret001", "name": "RheinWerk Agent-Secret"}}
RPC_URL = "http://host.docker.internal:54321/rest/v1/rpc/"
FAILED = "{ok:false,fehler:'werkzeug_gestoert'}"
catalog = json.loads((OUT / "catalog.json").read_text())


def stable_id(*parts):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "rheinwerk-agent-tools/" + "/".join(parts)))


# Request body of the agent: ElevenLabs sends the tool parameters as JSON object
B = "($json.body ?? {})"

# tool, RPC (None = code), RPC body expression
TOOLS = [
    ("einsatzgebiet-pruefen", "agent_check_area", f"{{{{ {{call_id:{B}.call_id, plz:{B}.plz ?? null}} }}}}"),
    ("sla-pruefen", "agent_check_contract", f"{{{{ {{contract_number:{B}.vertragsnummer ?? null, company_name:{B}.firma ?? null, postal_code:{B}.plz ?? null}} }}}}"),
    ("freie-termine", "agent_free_slots", f"{{{{ {{call_id:{B}.call_id, von_tag:{B}.von_tag || null, bis_tag:{B}.bis_tag || null, leistung:{B}.leistung || 'diagnosis_repair', plz:{B}.plz ?? null}} }}}}"),
    ("anfrage-anlegen", "agent_create_request", f"{{{{ (() => {{ const b = {B}; const {{call_id, termin_beginn, ...fields}} = b; return {{call_id, fields, termin_beginn: termin_beginn || null}}; }})() }}}}"),
    ("anfrage-finden", "agent_find_request", f"{{{{ {{call_id:{B}.call_id, nummer:{B}.nummer || null, firma:{B}.firma || null, plz:{B}.plz ?? null, strasse:{B}.strasse || null}} }}}}"),
    ("rueckrufbitte-techniker", "agent_request_callback", f"{{{{ {{call_id:{B}.call_id, anfrage_id:{B}.anfrage_id, rueckrufnummer:{B}.rueckrufnummer ?? null}} }}}}"),
    ("servicezeit", "agent_service_hours", f"{{{{ {{call_id:{B}.call_id}} }}}}"),
    ("rueckruf-service-desk", "agent_request_service_callback", f"{{{{ {{call_id:{B}.call_id, grund:{B}.grund ?? null, rueckrufnummer:{B}.rueckrufnummer ?? null, dringend:{B}.dringend === true, anfrage_id:{B}.anfrage_id || null}} }}}}"),
    ("kunde-finden", "agent_find_customer", f"{{{{ {{call_id:{B}.call_id, kundennummer:{B}.kundennummer ?? null, plz:{B}.plz ?? null}} }}}}"),
    ("email-pruefen", "agent_check_email", f"{{{{ {{call_id:{B}.call_id, buchstaben:{B}.buchstaben ?? null}} }}}}"),
    # Demo transfer (task-13-11): no phone line, the database marks the call and returns the sentence for the caller
    ("weiterleiten", "agent_forward", f"{{{{ {{call_id:{B}.call_id, ziel:{B}.ziel ?? null, grund:{B}.grund ?? null}} }}}}"),
    ("anlage-pruefen", None, None),
]

# Deterministic catalog match (same normalization and aliases as the request analysis, rheinwerk-analysis)
MATCHER = """const catalog=CATALOG;const b=$input.first().json.body??{};
const kinds={pumpe:'pump',pump:'pump',kompressor:'compressor',verdichter:'compressor',compressor:'compressor',lueftung:'ventilation','lüftung':'ventilation','lüftungsanlage':'ventilation',ventilator:'ventilation',ventilation:'ventilation'};
const kindRaw=String(b.anlagenart??'').trim().toLowerCase();const kind=kinds[kindRaw]??(kindRaw?'other':null);
const norm=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/(\\d),(\\d)/g,'$1.$2').replace(/(\\d{1,3})\\.(\\d{3})(?!\\d)/g,'$1$2').replace(/\\s+/g,'');
const brandnorm=s=>String(s??'').normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase().replace(/[\\s-]+/g,'');
const model=String(b.typ??'').trim();const brandraw=String(b.hersteller??'').trim();
let brand=null;for(const [k,names] of Object.entries(catalog.aliases)){if(brandraw&&[k,...names].some(n=>brandnorm(n)===brandnorm(brandraw)))brand=k;}
if(!brand&&model){for(const [k,names] of Object.entries(catalog.aliases)){for(const n of [k,...names]){if(n==='ABS')continue;if(brandnorm(model).startsWith(brandnorm(n))&&brandnorm(n).length>=3)brand=k;}}}
let modelOnly=model;const names=brand?[brand,...catalog.aliases[brand]]:[];for(const n of names.sort((x,y)=>y.length-x.length)){if(modelOnly.toLowerCase().startsWith(n.toLowerCase())){modelOnly=modelOnly.slice(n.length).trim();break;}}
const rowsOf=brand?catalog.rows.filter(r=>r.manufacturer===brand&&(!kind||r.category===kind)):[];
const label=brand?(catalog.rows.find(r=>r.manufacturer===brand)?.manufacturer??brand):null;
let status='needs_review',row=null;const missing=[];
if(kind==='other')status='out_of_scope';
else if(!brand){status='needs_review';if(!brandraw)missing.push('hersteller');}
else if(!model){status='brand_only';missing.push('typ');}
else{const exact=rowsOf.filter(r=>r.models.some(m=>norm(m)===norm(modelOnly)));
if(exact.length===1){row=exact[0];status=row.object_level==='component'?'needs_review':'listed_model';}
else if(exact.length>1)status='needs_review';
else{const series=rowsOf.filter(r=>{const tokens=[r.series,...r.aliases.split(',')].filter(x=>x&&x!=='-');return tokens.some(t=>{const n=norm(t);const v=norm(modelOnly);return v.startsWith(n)&&(!/[a-z]$/.test(n)||!/^[a-z]/.test(v.slice(n.length)));})||(r.key==='compair_dh'&&/^d\\d+h/i.test(modelOnly))||(r.key==='netzsch_nemo'&&/^nm\\d/i.test(modelOnly));}).sort((x,y)=>y.series.length-x.series.length);row=series[0]??null;status=row?'series_match':'needs_review';}}
if(!kind&&status!=='out_of_scope')missing.unshift('anlagenart');
// Known brand, unknown series: series whose letters differ by at most one (speech recognition: "CIR 32" for "CR 32")
let similar=[];
if(brand&&model&&status==='needs_review'&&!row){const head=norm(modelOnly).match(/^[a-z]+/)?.[0]??'';
const lev=(a,c)=>{const d=Array.from({length:a.length+1},(_,i)=>[i,...Array(c.length).fill(0)]);for(let j=1;j<=c.length;j++)d[0][j]=j;for(let i=1;i<=a.length;i++)for(let j=1;j<=c.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===c[j-1]?0:1));return d[a.length][c.length];};
if(head)for(const r of rowsOf){const tokens=[r.series,...r.aliases.split(',')].filter(x=>x&&x!=='-');if(tokens.some(t=>{const h=norm(t).match(/^[a-z]+/)?.[0]??'';return h&&h!==head&&lev(h,head)<=1&&Math.max(h.length,head.length)>=2;}))similar.push(r.series);}
similar=[...new Set(similar)].slice(0,3);}
const satz={listed_model:'Diese Anlage betreuen wir.',series_match:'Diese Baureihe betreuen wir. Den genauen Typ vom Typenschild nehme ich gern auf, falls er zur Hand ist.',brand_only:'Das prüft unser Service Desk anhand der Typenangaben.',needs_review:'Das prüft unser Service Desk anhand der Typenangaben.',out_of_scope:'Diese Anlagenart gehört leider nicht zu unserem Leistungsumfang.'}[status];
const rueckfrage=similar.length?`Meinen Sie die Baureihe ${similar.join(' oder ')}?`:null;
return [{json:{ok:true,status,hersteller:label,baureihe:row?.series??null,fehlende_angaben:missing,aehnliche_baureihen:similar,rueckfrage,satz}}];""".replace("CATALOG", json.dumps(catalog, ensure_ascii=False))

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


for row, (tool, fn, body) in enumerate(TOOLS):
    y = row * 200
    title = tool.replace("-", " ").capitalize()
    hook = add(f"Werkzeug {title}", "n8n-nodes-base.webhook", 2.1,
               {"httpMethod": "POST", "path": f"agent-{tool}", "authentication": "headerAuth", "responseMode": "responseNode", "options": {}},
               [0, y], SECRET, {"webhookId": stable_id("hook", tool)})
    if fn:
        work = add(f"{title}: Datenbank", "n8n-nodes-base.httpRequest", 4.5,
                   {"method": "POST", "url": RPC_URL + fn, "authentication": "predefinedCredentialType", "nodeCredentialType": "supabaseApi",
                    "sendBody": True, "specifyBody": "json", "jsonBody": "=" + body,
                    "options": {"timeout": 5000, "response": {"response": {"responseFormat": "json", "neverError": True}}}},
                   [260, y], SUPA, {"onError": "continueRegularOutput"})
        answer = f"={{{{ $json.error || $json.code || $json.message ? {FAILED} : $json }}}}"
    else:
        work = add(f"{title}: Katalog", "n8n-nodes-base.code", 2, {"mode": "runOnceForAllItems", "jsCode": MATCHER}, [260, y], extra={"onError": "continueRegularOutput"})
        answer = f"={{{{ $json.ok ? $json : {FAILED} }}}}"
    respond = add(f"{title}: Antwort", "n8n-nodes-base.respondToWebhook", 1.5,
                  {"respondWith": "json", "responseBody": answer, "options": {"responseCode": 200}}, [520, y])
    link(hook, work)
    link(work, respond)

workflow = {
    "id": WORKFLOW_ID,
    "name": "RheinWerk · Telefonassistent Werkzeuge",
    "active": False,
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "none", "saveDataErrorExecution": "all", "callerPolicy": "workflowsFromSameOwner", "errorWorkflow": "rwFehlerMeldung1"},
    "description": "Webhooks des Sprachagenten Mira (task-13-5): je Werkzeug ein POST /webhook/agent-<name> mit x-agent-secret.",
}
(OUT / "rheinwerk-agent-tools.workflow.json").write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n")
print("rheinwerk-agent-tools.workflow.json:", len(nodes), "Knoten")
