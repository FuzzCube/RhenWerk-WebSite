// Unit tests for the checks of n8n in the watchdog (task-17-8): raw answers → checks and state.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { ERROR_WORKFLOW, evaluateN8n, expectedWorkflows } from "../../scripts/ops/n8n.mjs";

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
  assert.equal(all.length, 9);
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

test("Zeitplan ohne Lauf länger als erlaubt warnt", () => {
  assert.equal(checkOf(evaluateN8n({ ...healthy, schedules: [{ ...healthy.schedules[0], lastRun: ago(9) }] }, now), "n8n:zeitplan:IlH4b7AKuSXyMiOd").ok, true);
  const late = checkOf(evaluateN8n({ ...healthy, schedules: [{ ...healthy.schedules[0], lastRun: ago(25) }] }, now), "n8n:zeitplan:IlH4b7AKuSXyMiOd");
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

test("Warnung des Error-Workflows: offen bis eine Stunde ohne Fehler, dann behoben", () => {
  const alert = { alert_key: "n8n:fehler:lw1QxoJbeSU0H17E", title: "Automatisierung: „RheinWerk · Serviceanfragen“ fehlgeschlagen", severity: "critical" };
  const recent = evaluateN8n({ ...healthy, openErrors: [alert], errors: [{ key: alert.alert_key, title: alert.title, lastError: ago(20) }] }, now);
  assert.equal(recent.state, "critical");
  assert.deepEqual(recent.errors, [{ title: alert.title, severity: "critical" }]);
  assert.equal(checkOf(recent, alert.alert_key), undefined);
  const quiet = evaluateN8n({ ...healthy, openErrors: [alert], errors: [{ key: alert.alert_key, title: alert.title, lastError: ago(61) }] }, now);
  assert.equal(checkOf(quiet, alert.alert_key).ok, true);
  assert.equal(quiet.state, "ok");
  // Without API access the warning stays open
  assert.equal(evaluateN8n({ ...healthy, api: { status: null }, openErrors: [alert], errors: undefined }, now).state, "critical");
});
