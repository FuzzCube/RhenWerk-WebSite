// "Update einspielen" in the area "System" (task-18-8), picked up by scripts/ops/check.mjs (rheinwerk-systemcheck) on
// the VPS. New image versions come as Dependabot PRs for ops/vps/docker-compose.yml and reach the server with the
// deployment (ops/vps/migrate.sh); the containers keep their image until this run:
//   1. backup with restore check (backup-run.mjs, reason pre_update); without it nothing changes
//   2. new images pulled while everything still runs
//   3. all services stopped, snapshot of every volume (database, Storage, n8n) as tar in the state folder
//   4. services started with the new images, read-only self test (selfTest)
//   5. on a failure in 2 to 4: services stopped, volumes back from the snapshot, the changed services pinned to their
//      previous image (images.override.yml), started, self test again (status rolled_back)
//   6. e-mail to the admin; a failure is the warning update:failed (critical), the next good update closes it
// Probe of the return: the file update-fail-selftest in the state folder makes the first self test fail.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { sendAlert } from "../lib/notify.mjs";
import { runBackup } from "./backup-run.mjs";
import { compose, composeServices, pendingImages, readPins, writePins } from "./images.mjs";
import { DASHBOARD, LOG_DIR, endMaintenance, report, rpc, startMaintenance } from "./lib.mjs";

const SNAPSHOTS = path.join(LOG_DIR, "snapshots");
const FAIL_FILE = path.join(LOG_DIR, "update-fail-selftest");
const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_rheinwerk";
const N8N = process.env.N8N_CONTAINER ?? "rheinwerk-n8n";
const N8N_URL = process.env.N8N_API_URL ?? "http://127.0.0.1:5678";
const run = (command, args, options = {}) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], ...options });
const stamp = (message) => console.log(`${new Date().toISOString()} ${message}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const psql = (sql) => run("docker", ["exec", DB, "psql", "-U", "postgres", "-d", "postgres", "-Atc", sql]).trim();

async function retry(label, test, seconds) {
  const until = Date.now() + seconds * 1000;
  let last = "";
  for (;;) {
    try {
      const result = await test();
      if (result === true) return;
      last = result || "falsche Antwort";
    } catch (error) {
      last = error.name === "TimeoutError" ? "Zeitüberschreitung" : error.message;
    }
    if (Date.now() > until) throw new Error(`${label}: ${last}`);
    await sleep(3000);
  }
}

async function activeWorkflows() {
  if (!process.env.N8N_API_KEY) return null;
  const response = await fetch(`${N8N_URL}/api/v1/workflows?active=true&limit=250`, { headers: { "X-N8N-API-KEY": process.env.N8N_API_KEY }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`n8n-API HTTP ${response.status}`);
  return (await response.json()).data.length;
}

// Every container of the project runs, those with a health check are healthy
async function waitHealthy(services) {
  await retry("Container", () => {
    const bad = services.filter((entry) => {
      try {
        const [state, health] = run("docker", ["inspect", "-f", "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}", entry.container]).trim().split(" ");
        return state !== "running" || (health && health !== "healthy");
      } catch { return true; }
    });
    return bad.length ? `nicht bereit: ${bad.map((entry) => entry.service).join(", ")}` : true;
  }, 180);
}

// Read-only self test: Supabase (database, migration state, privileges of the roles, REST, Auth, Storage) and n8n
// (healthz, number of active workflows as before, workflow "RheinWerk · Selbsttest" with the Supabase credential)
export async function selfTest({ workflows, probe = false, log }) {
  if (probe) throw new Error("Probe: Selbsttest absichtlich gescheitert (update-fail-selftest)");
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const get = (url, extra = {}) => fetch(url, { headers: { ...headers, ...extra }, signal: AbortSignal.timeout(10_000) });

  const latest = readdirSync("supabase/migrations").filter((file) => file.endsWith(".sql")).sort().at(-1).split("_")[0];
  const migration = psql("select max(version) from supabase_migrations.schema_migrations");
  if (migration !== latest) throw new Error(`Migrationsstand ${migration}, im Repository ${latest}`);
  const rights = psql(`select concat_ws(',', has_table_privilege('authenticated', 'public.requests', 'SELECT'),
    has_table_privilege('authenticated', 'public.profiles', 'UPDATE'), has_table_privilege('anon', 'public.requests', 'SELECT'))`);
  if (rights !== "t,f,f") throw new Error(`Rollenrechte falsch (authenticated liest Anfragen, ändert keine Profile, anon liest nichts): ${rights}`);
  await retry("Datenbank (REST)", async () => {
    const response = await get(`${base}/rest/v1/system_status?select=id`);
    return response.ok ? (await response.json()).length === 1 || "keine Zeile" : `HTTP ${response.status}`;
  }, 90);
  await retry("Anmeldung (Auth)", async () => {
    const response = await get(`${base}/auth/v1/admin/users?per_page=1`);
    return response.ok ? Array.isArray((await response.json()).users) || "keine Konten" : `HTTP ${response.status}`;
  }, 90);
  const object = psql("select name from storage.objects where bucket_id = 'dashboard' order by created_at desc limit 1");
  await retry("Dateien (Storage)", async () => {
    const response = object ? await get(`${base}/storage/v1/object/dashboard/${object.split("/").map(encodeURIComponent).join("/")}`) : await get(`${base}/storage/v1/bucket`);
    return response.ok || `HTTP ${response.status}`;
  }, 90);
  log("Supabase: Datenbank, Migrationen, Rollenrechte, REST, Anmeldung und Storage in Ordnung");

  await retry("n8n /healthz", () => {
    try {
      run("docker", ["exec", N8N, "node", "-e", "fetch('http://127.0.0.1:5678/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]);
      return true;
    } catch { return "keine Antwort"; }
  }, 180);
  // Right after a start the API and the webhooks come a little after /healthz (task-17-11)
  if (workflows !== null) await retry("n8n: aktive Workflows", async () => { const count = await activeWorkflows(); return count === workflows || `${count} statt ${workflows}`; }, 180);
  await retry("n8n: Workflow „RheinWerk · Selbsttest“", async () => {
    const response = await fetch(`${N8N_URL}/webhook/rheinwerk-selbsttest`, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? (await response.json()).ok === true || "Supabase nicht gelesen (Credential?)" : `HTTP ${response.status}`;
  }, 180);
  log(`n8n: healthz, ${workflows === null ? "aktive Workflows nicht geprüft (N8N_API_KEY fehlt)" : `${workflows} aktive Workflows`}, Selbsttest-Workflow in Ordnung`);
}

// Volumes as tar files through a helper container with the database image (busybox tar as root; owners, modes and
// links checked on the VPS on 22.10.2026)
function snapshot(volumes, helper, dir) {
  mkdirSync(dir, { recursive: true });
  for (const volume of volumes) {
    run("docker", ["run", "--rm", "--network", "none", "-v", `${volume}:/v:ro`, "-v", `${dir}:/s`, "--entrypoint", "tar", helper,
      "--numeric-owner", "-C", "/v", "-cf", `/s/${volume}.tar`, "."], { timeout: 15 * 60_000 });
  }
}
function restoreSnapshot(volumes, helper, dir) {
  for (const volume of volumes) {
    run("docker", ["run", "--rm", "--network", "none", "-v", `${volume}:/v`, "-v", `${dir}:/s:ro`, "--entrypoint", "sh", helper, "-c",
      `find /v -mindepth 1 -delete && tar --numeric-owner -xpf /s/${volume}.tar -C /v`], { timeout: 15 * 60_000 });
  }
}

export async function runImageUpdate(request) {
  startMaintenance("update", request.id);
  const steps = [];
  const log = (message) => { steps.push(message); stamp(`Update: ${message}`); };
  let status = "ok";
  let error = null;
  let pre = null;
  let changes = [];
  try {
    const pending = pendingImages();
    changes = pending.changes;
    if (!changes.length) {
      status = "no_change";
      log("Alle Dienste laufen mit dem Image aus dem Repository");
    } else {
      log(`Neue Versionen: ${changes.map((change) => `${change.service} ${change.from} → ${change.to}`).join(", ")}`);
      pre = await runBackup({ reason: "pre_update", requestedBy: request.requested_by });
      if (!pre) throw Object.assign(new Error("Die Sicherung vor dem Update ist fehlgeschlagen, es wurde nichts verändert"), { untouched: true });
      log(`Gesichert: ${pre.file_name}`);
      const workflows = await activeWorkflows().catch(() => null);
      const { volumes } = composeServices();
      const helper = pending.running.db;
      const pins = readPins();
      const dir = path.join(SNAPSHOTS, new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z"));
      let stopped = false;
      let snapshotDone = false;
      try {
        const without = Object.fromEntries(Object.entries(pins).filter(([service]) => !changes.some((change) => change.service === service)));
        writePins(without);
        compose(["pull", "--quiet", ...changes.map((change) => change.service)], { timeout: 20 * 60_000 });
        log("Neue Images geladen");
        compose(["stop"], { timeout: 5 * 60_000 });
        stopped = true;
        snapshot(Object.values(volumes), helper, dir);
        snapshotDone = true;
        log(`Schnappschuss der Volumes: ${Object.keys(volumes).join(", ")}`);
        compose(["up", "-d", "--remove-orphans"], { timeout: 10 * 60_000 });
        await waitHealthy(pending.services);
        log("Dienste mit neuen Images gestartet");
        await selfTest({ workflows, probe: existsSync(FAIL_FILE), log });
        log("Selbsttest bestanden");
        // Only the newest snapshot stays (manual return, docs/betrieb.md 6)
        for (const old of readdirSync(SNAPSHOTS).filter((entry) => path.join(SNAPSHOTS, entry) !== dir)) rmSync(path.join(SNAPSHOTS, old), { recursive: true, force: true });
      } catch (failure) {
        log(`FEHLER: ${failure.message}`);
        writePins({ ...pins, ...Object.fromEntries(changes.map((change) => [change.service, change.previous])) });
        if (!stopped) {
          // Nothing changed yet (pull failed): the pins keep the running images
          throw Object.assign(new Error(`${failure.message}; nichts verändert`), { untouched: true });
        }
        log("Rückfall auf Images und Daten von vorher");
        try {
          compose(["stop"], { timeout: 5 * 60_000 });
          if (snapshotDone) restoreSnapshot(Object.values(volumes), helper, dir);
          compose(["up", "-d", "--remove-orphans"], { timeout: 10 * 60_000 });
          await waitHealthy(pending.services);
          await selfTest({ workflows, log });
          log("Stand von vorher läuft, Selbsttest bestanden");
          status = "rolled_back";
          error = failure.message;
        } catch (returnFailure) {
          log(`FEHLER beim Rückfall: ${returnFailure.message}`);
          throw new Error(`${failure.message}; Rückfall fehlgeschlagen: ${returnFailure.message}`);
        }
      }
    }
  } catch (failure) {
    status = "failed";
    error = failure.message;
    if (!failure.untouched) {
      try { compose(["up", "-d"], { timeout: 10 * 60_000 }); } catch { /* reported below */ }
    }
  } finally {
    endMaintenance();
  }

  const detail = steps.join("\n");
  const summary = changes.map((change) => `${change.service} ${change.from} → ${change.to}`).join(", ");
  await rpc("finish_image_update", {
    update_id: request.id, status, changes: changes.map(({ service, from, to }) => ({ service, from, to })),
    pre_backup_file: pre?.file_name ?? null, error: error ? `${error}\n\n${detail}`.slice(0, 4000) : null,
  });
  if (status === "ok" || status === "no_change") {
    await report("update", { key: "update:failed", label: "Systemupdate", ok: true });
    if (status === "ok") await sendAlert({ subject: `Systemupdate eingespielt: ${summary}`, text: `${detail}\n\nGesichert vorher: ${pre.file_name}\n\n${DASHBOARD}` });
  } else {
    const rolledBack = status === "rolled_back";
    await report("update", {
      key: "update:failed", label: "Systemupdate", ok: false, severity: "critical",
      title: rolledBack ? "Systemupdate fehlgeschlagen, Stand von vorher läuft" : "Systemupdate fehlgeschlagen",
      detail: `${rolledBack
        ? `Das Update (${summary}) hat den Selbsttest nicht bestanden; Images und Daten von vorher laufen wieder (images.override.yml hält die Versionen). Ursache prüfen, dann erneut „Update einspielen“ oder den Dependabot-PR zurücknehmen.`
        : pre ? `Update und Rückfall sind fehlgeschlagen. Sofort prüfen: ops/vps/compose.sh ps, journalctl -u rheinwerk-systemcheck; Rückfall von Hand nach docs/betrieb.md 6 (Schnappschuss in ${SNAPSHOTS}, Sicherung ${pre.file_name}).`
          : "Es wurde nichts verändert."}\n\n${error}\n\n${detail}`,
    });
  }
  stamp(`Update: ${status}${error ? ` (${error})` : ""}`);
  return status;
}
