// Unit tests for the summary of the area "System" (task-17-12): open warnings, order, labels.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { alertSourceLabel, systemSummary } from "../../lib/system-summary.ts";

const alert = (id, severity, first_seen_at, source = "backup") => ({ id, source, severity, title: id, first_seen_at });

test("Ohne offene Warnung: alles in Ordnung", () => {
  assert.deepEqual(systemSummary([]), { ok: true, title: "Alles in Ordnung", alerts: [] });
});

test("Anzahl im Titel, Einzahl und Mehrzahl", () => {
  assert.equal(systemSummary([alert("a", "warning", "2026-10-21T10:00:00Z")]).title, "1 Punkt braucht Aufmerksamkeit");
  assert.equal(systemSummary([alert("a", "warning", "2026-10-21T10:00:00Z"), alert("b", "warning", "2026-10-21T11:00:00Z")]).title, "2 Punkte brauchen Aufmerksamkeit");
});

test("Kritische zuerst, sonst die älteste zuerst", () => {
  const { ok, alerts } = systemSummary([
    alert("neu", "warning", "2026-10-21T12:00:00Z"),
    alert("kritisch", "critical", "2026-10-21T13:00:00Z"),
    alert("alt", "warning", "2026-10-21T09:00:00Z"),
  ]);
  assert.equal(ok, false);
  assert.deepEqual(alerts.map((a) => a.id), ["kritisch", "alt", "neu"]);
});

test("Quelle in Worten", () => {
  assert.equal(alertSourceLabel("backup"), "Datensicherung");
  assert.equal(alertSourceLabel("update"), "Nächtliches Update");
});
