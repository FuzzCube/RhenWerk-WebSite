// Unit tests for the checks of the phone assistant in the watchdog (task-17-9): raw answers → checks, state, credit.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { creditOf, evaluateMira, isToolError } from "../../scripts/ops/mira.mjs";

const healthy = {
  configured: true,
  agentId: "agent_x",
  agent: { status: 200 },
  subscription: { status: 200, used: 9000, limit: 30000, tier: "starter", reset: 1795204152 },
  webhook: { status: 200, ok: true, text: "{\"ok\":true}" },
  analysis: { stale: 0, oldest: null },
  tools: { calls: 2, results: 6, failed: 1 },
};
const checkOf = (result, key) => result.checks.find((c) => c.key === key);

test("Ohne ELEVENLABS_API_KEY: nicht eingerichtet, keine Prüfung", () => {
  assert.deepEqual(evaluateMira({ configured: false }), { state: "off", checks: [], credit: null });
});

test("Alles erreichbar: Zustand ok, Guthaben mit Schwellwert 10 %", () => {
  const result = evaluateMira(healthy);
  assert.equal(result.state, "ok");
  assert.ok(result.checks.every((c) => c.ok === true));
  assert.deepEqual(result.credit, { used: 9000, limit: 30000, remaining: 21000, min: 3000, tier: "starter", reset_at: "2026-11-20T19:49:12.000Z" });
});

test("Abgelehnter Schlüssel und unbekannter Agent sind kritisch, Netzfehler nur Warnung", () => {
  assert.equal(checkOf(evaluateMira({ ...healthy, agent: { status: 401 } }), "mira:agent").severity, "critical");
  assert.match(checkOf(evaluateMira({ ...healthy, agent: { status: 404 } }), "mira:agent").title, /nicht gefunden/);
  const offline = evaluateMira({ ...healthy, agent: { status: 0, error: "ENOTFOUND" } });
  assert.equal(offline.state, "warning");
  assert.match(checkOf(offline, "mira:agent").detail, /ENOTFOUND/);
});

test("Webhook: Cloudflare, Secret, inaktiver Workflow, Tunnel aus", () => {
  const webhook = (status, text, ok) => checkOf(evaluateMira({ ...healthy, webhook: { status, text, ok } }), "mira:webhook");
  assert.match(webhook(401, "<title>Error ・ Cloudflare Access</title>").detail, /Service Token/);
  assert.match(webhook(403, "<title>Error ・ Cloudflare Access</title>").detail, /Service Token/);
  assert.match(webhook(403, "Authorization data is wrong!").detail, /Werkzeug-Secret/);
  assert.match(webhook(404, "").detail, /inaktiv/);
  assert.match(webhook(530, "").detail, /Tunnel oder n8n/);
  const failing = webhook(200, "{\"ok\":false}", false);
  assert.equal(failing.ok, false);
  assert.equal(failing.severity, "warning");
  assert.equal(checkOf(evaluateMira({ ...healthy, webhook: null }), "mira:webhook").ok, null);
});

test("Hängende Auswertung und gehäufte Werkzeugfehler warnen, ab 3 Fehlern", () => {
  assert.match(checkOf(evaluateMira({ ...healthy, analysis: { stale: 2, oldest: "2026-10-21T10:00:00Z" } }), "mira:analysis").detail, /^2 Gespräche/);
  assert.equal(checkOf(evaluateMira({ ...healthy, tools: { calls: 3, results: 9, failed: 2 } }), "mira:tools").ok, true);
  assert.equal(checkOf(evaluateMira({ ...healthy, tools: { calls: 3, results: 9, failed: 3 } }), "mira:tools").ok, false);
  assert.equal(checkOf(evaluateMira({ ...healthy, analysis: null }), "mira:analysis").ok, null);
});

test("Guthaben: niedrig, aufgebraucht, eigener Schwellwert, fehlende Berechtigung ohne Warnung", () => {
  const credit = (used, creditMin) => evaluateMira({ ...healthy, subscription: { ...healthy.subscription, used } }, { creditMin });
  assert.equal(checkOf(credit(28000), "mira:credit").severity, "warning");
  assert.equal(checkOf(credit(30000), "mira:credit").severity, "critical");
  assert.equal(checkOf(credit(25000, "6000"), "mira:credit").ok, false);
  const denied = evaluateMira({ ...healthy, subscription: { status: 401, error: "missing_permissions" } });
  assert.equal(checkOf(denied, "mira:credit").ok, null);
  assert.match(checkOf(denied, "mira:credit").detail, /User: Read/);
  assert.equal(denied.state, "ok");
  assert.equal(creditOf({ status: 200, used: 1, limit: 0 }), null);
});

test("Werkzeugfehler: is_error oder ok false", () => {
  assert.equal(isToolError({ is_error: true }), true);
  assert.equal(isToolError({ result_value: "{\"ok\":false,\"fehler\":\"werkzeug_gestoert\"}" }), true);
  assert.equal(isToolError({ result_value: "{\"ok\":true}" }), false);
  assert.equal(isToolError({ result_value: "kein JSON" }), false);
});
