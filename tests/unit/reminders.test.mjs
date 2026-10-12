// Unit tests for payment reminder texts (task-10-2). Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { nextReminderShort, nextReminderText, shortStageLabel, stageLabel } from "../../lib/reminders.ts";

const state = (overrides = {}) => ({ last_stage: 1, last_reminder_at: "2026-10-05T04:00:00Z", paused: false, next_stage: 2, next_due_on: "2026-10-19", ...overrides });

test("Stufenbezeichnungen", () => {
  assert.equal(stageLabel(0), "Keine");
  assert.equal(stageLabel(1), "Zahlungserinnerung");
  assert.equal(stageLabel(3), "2. Mahnung");
  assert.equal(shortStageLabel(1), "Erinnerung");
});

test("Nächste Erinnerung: Datum, fällig, ausgesetzt, keine weitere", () => {
  assert.equal(nextReminderText(state(), "2026-10-12"), "1. Mahnung am 19.10.2026");
  assert.equal(nextReminderText(state({ next_due_on: "2026-10-12" }), "2026-10-12"), "1. Mahnung beim nächsten Lauf");
  assert.equal(nextReminderText(state({ paused: true }), "2026-10-12"), "Erinnerungen ausgesetzt");
  assert.equal(nextReminderText(state({ next_stage: null, next_due_on: null }), "2026-10-12"), null);
  assert.equal(nextReminderText(null, "2026-10-12"), null);
});

test("Kurzform für die Rechnungsliste", () => {
  assert.equal(nextReminderShort(state(), "2026-10-12"), "→ 1. Mahnung 19.10.");
  assert.equal(nextReminderShort(state({ next_due_on: "2026-10-01" }), "2026-10-12"), "→ 1. Mahnung fällig");
  assert.equal(nextReminderShort(state({ paused: true }), "2026-10-12"), "ausgesetzt");
});
