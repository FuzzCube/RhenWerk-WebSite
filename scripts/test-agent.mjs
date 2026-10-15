// Webhooks of the voice agent Mira (task-13-5): every tool rejects calls without the shared secret, answers the
// contract of docs/telefonassistent/regeln.md and stays below the time limit.
// Usage: npm run test:agent                      (local n8n, http://127.0.0.1:5678)
//        AGENT_BASE_URL=https://… npm run test:agent   (public address through the tunnel; with CF_ACCESS_CLIENT_ID and
//        CF_ACCESS_CLIENT_SECRET for the Cloudflare Access service token)
// Requires AGENT_WEBHOOK_SECRET in .env.local (n8n/bootstrap_agent_secret.py). Creates no requests; the call rows of
// the test calls are removed at the end.
import { createClient } from "@supabase/supabase-js";

const base = (process.env.AGENT_BASE_URL ?? "http://127.0.0.1:5678").replace(/\/$/, "");
const secret = process.env.AGENT_WEBHOOK_SECRET;
const limitMs = Number(process.env.AGENT_LIMIT_MS ?? 1500);
if (!secret) {
  console.error("AGENT_WEBHOOK_SECRET fehlt in .env.local (python3 n8n/bootstrap_agent_secret.py).");
  process.exit(1);
}
const access = process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET
  ? { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET }
  : {};
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const runId = Date.now().toString(36);
const callId = `test-agent-${runId}`;
let failures = 0;

function check(name, ok, detail = "") {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` – ${detail}`}`);
  if (!ok) failures += 1;
}

async function call(tool, body, key = secret) {
  const started = performance.now();
  const response = await fetch(`${base}/webhook/agent-${tool}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...access, ...(key ? { "x-agent-secret": key } : {}) },
    body: JSON.stringify(body),
  });
  const ms = Math.round(performance.now() - started);
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: response.status, json, ms, text };
}

console.log(`Werkzeuge des Telefonassistenten gegen ${base}\n`);
try {
  const { data: demo } = await admin.from("requests").select("id, request_number, postal_code").eq("is_demo", true)
    .eq("work_status", "completed").order("created_at", { ascending: false }).limit(1).single();

  const cases = [
    ["einsatzgebiet-pruefen", { call_id: callId, plz: "68159" }, (j) => j.ergebnis === "in_gebiet" && j.ort === "Mannheim"],
    ["einsatzgebiet-pruefen", { call_id: callId, plz: "10115" }, (j) => j.ergebnis === "nur_mit_vertrag"],
    ["anlage-pruefen", { anlagenart: "Kompressor", hersteller: "Kaeser", typ: "SM 13" }, (j) => j.status === "listed_model" && j.satz === "Diese Anlage betreuen wir."],
    ["anlage-pruefen", { anlagenart: "Pumpe", hersteller: "Grundfos" }, (j) => j.status === "brand_only" && j.fehlende_angaben.includes("typ")],
    ["anlage-pruefen", { anlagenart: "Kälteanlage", hersteller: "Bitzer" }, (j) => j.status === "out_of_scope"],
    ["sla-pruefen", { vertragsnummer: "SLA-0000-0", plz: "68159" }, (j) => typeof j.status === "string"],
    ["freie-termine", { call_id: callId, leistung: "inspection", plz: "68159" }, (j) => j.ok === true && Array.isArray(j.fenster) && j.fenster.every((f) => f.beginn && f.ansage)],
    ["anfrage-finden", { call_id: callId, nummer: demo.request_number, plz: demo.postal_code }, (j) => j.treffer === 1 && j.lage === "abgeschlossen" && !("technician" in j)],
    ["anfrage-finden", { call_id: callId, nummer: "RIS 2026 1", plz: "00000" }, (j) => j.treffer === 0],
    ["anfrage-anlegen", { call_id: callId, company_name: "Test GmbH" }, (j) => j.ok === false && j.fehler === "fehlende_felder" && j.fehlende_felder.includes("description")],
    ["servicezeit", { call_id: callId }, (j) => j.ok === true && typeof j.in_servicezeit === "boolean" && /Uhr$/.test(j.jetzt)],
    ["rueckruf-service-desk", { call_id: callId, grund: "Test", rueckrufnummer: "12" }, (j) => j.ok === false && j.fehler === "rueckrufnummer_ungueltig"],
    ["rueckruf-service-desk", { call_id: callId, grund: "Test: Rückruf gewünscht", rueckrufnummer: "0621 123456", dringend: false }, (j) => j.ok === true && typeof j.in_servicezeit === "boolean"],
    ["rueckrufbitte-techniker", { call_id: callId, anfrage_id: demo.id, rueckrufnummer: "0621 123456" }, (j) => j.ok === false && j.fehler === "nicht_ueberfaellig"],
  ];
  const tools = [...new Set(cases.map(([tool]) => tool))];

  for (const tool of tools) {
    const none = await call(tool, {}, null);
    const wrong = await call(tool, {}, "falsch");
    check(`${tool}: ohne oder mit falschem Geheimnis abgewiesen`, [401, 403].includes(none.status) && [401, 403].includes(wrong.status) && !none.json && !wrong.json, `${none.status}/${wrong.status}`);
  }
  for (const [tool, body, expect] of cases) {
    const result = await call(tool, body);
    check(`${tool} ${JSON.stringify(body).slice(0, 70)} → ${result.ms} ms`, result.status === 200 && !!result.json && expect(result.json) && result.ms <= limitMs, `${result.status} ${result.ms} ms ${result.text.slice(0, 200)}`);
  }
  const broken = await call("anfrage-finden", { call_id: "" });
  check("Datenbankfehler wird als „werkzeug_gestoert“ gemeldet", broken.status === 200 && broken.json?.ok === false && broken.json.fehler === "werkzeug_gestoert", broken.text.slice(0, 200));
} catch (error) {
  console.error(error);
  failures += 1;
} finally {
  await admin.from("phone_calls").delete().like("conversation_id", "test-agent-%");
}

console.log(`\n${failures === 0 ? "Alle Werkzeug-Prüfungen bestanden." : `${failures} Prüfung(en) fehlgeschlagen.`}`);
process.exit(failures === 0 ? 0 : 1);
