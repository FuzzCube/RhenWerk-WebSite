// Unit tests for the display of the watchdog results in the area "System" (task-17-9).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { creditView, isStale, monitorNotes, monitorStatus } from "../../lib/system-monitoring.ts";

const now = new Date("2026-10-21T12:00:00Z");
const entry = (state, minutesAgo, checks = []) => ({ state, checked_at: new Date(now.getTime() - minutesAgo * 60_000).toISOString(), checks });

test("Zustand je Ergebnis, nach 15 Minuten veraltet", () => {
  assert.equal(monitorStatus(entry("ok", 4), now).label, "In Ordnung");
  assert.equal(monitorStatus(entry("critical", 4), now).tone, "act");
  assert.equal(monitorStatus(entry("off", 4), now).label, "Nicht eingerichtet");
  assert.equal(isStale(entry("ok", 15), now), false);
  assert.equal(monitorStatus(entry("ok", 16), now).label, "Prüfung veraltet");
});

test("Hinweise: fehlgeschlagene zuerst, übersprungene mit Grund, bestandene nicht", () => {
  const notes = monitorNotes(entry("warning", 1, [
    { key: "a", label: "Guthaben", ok: null, severity: "warning", title: null, detail: "Guthaben nicht abrufbar" },
    { key: "b", label: "Agent", ok: true, severity: "warning", title: null, detail: "" },
    { key: "c", label: "Werkzeuge", ok: false, severity: "critical", title: "Werkzeuge nicht erreichbar", detail: "…" },
  ]));
  assert.deepEqual(notes, [{ text: "Werkzeuge nicht erreichbar", tone: "bad" }, { text: "Guthaben nicht abrufbar", tone: "muted" }]);
});

test("Guthaben: Anteil, niedrig unter dem Schwellwert, aufgebraucht", () => {
  const credit = (remaining) => ({ used: 30000 - remaining, limit: 30000, remaining, min: 3000, tier: "starter", reset_at: null });
  assert.deepEqual(creditView(credit(21000)), { share: 0.7, low: false, empty: false });
  assert.equal(creditView(credit(2999)).low, true);
  assert.deepEqual(creditView(credit(0)), { share: 0, low: true, empty: true });
});
