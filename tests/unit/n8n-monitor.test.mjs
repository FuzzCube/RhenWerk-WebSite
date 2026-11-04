// Unit tests for the checks of n8n in the watchdog (task-17-8): raw answers → checks and state.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { ERROR_WORKFLOW, GMAIL_ALERT_KEY, collectN8n, evaluateN8n, expectedWorkflows, gmailAccessSucceeded, latestExecution } from "../../scripts/ops/n8n.mjs";
import { notificationCandidates, notifyDue, report } from "../../scripts/ops/lib.mjs";

const now = new Date("2026-10-21T12:00:00Z");
const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
const healthy = {
  health: { status: 200 },
  queues: { send_waiting: 0, send_oldest: null, analysis_waiting: 0, analysis_oldest: null },
  openErrors: [],
  api: { status: 200 },
  workflows: [{ id: "IlH4b7AKuSXyMiOd", name: "RheinWerk · Gmail Versand", status: 200, active: true }],
  schedules: [{ id: "IlH4b7AKuSXyMiOd", name: "RheinWerk · Gmail Versand", maxGap: 10, lastRun: ago(1) }],
  errors: [],
};
const checkOf = (result, key) => result.checks.find((c) => c.key === key);

test("Erwartete Workflows aus dem Repository mit Error-Workflow, Mira nur wenn eingerichtet", () => {
  const all = expectedWorkflows(true).map((w) => w.id);
  assert.equal(all.length, 13, "neun Workflows, Selbsttest (task-18-8), Assistent (task-18-10), Kundenantwort zum Termin (task-20-10) und Antwortassistent (task-22-3)");
  assert.ok(!all.includes("rwRagImport2026"), "Import der Wissensbasis nur von Hand");
  assert.ok(all.includes(ERROR_WORKFLOW));
  assert.ok(!expectedWorkflows(false).some((w) => w.id === "rwAgentTools2026" || w.id === "rwCallAnalysis26"));
});

test("Alles läuft: Zustand ok", () => {
  const result = evaluateN8n(healthy, now);
  assert.equal(result.state, "ok");
  assert.ok(result.checks.every((c) => c.ok === true));
});

test("n8n nicht erreichbar: kritisch, Workflows nicht geprüft, Warteschlangen schon", () => {
  const result = evaluateN8n({ health: { status: 0, error: "ECONNREFUSED" }, queues: healthy.queues, openErrors: [] }, now);
  assert.equal(result.state, "critical");
  assert.match(checkOf(result, "n8n:down").detail, /ECONNREFUSED/);
  assert.equal(checkOf(result, "n8n:api"), undefined);
  assert.equal(checkOf(result, "n8n:versandstau").ok, true);
});

test("Ohne Schlüssel übersprungen, abgelehnter Schlüssel warnt", () => {
  assert.equal(checkOf(evaluateN8n({ ...healthy, api: { status: null } }, now), "n8n:api").ok, null);
  assert.equal(evaluateN8n({ ...healthy, api: { status: null } }, now).state, "ok");
  assert.equal(checkOf(evaluateN8n({ ...healthy, api: { status: 401 } }, now), "n8n:api").ok, false);
  // Gesamtprobe task-17-11: right after a start the API answers 404 for a moment
  const started = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  assert.equal(checkOf(evaluateN8n({ ...healthy, api: { status: 404 }, startedAt: started(1) }, now), "n8n:api").ok, null);
  const late = checkOf(evaluateN8n({ ...healthy, api: { status: 404 }, startedAt: started(10) }, now), "n8n:api");
  assert.equal(late.ok, false);
  assert.doesNotMatch(late.detail, /lehnt N8N_API_KEY ab/);
  assert.match(checkOf(evaluateN8n({ ...healthy, api: { status: 401 }, startedAt: started(10) }, now), "n8n:api").detail, /lehnt N8N_API_KEY ab/);
});

test("Inaktiver oder fehlender Workflow ist kritisch; sein Zeitplan wird dann nicht zusätzlich gemeldet", () => {
  const inactive = evaluateN8n({ ...healthy, workflows: [{ ...healthy.workflows[0], active: false }], schedules: [{ ...healthy.schedules[0], lastRun: ago(60) }] }, now);
  assert.equal(checkOf(inactive, "n8n:inaktiv:IlH4b7AKuSXyMiOd").severity, "critical");
  assert.match(checkOf(inactive, "n8n:inaktiv:IlH4b7AKuSXyMiOd").title, /nicht aktiv/);
  assert.equal(checkOf(inactive, "n8n:zeitplan:IlH4b7AKuSXyMiOd").ok, null);
  const missing = evaluateN8n({ ...healthy, workflows: [{ ...healthy.workflows[0], status: 404, active: null }] }, now);
  assert.match(checkOf(missing, "n8n:inaktiv:IlH4b7AKuSXyMiOd").title, /fehlt/);
});

test("Zeitplan-Ausfall braucht drei zeitlich getrennte Bestätigungen", () => {
  assert.equal(checkOf(evaluateN8n({ ...healthy, schedules: [{ ...healthy.schedules[0], lastRun: ago(9) }] }, now), "n8n:zeitplan:IlH4b7AKuSXyMiOd").ok, true);
  const raw = { ...healthy, schedules: [{ ...healthy.schedules[0], lastRun: ago(15) }] };
  const first = evaluateN8n(raw, now);
  assert.equal(checkOf(first, "n8n:zeitplan:IlH4b7AKuSXyMiOd").ok, null);
  const immediate = evaluateN8n(raw, new Date(now.getTime() + 60_000), first);
  assert.equal(immediate.schedule_observations.IlH4b7AKuSXyMiOd.late, 1, "manual recheck does not multiply evidence");
  const second = evaluateN8n(raw, new Date(now.getTime() + 5 * 60_000), immediate);
  const third = evaluateN8n(raw, new Date(now.getTime() + 10 * 60_000), second);
  const late = checkOf(third, "n8n:zeitplan:IlH4b7AKuSXyMiOd");
  assert.equal(late.ok, false);
  assert.match(late.detail, /25 Minuten/);
});

test("Versandstau kritisch, Analysestau Warnung, ohne Datenbank übersprungen", () => {
  const queues = { send_waiting: 2, send_oldest: ago(20), analysis_waiting: 1, analysis_oldest: ago(30) };
  const result = evaluateN8n({ ...healthy, queues }, now);
  assert.equal(checkOf(result, "n8n:versandstau").severity, "critical");
  assert.match(checkOf(result, "n8n:versandstau").detail, /^2 freigegebene E-Mails warten/);
  assert.equal(checkOf(result, "n8n:analysestau").ok, false);
  assert.equal(checkOf(evaluateN8n({ ...healthy, queues: null }, now), "n8n:versandstau").ok, null);
});

test("Error-Warnung braucht eine ruhige Stunde und einen neueren erfolgreichen Lauf", () => {
  const alert = { alert_key: "n8n:fehler:lw1QxoJbeSU0H17E", title: "Automatisierung: „RheinWerk · Serviceanfragen“ fehlgeschlagen", severity: "critical" };
  const recent = evaluateN8n({ ...healthy, openErrors: [alert], errors: [{ key: alert.alert_key, title: alert.title, lastError: ago(20) }] }, now);
  assert.equal(recent.state, "critical");
  assert.deepEqual(recent.errors, [{ title: alert.title, severity: "critical" }]);
  assert.equal(checkOf(recent, alert.alert_key), undefined);
  const quiet = evaluateN8n({ ...healthy, openErrors: [alert], errors: [{ key: alert.alert_key, title: alert.title, lastError: ago(61), lastSuccess: ago(1) }] }, now);
  assert.equal(checkOf(quiet, alert.alert_key).ok, true);
  assert.equal(quiet.state, "ok");
  // Without API access the warning stays open
  assert.equal(evaluateN8n({ ...healthy, api: { status: null }, openErrors: [alert], errors: undefined }, now).state, "critical");
});

test("Unbekannte Ausführungen sind kein Stillstand und keine Entwarnung", () => {
  const raw = { ...healthy, schedules: [{ ...healthy.schedules[0], available: false, lastRun: null }] };
  const first = evaluateN8n(raw, now);
  const second = evaluateN8n(raw, new Date(now.getTime() + 5 * 60_000), first);
  const third = evaluateN8n(raw, new Date(now.getTime() + 10 * 60_000), second);
  assert.equal(checkOf(third, "n8n:zeitplan:IlH4b7AKuSXyMiOd").ok, null);
  assert.equal(checkOf(first, "n8n:ausfuehrungsdaten").ok, null);
  assert.equal(checkOf(third, "n8n:ausfuehrungsdaten").ok, false);
  const restoredData = evaluateN8n(healthy, new Date(now.getTime() + 11 * 60_000), third);
  assert.equal(checkOf(restoredData, "n8n:ausfuehrungsdaten").ok, true);
  assert.equal(restoredData.schedule_observations.IlH4b7AKuSXyMiOd.unknown, 0);
});

test("API-Fehler dürfen weder Workflow deaktiviert melden noch Fehlerwarnungen schließen", () => {
  const alert = { alert_key: "n8n:fehler:test", title: "Fehler", severity: "warning" };
  const raw = { ...healthy, workflows: [{ ...healthy.workflows[0], status: 503, active: null }], openErrors: [alert],
    errors: [{ key: alert.alert_key, available: false, lastError: null, lastSuccess: ago(1) }] };
  const result = evaluateN8n(raw, now);
  assert.equal(checkOf(result, "n8n:inaktiv:IlH4b7AKuSXyMiOd").ok, null);
  assert.equal(checkOf(result, alert.alert_key), undefined);
  assert.equal(result.errors.length, 1);
  const old = evaluateN8n({ ...healthy, openErrors: [alert], errors: [{ key: alert.alert_key, lastError: ago(120), lastSuccess: ago(180) }] }, now);
  assert.equal(checkOf(old, alert.alert_key), undefined, "an old success cannot prove recovery");
});

const gmailAlerts = ["IlH4b7AKuSXyMiOd", "rGQGvOLDJUuHt4bO"].map((id) => ({
  alert_key: `n8n:fehler:${id}`, title: "Gmail fehlgeschlagen", severity: "critical",
  detail: 'Fehler: The credential "RheinWerk Gmail" needs to be reconnected.',
  first_seen_at: ago(120), last_seen_at: ago(5), notified_at: ago(110),
}));

test("Gemeinsamer Gmail-Zugangsfehler: ein Vorfall, keine Entwarnung durch laufenden Zeitplan", () => {
  const broken = evaluateN8n({ ...healthy, openErrors: gmailAlerts, gmail: { recovered: false } }, now);
  const group = checkOf(broken, GMAIL_ALERT_KEY);
  assert.equal(group.ok, false);
  assert.equal(group.notifyOnce, true);
  assert.equal(group.adoptNotification, true, "already sent legacy notification is retained");
  assert.equal(broken.errors.length, 0, "legacy warnings are represented by one grouped check");
  assert.equal(checkOf(broken, "n8n:zeitplan:IlH4b7AKuSXyMiOd").silent, true);
  assert.equal(checkOf(broken, gmailAlerts[0].alert_key), undefined);
  const restored = evaluateN8n({ ...healthy, openErrors: gmailAlerts, gmail: { recovered: true } }, now);
  assert.equal(checkOf(restored, GMAIL_ALERT_KEY).ok, true);
  assert.ok(gmailAlerts.every((a) => checkOf(restored, a.alert_key).silent));
  assert.equal(evaluateN8n({ ...healthy, api: { status: 503 }, openErrors: gmailAlerts, gmail: { recovered: true } }, now).state, "critical");
});

test("Gmail-Meldungen werden zusammengefasst, andere Fehler und erfolgloser Mailversand bleiben sichtbar", () => {
  const group = { alert_key: GMAIL_ALERT_KEY, notified_at: ago(5) };
  const other = { ...gmailAlerts[0], detail: "DNS lookup failed" };
  assert.deepEqual(notificationCandidates([...gmailAlerts, group, other], true), [other]);
  assert.deepEqual(notificationCandidates([group], false), []);
  const unsent = { ...group, notified_at: null };
  assert.deepEqual(notificationCandidates([...gmailAlerts, unsent], true), [unsent]);
  assert.equal(notificationCandidates(gmailAlerts, false).length, 2, "without persisted group, original alerts are not muted");
});

const successfulGmail = {
  status: "success", workflowData: { nodes: [{ name: "Postfach prüfen", credentials: { gmailOAuth2: { id: "rw46346a76655347" } },
    parameters: { url: "https://gmail.googleapis.com/gmail/v1/users/me/profile" } }] },
  data: { resultData: { runData: { "Postfach prüfen": [{ executionStatus: "success", data: { main: [[{ json: {
    statusCode: 200, body: { emailAddress: "rheinwerk.industrieservice@gmail.com" },
  } }]] } }] } } },
};

test("Gmail-Wiederherstellung braucht einen echten erfolgreichen Profilaufruf des richtigen Postfachs", () => {
  assert.equal(gmailAccessSucceeded(successfulGmail), true);
  assert.equal(gmailAccessSucceeded({ ...successfulGmail, status: "error" }), false);
  assert.equal(gmailAccessSucceeded({ ...successfulGmail, data: {} }), false);
  const wrong = structuredClone(successfulGmail);
  wrong.data.resultData.runData["Postfach prüfen"][0].data.main[0][0].json.body.emailAddress = "other@example.com";
  assert.equal(gmailAccessSucceeded(wrong), false);
});

test("Executions-API: Fehler, ungültige oder leere Antwort unbekannt; laufender Datensatz verdeckt vorigen Lauf nicht", async (t) => {
  let response;
  t.mock.method(globalThis, "fetch", async () => response);
  for (const [status, body] of [[503, {}], [200, {}], [200, { data: [] }], [200, { data: [{ startedAt: null }] }]]) {
    response = Response.json(body, { status });
    assert.equal((await latestExecution("https://n8n.test", {}, "workflowId=test")).available, false);
  }
  response = Response.json({ data: [{ id: "new", startedAt: null }, { id: "finished", startedAt: ago(1) }] });
  const latest = await latestExecution("https://n8n.test", {}, "workflowId=test");
  assert.equal(latest.available, true);
  assert.equal(latest.execution.id, "finished");
});

test("Collector prüft beide Gmail-Workflows; ein Erfolg allein und Fehler beim Detailabruf reichen nicht", async (t) => {
  let incomingGood = false;
  let detailFailure = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = new URL(url);
    if (u.pathname === "/healthz") return Response.json({});
    if (u.pathname.endsWith("/executions/good")) return detailFailure ? Response.json({}, { status: 503 }) : Response.json(successfulGmail);
    if (u.pathname.endsWith("/executions")) {
      const incoming = u.searchParams.get("workflowId") === "rGQGvOLDJUuHt4bO";
      return Response.json({ data: [{ id: "good", startedAt: incoming && !incomingGood ? ago(180) : ago(1) }] });
    }
    return Response.json({ active: true, data: [] });
  });
  const rpc = async (name) => name === "open_alerts" ? gmailAlerts : healthy.queues;
  const env = { N8N_API_KEY: "test", N8N_API_URL: "https://n8n.test" };
  assert.equal((await collectN8n(env, rpc)).gmail.recovered, false);
  incomingGood = true;
  assert.equal((await collectN8n(env, rpc)).gmail.recovered, true);
  detailFailure = true;
  assert.equal((await collectN8n(env, rpc)).gmail.recovered, false);
});

test("Gmail-Vorfall sendet genau eine Warnung und eine Entwarnung; Legacy-Upgrade sendet keine neue Warnung", async () => {
  for (const alreadyNotified of [false, true]) {
    const mails = [];
    const rows = new Map();
    const call = async (name, args = {}) => {
      if (name === "raise_alert") {
        const old = rows.get(args.alert_key);
        const row = old ?? { id: args.alert_key, ...args, notified_at: null };
        rows.set(row.id, row);
        return { alert_id: row.id, notify: true, reason: row.notified_at ? "reminder" : "new" };
      }
      if (name === "mark_alert_notified") { rows.get(args.alert_id).notified_at = ago(1); return rows.get(args.alert_id); }
      if (name === "clear_alert") {
        const old = rows.get(args.alert_key); rows.delete(args.alert_key);
        return old ? { notify: Boolean(old.notified_at) } : null;
      }
      if (name === "alerts_to_notify") return [...rows.values(), ...gmailAlerts];
      if (name === "open_alerts") return [...rows.values()].filter((row) => row.id === GMAIL_ALERT_KEY);
      throw new Error(name);
    };
    const deps = { call, send: async (mail) => { mails.push(mail); return { ok: true }; } };
    const alerts = gmailAlerts.map((alert) => ({ ...alert, notified_at: alreadyNotified ? alert.notified_at : null }));
    const raw = { ...healthy, openErrors: alerts, gmail: { recovered: false } };
    const group = checkOf(evaluateN8n(raw, now), GMAIL_ALERT_KEY);
    await report("n8n", group, deps);
    await report("n8n", { ...group, adoptNotification: false }, deps);
    await notifyDue(deps);
    assert.equal(mails.length, alreadyNotified ? 0 : 1, "no reminders or duplicate workflow emails");
    const recovered = evaluateN8n({ ...raw, gmail: { recovered: true } }, now);
    assert.equal(recovered.state, "ok");
    for (const c of recovered.checks.filter((c) => c.key === GMAIL_ALERT_KEY || c.key.startsWith("n8n:fehler:"))) await report("n8n", c, deps);
    assert.equal(mails.length, alreadyNotified ? 1 : 2);
    assert.match(mails.at(-1).subject, /^Wieder in Ordnung: Gmail-Eingang und -Versand$/);
    assert.match(mails.at(-1).text, /authentifizierte Gmail-Aufrufe/);
    assert.equal(rows.has(GMAIL_ALERT_KEY), false);
  }
});

test("Bereits behobener Legacy-Vorfall erhält genau eine gemeinsame Entwarnung", async () => {
  const calls = [];
  const deps = { call: async (name) => { calls.push(name); return name === "raise_alert" ? { reason: "new", alert_id: "group" } : { notify: true }; },
    send: async (mail) => { calls.push(mail.subject); return { ok: true }; } };
  const result = evaluateN8n({ ...healthy, openErrors: gmailAlerts, gmail: { recovered: true } }, now);
  await report("n8n", checkOf(result, GMAIL_ALERT_KEY), deps);
  assert.deepEqual(calls, ["raise_alert", "mark_alert_notified", "clear_alert", "Wieder in Ordnung: Gmail-Eingang und -Versand"]);
});
