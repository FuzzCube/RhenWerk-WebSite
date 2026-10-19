// Latency of the phone assistant (task-13-8), in two parts:
// 1. Live conversations: metrics ElevenLabs stores per turn (time from the end of the caller's speech to Mira's first
//    audio, language model, speech synthesis, speech recognition) and the tool latency the platform measured.
//    Reading costs no credits.
// 2. Webhooks: N requests per read-only tool, locally and through the tunnel (AGENT_TUNNEL_URL, default
//    https://n8n.rheinwerk-service.online, with the Cloudflare Access service token). Tools that write (anfrage_anlegen,
//    rueckruf_*) are left out; the call rows of the measurement are removed at the end.
// Usage: npm run agent:latency [-- --runs 10] [-- --markdown]
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) || 10;
const markdown = args.includes("--markdown");
const apiKey = process.env.ELEVENLABS_API_KEY;
const secret = process.env.AGENT_WEBHOOK_SECRET;
const { agent_id: agentId } = JSON.parse(await readFile(new URL("../docs/telefonassistent/elevenlabs.json", import.meta.url), "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const runId = Date.now().toString(36);

const quantile = (values, q) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
};
const ms = (value) => (value === null ? "–" : `${Math.round(value)} ms`);
const rows = [];
const row = (group, label, values) => rows.push({ group, label, n: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95), max: values.length ? Math.max(...values) : null });

// 1 Live conversations
const METRICS = {
  convai_ttf_audio_since_silence: "Antwortzeit (Ende der Rede bis erstes Audio)",
  convai_llm_service_ttfb: "Sprachmodell bis erstes Token",
  convai_llm_service_ttf_sentence: "Sprachmodell bis erster Satz",
  convai_tts_service_ttfb: "Sprachsynthese bis erstes Audio",
  convai_asr_trailing_service_latency: "Spracherkennung nach Redeende",
};
const live = Object.fromEntries(Object.keys(METRICS).map((key) => [key, []]));
const tools = {};
let conversations = 0;
if (apiKey) {
  const headers = { "xi-api-key": apiKey };
  let cursor = null;
  const ids = [];
  do {
    const page = await (await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${agentId}&page_size=100${cursor ? `&cursor=${cursor}` : ""}`, { headers })).json();
    ids.push(...(page.conversations ?? []).filter((c) => c.status === "done").map((c) => c.conversation_id));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  for (const id of ids) {
    const detail = await (await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, { headers })).json();
    conversations += 1;
    for (const turn of detail.transcript ?? []) {
      for (const [key, metric] of Object.entries(turn.conversation_turn_metrics?.metrics ?? {})) {
        if (key in live && Number.isFinite(metric?.elapsed_time)) live[key].push(metric.elapsed_time * 1000);
      }
      for (const result of turn.tool_results ?? []) {
        if (result.tool_name && Number.isFinite(result.tool_latency_secs)) (tools[result.tool_name] ??= []).push(result.tool_latency_secs * 1000);
      }
    }
  }
  for (const [key, label] of Object.entries(METRICS)) row(`Live-Gespräche (${conversations})`, label, live[key]);
  for (const [tool, values] of Object.entries(tools).sort()) row(`Live-Gespräche (${conversations})`, `Werkzeug ${tool} (gemessen von ElevenLabs)`, values);
}

// 2 Webhooks
const CASES = [
  ["servicezeit", () => ({ call_id: `latency-${runId}` })],
  ["einsatzgebiet-pruefen", () => ({ call_id: `latency-${runId}`, plz: "68159" })],
  ["anlage-pruefen", () => ({ anlagenart: "Kompressor", hersteller: "Kaeser", typ: "SM 13" })],
  ["sla-pruefen", () => ({ vertragsnummer: "SLA-0000-0", plz: "68159" })],
  ["freie-termine", () => ({ call_id: `latency-${runId}`, leistung: "inspection", plz: "68159" })],
  ["anfrage-finden", () => ({ call_id: `latency-${runId}`, nummer: "RIS 2026 1", plz: "00000" })],
  ["kunde-finden", () => ({ call_id: `latency-${runId}`, kundennummer: "K-10000", plz: "69115" })],
  ["email-pruefen", () => ({ call_id: `latency-${runId}`, buchstaben: "M, A, X, Punkt, M, U, S, T, E, R, @gmail.com" })],
];
const targets = [["lokal", "http://127.0.0.1:5678", {}]];
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  targets.push(["Tunnel", (process.env.AGENT_TUNNEL_URL ?? "https://n8n.rheinwerk-service.online").replace(/\/$/, ""),
    { "CF-Access-Client-Id": process.env.CF_ACCESS_CLIENT_ID, "CF-Access-Client-Secret": process.env.CF_ACCESS_CLIENT_SECRET }]);
}
let failed = 0;
try {
  if (secret) {
    for (const [name, base, access] of targets) {
      const all = [];
      for (const [tool, body] of CASES) {
        const values = [];
        for (let i = 0; i < runs; i += 1) {
          const started = performance.now();
          const response = await fetch(`${base}/webhook/agent-${tool}`, {
            method: "POST", headers: { "content-type": "application/json", "x-agent-secret": secret, ...access }, body: JSON.stringify(body()),
          }).catch(() => null);
          await response?.text();
          if (!response?.ok) failed += 1;
          else values.push(performance.now() - started);
        }
        all.push(...values);
        row(`Webhooks ${name} (${runs} je Werkzeug)`, tool, values);
      }
      row(`Webhooks ${name} (${runs} je Werkzeug)`, "alle Werkzeuge", all);
    }
  }
} finally {
  await admin.from("phone_calls").delete().like("conversation_id", `latency-${runId}`);
}

if (markdown) {
  let group = null;
  for (const r of rows) {
    if (r.group !== group) {
      group = r.group;
      console.log(`\n**${group}**\n\n| Messgröße | n | p50 | p95 | max |\n| --- | ---: | ---: | ---: | ---: |`);
    }
    console.log(`| ${r.label} | ${r.n} | ${ms(r.p50)} | ${ms(r.p95)} | ${ms(r.max)} |`);
  }
} else {
  let group = null;
  for (const r of rows) {
    if (r.group !== group) console.log(`\n${(group = r.group)}`);
    console.log(`  ${r.label.padEnd(52)} n=${String(r.n).padStart(4)}  p50 ${ms(r.p50).padStart(8)}  p95 ${ms(r.p95).padStart(8)}  max ${ms(r.max).padStart(8)}`);
  }
}
if (!apiKey) console.log("\nELEVENLABS_API_KEY fehlt: Live-Gespräche nicht ausgewertet.");
if (!secret) console.log("\nAGENT_WEBHOOK_SECRET fehlt: Webhooks nicht gemessen.");
if (failed) console.log(`\n${failed} Webhook-Aufruf(e) fehlgeschlagen.`);
process.exit(failed ? 1 : 0);
