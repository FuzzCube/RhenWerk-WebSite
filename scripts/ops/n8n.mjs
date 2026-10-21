// Checks of n8n for the watchdog (task-17-8): reachable, RheinWerk workflows active, schedules running, e-mail and
// analysis queues, warnings of the error workflow. Only through the n8n API and the database, never through
// ~/n8n/data/database.sqlite (n8n hung for two hours on 20.10.2026 after such an access). collectN8n gathers the raw
// answers, evaluateN8n turns them into checks (pure, unit tests in tests/unit/n8n-monitor.test.mjs).
//   N8N_API_KEY (n8n → Settings → n8n API; without it only healthz and queues), N8N_API_URL (default
//   http://127.0.0.1:5678), ELEVENLABS_API_KEY (without it the two workflows of Mira are not expected)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export const ERROR_WORKFLOW = "rwFehlerMeldung1";
const MIRA_WORKFLOWS = ["rwAgentTools2026", "rwCallAnalysis26"];
// Scheduled workflows that save their executions, with the longest acceptable gap between two runs in minutes
export const SCHEDULES = { IlH4b7AKuSXyMiOd: 10, wO3EgSMM8l1wRKsc: 10, rGQGvOLDJUuHt4bO: 30 };
// A warning of the error workflow closes after this long without a new failed execution
export const ERROR_QUIET_MINUTES = 60;
// Right after a start /healthz answers before the API is registered (HTTP 404, Gesamtprobe task-17-11): API errors
// in this time are skipped instead of reported as a rejected key
export const STARTUP_MINUTES = 3;

// Start of the container (docker inspect), null if unknown
export function containerStartedAt(env) {
  try {
    return execFileSync("docker", ["inspect", "-f", "{{.State.StartedAt}}", env.N8N_CONTAINER ?? "n8n"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
  } catch {
    return null;
  }
}

// The RheinWerk workflows as exported in the repository, including the error workflow (n8n 2.x calls it only while it
// is published); other workflows of the same n8n are not watched
export function expectedWorkflows(miraConfigured) {
  const dir = new URL("../../n8n/workflows/", import.meta.url);
  return readdirSync(dir).filter((file) => file.endsWith(".workflow.json"))
    .map((file) => JSON.parse(readFileSync(new URL(file, dir), "utf8")))
    .filter((workflow) => miraConfigured || !MIRA_WORKFLOWS.includes(workflow.id))
    .map((workflow) => ({ id: workflow.id, name: workflow.name }));
}

async function request(url, headers = {}) {
  try {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    let json = null;
    try { json = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, error: error.cause?.code ?? error.name ?? "Fehler" };
  }
}

export async function collectN8n(env, rpc) {
  const base = env.N8N_API_URL ?? "http://127.0.0.1:5678";
  const health = await request(`${base}/healthz`);
  const queues = await rpc("monitor_n8n_queues");
  const openErrors = (await rpc("open_alerts", { key_prefix: "n8n:fehler:" })) ?? [];
  if (health.status !== 200) return { health, queues, openErrors };
  if (!env.N8N_API_KEY) return { health, queues, openErrors, api: { status: null } };

  const headers = { "X-N8N-API-KEY": env.N8N_API_KEY };
  const probe = await request(`${base}/api/v1/workflows?limit=1`, headers);
  if (probe.status !== 200) return { health, queues, openErrors, api: { status: probe.status, error: probe.error }, startedAt: containerStartedAt(env) };

  const expected = expectedWorkflows(Boolean(env.ELEVENLABS_API_KEY));
  const workflows = await Promise.all(expected.map(async (workflow) => {
    const live = await request(`${base}/api/v1/workflows/${workflow.id}`, headers);
    return { ...workflow, status: live.status, active: live.json?.active ?? null };
  }));
  const latest = async (query) => (await request(`${base}/api/v1/executions?limit=1&${query}`, headers)).json?.data?.[0]?.startedAt ?? null;
  const schedules = await Promise.all(Object.entries(SCHEDULES).map(async ([id, maxGap]) => ({
    id, name: expected.find((workflow) => workflow.id === id)?.name ?? id, maxGap, lastRun: await latest(`workflowId=${id}`),
  })));
  const errors = await Promise.all(openErrors.map(async (alert) => {
    const id = alert.alert_key.slice("n8n:fehler:".length);
    return { key: alert.alert_key, title: alert.title, lastError: await latest(`workflowId=${id}&status=error`) };
  }));
  return { health, queues, openErrors, api: { status: 200 }, workflows, schedules, errors };
}

const check = (key, label, ok, severity = "warning", title = "", detail = "") => ({ key, label, ok, severity, title, detail });
const minutesSince = (iso, now) => (now.getTime() - Date.parse(iso)) / 60_000;

export function evaluateN8n(raw, now = new Date()) {
  const checks = [];
  if (raw.health.status !== 200) {
    checks.push(check("n8n:down", "n8n erreichbar", false, "critical", "Automatisierung: n8n nicht erreichbar",
      `n8n antwortet nicht (${raw.health.status ? `HTTP ${raw.health.status}` : raw.health.error}). Formulare, E-Mail-Versand, KI-Analysen und Mira stehen. Läuft der Container? docker ps, docker start n8n, docker logs n8n --since 30m.`));
  } else {
    checks.push(check("n8n:down", "n8n erreichbar", true));
    const api = raw.api ?? { status: null };
    if (api.status === null) {
      checks.push(check("n8n:api", "n8n-API", null, "warning", "", "N8N_API_KEY fehlt: Workflows und Zeitpläne nicht geprüft"));
    } else if (api.status !== 200 && raw.startedAt && minutesSince(raw.startedAt, now) < STARTUP_MINUTES) {
      checks.push(check("n8n:api", "n8n-API", null, "warning", "", "n8n startet gerade, API noch nicht bereit: Workflows und Zeitpläne beim nächsten Lauf"));
    } else if (api.status !== 200) {
      const rejected = api.status === 401 || api.status === 403;
      checks.push(check("n8n:api", "n8n-API", false, "warning", "Automatisierung: Wächter ohne Zugriff auf die n8n-API",
        rejected
          ? `Die n8n-API lehnt N8N_API_KEY ab (HTTP ${api.status}); aktive Workflows und Zeitpläne werden nicht geprüft. In n8n unter Settings → n8n API einen neuen Schlüssel anlegen und in .env.local eintragen.`
          : `Die n8n-API antwortet nicht wie erwartet (${api.status ? `HTTP ${api.status}` : api.error}); aktive Workflows und Zeitpläne werden nicht geprüft. Ist die öffentliche API abgeschaltet (N8N_PUBLIC_API_DISABLED)? docker logs n8n --since 30m.`));
    } else {
      checks.push(check("n8n:api", "n8n-API", true));
      for (const workflow of raw.workflows) {
        const key = `n8n:inaktiv:${workflow.id}`;
        if (workflow.status === 200 && workflow.active) { checks.push(check(key, `Workflow „${workflow.name}“`, true)); continue; }
        checks.push(check(key, `Workflow „${workflow.name}“`, false, "critical", `Automatisierung: „${workflow.name}“ ${workflow.status === 404 ? "fehlt in n8n" : "ist nicht aktiv"}`,
          workflow.status === 404
            ? `Den Workflow ${workflow.id} gibt es in n8n nicht. Aus n8n/workflows/ importieren (docs/n8n-workflows.md 7).`
            : `Der Workflow ${workflow.id} ist in n8n ausgeschaltet; seine Aufgaben bleiben liegen. In n8n öffnen und veröffentlichen (Schalter Active).`));
      }
      for (const schedule of raw.schedules) {
        const key = `n8n:zeitplan:${schedule.id}`;
        const late = !schedule.lastRun || minutesSince(schedule.lastRun, now) > schedule.maxGap;
        const inactive = raw.workflows.some((workflow) => workflow.id === schedule.id && !workflow.active);
        checks.push(late && !inactive
          ? check(key, `Zeitplan „${schedule.name}“`, false, "warning", `Automatisierung: „${schedule.name}“ läuft nicht mehr`,
            `Seit ${schedule.lastRun ? `${Math.round(minutesSince(schedule.lastRun, now))} Minuten` : "unbekannt"} kein Lauf, erwartet spätestens alle ${schedule.maxGap} Minuten. Meist hängt n8n (Logs „LockAcquireTimeoutError“): docker restart n8n (docs/betrieb.md 7).`)
          : check(key, `Zeitplan „${schedule.name}“`, inactive ? null : true));
      }
    }
  }

  const queues = raw.queues;
  if (!queues) {
    checks.push(check("n8n:versandstau", "E-Mail-Versand", null, "warning", "", "Datenbank nicht erreichbar, Prüfung übersprungen"));
    checks.push(check("n8n:analysestau", "KI-Analysen", null, "warning", "", "Datenbank nicht erreichbar, Prüfung übersprungen"));
  } else {
    checks.push(queues.send_waiting > 0
      ? check("n8n:versandstau", "E-Mail-Versand", false, "critical", "Automatisierung: E-Mail-Versand hängt",
        `${queues.send_waiting === 1 ? "1 freigegebene E-Mail wartet" : `${queues.send_waiting} freigegebene E-Mails warten`} seit ${queues.send_oldest} auf den Versand. Meist ist der Gmail-Zugang „RheinWerk Gmail“ in n8n abgelaufen: über https://n8n.rheinwerk-service.online → Credentials → Reconnect (docs/betrieb.md 7).`)
      : check("n8n:versandstau", "E-Mail-Versand", true));
    checks.push(queues.analysis_waiting > 0
      ? check("n8n:analysestau", "KI-Analysen", false, "warning", "Automatisierung: KI-Analysen bleiben liegen",
        `${queues.analysis_waiting === 1 ? "1 Anfrage wartet" : `${queues.analysis_waiting} Anfragen warten`} seit ${queues.analysis_oldest} auf die Analyse (Workflow „Anfrage analysieren“ alle 2 Minuten). OpenAI-Guthaben und -Schlüssel sowie die Executions des Workflows prüfen.`)
      : check("n8n:analysestau", "KI-Analysen", true));
  }

  // Warnings of the error workflow: closed after an hour without a new failed execution of that workflow (only with
  // API access); the others stay open and count for the state, but are not raised again here
  const quiet = new Set((raw.errors ?? [])
    .filter((error) => !error.lastError || minutesSince(error.lastError, now) > ERROR_QUIET_MINUTES).map((error) => error.key));
  for (const alert of raw.openErrors ?? []) {
    if (quiet.has(alert.alert_key)) checks.push(check(alert.alert_key, alert.title.replace(/ fehlgeschlagen$/, ""), true, alert.severity, alert.title));
  }
  const errors = (raw.openErrors ?? []).filter((alert) => !quiet.has(alert.alert_key)).map((alert) => ({ title: alert.title, severity: alert.severity }));

  const failed = [...checks.filter((c) => c.ok === false), ...errors];
  const state = failed.some((c) => c.severity === "critical") ? "critical" : failed.length ? "warning" : "ok";
  return { state, checks, errors };
}
