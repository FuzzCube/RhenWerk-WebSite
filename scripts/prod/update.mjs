// Nightly update of the production copy (task-17-5, user decision 21.10.2026), launchd online.rheinwerk.update 02:00:
//   1. origin/main fetched; available commit, commits not installed yet, npm and n8n updates (only shown) → system_status
//   2. daily backup with restore check (every night, also without a new commit); if it fails: no update, warning
//   3. no new commit: record no_change
//   4. new commit: build the release, supabase migration up, switch, /api/health with the new commit
//   5. failure: build or migration → current stays; app does not answer → back to the previous release
//      (migrations stay, they are written forward only); record failed/rolled_back, warning + e-mail to the admin
// E-mails only on failures (and "wieder in Ordnung" after one); success is visible in the dashboard.
// npm run prod:update [-- --dry-run]       by hand (trigger cli), environment from ~/RheinWerk-Prod/shared/.env.local
// npm run prod:update -- --ref <ref>       by hand: another ref of ~/RheinWerk-Prod/repo instead of origin/main
// launchd: node --env-file=…/shared/.env.local …/current/scripts/prod/update.mjs --nightly
import path from "node:path";
import { sendAlert } from "../lib/notify.mjs";
import {
  CURRENT, PROD_DIR, RELEASES, REPO, SHARED_ENV, acquireLock, activate, build, currentCommit, ensureLayout, fetchOrigin, log, prune,
  readRelease, releaseLock, removeRelease, resolveCommit, rpc, run, runLog, syncReleases,
} from "./lib.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const trigger = args.includes("--nightly") ? "nightly" : "cli";
// Only by hand: another ref of the clone instead of origin/main (tests of the failure paths with local commits)
const refIndex = args.indexOf("--ref");
const ref = trigger === "cli" && refIndex >= 0 ? args[refIndex + 1] : "origin/main";
const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
const N8N = process.env.N8N_CONTAINER ?? "n8n";
const short = (commit) => commit?.slice(0, 7) ?? "–";

ensureLayout();
if (!acquireLock()) {
  console.error(`Ein anderer Lauf ist aktiv (${PROD_DIR}/.lock).`);
  process.exit(1);
}
let exitCode = 0;
try {
  exitCode = await main();
} catch (error) {
  exitCode = 1;
  log(`FEHLER: ${error.message.split("\n")[0]}`);
  await warn("update:failed", "Update-Lauf abgebrochen", `${error.message}\n\n${excerpt()}`);
} finally {
  if (!dryRun) await syncReleases();
  releaseLock();
}
process.exit(exitCode);

async function main() {
  log(`Update-Lauf (${trigger}${dryRun ? ", Probelauf" : ""}) in ${PROD_DIR}`);
  fetchOrigin();
  const target = resolveCommit(ref);
  const from = currentCommit();
  const pending = pendingCommits(from, target);
  const status = { available_commit: target, pending_commits: pending, dependency_updates: dependencyUpdates() };
  log(`Aktiv ${short(from)}, ${ref} ${short(target)}, ${pending.length} neue Commit(s)`);
  for (const commit of pending.slice(0, 10)) log(`  ${short(commit.commit)} ${commit.subject}`);
  log(`Verfügbar, nicht installiert: ${describeDependencies(status.dependency_updates)}`);

  if (dryRun) {
    log(from === target ? "Probelauf: Sicherung, danach no_change" : `Probelauf: Sicherung, Build ${short(target)}, Migrationen, Umschalten`);
    return 0;
  }
  await rpc("set_system_status", { payload: status });

  // Daily backup first; without a restorable backup no update
  let backupFile = null;
  try {
    backupFile = backup();
    await recover("backup:failed", "Tägliche Sicherung");
  } catch (error) {
    log(`FEHLER: Sicherung: ${error.message.split("\n")[0]}`);
    await warn("backup:failed", "Tägliche Sicherung fehlgeschlagen",
      `Die Sicherung oder ihre Prüfung ist fehlgeschlagen${from === target ? "" : "; das Update wurde deshalb nicht ausgeführt"}.\n\n${excerpt()}`);
    if (from !== target) await record("failed", from, target, { error: "Sicherung fehlgeschlagen, kein Update" });
    return 1;
  }

  if (from === target) {
    log(`Keine Änderung auf ${ref}`);
    await record("no_change", from, target, { backup_file: backupFile });
    // The newest commit runs: a warning of an earlier failed update is settled
    await recover("update:failed", "Update");
    return 0;
  }

  const entry = await rpc("start_system_update", { kind: "update", trigger, from_commit: from, to_commit: target });
  const finish = async (statusValue, extra) => {
    if (entry) await rpc("finish_system_update", { update_id: entry.id, status: statusValue, backup_file: backupFile, log_excerpt: excerpt(extra?.buildLog), ...extra?.fields });
  };

  try {
    if (readRelease(target)) log(`Release ${short(target)} ist bereits gebaut`);
    else build(target);
  } catch (error) {
    log(`FEHLER: ${error.message.split("\n")[0]}`);
    await finish("failed", { buildLog: error.buildLog, fields: { error: error.message.split("\n")[0] } });
    await warn("update:failed", `Update auf ${short(target)} fehlgeschlagen (Build)`,
      `Der Build von ${short(target)} ist fehlgeschlagen. Es läuft weiter ${short(from)}.\n\n${excerpt(error.buildLog)}`);
    return 1;
  }

  let migrations = [];
  try {
    migrations = migrate(target);
  } catch (error) {
    log(`FEHLER: Migration: ${error.message.split("\n")[0]}`);
    removeRelease(target);
    await finish("failed", { fields: { error: `Migration fehlgeschlagen: ${error.message.split("\n")[0]}`, migrations: error.applied ?? [] } });
    await warn("update:failed", `Update auf ${short(target)} fehlgeschlagen (Migration)`,
      `Eine Migration von ${short(target)} ist fehlgeschlagen; es läuft weiter ${short(from)}. Bereits angewandte Migrationen: ${(error.applied ?? []).join(", ") || "keine"}.\n\n${excerpt()}`);
    return 1;
  }

  const result = await activate(target);
  if (result.ok) {
    await finish("succeeded", { fields: { migrations } });
    await recover("update:failed", "Update");
    log(`Update ${short(from)} → ${short(target)} erfolgreich`);
  } else {
    if (result.restored) removeRelease(target);
    await finish(result.restored ? "rolled_back" : "failed", { fields: { migrations, error: `App antwortet nicht mit ${short(target)}` } });
    await warn("update:failed", `Update auf ${short(target)} zurückgerollt`,
      `Die App antwortete nach dem Umschalten nicht mit ${short(target)}. ${result.restored ? `Es läuft wieder ${short(from)}.` : "AUCH DER RÜCKFALL ANTWORTET NICHT – App prüfen."}` +
      `${migrations.length ? `\nAngewandte Migrationen bleiben: ${migrations.join(", ")}.` : ""}\n\n${excerpt()}`);
  }
  prune();
  await rpc("set_system_status", { payload: { ...status, pending_commits: result.ok ? [] : pending } });
  return result.ok ? 0 : 1;
}

// Run without a build (no_change, or a failed backup before the update)
async function record(statusValue, from, target, fields) {
  const entry = await rpc("start_system_update", { kind: "update", trigger, from_commit: from, to_commit: target });
  if (entry) await rpc("finish_system_update", { update_id: entry.id, status: statusValue, log_excerpt: excerpt(), ...fields });
}

function pendingCommits(from, target) {
  if (from === target) return [];
  const range = from ? `${from}..${target}` : target;
  try {
    return run("git", ["-C", REPO, "log", "--format=%H%x09%cI%x09%s", "-n", "50", range]).trim().split("\n").filter(Boolean)
      .map((line) => { const [commit, committed_at, ...subject] = line.split("\t"); return { commit, committed_at, subject: subject.join("\t") }; });
  } catch {
    return [];
  }
}

// Only shown, never installed (user decision 21.10.2026)
function dependencyUpdates() {
  const result = { checked_at: new Date().toISOString(), npm: [], n8n: null };
  try {
    let out = "";
    try { out = run("npm", ["outdated", "--json"], { cwd: CURRENT, stdio: ["ignore", "pipe", "ignore"] }); } catch (error) { out = error.stdout ?? ""; }
    result.npm = Object.entries(JSON.parse(out || "{}")).map(([name, info]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest }))
      .filter((entry) => entry.current !== entry.latest);
  } catch { result.npm = null; }
  try {
    const current = run("docker", ["exec", N8N, "n8n", "--version"]).trim();
    const latest = run("npm", ["view", "n8n", "version"]).trim();
    result.n8n = { current, latest, update: current !== latest };
  } catch { /* n8n or registry not reachable */ }
  return result;
}

function describeDependencies(deps) {
  const npm = deps.npm === null ? "npm nicht geprüft" : `${deps.npm.length} npm-Paket(e)`;
  const n8n = deps.n8n ? (deps.n8n.update ? `n8n ${deps.n8n.current} → ${deps.n8n.latest}` : `n8n ${deps.n8n.current} aktuell`) : "n8n nicht geprüft";
  return `${npm}, ${n8n}`;
}

// backup and backup:check of the active release with the shared environment; returns the archive
function backup() {
  const scripts = path.join(CURRENT, "scripts");
  const options = { cwd: CURRENT, stdio: ["ignore", "pipe", "pipe"] };
  const created = run("node", [`--env-file=${SHARED_ENV}`, path.join(scripts, "backup.mjs")], options);
  for (const line of created.trim().split("\n")) log(`  ${line}`);
  const file = created.match(/Sicherung erstellt: (\S+)/)?.[1] ?? null;
  const checked = run("node", [`--env-file=${SHARED_ENV}`, path.join(scripts, "backup-check.mjs"), ...(file ? [file] : [])], options);
  log(`  ${checked.trim().split("\n").at(-1)}`);
  return file;
}

function appliedMigrations() {
  return run("docker", ["exec", DB, "psql", "-U", "postgres", "-Atc", "select version from supabase_migrations.schema_migrations order by version"])
    .trim().split("\n").filter(Boolean);
}

// supabase migration up from the new release (same project_id, so the same local stack); returns the new versions
function migrate(commit) {
  const before = new Set(appliedMigrations());
  try {
    const out = run("supabase", ["migration", "up", "--local"], { cwd: path.join(RELEASES, commit), stdio: ["ignore", "pipe", "pipe"] });
    const applied = appliedMigrations().filter((version) => !before.has(version));
    log(applied.length ? `Migrationen angewandt: ${applied.join(", ")}` : "Keine neuen Migrationen");
    if (out.trim()) runLog.push(out.trim().slice(-2000));
    return applied;
  } catch (error) {
    error.applied = appliedMigrations().filter((version) => !before.has(version));
    runLog.push(String(error.stderr ?? error.message).slice(-4000));
    throw error;
  }
}

function excerpt(extra) {
  return [...runLog, ...(extra ? ["--- Build-Protokoll (Ende) ---", extra] : [])].join("\n").slice(-20000);
}

// Warning in the dashboard; e-mail when the database says so (new incident, reminder) or when the database is
// unreachable (no record possible, so better one e-mail too many)
async function warn(key, title, detail) {
  const alert = await rpc("raise_alert", { source: key.startsWith("backup") ? "backup" : "update", alert_key: key, severity: "critical", title, detail: detail.slice(0, 4000) });
  if (alert && !alert.notify) return;
  const mail = await sendAlert({ subject: title, text: `${detail}\n\nServer: ${PROD_DIR}\nProtokoll: ${path.join(PROD_DIR, "logs")}` });
  if (mail.ok && alert) await rpc("mark_alert_notified", { alert_id: alert.alert_id });
}

async function recover(key, title) {
  const cleared = await rpc("clear_alert", { alert_key: key });
  if (cleared?.notify) await sendAlert({ subject: `Wieder in Ordnung: ${title}`, text: `${title} läuft wieder fehlerfrei.\n\n${excerpt().slice(-3000)}` });
}
