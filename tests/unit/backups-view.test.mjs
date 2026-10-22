// Unit tests for the backups in the area "System" (task-18-6, lib/backups.ts) and the restore (task-18-7).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  backupContents, backupReasonLabel, backupStatus, confirmationMatches, formatBytes, latestVerified, providerView, restorable, restoreActive, restoreStatus,
} from "../../lib/backups.ts";
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
  assert.equal(providerView({ state: "enabled", schedule: "03:10:00", restore_points: 1 }).text, "Täglich um 03:10 beim Anbieter (OVHcloud), ganzer Server; 1 Sicherungspunkt.");
  assert.equal(providerView({ state: "enabled", schedule: "09:42:00", rotation: 1, restore_points: null }).text, "Täglich um 09:42 beim Anbieter (OVHcloud), ganzer Server; 1 Sicherungspunkt.");
  assert.equal(providerView({ state: "disabled" }).status.label, "Ausgeschaltet");
  assert.match(providerView({ error: "HTTP 403" }).text, /HTTP 403/);
});

test("„Jetzt sichern“ verfällt erst nach 30 Minuten", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  const request = { requested_at: "2026-10-22T11:45:00Z", started_at: "2026-10-22T11:45:10Z" };
  assert.equal(checkRequestState(request, now), "idle");
  assert.equal(checkRequestState(request, now, 30), "running");
});

test("Wiederherstellen nur aus vollständiger geprüfter Sicherung mit gleichem Migrationsstand der letzten 14 Tage", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const ok = row({ contents: { migration: "20261022160000" } });
  assert.equal(restorable(ok, "20261022160000", now), true);
  assert.equal(restorable(row({ reason: "pre_restore", contents: { migration: "20261022160000" } }), "20261022160000", now), true);
  assert.equal(restorable(ok, "20261101000000", now), false, "andere Migration");
  assert.equal(restorable(ok, null, now), false, "Migrationsstand unbekannt");
  assert.equal(restorable(row({ contents: {} }), "20261022160000", now), false, "ältere Sicherung ohne Migrationsstand");
  assert.equal(restorable(row({ reason: "migration", verified: null, contents: { migration: "20261022160000" } }), "20261022160000", now), false);
  assert.equal(restorable(row({ verified: false, contents: { migration: "20261022160000" } }), "20261022160000", now), false);
  assert.equal(restorable(ok, "20261022160000", new Date("2026-11-06T10:00:00Z")), false, "älter als 14 Tage");
  assert.equal(backupReasonLabel("pre_restore"), "Vor Wiederherstellung");
});

test("Bestätigungswort und Zustand einer Wiederherstellung", () => {
  assert.equal(confirmationMatches(" wiederherstellen "), true);
  assert.equal(confirmationMatches("WIEDERHERSTELLE"), false);
  const now = new Date("2026-10-23T10:00:00Z");
  const restore = (extra) => ({ id: "r", file_name: "a", backup_finished_at: "2026-10-23T01:00:00Z", requested_at: "2026-10-23T09:50:00Z", started_at: null, finished_at: null, status: "requested", pre_backup_file: null, error: null, requester: null, ...extra });
  assert.equal(restoreActive(restore(), now), true);
  assert.equal(restoreStatus(restore(), now).label, "Angefordert");
  assert.equal(restoreStatus(restore({ status: "running" }), now).label, "Läuft");
  assert.equal(restoreActive(restore({ requested_at: "2026-10-23T08:30:00Z", status: "running" }), now), false, "nach einer Stunde aufgegeben");
  assert.equal(restoreStatus(restore({ requested_at: "2026-10-23T08:30:00Z", status: "running" }), now).label, "Nicht abgeschlossen");
  assert.equal(restoreStatus(restore({ status: "ok" }), now).tone, "done");
  assert.equal(restoreStatus(restore({ status: "rolled_back", error: "x" }), now).label, "Fehlgeschlagen, Stand davor zurück");
  assert.equal(restoreActive(null, now), false);
});
