// Unit tests for the system checks and versions of the watchdog (task-17-15, scripts/ops/systems.mjs, versions.mjs).
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateSystems, tunnelConnections } from "../../scripts/ops/systems.mjs";
import { advise, compareVersions, versionRows } from "../../scripts/ops/versions.mjs";
import { checkRequestState, isStale, versionStatus } from "../../lib/system-monitoring.ts";

const GB = 1024 ** 3;
const container = (name, state = "running", status = "Up 3 hours (healthy)") => ({ name, image: "x", state, status });
const REQUIRED = ["db", "kong", "auth", "rest", "storage", "realtime"].map((s) => container(`supabase_${s}_P`));
const healthy = () => ({
  website: { status: 200, ms: 80 },
  database: { ok: true, ms: 30 },
  tunnel: { mode: "container", name: "cf", running: true, connections: ["fra10", "fra18", "fra10", "fra19"] },
  smtp: { ok: true },
  docker: { ok: true, version: "29.8.2", containers: [...REQUIRED, container("n8n")] },
  disk: { free: 100 * GB, total: 900 * GB },
  n8nContainer: "n8n",
});
const failed = (systems) => Object.values(systems).flatMap((s) => s.checks).filter((c) => c.ok === false).map((c) => c.key);

test("alles in Ordnung: jedes System mit Zustand ok und Kurzangabe", () => {
  const systems = evaluateSystems(healthy());
  assert.deepEqual(Object.keys(systems), ["website", "database", "tunnel", "smtp", "docker", "disk"]);
  assert.ok(Object.values(systems).every((s) => s.state === "ok"));
  assert.equal(systems.website.summary, "Antwort in 80 ms");
  assert.equal(systems.tunnel.summary, "4 Verbindungen zu Cloudflare (fra10, fra18, fra19)");
  assert.equal(systems.disk.summary, "100 GB von 900 GB frei");
  assert.equal(systems.smtp.stale_after_minutes, 75);
});

test("ausgefallene Systeme sind kritisch, Website mit 503 läuft (die Datenbank meldet sich selbst)", () => {
  const raw = healthy();
  raw.website = { status: 0, error: "ECONNREFUSED" };
  raw.database = { ok: false, error: "Zeitüberschreitung" };
  raw.tunnel = { mode: "container", name: "cf", running: false };
  raw.smtp = { ok: false, error: "535 Invalid login" };
  raw.docker = { ok: false, error: "Cannot connect to the Docker daemon", containers: [] };
  const systems = evaluateSystems(raw);
  assert.deepEqual(failed(systems), ["system:website", "system:datenbank", "system:tunnel", "system:smtp", "system:docker"]);
  assert.ok(["website", "database", "tunnel", "smtp", "docker"].every((key) => systems[key].state === "critical"));
  assert.match(systems.tunnel.checks[0].detail, /docker start cf/);
  const site = healthy();
  site.website = { status: 503, ms: 40 };
  assert.equal(evaluateSystems(site).website.state, "ok");
});

test("Tunnel ohne Verbindung, Tunnel nicht gefunden", () => {
  const raw = healthy();
  raw.tunnel = { mode: "container", name: "cf", running: true, connections: [] };
  assert.equal(evaluateSystems(raw).tunnel.checks[0].title, "Cloudflare-Tunnel ohne Verbindung");
  raw.tunnel = { mode: "none" };
  assert.equal(evaluateSystems(raw).tunnel.checks[0].title, "Cloudflare-Tunnel läuft nicht");
  raw.tunnel = { mode: "process", running: true, connections: null };
  assert.equal(evaluateSystems(raw).tunnel.summary, "cloudflared läuft");
});

test("Container: Pflicht-Container gestoppt oder fehlend, laufende unhealthy; optionale gestoppte zählen nicht", () => {
  const raw = healthy();
  raw.docker.containers = [...REQUIRED.slice(1), container("supabase_edge_runtime_P", "exited", "Exited (15) 6 days ago"), container("n8n-old", "exited", "Exited (0)")];
  raw.docker.containers.push(container("supabase_studio_P", "running", "Up 1 hour (unhealthy)"));
  const { docker } = evaluateSystems(raw);
  assert.equal(docker.state, "critical");
  const c = docker.checks.find((x) => x.key === "system:container");
  assert.equal(c.title, "3 Container gestört");
  assert.match(c.detail, /supabase_studio_P: Up 1 hour \(unhealthy\)/);
  assert.match(c.detail, /supabase_db: fehlt/);
  assert.match(c.detail, /n8n: fehlt/);
  assert.doesNotMatch(c.detail, /edge_runtime|n8n-old/);
});

test("VPS (task-18-2): Website abgeschaltet, Supabase ohne Realtime, n8n unter eigenem Namen", () => {
  const raw = healthy();
  raw.website = { off: true };
  raw.n8nContainer = "rheinwerk-n8n";
  raw.docker.containers = [...["db", "kong", "auth", "rest", "storage"].map((s) => container(`supabase_${s}_rheinwerk`)), container("rheinwerk-n8n")];
  const env = { SUPABASE_REQUIRED_SERVICES: "db,kong,auth,rest,storage" };
  const systems = evaluateSystems(raw, env);
  assert.deepEqual(failed(systems), []);
  assert.equal(systems.website.state, "off");
  assert.equal(systems.docker.state, "ok");
  assert.deepEqual(failed(evaluateSystems(raw)), ["system:container"]);
  assert.match(evaluateSystems(raw).docker.checks[1].detail, /supabase_realtime: fehlt/);
});

test("Speicherplatz: Warnung unter 20 GB, kritisch unter 5 GB, Schwellen aus der Umgebung", () => {
  const raw = healthy();
  raw.disk = { free: 12 * GB, total: 926 * GB };
  const warn = evaluateSystems(raw).disk;
  assert.equal(warn.state, "warning");
  assert.equal(warn.checks[0].title, "Wenig Speicherplatz: 12 GB frei");
  raw.disk = { free: 4 * GB, total: 926 * GB };
  assert.equal(evaluateSystems(raw).disk.state, "critical");
  raw.disk = { free: 12 * GB, total: 926 * GB };
  assert.equal(evaluateSystems(raw, { DISK_WARN_GB: "10" }).disk.state, "ok");
});

test("SMTP: ohne Zugangsdaten übersprungen, zwischen den stündlichen Prüfungen nicht neu bewertet", () => {
  const raw = healthy();
  raw.smtp = { ok: null, error: "fehlt" };
  const systems = evaluateSystems(raw);
  assert.equal(systems.smtp.state, "off");
  assert.equal(systems.smtp.checks[0].ok, null);
  raw.smtp = { carried: { state: "ok" } };
  assert.equal(evaluateSystems(raw).smtp, undefined);
});

test("Tunnelverbindungen aus dem Protokoll von cloudflared", () => {
  const log = [
    "INF Registered tunnel connection connIndex=0 connection=a event=0 ip=1 location=fra18 protocol=quic",
    "INF Registered tunnel connection connIndex=1 connection=b event=0 ip=1 location=fra10 protocol=quic",
    "WRN Connection terminated error=x connIndex=1",
    "ERR Request failed error=origin connIndex=0 dest=https://n8n",
  ].join("\n");
  assert.deepEqual(tunnelConnections(log), ["fra18"]);
  assert.deepEqual(tunnelConnections(`${log}\nINF Registered tunnel connection connIndex=1 location=fra19`), ["fra18", "fra19"]);
});

test("Versionen vergleichen und empfehlen", () => {
  assert.ok(compareVersions("4.96.1", "4.95.0") > 0);
  assert.equal(compareVersions("v26.7.0", "26.7.0"), 0);
  assert.equal(advise("26.7.0", "26.12.1").level, "update");
  assert.equal(advise("2.40.7", "2.40.7").level, "current");
  assert.equal(advise("2.40.7", "2.40.6").level, "current");
  assert.equal(advise("5.9.3", "6.0.2").level, "major");
  assert.equal(advise(null, "1.0.0").level, "unknown");
  assert.equal(versionStatus("major").label, "Neue Hauptversion");
});

test("Versionszeilen mit Release Notes; Supabase-Images gegen die CLI; npm mit Hauptversionen", () => {
  const rows = versionRows({
    docker: { current: "4.95.0", latest: "4.96.1" },
    supabaseCli: { current: "2.120.0", latest: "2.121.0" },
    supabaseImages: [{ name: "supabase/postgres", running: "17.11.0.004", expected: "17.11.0.004" }, { name: "supabase/gotrue", running: "v2.197.0", expected: "v2.198.0" }],
    n8n: { current: "2.40.7", latest: "2.44.5" },
    node: { current: "24.1.0", latest: "24.9.0", lts: { version: "26.12.1", codename: "Xenon" } },
    npm: [{ name: "next", current: "16.3.8", wanted: "16.3.8", latest: "16.4.0" }, { name: "typescript", current: "5.9.3", wanted: "5.9.3", latest: "6.0.2" }],
  });
  assert.deepEqual(rows.map((r) => r.key), ["docker", "supabase_cli", "supabase_images", "n8n", "node", "npm"]);
  assert.ok(rows.every((r) => r.notes.startsWith("https://")));
  const by = Object.fromEntries(rows.map((r) => [r.key, r]));
  assert.equal(by.docker.text, "Update empfohlen");
  assert.equal(by.supabase_images.latest, "1 neuer zur CLI");
  assert.deepEqual(by.supabase_images.items, [{ name: "supabase/gotrue", current: "v2.197.0", latest: "v2.198.0" }]);
  assert.equal(by.node.notes, "https://nodejs.org/en/blog/release/v24.9.0");
  assert.match(by.node.hint, /26\.12\.1/);
  assert.equal(by.npm.level, "major");
  assert.equal(by.npm.text, "Update empfohlen, 1 neue Hauptversion");
  const none = versionRows({ docker: {}, supabaseCli: {}, supabaseImages: null, n8n: {}, node: { current: "26.7.0", latest: null, lts: null }, npm: [] });
  assert.ok(none.filter((r) => r.key !== "npm").every((r) => r.level === "unknown"));
  assert.equal(none.find((r) => r.key === "npm").level, "current");
});

test("„System prüfen“: angefordert, läuft, hängt, nach 10 Minuten wieder frei; SMTP veraltet erst nach 75 Minuten", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const ago = (minutes) => new Date(now.getTime() - minutes * 60_000).toISOString();
  assert.equal(checkRequestState({ requested_at: null, started_at: null }, now), "idle");
  assert.equal(checkRequestState({ requested_at: ago(0.5), started_at: null }, now), "waiting");
  assert.equal(checkRequestState({ requested_at: ago(1), started_at: ago(0.5) }, now), "running");
  assert.equal(checkRequestState({ requested_at: ago(3), started_at: null }, now), "stuck");
  assert.equal(checkRequestState({ requested_at: ago(11), started_at: null }, now), "idle");
  assert.equal(isStale({ checked_at: ago(60), stale_after_minutes: 75 }, now), false);
  assert.equal(isStale({ checked_at: ago(76), stale_after_minutes: 75 }, now), true);
  assert.equal(isStale({ checked_at: ago(16) }, now), true);
});
