// Text simulation of the test scenarios with the real agent in ElevenLabs (task-13-5, extended to the test protocol
// docs/telefonassistent/testprotokoll.md in task-13-8). The simulation endpoint does not
// call webhooks, so each tool is mocked with the answer our real webhook gives for the scenario (fetched first from
// local n8n); anfrage_anlegen gets a fixed answer, so no request and no e-mail is created. Checks which tools Mira
// calls and which she must not call, checks parameters and, where given, what she says. Situations the database cannot
// produce on demand (no free window, overdue visit, broken tool, night) use fixed answers in the format of the real
// webhook. Usage: npm run agent:simulate [-- <szenario>]
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

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
const night = JSON.stringify({ ok: true, heute: "2026-10-15", jetzt: "Donnerstag, der 15. Oktober, um 21:30 Uhr", in_servicezeit: false, naechste_servicezeit: "Freitag, der 16. Oktober, um 7 Uhr" });
const day = JSON.stringify({ ok: true, heute: "2026-10-15", jetzt: "Donnerstag, der 15. Oktober, um 10:30 Uhr", in_servicezeit: true });
const CALLBACK = JSON.stringify({ ok: true, in_servicezeit: true });
// Demo transfer (task-13-11), format of agent_forward
const FORWARD = JSON.stringify({ ok: true, demo: true, verbunden: false, ansage: "Dies ist ein Demo-Projekt. In einem echten Betrieb würde ich Sie jetzt mit unserem Service Desk verbinden. Hier ist niemand erreichbar, deshalb nehme ich gern einen Rückruf für Sie auf." });
const FORWARD_STANDBY = FORWARD.replace("unserem Service Desk", "unserem Bereitschaftsdienst");
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
    caller: "Du bist Anna Schulz von der Neckar Pumpenwerk GmbH, Industriestraße 5, 68219 Mannheim, Telefon 0621 5550123, E-Mail a.schulz@npw.de (buchstabiere sie, wenn du gefragt wirst: A, Punkt, S, C, H, U, L, Z, at N, P, W, Punkt, D, E). Deine Grundfos-Pumpe CR 32 leckt an der Gleitringdichtung, kein Stillstand, keine Gefahr, zeitnah. Ihr seid Neukunden ohne Kundennummer. Du möchtest einen Termin in den nächsten Tagen und nimmst den ersten Vorschlag. Antworte kurz und bestätige Zusammenfassungen.",
    tools: { anlage_pruefen: { anlagenart: "Pumpe", hersteller: "Grundfos", typ: "CR 32" }, einsatzgebiet_pruefen: { plz: "68219" }, freie_termine: { leistung: "diagnosis_repair", plz: "68219" },
      email_pruefen: { buchstaben: "A, Punkt, S, C, H, U, L, Z, at N, P, W, Punkt, D, E" }, kunde_finden: { kundennummer: "K-99999", plz: "68219" }, anfrage_anlegen: null },
    must: ["anlage_pruefen", "einsatzgebiet_pruefen", "email_pruefen", "freie_termine", "anfrage_anlegen"], never: ["rueckruf_service_desk"],
    // Street asked, e-mail taken from email_pruefen
    params: { anfrage_anlegen: (p) => /Industriestra(ß|ss)e 5/.test(p.street_house_number ?? "") && p.business_email === "a.schulz@npw.de" },
  },
  // Existing customer (task-13-10): demo contract customer K-10000, site 69115; no address or e-mail questions
  bestand: {
    caller: "Du bist Herr Braun von der Neckartal Brauerei. Dein Kompressor von Kaeser, Typ SM 13, schaltet mit Fehlermeldung ab, keine Gefahr, kein Stillstand. Du bist Kunde, Kundennummer K-10000, der Standort hat die Postleitzahl 69115. Rückrufnummer 06221 555000. Du möchtest einen Termin in den nächsten Tagen und nimmst den ersten Vorschlag. Antworte kurz und bestätige Zusammenfassungen.",
    tools: { anlage_pruefen: { anlagenart: "Kompressor", hersteller: "Kaeser", typ: "SM 13" }, kunde_finden: { kundennummer: "K-10000", plz: "69115" },
      freie_termine: { leistung: "diagnosis_repair", plz: "69115" }, anfrage_anlegen: null },
    must: ["kunde_finden", "freie_termine", "anfrage_anlegen"], never: ["email_pruefen", "einsatzgebiet_pruefen"],
  },
  notfall: {
    caller: "Du bist Herr Krämer von der Rheinhafen Logistikzentrum GmbH & Co. KG, Hafenstraße 12, 68159 Mannheim, Rückrufnummer 0621 4440001. Dein Kompressor ist ausgefallen, die Produktion steht. Keine Gefahr für Personen. Wenn nach einem Vertrag gefragt wird: SLA-2022-340. Antworte kurz.",
    // Always outside the service hours, independent of the time of the run
    fixed: { servicezeit: JSON.stringify({ ok: true, heute: "2026-10-15", jetzt: "Donnerstag, der 15. Oktober, um 21:30 Uhr", in_servicezeit: false, naechste_servicezeit: "Freitag, der 16. Oktober, um 7 Uhr" }), weiterleiten: FORWARD_STANDBY },
    tools: { sla_pruefen: { vertragsnummer: "SLA-2022-340", plz: "68159" }, rueckruf_service_desk: { grund: "Simulation", rueckrufnummer: "0621 4440001", dringend: true } },
    must: ["sla_pruefen", "weiterleiten", "rueckruf_service_desk"], never: ["freie_termine"],
    params: { weiterleiten: (p) => p.ziel === "bereitschaft" },
    says: /Demo-Projekt/,
  },
  // Scenario 2: the wished day is fully booked (no window): request without a hold, no invented date
  ausgebucht: {
    caller: "Du bist Petra Hahn von der Rhein-Neckar Logistik GmbH, Hafenstraße 3, 68159 Mannheim, Telefon 0621 3330001, E-Mail p.hahn@rnl.de (buchstabiere sie, wenn du gefragt wirst: P, Punkt, H, A, H, N, at R, N, L, Punkt, D, E). Eure Pumpe von Grundfos, Typ CR 32, braucht eine Inspektion, planbar. Ihr seid Neukunden. Du willst unbedingt nächste Woche Mittwoch. Antworte kurz und bestätige Zusammenfassungen.",
    // Without dates: a static answer with the first asked day contradicts every later search (run 19.10.2026)
    fixed: { freie_termine: JSON.stringify({ ok: true, fenster: [] }) },
    tools: { anlage_pruefen: { anlagenart: "Pumpe", hersteller: "Grundfos", typ: "CR 32" }, einsatzgebiet_pruefen: { plz: "68159" },
      email_pruefen: { buchstaben: "P, Punkt, H, A, H, N, at R, N, L, Punkt, D, E" }, anfrage_anlegen: null },
    must: ["freie_termine", "anfrage_anlegen"], never: ["rueckruf_service_desk"],
    params: { anfrage_anlegen: (p) => !p.termin_beginn },
  },
  // Scenario 3: the caller first takes a window and then changes to the second one (interrupting is voice only)
  umbuchen: {
    caller: "Du bist Jonas Keller von der Kraichgau Kunststoff GmbH, Industriering 8, 68723 Schwetzingen, Telefon 06202 777001, E-Mail j.keller@kks.de (buchstabiere sie, wenn du gefragt wirst: J, Punkt, K, E, L, L, E, R, at K, K, S, Punkt, D, E). Euer Kompressor von Kaeser, Typ SM 13, braucht eine Wartung, planbar. Ihr seid Neukunden. Nimm zuerst den ersten Terminvorschlag, sag dann aber sofort: Moment, der zweite passt doch besser. Antworte kurz und bestätige Zusammenfassungen.",
    tools: { anlage_pruefen: { anlagenart: "Kompressor", hersteller: "Kaeser", typ: "SM 13" }, einsatzgebiet_pruefen: { plz: "68723" },
      freie_termine: { leistung: "scheduled_maintenance", plz: "68723" }, email_pruefen: { buchstaben: "J, Punkt, K, E, L, L, E, R, at K, K, S, Punkt, D, E" }, anfrage_anlegen: null },
    must: ["freie_termine", "anfrage_anlegen"], never: ["rueckruf_service_desk"],
    // Mira offers two of the windows; which one is "the second" depends on her choice, so any offered window counts
    // (the transcript shows the change, run 19.10.2026: second offered window booked)
    params: { anfrage_anlegen: (p, mocks) => (JSON.parse(mocks.freie_termine).fenster ?? []).some((f) => f.beginn === p.termin_beginn) },
  },
  // Scenario 5: status by company and postal code, without a request number
  status_firma: {
    caller: "Du bist Frau Roth von der Neckarauer Metallverarbeitung GmbH & Co. KG. Du kennst keine Anfragenummer. Der Standort hat die Postleitzahl 68199, Straße Rheingoldstraße 20. Du fragst, wann der Techniker kommt. Antworte kurz und bestätige den Standort.",
    fixed: { anfrage_finden: JSON.stringify({ ok: true, treffer: 1, anfrage_id: "00000000-0000-0000-0000-000000000001", anfrage_nummer: "RIS-2026-01152", standort: "Kompressor, Rheingoldstraße 20, Mannheim", lage: "geplant", termin_ansage: "Donnerstag, der 22. Oktober, um 9 Uhr" }) },
    tools: {},
    must: ["anfrage_finden"], never: ["anfrage_anlegen", "rueckrufbitte_techniker"],
    params: { anfrage_finden: (p) => Boolean(p.firma) && !p.nummer && p.plz === "68199" },
    says: /22\.Oktober|zweiundzwanzigsten?Oktober/i,
  },
  // Scenario 6: the technician is late; Mira asks the technician to call back (escalation: test:db, test:ui)
  verspaetung: {
    caller: "Du bist Herr Vogel von der Hardt Getränke AG, Anfragenummer RIS-2026-01137, Standort-PLZ 68723. Der Techniker sollte vor einer Stunde da sein und ist nicht gekommen. Rückrufnummer 06202 888002. Antworte kurz und bestätige Rückfragen.",
    fixed: {
      anfrage_finden: JSON.stringify({ ok: true, treffer: 1, anfrage_id: "00000000-0000-0000-0000-000000000002", anfrage_nummer: "RIS-2026-01137", standort: "Pumpe, Hockenheimer Straße 4, Schwetzingen", lage: "ueberfaellig", termin_ansage: "heute um 9 Uhr" }),
      rueckrufbitte_techniker: JSON.stringify({ ok: true, bereits_offen: false }),
    },
    tools: {},
    must: ["anfrage_finden", "rueckrufbitte_techniker"], never: ["anfrage_anlegen"],
    params: { rueckrufbitte_techniker: (p) => p.anfrage_id === "00000000-0000-0000-0000-000000000002" && /888 ?002/.test(p.rueckrufnummer ?? "") },
  },
  // Scenario 7: price question, answered from the knowledge without collecting data
  preis: {
    caller: "Du fragst nur, was eine Inspektion eines Kompressors bei RheinWerk kostet und was die Anfahrt kostet. Du willst noch keinen Auftrag geben. Antworte kurz.",
    tools: {},
    must: [], never: ["anfrage_anlegen", "freie_termine", "rueckruf_service_desk"],
    // Prices are spoken as words for the speech synthesis
    says: /290|zweihundertneunzig/i,
  },
  // Scenario 8: production stop during the service hours: urgent callback by the service desk
  stillstand_tag: {
    caller: "Du bist Herr Lang von der Pfälzer Gießerei GmbH, Gießereistraße 2, 67059 Ludwigshafen, Rückrufnummer 0621 5554443. Euer Kompressor ist ausgefallen, die Produktion steht. Keine Gefahr für Personen. Einen Vertrag kennst du nicht. Antworte kurz.",
    fixed: { servicezeit: day, rueckruf_service_desk: CALLBACK },
    tools: {},
    must: ["weiterleiten", "rueckruf_service_desk"], never: ["freie_termine"],
    params: { weiterleiten: (p) => p.ziel === "service_desk", rueckruf_service_desk: (p) => p.dringend === true && /555 ?4443/.test(p.rueckrufnummer ?? "") },
    says: /Demo-Projekt/,
  },
  // Scenario 9 without SLA: at night an urgent request without appointment, checked from 07:00
  notfall_ohne_sla: {
    caller: "Du bist Frau Engel von der Odenwald Papier GmbH, Mühlweg 7, 69469 Weinheim, Telefon 06201 444555, E-Mail m.engel@owp.de (buchstabiere sie, wenn du gefragt wirst: M, Punkt, E, N, G, E, L, at O, W, P, Punkt, D, E). Eure Pumpe von KSB ist ausgefallen, die Produktion steht. Keine Gefahr für Personen. Ihr habt keinen Servicevertrag und keine Kundennummer, ihr seid Neukunden. Antworte kurz und bestätige Zusammenfassungen.",
    fixed: { servicezeit: night, rueckruf_service_desk: CALLBACK },
    tools: { einsatzgebiet_pruefen: { plz: "69469" }, anlage_pruefen: { anlagenart: "Pumpe", hersteller: "KSB" }, email_pruefen: { buchstaben: "M, Punkt, E, N, G, E, L, at O, W, P, Punkt, D, E" }, anfrage_anlegen: null },
    must: ["anfrage_anlegen"], never: ["freie_termine", "sla_pruefen", "weiterleiten", "rueckruf_service_desk"],
    params: { anfrage_anlegen: (p) => p.customer_urgency === "production_stop" && !p.termin_beginn },
  },
  // Scenario 10: site outside the service area, no request
  gebiet: {
    caller: "Du bist Herr Brandt von der Spree Logistik GmbH, Invalidenstraße 10, 10115 Berlin. Eure Grundfos-Pumpe CR 32 braucht eine Reparatur. Einen Vertrag mit RheinWerk habt ihr nicht, ihr seid Neukunden. Antworte kurz.",
    tools: { einsatzgebiet_pruefen: { plz: "10115" } },
    must: ["einsatzgebiet_pruefen"], never: ["anfrage_anlegen", "freie_termine"],
  },
  // Scenario 11: angry caller with a complaint: no discussion, callback by a human
  beschwerde: {
    caller: "Du bist sehr verärgert, Herr Schuster von der Kurpfalz Präzisionsteile KG, Rückrufnummer 0621 9998887. Die letzte Rechnung ist viel zu hoch und der Techniker war unfreundlich. Du willst sofort mit einem Menschen sprechen. Sprich gereizt, aber ohne Beleidigungen.",
    fixed: { servicezeit: day, rueckruf_service_desk: CALLBACK },
    tools: {},
    must: ["weiterleiten", "rueckruf_service_desk"], never: ["anfrage_anlegen", "freie_termine"],
    says: /Demo-Projekt/,
  },
  // Scenario 12: a tool fails: Mira says so and offers a callback instead of guessing
  stoerung: {
    caller: "Du bist Herr Wolf von der Lindenhof Brauerei GmbH, Anfragenummer RIS-2026-01143, Standort-PLZ 68219. Du fragst nach dem Stand deiner Anfrage. Wenn ein Rückruf angeboten wird, nimm ihn an, Rückrufnummer 0621 1112223. Antworte kurz.",
    fixed: { servicezeit: day, anfrage_finden: JSON.stringify({ ok: false, fehler: "werkzeug_gestoert" }), rueckruf_service_desk: CALLBACK },
    tools: {},
    must: ["anfrage_finden", "rueckruf_service_desk"], never: ["anfrage_anlegen"],
  },
  // Scenario 14: advertising call: no data, polite end
  spam: {
    caller: "Du bist Verkäufer und willst RheinWerk günstige Energieverträge und Werbeanzeigen verkaufen. Du hast kein Serviceanliegen. Wenn abgelehnt wird, verabschiede dich.",
    tools: {},
    must: ["end_call"], never: ["anfrage_anlegen", "rueckruf_service_desk", "freie_termine", "weiterleiten"],
  },
};

// Defaults for tools a scenario does not prepare: the simulation answers unmocked tools with an error, and the
// simulated caller sometimes invents a type or a customer number (run 19.10.2026)
const always = {
  servicezeit: await real("servicezeit", {}), einsatzgebiet_pruefen: await real("einsatzgebiet_pruefen", { plz: "68159" }),
  anlage_pruefen: await real("anlage_pruefen", { anlagenart: "Pumpe", hersteller: "Grundfos", typ: "CR 32" }),
  kunde_finden: await real("kunde_finden", { kundennummer: "K-99999", plz: "68159" }),
  weiterleiten: FORWARD,
};
// The real webhooks record the preparation as call "sim-vorab" (e.g. an urgent service desk callback): removed at the
// end, so it never shows up as a dashboard notification
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
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
      if (expect && !expect(JSON.parse(call.params_as_json), mocks)) badParams.push(call.tool_name);
    }
    if (turn.message) console.log(`${turn.role === "agent" ? "Mira" : "Anrufer"}: ${turn.message}`);
  }
  const missing = scenario.must.filter((tool) => !called.has(tool));
  // The platform splits streamed words with spaces ("zwe ihundertneunzig"), so text checks ignore white space
  const said = data.simulated_conversation.filter((turn) => turn.role === "agent").map((turn) => turn.message ?? "").join("").replace(/\s+/g, "");
  if (scenario.says && !scenario.says.test(said)) badParams.push(`Aussage ${scenario.says}`);
  const wrong = scenario.never.filter((tool) => called.has(tool));
  const ok = missing.length === 0 && wrong.length === 0 && badParams.length === 0;
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${name}: Werkzeuge ${[...called].join(", ")}${missing.length ? ` · fehlt: ${missing.join(", ")}` : ""}${wrong.length ? ` · unerwartet: ${wrong.join(", ")}` : ""}${badParams.length ? ` · Parameter falsch: ${badParams.join(", ")}` : ""}`);
}
await admin.from("phone_calls").delete().eq("conversation_id", "sim-vorab");
console.log(`\n${failures === 0 ? "Alle Szenarien wie erwartet." : `${failures} Szenario(s) mit Abweichung.`}`);
process.exit(failures === 0 ? 0 : 1);
