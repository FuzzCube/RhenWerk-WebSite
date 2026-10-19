// Voice agent "Mira" in ElevenLabs (task-13-5): creates or updates secrets, webhook tools, pronunciation dictionary
// and the agent from the repository (docs/telefonassistent/systemprompt.md, wissensbasis.md, leitfaden.md).
// Usage: npm run agent:sync
// Needs in .env.local: ELEVENLABS_API_KEY, AGENT_WEBHOOK_SECRET, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET.
// Secret values go only to ElevenLabs workspace secrets; the ids of the created objects (no secrets) are kept in
// docs/telefonassistent/elevenlabs.json so a second run updates instead of duplicating.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://api.elevenlabs.io";
const BASE_URL = process.env.AGENT_BASE_URL ?? "https://n8n.rheinwerk-service.online";
const STATE_FILE = new URL("../docs/telefonassistent/elevenlabs.json", import.meta.url);
const key = process.env.ELEVENLABS_API_KEY;
for (const name of ["ELEVENLABS_API_KEY", "AGENT_WEBHOOK_SECRET", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"]) {
  if (!process.env[name]) { console.error(`${name} fehlt in .env.local.`); process.exit(1); }
}

const state = JSON.parse(await readFile(STATE_FILE, "utf8").catch(() => "{}"));
state.tools ??= {};
state.secrets ??= {};
// Saved after every step, so a failed run never creates duplicates on the next one
const save = () => writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

async function api(method, path, body) {
  const response = await fetch(API + path, { method, headers: { "xi-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 600)}`);
  return text ? JSON.parse(text) : {};
}

// Workspace secrets (value never printed)
async function secret(name, value) {
  const { secrets } = await api("GET", "/v1/convai/secrets");
  const existing = secrets.find((s) => s.name === name);
  if (existing) {
    await api("PATCH", `/v1/convai/secrets/${existing.secret_id}`, { type: "update", name, value });
    return existing.secret_id;
  }
  return (await api("POST", "/v1/convai/secrets", { type: "new", name, value })).secret_id;
}
state.secrets.agent = await secret("rheinwerk_agent_secret", process.env.AGENT_WEBHOOK_SECRET);
state.secrets.cfId = await secret("rheinwerk_cf_access_id", process.env.CF_ACCESS_CLIENT_ID);
state.secrets.cfSecret = await secret("rheinwerk_cf_access_secret", process.env.CF_ACCESS_CLIENT_SECRET);
const headers = {
  "x-agent-secret": { secret_id: state.secrets.agent },
  "CF-Access-Client-Id": { secret_id: state.secrets.cfId },
  "CF-Access-Client-Secret": { secret_id: state.secrets.cfSecret },
};

// Tool parameters; call_id is always set by the platform
const str = (description) => ({ type: "string", description });
const bool = (description) => ({ type: "boolean", description });
const TOOLS = [
  ["servicezeit", "Heutiges Datum, aktuelle Uhrzeit (Europe/Berlin) und ob der Service Desk gerade erreichbar ist. Zu Beginn jedes Gesprächs still aufrufen.", {}, []],
  ["anlage_pruefen", "Prüft, ob RheinWerk die Anlage betreut (Katalogabgleich). Antwort: status, satz für den Anrufer und ggf. rueckfrage (ähnliche Baureihe, einmal stellen).", {
    anlagenart: str("Pumpe, Kompressor, Lüftung oder die genannte andere Anlagenart"), hersteller: str("Hersteller, falls genannt"), typ: str("Typ vom Typenschild, falls genannt"),
  }, []],
  ["kunde_finden", "Findet einen Bestandskunden nach Kundennummer; die Postleitzahl des Standorts ist die Prüfung. Antwort: treffer, firma, standorte (standort_id, ansage). Nennt nie E-Mail oder Telefon.", {
    kundennummer: str("Kundennummer wie genannt, z. B. K 10021"), plz: str("Fünfstellige Postleitzahl des Standorts"),
  }, ["kundennummer", "plz"]],
  ["email_pruefen", "Setzt die vom Anrufer buchstabierte E-Mail-Adresse zusammen und merkt sie für das Gespräch. Antwort: email und ansage (so vorlesen). Bei fehler email_ungueltig erneut buchstabieren lassen.", {
    buchstaben: str("Buchstaben und Wörter genau wie gehört, durch Kommas getrennt, z. B. „A, N, N, A, Punkt, M, at gmail Punkt com“; nichts weglassen oder ergänzen"),
  }, ["buchstaben"]],
  ["einsatzgebiet_pruefen", "Prüft, ob die Postleitzahl des Standorts im Einsatzgebiet liegt.", { plz: str("Fünfstellige Postleitzahl des Standorts") }, ["plz"]],
  ["sla_pruefen", "Prüft eine Notfall-SLA-Vertragsnummer. Nennt nie die Firma.", {
    vertragsnummer: str("Vertragsnummer wie genannt"), firma: str("Firma des Anrufers, falls bekannt"), plz: str("Postleitzahl des Standorts"),
  }, ["vertragsnummer"]],
  ["freie_termine", "Freie Terminfenster für einen Einsatz. Nutze das Feld ansage. Höchstens zwei Vorschläge nennen.", {
    von_tag: str("Frühester Tag JJJJ-MM-TT"), bis_tag: str("Spätester Tag JJJJ-MM-TT, optional"),
    leistung: str("inspection (Inspektion), scheduled_maintenance (Wartung) oder diagnosis_repair (Störung/Reparatur)"), plz: str("Postleitzahl des Standorts"),
  }, ["leistung"]],
  ["anfrage_anlegen", "Legt die Serviceanfrage an und merkt den gewählten Termin vor. Erst nach Zusammenfassung und Bestätigung aufrufen. Fehlen Angaben, kommt fehlende_felder zurück.", {
    company_name: str("Firma (entfällt bei Bestandskunden aus kunde_finden)"), contact_name: str("Ansprechperson"), business_email: str("email aus email_pruefen, unverändert"),
    phone_number: str("Rückrufnummer in Ziffern, z. B. 0621 5550123"), customer_number: str("Kundennummer, falls vorhanden"),
    street_house_number: str("Straße und Hausnummer des Standorts"), postal_code: str("Postleitzahl des Standorts"), city: str("Ort"),
    site_label: str("Halle, Gebäude oder Linie, falls genannt"),
    standort_id: str("standort_id aus kunde_finden, wenn der Kunde mehrere Standorte hat und einer bestätigt ist"),
    equipment_kind: str("pump, compressor, ventilation oder other"), manufacturer: str("Hersteller"), model_type: str("Typ vom Typenschild"),
    service_kind: str("inspection, scheduled_maintenance oder diagnosis_repair"),
    description: str("Anliegen in eigenen Worten, mindestens ein Satz; bei Störung Symptom oder Fehlercode"),
    customer_urgency: str("planbar, zeitnah, erheblich oder production_stop"), safety_risk: str("none_known, known oder unclear"),
    requested_visit_date: str("Wunschtag JJJJ-MM-TT, optional"), termin_beginn: str("Beginn des gewählten Fensters genau wie von freie_termine (beginn), optional"),
    sla_contract_number: str("Notfall-SLA-Vertragsnummer, falls genannt"),
  // Company, address and e-mail are optional here: with a customer from kunde_finden the database takes them from the
  // master data; otherwise it answers fehlende_felder
  }, ["contact_name", "phone_number", "equipment_kind", "service_kind", "description", "customer_urgency", "safety_risk"]],
  ["anfrage_finden", "Findet eine bestehende Anfrage. PLZ des Standorts ist Pflicht, dazu Anfragenummer oder Firma.", {
    nummer: str("Anfragenummer wie genannt, z. B. RIS 2026 123"), firma: str("Firma, wenn keine Nummer"), plz: str("Postleitzahl des Standorts"), strasse: str("Straße, falls mehrere Treffer"),
  }, ["plz"]],
  ["rueckrufbitte_techniker", "Nur bei lage ueberfaellig: bittet den eingeplanten Techniker, den Kunden zurückzurufen.", {
    anfrage_id: str("anfrage_id aus anfrage_finden"), rueckrufnummer: str("Bestätigte Rückrufnummer in Ziffern, z. B. 0621 5550123"),
  }, ["anfrage_id", "rueckrufnummer"]],
  ["rueckruf_service_desk", "Rückruf durch einen Menschen (statt Weiterleitung): Notfall, Beschwerde, Wunsch nach einem Menschen oder Werkzeugstörung.", {
    grund: str("Anliegen in einem Satz"), rueckrufnummer: str("Bestätigte Rückrufnummer in Ziffern, z. B. 0621 5550123"), dringend: bool("true bei Notfall, Stillstand oder Sicherheitsgefahr"), anfrage_id: str("anfrage_id, falls bekannt"),
  }, ["grund", "rueckrufnummer"]],
];

for (const [name, description, properties, required] of TOOLS) {
  const tool_config = {
    type: "webhook", name, description, response_timeout_secs: 10,
    api_schema: {
      url: `${BASE_URL}/webhook/agent-${name.replace(/_/g, "-")}`, method: "POST", request_headers: headers,
      request_body_schema: {
        type: "object", description: "Parameter des Werkzeugs",
        properties: { call_id: { type: "string", dynamic_variable: "system__conversation_id" }, ...properties },
        required: ["call_id", ...required],
      },
    },
  };
  const id = state.tools[name];
  if (id) await api("PATCH", `/v1/convai/tools/${id}`, { tool_config });
  else state.tools[name] = (await api("POST", "/v1/convai/tools", { tool_config })).id;
  await save();
  console.log(`Werkzeug ${name}: ${state.tools[name]}`);
}

// Pronunciation: names and abbreviations as they are spoken
const RULES = [["RheinWerk", "Rhein Werk"], ["RIS", "R I S"], ["KAESER", "Kaiser"], ["Kaeser", "Kaiser"], ["KSB", "K S B"], ["BOGE", "Boge"], ["WILO", "Wilo"],
  ["TROX", "Trox"], ["ebm-papst", "e b m papst"], ["SLA", "S L A"], ["PLZ", "Postleitzahl"], ["CompAir", "Komp Air"], ["Atlas Copco", "Atlas Kopko"], ["Ziehl-Abegg", "Ziel Abeck"]]
  .map(([string_to_replace, alias]) => ({ type: "alias", string_to_replace, alias }));
try {
  if (!state.dictionary) {
    const created = await api("POST", "/v1/pronunciation-dictionaries/add-from-rules", { name: "RheinWerk Mira", rules: RULES });
    state.dictionary = { id: created.id, version_id: created.version_id };
  } else {
    const updated = await api("POST", `/v1/pronunciation-dictionaries/${state.dictionary.id}/set-rules`, { rules: RULES });
    state.dictionary.version_id = updated.version_id ?? state.dictionary.version_id;
  }
  await save();
  console.log(`Aussprache: ${state.dictionary.id}`);
} catch (error) {
  console.warn(`Aussprache übersprungen: ${error.message}`);
}

const promptFile = await readFile(new URL("../docs/telefonassistent/systemprompt.md", import.meta.url), "utf8");
const knowledge = await readFile(new URL("../docs/telefonassistent/wissensbasis.md", import.meta.url), "utf8");
const guide = await readFile(new URL("../docs/telefonassistent/leitfaden.md", import.meta.url), "utf8");
const prompt = promptFile.match(/```text\n([\s\S]*?)```/)[1].trim() + "\n\n# Wissen\n" + knowledge.replace(/^# .*\n/, "").trim();
// Speech recognition hints: manufacturers and series of the catalog (test call 19.10.2026: "Grundfos" heard as "Dahlhof")
const catalog = JSON.parse(await readFile(new URL("../n8n/workflows/catalog.json", import.meta.url), "utf8"));
// Short series ("G", "CR") left out: as hints they would bend ordinary words
const keywords = [...new Set([...Object.entries(catalog.aliases).flat(2), ...catalog.rows.map((r) => r.series).filter((x) => x.length >= 3 && !x.includes("/")),
  "RheinWerk", "Gleitringdichtung", "Typenschild"])].filter((k) => k && k !== "-");
const greeting = guide.match(/\| Begrüßung \| „(.+?)“ \|/)[1];

// German voice from the ElevenLabs library ("Laura – Sharp and Professional", made for hotlines); added to the
// workspace once (needs voices_write). Another voice: ELEVENLABS_VOICE_ID.
const voiceId = process.env.ELEVENLABS_VOICE_ID ?? state.voice_id ?? "zKHQdbB8oaQ7roNTiDTK";
const own = await fetch(`${API}/v1/voices/${voiceId}`, { headers: { "xi-api-key": key } });
if (own.status === 404 || own.status === 400) {
  const { voices } = await api("GET", `/v1/shared-voices?search=${encodeURIComponent("Laura")}&language=de&page_size=20`);
  const shared = voices.find((v) => v.voice_id === voiceId);
  if (!shared) throw new Error(`Stimme ${voiceId} weder im Konto noch in der Bibliothek gefunden.`);
  await api("POST", `/v1/voices/add/${shared.public_owner_id}/${voiceId}`, { new_name: "Mira (Laura)" });
  console.log("Stimme aus der Bibliothek hinzugefügt");
}
const agent = {
  name: "RheinWerk Mira",
  conversation_config: {
    agent: {
      first_message: greeting,
      language: "de",
      prompt: {
        prompt, llm: state.llm ?? "gpt-4.1-mini", temperature: 0.2, tool_ids: Object.values(state.tools),
        built_in_tools: { end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } } },
      },
    },
    tts: {
      // Expressive mode: livelier intonation; stability below the default 0.5 for more variation, latency
      // optimisation one step lower than the default 3 for better sound (user decision 19.10.2026)
      voice_id: voiceId, model_id: state.tts_model ?? "eleven_flash_v2_5", expressive_mode: true, stability: 0.4, optimize_streaming_latency: 2,
      ...(state.dictionary ? { pronunciation_dictionary_locators: [{ pronunciation_dictionary_id: state.dictionary.id, version_id: state.dictionary.version_id }] } : {}),
    },
    asr: { keywords },
    // Waits longer during "äh" pauses before answering (test call 19.10.2026: Mira interrupted the caller)
    turn: { turn_eagerness: "patient" },
    conversation: { max_duration_seconds: 600 },
  },
  platform_settings: {
    call_limits: { agent_concurrency_limit: 2, daily_limit: 30 },
    privacy: { record_voice: false, retention_days: 30 },
  },
};
if (state.agent_id) await api("PATCH", `/v1/convai/agents/${state.agent_id}`, agent);
else state.agent_id = (await api("POST", "/v1/convai/agents/create", agent)).agent_id;
state.voice_id = voiceId;
console.log(`Agent: ${state.agent_id}`);

await save();
console.log("Gespeichert: docs/telefonassistent/elevenlabs.json (nur IDs, keine Geheimnisse)");
