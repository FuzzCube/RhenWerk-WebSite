// Checks of the phone assistant Mira for the watchdog (task-17-9): agent at ElevenLabs, credit, tool webhooks through
// the Cloudflare tunnel, overdue call analyses, frequent tool errors. collectMira gathers the raw answers,
// evaluateMira turns them into checks (pure, unit tests in tests/unit/mira-monitor.test.mjs).
//   ELEVENLABS_API_KEY (without it Mira counts as not set up: no checks, no warning), ELEVENLABS_AGENT_ID (default from
//   docs/telefonassistent/elevenlabs.json), AGENT_BASE_URL (default https://n8n.rheinwerk-service.online),
//   AGENT_WEBHOOK_SECRET, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET, MIRA_CREDIT_MIN (default 10 % of the plan)
import { readFileSync } from "node:fs";

const API = "https://api.elevenlabs.io";
const TOOL_ERROR_LIMIT = 3;
const TOOL_WINDOW_SECONDS = 3600;
// Pure catalogue lookup in n8n: no database, no call row
const PROBE = { path: "agent-anlage-pruefen", body: { anlagenart: "Kompressor", hersteller: "Kaeser", typ: "SM 13" } };

function agentId(env) {
  if (env.ELEVENLABS_AGENT_ID) return env.ELEVENLABS_AGENT_ID;
  try {
    return JSON.parse(readFileSync(new URL("../../docs/telefonassistent/elevenlabs.json", import.meta.url), "utf8")).agent_id ?? "";
  } catch {
    return "";
  }
}

async function request(url, options = {}) {
  try {
    const response = await fetch(url, { ...options, redirect: "manual", signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* HTML or plain text */ }
    return { status: response.status, json, text: text.slice(0, 500) };
  } catch (error) {
    return { status: 0, error: error.cause?.code ?? error.name ?? "Fehler" };
  }
}

// A tool result counts as failed when ElevenLabs marks it or n8n answered {ok: false}
export function isToolError(result) {
  if (result?.is_error) return true;
  try {
    return JSON.parse(result?.result_value ?? "").ok === false;
  } catch {
    return false;
  }
}

export async function collectMira(env, rpc) {
  const key = env.ELEVENLABS_API_KEY;
  if (!key) return { configured: false };
  const id = agentId(env);
  const headers = { "xi-api-key": key };
  const base = env.AGENT_BASE_URL ?? "https://n8n.rheinwerk-service.online";
  const since = Math.floor(Date.now() / 1000) - TOOL_WINDOW_SECONDS;

  const [agent, subscription, webhook, analysis, list] = await Promise.all([
    request(`${API}/v1/convai/agents/${id}`, { headers }),
    request(`${API}/v1/user/subscription`, { headers }),
    env.AGENT_WEBHOOK_SECRET
      ? request(`${base}/webhook/${PROBE.path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json", "x-agent-secret": env.AGENT_WEBHOOK_SECRET,
          "CF-Access-Client-Id": env.CF_ACCESS_CLIENT_ID ?? "", "CF-Access-Client-Secret": env.CF_ACCESS_CLIENT_SECRET ?? "",
        },
        body: JSON.stringify(PROBE.body),
      })
      : null,
    rpc("monitor_call_analysis"),
    request(`${API}/v1/convai/conversations?agent_id=${id}&page_size=30&call_start_after_unix=${since}`, { headers }),
  ]);

  // Tool results of the calls of the last hour (at most 30 calls a day, so only a few requests)
  let tools = null;
  if (list.status === 200) {
    const recent = (list.json?.conversations ?? []).filter((call) => call.start_time_unix_secs >= since);
    const details = await Promise.all(recent.map((call) => request(`${API}/v1/convai/conversations/${call.conversation_id}`, { headers })));
    const results = details.flatMap((detail) => (detail.json?.transcript ?? []).flatMap((turn) => turn.tool_results ?? []));
    tools = { calls: recent.length, results: results.length, failed: results.filter(isToolError).length };
  }

  return {
    configured: true,
    agentId: id,
    agent: { status: agent.status, error: agent.error, name: agent.json?.name },
    subscription: subscription.status === 200
      ? { status: 200, used: subscription.json.character_count, limit: subscription.json.character_limit, tier: subscription.json.tier, reset: subscription.json.next_character_count_reset_unix }
      : { status: subscription.status, error: subscription.error ?? subscription.json?.detail?.status },
    webhook: webhook && { status: webhook.status, ok: webhook.json?.ok, text: webhook.text, error: webhook.error },
    analysis,
    tools,
  };
}

const check = (key, label, ok, severity = "warning", title = "", detail = "") => ({ key, label, ok, severity, title, detail });

function agentCheck(agent, id) {
  const label = "Agent bei ElevenLabs";
  if (agent.status === 200) return check("mira:agent", label, true);
  if (agent.status === 401 || agent.status === 403) {
    return check("mira:agent", label, false, "critical", "Telefonassistent: Zugang zu ElevenLabs abgelehnt",
      "ElevenLabs lehnt ELEVENLABS_API_KEY ab (ungültig, gelöscht oder ohne Berechtigung „Agents: Read“). Schlüssel in ElevenLabs prüfen und in shared/.env.local sowie im n8n-Credential „RheinWerk ElevenLabs“ ersetzen.");
  }
  if (agent.status === 404) {
    return check("mira:agent", label, false, "critical", "Telefonassistent: Agent nicht gefunden",
      `Den Agenten ${id} gibt es bei ElevenLabs nicht (mehr). Agent-ID in docs/telefonassistent/elevenlabs.json bzw. ELEVENLABS_AGENT_ID prüfen.`);
  }
  return check("mira:agent", label, false, "warning", "Telefonassistent: ElevenLabs nicht erreichbar",
    `Abfrage des Agenten: ${agent.status ? `HTTP ${agent.status}` : agent.error}. Meist eine Störung bei ElevenLabs oder der Internetverbindung; status.elevenlabs.io prüfen.`);
}

function webhookCheck(webhook) {
  const label = "Werkzeuge über den Tunnel";
  if (!webhook) return check("mira:webhook", label, null, "warning", "", "AGENT_WEBHOOK_SECRET fehlt, Prüfung übersprungen");
  if (webhook.status === 200 && webhook.ok === true) return check("mira:webhook", label, true);
  const title = "Telefonassistent: Werkzeuge nicht erreichbar";
  // Cloudflare answers 401 (wrong secret) or 403 (no or unknown token) with its own error page
  if ((webhook.status === 401 || webhook.status === 403) && /Cloudflare Access/i.test(webhook.text ?? "")) {
    return check("mira:webhook", label, false, "critical", title,
      "Cloudflare Access lässt den Service Token nicht durch (abgelaufen, gelöscht oder Richtlinie „Service Auth“ geändert). Mira kann keine Termine, Anfragen oder Rückrufe anlegen. Zero Trust → Access → Service Tokens prüfen, CF_ACCESS_CLIENT_ID/SECRET in shared/.env.local und mit npm run agent:sync in ElevenLabs aktualisieren.");
  }
  if (webhook.status === 401 || webhook.status === 403) {
    return check("mira:webhook", label, false, "critical", title,
      "n8n lehnt das Werkzeug-Secret ab (x-agent-secret passt nicht zu Credential rwAgentSecret001). AGENT_WEBHOOK_SECRET in shared/.env.local, n8n und ElevenLabs angleichen (npm run agent:sync).");
  }
  if (webhook.status === 404) {
    return check("mira:webhook", label, false, "critical", title,
      "n8n kennt den Werkzeug-Webhook nicht: Workflow rwAgentTools2026 ist inaktiv oder wurde gelöscht. In n8n aktivieren.");
  }
  if (webhook.status === 200) {
    return check("mira:webhook", label, false, "warning", "Telefonassistent: Werkzeug meldet einen Fehler",
      `Die Probe agent-anlage-pruefen antwortet ohne ok: ${webhook.text}. n8n → Executions des Workflows rwAgentTools2026 prüfen.`);
  }
  return check("mira:webhook", label, false, "critical", title,
    `Tunnel oder n8n antworten nicht (${webhook.status ? `HTTP ${webhook.status}` : webhook.error}). Container n8n und den Cloudflare-Tunnel prüfen (docker ps).`);
}

function analysisCheck(analysis) {
  const label = "Gesprächsauswertung";
  if (!analysis) return check("mira:analysis", label, null, "warning", "", "Datenbank nicht erreichbar, Prüfung übersprungen");
  if (!analysis.stale) return check("mira:analysis", label, true);
  return check("mira:analysis", label, false, "warning", "Telefonassistent: Gesprächsauswertung hängt",
    `${analysis.stale === 1 ? "1 Gespräch ist" : `${analysis.stale} Gespräche sind`} 30 Minuten nach Ende noch nicht ausgewertet (ältestes seit ${analysis.oldest}). n8n → Workflow rwCallAnalysis26 (alle 2 Minuten) und dessen Executions prüfen.`);
}

function toolsCheck(tools) {
  const label = "Werkzeugaufrufe";
  if (!tools) return check("mira:tools", label, null, "warning", "", "Gespräche bei ElevenLabs nicht abrufbar, Prüfung übersprungen");
  if (tools.failed < TOOL_ERROR_LIMIT) return check("mira:tools", label, true, "warning", "", `${tools.failed} von ${tools.results} in der letzten Stunde fehlgeschlagen`);
  return check("mira:tools", label, false, "warning", "Telefonassistent: Werkzeugaufrufe schlagen fehl",
    `${tools.failed} von ${tools.results} Werkzeugaufrufen in ${tools.calls} Gesprächen der letzten Stunde sind fehlgeschlagen. n8n → Executions von rwAgentTools2026 und die Datenbank prüfen.`);
}

export function creditOf(subscription, creditMin) {
  if (subscription?.status !== 200 || !subscription.limit) return null;
  const remaining = Math.max(0, subscription.limit - subscription.used);
  const min = Number(creditMin) > 0 ? Number(creditMin) : Math.ceil(subscription.limit * 0.1);
  return {
    used: subscription.used, limit: subscription.limit, remaining, min, tier: subscription.tier,
    reset_at: subscription.reset ? new Date(subscription.reset * 1000).toISOString() : null,
  };
}

function creditCheck(subscription, credit) {
  const label = "Guthaben";
  if (!credit) {
    const reason = subscription?.error === "missing_permissions" ? "kein Zugriff (Berechtigung „User: Read“ fehlt)" : "nicht abrufbar";
    return check("mira:credit", label, null, "warning", "", `Guthaben ${reason}, Prüfung übersprungen`);
  }
  if (credit.remaining <= 0) {
    return check("mira:credit", label, false, "critical", "Telefonassistent: Guthaben aufgebraucht",
      `ElevenLabs-Guthaben aufgebraucht (${credit.used} von ${credit.limit} Credits, Tarif ${credit.tier}). Mira nimmt keine Gespräche mehr an. Guthaben aufladen oder Tarif wechseln; neues Kontingent ab ${credit.reset_at ?? "unbekannt"}.`);
  }
  if (credit.remaining < credit.min) {
    return check("mira:credit", label, false, "warning", "Telefonassistent: Guthaben niedrig",
      `Noch ${credit.remaining} von ${credit.limit} Credits (Schwellwert ${credit.min}, Tarif ${credit.tier}); neues Kontingent ab ${credit.reset_at ?? "unbekannt"}.`);
  }
  return check("mira:credit", label, true);
}

// Raw answers → checks, state for the dashboard (off, ok, warning, critical) and the credit
export function evaluateMira(raw, { creditMin } = {}) {
  if (!raw.configured) return { state: "off", checks: [], credit: null };
  const credit = creditOf(raw.subscription, creditMin);
  const checks = [agentCheck(raw.agent, raw.agentId), webhookCheck(raw.webhook), analysisCheck(raw.analysis), toolsCheck(raw.tools), creditCheck(raw.subscription, credit)];
  const failed = checks.filter((c) => c.ok === false);
  const state = failed.some((c) => c.severity === "critical") ? "critical" : failed.length ? "warning" : "ok";
  return { state, checks, credit };
}
