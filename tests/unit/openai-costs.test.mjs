// Unit tests for the costs of OpenAI in the watchdog (task-19-5): raw answer → state and figures.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateOpenAI } from "../../scripts/ops/openai.mjs";

const raw = (spent) => ({ configured: true, status: 200, spent, month: "2026-10" });

test("Ohne OPENAI_ADMIN_KEY: nicht eingerichtet", () => {
  assert.deepEqual(evaluateOpenAI({ configured: false }), { state: "off", costs: null, detail: null });
});

test("Ohne Budget: nur Verbrauch, Zustand ok", () => {
  const result = evaluateOpenAI(raw(3.456));
  assert.equal(result.state, "ok");
  assert.deepEqual(result.costs, { spent: 3.46, month: "2026-10", budget: null, remaining: null, min: null });
});

test("Budget: Rest und Schwellwert 10 %", () => {
  assert.deepEqual(evaluateOpenAI(raw(12), { budget: "20" }).costs, { spent: 12, month: "2026-10", budget: 20, remaining: 8, min: 2 });
  assert.equal(evaluateOpenAI(raw(18.5), { budget: "20" }).state, "warning");
  assert.equal(evaluateOpenAI(raw(18.5), { budget: "20", budgetMin: "1" }).state, "ok");
  assert.equal(evaluateOpenAI(raw(20), { budget: "20" }).state, "critical");
});

test("Fehler der API: Warnung mit Grund", () => {
  assert.match(evaluateOpenAI({ configured: true, status: 401 }).detail, /Admin-Key ungültig/);
  assert.match(evaluateOpenAI({ configured: true, status: 0, error: "fetch failed" }).detail, /nicht erreichbar \(fetch failed\)/);
  assert.equal(evaluateOpenAI({ configured: true, status: 500 }).state, "warning");
});
