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
// Started by hand only (manual trigger, cannot be published): import of the assistant's knowledge base (task-18-10)
const MANUAL_WORKFLOWS = ["rwRagImport2026"];
// Scheduled workflows that save their executions, with the longest acceptable gap between two runs in minutes
export const SCHEDULES = { IlH4b7AKuSXyMiOd: 10, wO3EgSMM8l1wRKsc: 10, rGQGvOLDJUuHt4bO: 30 };
// A warning of the error workflow closes after this long without a new failed execution
export const ERROR_QUIET_MINUTES = 60;
export const GMAIL_ALERT_KEY = "n8n:gmail:zugang";
export const GMAIL_WORKFLOWS = ["IlH4b7AKuSXyMiOd", "rGQGvOLDJUuHt4bO"];
export const CONFIRM_CHECKS = 3;
const CHECK_INTERVAL_MS = 4 * 60_000;

// Only this shared credential is grouped. Other Gmail errors retain their workflow warning.
export function isGmailCredentialAlert(alert) {
  return GMAIL_WORKFLOWS.some((id) => alert.alert_key === `n8n:fehler:${id}`)
    && /The credential ["“]RheinWerk Gmail["”] needs to be reconnected\./.test(alert.detail ?? "");
}

const validDate = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

// Fetch several executions: a just-created execution can temporarily have no startedAt.
// An unsuccessful or malformed response must never become evidence of an outage or recovery.
export async function latestExecution(base, headers, query) {
  const response = await request(`${base}/api/v1/executions?limit=10&${query}`, headers);
  const rows = response.json?.data;
  if (response.status !== 200 || !Array.isArray(rows)) return { available: false, lastRun: null };
  const dated = rows.filter((row) => row && validDate(row.startedAt)).sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
  return { available: dated.length > 0, lastRun: dated[0]?.startedAt ?? null, execution: dated[0] ?? null };
}

// Successful workflow completion alone is insufficient: prove an authenticated Gmail node actually ran.
export function gmailAccessSucceeded(execution) {
  if (execution?.status !== "success") return false;
  const nodes = execution.workflowData?.nodes ?? [];
  const runs = execution.data?.resultData?.runData ?? {};
  return nodes.some((node) => node.credentials?.gmailOAuth2?.id === "rw46346a76655347"
    && node.parameters?.url === "https://gmail.googleapis.com/gmail/v1/users/me/profile"
    && (runs[node.name] ?? []).some((run) => run.executionStatus === "success" && !run.error
      && (run.data?.main ?? []).flat().some((item) => item?.json?.statusCode >= 200 && item.json.statusCode < 300
        && item.json.body?.emailAddress === "rheinwerk.industrieservice@gmail.com")));
}
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
    .filter((workflow) => !MANUAL_WORKFLOWS.includes(workflow.id) && (miraConfigured || !MIRA_WORKFLOWS.includes(workflow.id)))
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
  const openErrors = ((await rpc("open_alerts", { key_prefix: "n8n:" })) ?? [])
    .filter((alert) => alert.alert_key.startsWith("n8n:fehler:") || alert.alert_key === GMAIL_ALERT_KEY);
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
  const latest = (query) => latestExecution(base, headers, query);
  const schedules = await Promise.all(Object.entries(SCHEDULES).map(async ([id, maxGap]) => {
    const result = await latest(`workflowId=${id}`);
    return { id, name: expected.find((workflow) => workflow.id === id)?.name ?? id, maxGap,
      available: result.available, lastRun: result.lastRun };
  }));
  const errors = await Promise.all(openErrors.filter((alert) => alert.alert_key.startsWith("n8n:fehler:") && !isGmailCredentialAlert(alert)).map(async (alert) => {
    const id = alert.alert_key.slice("n8n:fehler:".length);
    const [failure, success] = await Promise.all([latest(`workflowId=${id}&status=error`), latest(`workflowId=${id}&status=success`)]);
    return { key: alert.alert_key, title: alert.title, available: failure.available && success.available,
      lastError: failure.lastRun, lastSuccess: success.lastRun };
  }));
  const gmailAlerts = openErrors.filter((alert) => isGmailCredentialAlert(alert) || alert.alert_key === GMAIL_ALERT_KEY);
  let gmail = null;
  if (gmailAlerts.length) {
    const since = Math.max(...gmailAlerts.map((alert) => Date.parse(alert.last_seen_at ?? alert.first_seen_at)));
    const access = await Promise.all(GMAIL_WORKFLOWS.map(async (id) => {
      const success = await latest(`workflowId=${id}&status=success`);
      if (!Number.isFinite(since) || !success.available || Date.parse(success.lastRun) <= since) return { id, verified: false };
      const detail = await request(`${base}/api/v1/executions/${encodeURIComponent(success.execution.id)}?includeData=true`, headers);
      return { id, verified: detail.status === 200 && gmailAccessSucceeded(detail.json), lastSuccess: success.lastRun };
    }));
    gmail = { recovered: access.every((item) => item.verified), access };
  }
  return { health, queues, openErrors, api: { status: 200 }, workflows, schedules, errors, gmail };
}

const check = (key, label, ok, severity = "warning", title = "", detail = "") => ({ key, label, ok, severity, title, detail });
const minutesSince = (iso, now) => (now.getTime() - Date.parse(iso)) / 60_000;

export function evaluateN8n(raw, now = new Date(), previous = {}) {
  const checks = [];
  const observations = { ...previous.schedule_observations };
  const gmailAlerts = (raw.openErrors ?? []).filter((alert) => isGmailCredentialAlert(alert) || alert.alert_key === GMAIL_ALERT_KEY);
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
        if ((workflow.status !== 200 && workflow.status !== 404) || (workflow.status === 200 && typeof workflow.active !== "boolean")) {
          checks.push(check(key, `Workflow „${workflow.name}“`, null, "warning", "", "Workflow-API nicht auswertbar; Zustand unverändert"));
          continue;
        }
        if (workflow.status === 200 && workflow.active) { checks.push(check(key, `Workflow „${workflow.name}“`, true)); continue; }
        checks.push(check(key, `Workflow „${workflow.name}“`, false, "critical", `Automatisierung: „${workflow.name}“ ${workflow.status === 404 ? "fehlt in n8n" : "ist nicht aktiv"}`,
          workflow.status === 404
            ? `Den Workflow ${workflow.id} gibt es in n8n nicht. Aus n8n/workflows/ importieren (docs/n8n-workflows.md 7).`
            : `Der Workflow ${workflow.id} ist in n8n ausgeschaltet; seine Aufgaben bleiben liegen. In n8n öffnen und veröffentlichen (Schalter Active).`));
      }
      for (const schedule of raw.schedules) {
        const key = `n8n:zeitplan:${schedule.id}`;
        const workflow = raw.workflows.find((item) => item.id === schedule.id);
        const available = schedule.available !== false && validDate(schedule.lastRun);
        const late = available && minutesSince(schedule.lastRun, now) > schedule.maxGap;
        const old = previous.schedule_observations?.[schedule.id];
        const age = old ? now.getTime() - Date.parse(old.counted_at) : Infinity;
        const recent = age >= 0 && age < 15 * 60_000;
        const counted = !recent || age >= CHECK_INTERVAL_MS;
        const counts = { late: late ? (recent ? old.late ?? 0 : 0) + (counted ? 1 : 0) : 0,
          unknown: !available ? (recent ? old.unknown ?? 0 : 0) + (counted ? 1 : 0) : 0,
          counted_at: counted ? now.toISOString() : old.counted_at };
        if (!workflow?.active || workflow.status !== 200) { counts.late = 0; counts.unknown = 0; }
        observations[schedule.id] = counts;
        const scheduleCheck = late
          ? check(key, `Zeitplan „${schedule.name}“`, counts.late >= CONFIRM_CHECKS ? false : null, "warning", `Automatisierung: „${schedule.name}“ läuft nicht mehr`,
            `Seit ${Math.round(minutesSince(schedule.lastRun, now))} Minuten kein Lauf, erwartet spätestens alle ${schedule.maxGap} Minuten. Durch ${CONFIRM_CHECKS} zeitlich getrennte Prüfungen bestätigt. Executions und Container-Logs prüfen (docs/betrieb.md 7).`)
          : check(key, `Zeitplan „${schedule.name}“`, available ? true : null, "warning", "", available ? "" : "Keine verlässlichen Ausführungsdaten; Prüfung unbekannt");
        if (!workflow?.active || workflow.status !== 200) scheduleCheck.ok = null;
        scheduleCheck.recoveryText = `${scheduleCheck.label} wird wieder ausgeführt. Dies bestätigt den Zeitplan; fachliche Fehler werden getrennt geprüft.`;
        // A running Gmail schedule is not an all-clear while its shared credential is broken.
        if (scheduleCheck.ok === true && gmailAlerts.length && GMAIL_WORKFLOWS.includes(schedule.id)) scheduleCheck.silent = true;
        checks.push(scheduleCheck);
      }
      const unknown = Object.values(observations).some((item) => item.unknown >= CONFIRM_CHECKS);
      const allKnown = raw.schedules.every((item) => item.available !== false && validDate(item.lastRun));
      checks.push(check("n8n:ausfuehrungsdaten", "Abruf der n8n-Ausführungen", unknown ? false : allKnown ? true : null, "warning",
        "Automatisierung: Ausführungen können nicht zuverlässig geprüft werden", "Seit drei Prüfungen fehlen verlässliche API-Daten. Dies belegt keinen Stillstand der Workflows; n8n-API und Logs prüfen."));
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

  // A shared Gmail credential gets one incident, with no repeated reminders. Legacy workflow
  // alerts remain recorded but are closed silently only after both authenticated paths recover.
  if (gmailAlerts.length) {
    const recovered = raw.gmail?.recovered === true && raw.api?.status === 200;
    const group = check(GMAIL_ALERT_KEY, "Gmail-Eingang und -Versand", recovered, "critical",
      "Automatisierung: Gmail-Zugang muss neu verbunden werden",
      "Der gemeinsame Zugang „RheinWerk Gmail“ ist ungültig. Gmail-Eingang und -Versand sind betroffen. Google Cloud → Google Auth Platform → Audience: In production; danach in n8n → Credentials → RheinWerk Gmail → Sign in with Google erneut verbinden. Entwarnung erst nach erfolgreichen Gmail-Aufrufen beider Workflows.");
    group.notifyOnce = true;
    group.adoptNotification = !gmailAlerts.some((alert) => alert.alert_key === GMAIL_ALERT_KEY)
      && gmailAlerts.some((alert) => alert.notified_at);
    group.recoverySubject = "Gmail-Eingang und -Versand";
    group.recoveryText = "Der Gmail-Zugang wurde durch erfolgreiche authentifizierte Gmail-Aufrufe im Eingangs- und Versandworkflow bestätigt.";
    if (recovered) {
      for (const alert of gmailAlerts.filter(isGmailCredentialAlert)) {
        checks.push({ ...check(alert.alert_key, alert.title, true), silent: true });
      }
    }
    checks.push(group);
  }

  // Unknown execution data cannot clear warnings. Other workflow incidents need both a
  // quiet hour and a successful execution newer than the actual alert, including trigger errors.
  const quiet = new Set((raw.errors ?? [])
    .filter((error) => {
      const alert = (raw.openErrors ?? []).find((item) => item.alert_key === error.key);
      const lastFailure = Math.max(Date.parse(error.lastError), Date.parse(alert?.last_seen_at ?? error.lastError));
      return error.available !== false && Number.isFinite(lastFailure) && validDate(error.lastSuccess)
        && now.getTime() - lastFailure > ERROR_QUIET_MINUTES * 60_000 && Date.parse(error.lastSuccess) > lastFailure;
    }).map((error) => error.key));
  for (const alert of raw.openErrors ?? []) {
    if (quiet.has(alert.alert_key)) checks.push(check(alert.alert_key, alert.title.replace(/ fehlgeschlagen$/, ""), true, alert.severity, alert.title));
  }
  const errors = (raw.openErrors ?? []).filter((alert) => !quiet.has(alert.alert_key)
    && alert.alert_key !== GMAIL_ALERT_KEY && !isGmailCredentialAlert(alert)).map((alert) => ({ title: alert.title, severity: alert.severity }));

  const failed = [...checks.filter((c) => c.ok === false), ...errors];
  const state = failed.some((c) => c.severity === "critical") ? "critical" : failed.length ? "warning" : "ok";
  if (raw.health.status !== 200 || raw.api?.status !== 200) {
    for (const id of Object.keys(observations)) delete observations[id];
  }
  return { state, checks, errors, schedule_observations: observations };
}
