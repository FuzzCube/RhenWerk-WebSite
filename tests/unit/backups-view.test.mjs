// Unit tests for the backups in the area "System" (task-18-6, lib/backups.ts).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { backupContents, backupStatus, formatBytes, latestVerified, providerView } from "../../lib/backups.ts";
import { checkRequestState } from "../../lib/system-monitoring.ts";

const row = (extra) => ({ id: "x", started_at: "2026-10-22T01:00:00Z", finished_at: "2026-10-22T01:01:00Z", reason: "daily", status: "ok", file_name: "a", size_bytes: 1, contents: {}, verified: true, error: null, requester: null, ...extra });

test("Zustand einer Sicherung: geprüft, ohne Probewiederherstellung (vor Migration), fehlgeschlagen", () => {
  assert.equal(backupStatus(row()).label, "Geprüft");
  assert.equal(backupStatus(row({ reason: "migration", verified: null })).label, "Ohne Probewiederherstellung");
  assert.equal(backupStatus(row({ status: "failed", verified: false })).tone, "act");
});

test("Größe und Inhalt lesbar, neueste geprüfte Sicherung", () => {
  assert.equal(formatBytes(101_711_872), "97 MB");
  assert.equal(formatBytes(4_117_542), "3,9 MB");
  assert.equal(formatBytes(null), "–");
  assert.deepEqual(backupContents({ "public.requests": 1573, storage_files: 102, n8n_workflows: 29, secrets: ["env"] }),
    [{ label: "Anfragen", value: "1.573" }, { label: "Dateien", value: "102" }, { label: "Workflows (n8n)", value: "29" }]);
  const rows = [row({ id: "m", reason: "migration", verified: null }), row({ id: "f", status: "failed", verified: false }), row({ id: "d" })];
  assert.equal(latestVerified(rows).id, "d");
  assert.equal(latestVerified([rows[0]]), null);
});

test("Sicherung des Anbieters: ohne Schlüssel, aktiv, ausgeschaltet, Fehler", () => {
  assert.equal(providerView(null).status.label, "Nicht abgefragt");
  assert.equal(providerView({ state: "enabled", schedule: "03:10:00", restore_points: 1 }).text, "Täglich um 03:10 (UTC) beim Anbieter, ganzer Server; 1 Sicherungspunkt.");
  assert.equal(providerView({ state: "disabled" }).status.label, "Ausgeschaltet");
  assert.match(providerView({ error: "HTTP 403" }).text, /HTTP 403/);
});

test("„Jetzt sichern“ verfällt erst nach 30 Minuten", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const request = { requested_at: "2026-10-22T11:45:00Z", started_at: "2026-10-22T11:45:10Z" };
  assert.equal(checkRequestState(request, now), "idle");
  assert.equal(checkRequestState(request, now, 30), "running");
});
