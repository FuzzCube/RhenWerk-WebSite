// Evaluation after the call (task-13-6): every finished conversation of the agent in ElevenLabs (latest 30) has an
// evaluated row in phone_calls with a valid category and summary, nothing is pending any more, and storing an
// evaluated conversation again changes nothing. Run while the workflow "RheinWerk · Telefonassistent Auswertung"
// is active and at least one cycle (2 minutes) has passed. Usage: npm run test:calls
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const { agent_id } = JSON.parse(await readFile(new URL("../docs/telefonassistent/elevenlabs.json", import.meta.url), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const CATEGORIES = ["neue_anfrage", "termin", "status", "verspaetung", "frage", "notfall", "beschwerde", "ausserhalb_gebiet", "spam", "sonstiges"];
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${ok || !detail ? "" : ` – ${detail}`}`);
  if (!ok) failures += 1;
};

const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agent_id}&page_size=30`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
const { conversations = [] } = await response.json();
const finished = conversations.filter((c) => c.status === "done" || c.status === "failed").map((c) => c.conversation_id);
check(`ElevenLabs: ${finished.length} beendete Gespräche`, response.ok && finished.length > 0, String(response.status));

const { data: pending, error: pendingError } = await admin.rpc("agent_calls_pending", { conversation_ids: finished });
check("Keine unausgewerteten Gespräche mehr", !pendingError && pending.ids.length === 0, JSON.stringify(pendingError ?? pending));

const { data: rows } = await admin.from("phone_calls").select("conversation_id, category, summary, duration_seconds, analyzed_at, analysis, transcript, started_at").in("conversation_id", finished);
const byId = new Map((rows ?? []).map((row) => [row.conversation_id, row]));
const bad = finished.filter((id) => {
  const row = byId.get(id);
  return !row || !row.analyzed_at || !CATEGORIES.includes(row.category) || !row.summary || !(row.duration_seconds >= 0) || !("termin_vorgemerkt" in (row.analysis ?? {}));
});
check("Jedes Gespräch mit Kategorie, Zusammenfassung, Dauer und Fakten aus der Datenbank", bad.length === 0, bad.join(", "));

const sample = byId.get(finished[0]);
if (sample) {
  const { data: again } = await admin.rpc("agent_record_call", { call_id: sample.conversation_id, started_at: sample.started_at, duration_seconds: 1, transcript: "geändert", analysis: { kategorie: "spam" } });
  const { data: after } = await admin.from("phone_calls").select("category, analyzed_at, duration_seconds").eq("conversation_id", sample.conversation_id).single();
  check("Wiederholung ändert nichts", again?.wiederholt === true && after.category === sample.category && after.analyzed_at === sample.analyzed_at && after.duration_seconds === sample.duration_seconds, JSON.stringify({ again, after }));
}

console.log(`\n${failures === 0 ? "Gesprächsauswertung geprüft." : `${failures} Prüfung(en) fehlgeschlagen.`}`);
process.exit(failures === 0 ? 0 : 1);
