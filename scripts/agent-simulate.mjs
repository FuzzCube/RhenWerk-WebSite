// Text simulation of core scenarios with the real agent in ElevenLabs (task-13-5). The simulation endpoint does not
// call webhooks, so each tool is mocked with the answer our real webhook gives for the scenario (fetched first from
// local n8n); anfrage_anlegen gets a fixed answer, so no request and no e-mail is created. Checks which tools Mira
// calls and which she must not call. Usage: npm run agent:simulate [-- <szenario>]
import { readFile } from "node:fs/promises";

const key = process.env.ELEVENLABS_API_KEY;
const secret = process.env.AGENT_WEBHOOK_SECRET;
const { agent_id } = JSON.parse(await readFile(new URL("../docs/telefonassistent/elevenlabs.json", import.meta.url), "utf8"));
const only = process.argv[2];
let failures = 0;

async function real(tool, body) {
  const response = await fetch(`http://127.0.0.1:5678/webhook/agent-${tool.replace(/_/g, "-")}`, {
    method: "POST", headers: { "content-type": "application/json", "x-agent-secret": secret }, body: JSON.stringify({ call_id: "sim-vorab", ...body }),
  });
  return response.text();
}

const CREATED = JSON.stringify({ ok: true, wiederholt: false, anfrage_id: "00000000-0000-0000-0000-000000000000", anfrage_nummer: "RIS-2026-09999", termin_vorgemerkt: true, termin_ansage: "Montag, der 19. Oktober, um 8 Uhr" });
const SCENARIOS = {
  status: {
    caller: "Du bist Herr Weber von der Bergsträßer Chemiepark Service GmbH. Du fragst, wann der Techniker kommt. Anfragenummer RIS-2026-03273, Standort-PLZ 69115, Kanalstraße 51 in Heidelberg. Antworte kurz, bestätige Rückfragen.",
    tools: { anfrage_finden: { nummer: "RIS-2026-03273", plz: "69115" } },
    must: ["servicezeit", "anfrage_finden"], never: ["rueckrufbitte_techniker", "anfrage_anlegen"],
  },
  anlage: {
    caller: "Du rufst für die Firma Kühltechnik Süd in 68219 Mannheim an und brauchst eine Wartung für eine Kälteanlage von Bitzer. Antworte kurz.",
    tools: { anlage_pruefen: { anlagenart: "Kälteanlage", hersteller: "Bitzer" } },
    // Kälteanlagen are excluded in the knowledge too, so a refusal without the tool is fine; no data collection
    must: [], never: ["anfrage_anlegen", "freie_termine", "einsatzgebiet_pruefen"],
  },
  neu: {
    caller: "Du bist Anna Schulz von der Neckar Pumpenwerk GmbH, Industriestraße 5, 68219 Mannheim, Telefon 0621 5550123, E-Mail a.schulz@npw.de (buchstabiere sie, wenn du gefragt wirst: A, Punkt, S, C, H, U, L, Z, at N, P, W, Punkt, D, E). Deine Grundfos-Pumpe CR 32 leckt an der Gleitringdichtung, kein Stillstand, keine Gefahr, zeitnah. Du möchtest einen Termin in den nächsten Tagen und nimmst den ersten Vorschlag. Antworte kurz und bestätige Zusammenfassungen.",
    tools: { anlage_pruefen: { anlagenart: "Pumpe", hersteller: "Grundfos", typ: "CR 32" }, einsatzgebiet_pruefen: { plz: "68219" }, freie_termine: { leistung: "diagnosis_repair", plz: "68219" },
      email_pruefen: { buchstaben: "A, Punkt, S, C, H, U, L, Z, at N, P, W, Punkt, D, E" }, anfrage_anlegen: null },
    must: ["anlage_pruefen", "einsatzgebiet_pruefen", "email_pruefen", "freie_termine", "anfrage_anlegen"], never: ["rueckruf_service_desk"],
    // Street asked, e-mail taken from email_pruefen
    params: { anfrage_anlegen: (p) => /Industriestra(ß|ss)e 5/.test(p.street_house_number ?? "") && p.business_email === "a.schulz@npw.de" },
  },
  notfall: {
    caller: "Du bist Herr Krämer von der Rheinhafen Logistikzentrum GmbH & Co. KG, Hafenstraße 12, 68159 Mannheim, Rückrufnummer 0621 4440001. Dein Kompressor ist ausgefallen, die Produktion steht. Keine Gefahr für Personen. Wenn nach einem Vertrag gefragt wird: SLA-2022-340. Antworte kurz.",
    // Always outside the service hours, independent of the time of the run
    fixed: { servicezeit: JSON.stringify({ ok: true, heute: "2026-10-15", jetzt: "Donnerstag, der 15. Oktober, um 21:30 Uhr", in_servicezeit: false, naechste_servicezeit: "Freitag, der 16. Oktober, um 7 Uhr" }) },
    tools: { sla_pruefen: { vertragsnummer: "SLA-2022-340", plz: "68159" }, rueckruf_service_desk: { grund: "Simulation", rueckrufnummer: "0621 4440001", dringend: true } },
    must: ["sla_pruefen", "rueckruf_service_desk"], never: ["freie_termine"],
  },
};

const always = { servicezeit: await real("servicezeit", {}), einsatzgebiet_pruefen: await real("einsatzgebiet_pruefen", { plz: "68159" }) };
for (const [name, scenario] of Object.entries(SCENARIOS)) {
  if (only && only !== name) continue;
  const mocks = { ...always, ...scenario.fixed };
  for (const [tool, body] of Object.entries(scenario.tools)) mocks[tool] = body === null ? CREATED : await real(tool, body);
  const response = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agent_id}/simulate-conversation`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      simulation_specification: {
        simulated_user_config: { language: "de", prompt: { prompt: scenario.caller, llm: "gpt-4.1-mini" } },
        // The platform sets the conversation id only in real conversations
        dynamic_variables: { system__conversation_id: `sim-${name}-${Date.now().toString(36)}` },
        tool_mock_config: Object.fromEntries(Object.entries(mocks).map(([tool, value]) => [tool, { default_return_value: value, default_is_error: false }])),
      },
      new_turns_limit: 30,
    }),
  });
  const data = await response.json();
  console.log(`\n=== ${name} ===`);
  if (!response.ok) { console.log(JSON.stringify(data).slice(0, 600)); failures += 1; continue; }
  const called = new Set();
  const badParams = [];
  for (const turn of data.simulated_conversation) {
    for (const call of turn.tool_calls ?? []) {
      called.add(call.tool_name);
      console.log(`  → ${call.tool_name} ${call.params_as_json}`);
      const expect = scenario.params?.[call.tool_name];
      if (expect && !expect(JSON.parse(call.params_as_json))) badParams.push(call.tool_name);
    }
    if (turn.message) console.log(`${turn.role === "agent" ? "Mira" : "Anrufer"}: ${turn.message}`);
  }
  const missing = scenario.must.filter((tool) => !called.has(tool));
  const wrong = scenario.never.filter((tool) => called.has(tool));
  const ok = missing.length === 0 && wrong.length === 0 && badParams.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}: Werkzeuge ${[...called].join(", ")}${missing.length ? ` · fehlt: ${missing.join(", ")}` : ""}${wrong.length ? ` · unerwartet: ${wrong.join(", ")}` : ""}${badParams.length ? ` · Parameter falsch: ${badParams.join(", ")}` : ""}`);
}
console.log(`\n${failures === 0 ? "Alle Szenarien wie erwartet." : `${failures} Szenario(s) mit Abweichung.`}`);
process.exit(failures === 0 ? 0 : 1);
