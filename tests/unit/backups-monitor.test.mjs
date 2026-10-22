// Unit tests for the backup checks of the watchdog (task-18-6, scripts/ops/backups.mjs).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateBackups } from "../../scripts/ops/backups.mjs";

const now = new Date("2026-10-22T12:00:00Z");
const latest = (hoursAgo) => ({ finished_at: new Date(now.getTime() - hoursAgo * 3600_000).toISOString(), reason: "daily" });
const provider = (extra = {}) => ({ state: "enabled", schedule: "03:10:00", restore_points: 1, last_restore_point: "2026-10-22T01:10:00Z", ...extra });
const byKey = (result) => Object.fromEntries(result.checks.map((c) => [c.key, c]));

test("Sicherung von heute und Sicherung des Anbieters aktuell: alles in Ordnung", () => {
  const result = evaluateBackups({ latest: latest(9), provider: provider() }, now);
  assert.equal(result.state, "ok");
  assert.equal(byKey(result)["backup:stale"].ok, true);
  assert.equal(byKey(result)["backup:provider"].ok, true);
  assert.deepEqual(result.provider, { state: "enabled", schedule: "03:10:00", rotation: null, restore_points: 1, last_restore_point: "2026-10-22T01:10:00Z" });
});

test("Eigene Sicherung älter als 26 Stunden oder keine: kritisch", () => {
  assert.equal(byKey(evaluateBackups({ latest: latest(25.9), provider: provider() }, now))["backup:stale"].ok, true);
  const old = evaluateBackups({ latest: latest(27), provider: provider() }, now);
  assert.equal(old.state, "critical");
  assert.equal(byKey(old)["backup:stale"].title, "Letzte Sicherung vor 27 Stunden");
  const none = evaluateBackups({ latest: null, provider: provider() }, now);
  assert.equal(byKey(none)["backup:stale"].title, "Keine geprüfte Sicherung vorhanden");
});

test("Anbieter: ohne Schlüssel übersprungen, ausgeschaltet, alter Sicherungspunkt, API-Fehler", () => {
  const without = evaluateBackups({ latest: latest(2), provider: null }, now);
  assert.equal(without.state, "ok");
  assert.equal(byKey(without)["backup:provider"].ok, null);
  assert.equal(byKey(evaluateBackups({ latest: latest(2), provider: provider({ state: "disabled" }) }, now))["backup:provider"].title, "Sicherung des Anbieters ausgeschaltet");
  const stale = evaluateBackups({ latest: latest(2), provider: provider({ last_restore_point: "2026-10-19T01:10:00Z" }) }, now);
  assert.equal(stale.state, "warning");
  assert.equal(byKey(stale)["backup:provider"].title, "Kein aktueller Sicherungspunkt beim Anbieter");
  const noPoints = evaluateBackups({ latest: latest(2), provider: provider({ restore_points: null, last_restore_point: null, rotation: 1 }) }, now);
  assert.equal(byKey(noPoints)["backup:provider"].ok, true, "ohne Recht auf die Sicherungspunkte zählt der Zustand");
  const failed = evaluateBackups({ latest: latest(2), provider: { error: "HTTP 403: This call has not been granted" } }, now);
  assert.match(byKey(failed)["backup:provider"].detail, /HTTP 403/);
  assert.deepEqual(failed.provider, { error: "HTTP 403: This call has not been granted" });
});
