// Unit tests for the system updates of the images on the VPS (task-18-8): scripts/ops/images.mjs, the row
// "Images (Server)" of scripts/ops/versions.mjs and the history view in lib/backups.ts.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { imageChanges, imageUpdateActive, imageUpdateStatus } from "../../lib/backups.ts";
import { diffImages, overrideYaml } from "../../scripts/ops/images.mjs";
import { updateReadyMail, versionRows } from "../../scripts/ops/versions.mjs";

const services = [
  { service: "db", image: "supabase/postgres:17.11.0.005", container: "supabase_db_rheinwerk" },
  { service: "n8n", image: "n8nio/n8n:2.44.4", container: "rheinwerk-n8n" },
  { service: "kong", image: "envoyproxy/envoy:v1.39.1", container: "supabase_kong_rheinwerk" },
  { service: "studio", image: "supabase/studio:x", container: "supabase_studio_rheinwerk" },
];

test("Dienste mit neuerem Image im Repository; Dienste ohne Container zählen nicht", () => {
  const running = { db: "supabase/postgres:17.6.1.136", n8n: "n8nio/n8n:2.44.4", kong: "envoyproxy/envoy:v1.39.1", studio: null };
  assert.deepEqual(diffImages(services, running), [
    { service: "db", image: "supabase/postgres:17.11.0.005", from: "17.6.1.136", to: "17.11.0.005", previous: "supabase/postgres:17.6.1.136" },
  ]);
  assert.deepEqual(diffImages(services, { db: "supabase/postgres:17.11.0.005", n8n: "n8nio/n8n:2.44.4", kong: "envoyproxy/envoy:v1.39.1" }), []);
});

test("Rückfall hält Dienste auf dem Image von vorher (images.override.yml), ohne Einträge keine Datei", () => {
  assert.equal(overrideYaml({}), null);
  const text = overrideYaml({ n8n: "n8nio/n8n:2.40.7", db: "supabase/postgres:17.6.1.136" });
  assert.match(text, /services:\n {2}db:\n {4}image: supabase\/postgres:17\.6\.1\.136\n {2}n8n:\n {4}image: n8nio\/n8n:2\.40\.7\n$/);
});

test("Systemversionen auf dem Server: Images statt Docker Desktop und Supabase CLI, Anzahl bereit", () => {
  const raw = { docker: {}, supabaseCli: {}, supabaseImages: null, n8n: { current: "2.40.7", latest: "2.44.4" }, node: { current: "24.1.0", latest: "24.1.0", lts: null }, npm: [],
    server: { images: [{ service: "n8n", running: "n8nio/n8n:2.40.7", wanted: "n8nio/n8n:2.44.4" }, { service: "kong", running: "envoyproxy/envoy:v1.39.1", wanted: "envoyproxy/envoy:v1.39.1" }] } };
  const rows = versionRows(raw);
  assert.deepEqual(rows.map((row) => row.key), ["server_images", "n8n", "node", "npm"]);
  assert.equal(rows[0].pending, 1);
  assert.equal(rows[0].text, "Update bereit");
  assert.deepEqual(rows[0].items, [{ name: "n8n", current: "2.40.7", latest: "2.44.4" }]);
  assert.match(rows[1].how, /Update einspielen/);
  const same = versionRows({ ...raw, server: { images: [raw.server.images[1]] } })[0];
  assert.equal(same.level, "current");
  assert.equal(same.pending, 0);
  assert.equal(versionRows({ ...raw, server: { images: null } })[0].text, "Nicht geprüft");
  assert.ok(versionRows({ ...raw, server: null }).some((row) => row.key === "docker"), "auf dem Rechner unverändert");
});

test("Verlauf der Systemupdates", () => {
  const now = new Date("2026-10-23T10:00:00Z");
  const row = (extra) => ({ id: "u", requested_at: "2026-10-23T09:55:00Z", started_at: null, finished_at: null, status: "requested", changes: [], pre_backup_file: null, error: null, requester: null, ...extra });
  assert.equal(imageUpdateActive(row(), now), true);
  assert.equal(imageUpdateStatus(row({ status: "running" }), now).label, "Läuft");
  assert.equal(imageUpdateStatus(row({ status: "running", requested_at: "2026-10-23T08:00:00Z" }), now).label, "Nicht abgeschlossen");
  assert.equal(imageUpdateStatus(row({ status: "ok" }), now).tone, "done");
  assert.equal(imageUpdateStatus(row({ status: "rolled_back", error: "x" }), now).label, "Fehlgeschlagen, Stand von vorher läuft");
  assert.equal(imageChanges(row({ changes: [{ service: "n8n", from: "2.40.7", to: "2.44.4" }] })), "n8n 2.40.7 → 2.44.4");
  assert.equal(imageChanges(row()), "–");
});

test("E-Mail „Update bereit“ einmal je Versionsstand (task-29-1)", () => {
  const rows = (items) => [{ key: "n8n" }, { key: "server_images", items }];
  const ready = [{ name: "kong", current: "v1.40.0", latest: "v1.40.1" }, { name: "db", current: "17.11.0.005", latest: "17.11.0.007" }];
  const first = updateReadyMail(rows(ready), null);
  assert.equal(first.key, "db:17.11.0.007,kong:v1.40.1");
  assert.equal(first.mail.subject, "Systemupdate bereit: kong v1.40.0 → v1.40.1, db 17.11.0.005 → 17.11.0.007");
  assert.match(first.mail.text, /„Update einspielen“/);
  assert.deepEqual(updateReadyMail(rows([...ready].reverse()), first.key), { key: first.key, mail: null });
  const newer = updateReadyMail(rows([{ ...ready[0], latest: "v1.40.2" }, ready[1]]), first.key);
  assert.ok(newer.mail);
  assert.deepEqual(updateReadyMail(rows([]), first.key), { key: null, mail: null });
  assert.deepEqual(updateReadyMail([{ key: "npm" }], null), { key: null, mail: null });
});
