// Production copy (task-17-1): operation runs from ~/RheinWerk-Prod, never from the development folder.
//   repo/                 clone of origin (source of every release)
//   releases/<commit>/    one built release per commit (git archive + npm ci + next build), release.json when complete
//   current               symlink to the active release; the launchd service starts next start from it
//   shared/.env.local     one environment for all releases (each release links to it)
//   logs/                 web.log (app service), release.log (switches), update.log (nightly run), build-<commit>.log
// PROD_DIR (default ~/RheinWerk-Prod), PROD_PORT (default 3200), PROD_KEEP_RELEASES (default 3).
import { execFileSync } from "node:child_process";
import {
  appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync,
  symlinkSync, writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

export const PROD_DIR = process.env.PROD_DIR ?? path.join(homedir(), "RheinWerk-Prod");
export const PORT = Number(process.env.PROD_PORT ?? 3200);
export const KEEP_RELEASES = Number(process.env.PROD_KEEP_RELEASES ?? 3);
export const LABEL = "online.rheinwerk.web";
export const UPDATE_LABEL = "online.rheinwerk.update";
export const REPO = path.join(PROD_DIR, "repo");
export const RELEASES = path.join(PROD_DIR, "releases");
export const CURRENT = path.join(PROD_DIR, "current");
export const SHARED_ENV = path.join(PROD_DIR, "shared", ".env.local");
export const LOGS = path.join(PROD_DIR, "logs");
export const LAUNCH_AGENTS = path.join(homedir(), "Library", "LaunchAgents");
export const PLIST = path.join(LAUNCH_AGENTS, `${LABEL}.plist`);
const LOCK = path.join(PROD_DIR, ".lock");

export const run = (command, args, options = {}) =>
  execFileSync(command, args, { maxBuffer: 256 * 1024 * 1024, encoding: "utf8", ...options });

export function ensureLayout() {
  for (const dir of [RELEASES, path.dirname(SHARED_ENV), LOGS]) mkdirSync(dir, { recursive: true });
}

// Lines of this run, also for the excerpt in system_updates
export const runLog = [];
export function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(message);
  runLog.push(line);
  appendFileSync(path.join(LOGS, "release.log"), line + "\n");
}

// One run at a time (release, update, dashboard request). A lock whose process no longer exists is taken over,
// so a crashed nightly run does not block the next one.
export function acquireLock() {
  try {
    mkdirSync(LOCK);
  } catch {
    let pid = 0;
    try { pid = Number(readFileSync(path.join(LOCK, "pid"), "utf8")); } catch { /* no pid file */ }
    let alive = false;
    if (pid) { try { process.kill(pid, 0); alive = true; } catch { /* gone */ } }
    if (alive || !pid) return false;
    log(`Verwaiste Sperre von Prozess ${pid} übernommen`);
  }
  writeFileSync(path.join(LOCK, "pid"), String(process.pid));
  return true;
}
export function releaseLock() {
  rmSync(LOCK, { recursive: true, force: true });
}

// Commit the symlink current points to, or null
export function currentCommit() {
  try { return path.basename(readlinkSync(CURRENT)); } catch { return null; }
}

export function readRelease(commit) {
  const file = path.join(RELEASES, commit, "release.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

// Complete releases, newest build first
export function listReleases() {
  if (!existsSync(RELEASES)) return [];
  return readdirSync(RELEASES).map(readRelease).filter(Boolean).sort((a, b) => b.built_at.localeCompare(a.built_at));
}

export function fetchOrigin() {
  run("git", ["-C", REPO, "fetch", "--quiet", "--prune", "origin"]);
}
export function resolveCommit(ref) {
  return run("git", ["-C", REPO, "rev-parse", `${ref}^{commit}`]).trim();
}

// Builds a commit into releases/<commit> (git archive, npm ci, next build); a failed build leaves nothing behind.
// Throws with the end of the build log in error.buildLog.
export function build(commit) {
  const short = commit.slice(0, 7);
  const target = path.join(RELEASES, commit);
  const work = `${target}.building`;
  const buildLog = path.join(LOGS, `build-${short}.log`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work);
  log(`Baue ${short} (Protokoll ${buildLog})`);
  const started = Date.now();
  const out = openSync(buildLog, "w");
  try {
    run("sh", ["-c", 'git -C "$1" archive "$2" | tar -x -C "$3"', "sh", REPO, commit, work]);
    symlinkSync(path.relative(work, SHARED_ENV), path.join(work, ".env.local"));
    run("npm", ["ci", "--no-audit", "--no-fund"], { cwd: work, stdio: ["ignore", out, out] });
    run("npm", ["run", "build"], { cwd: work, stdio: ["ignore", out, out] });
  } catch (error) {
    closeSync(out);
    rmSync(work, { recursive: true, force: true });
    const failure = new Error(`Build von ${short} fehlgeschlagen (${buildLog}): ${error.message.split("\n")[0]}`);
    failure.buildLog = readFileSync(buildLog, "utf8").slice(-8000);
    throw failure;
  }
  closeSync(out);
  const [subject, committedAt] = run("git", ["-C", REPO, "log", "-1", "--format=%s%n%cI", commit]).trim().split("\n");
  const migrations = readdirSync(path.join(work, "supabase", "migrations")).filter((file) => file.endsWith(".sql")).sort();
  const release = { commit, short, subject, committed_at: committedAt, built_at: new Date().toISOString(),
    build_seconds: Math.round((Date.now() - started) / 1000), last_migration: migrations.at(-1) ?? null };
  writeFileSync(path.join(work, "release.json"), JSON.stringify(release, null, 2) + "\n");
  run("mv", [work, target]);
  log(`Gebaut: ${short} „${subject}“ in ${release.build_seconds} s`);
  return release;
}

// Keep the newest KEEP_RELEASES builds; the active release is never removed, leftovers of aborted builds are
export function prune() {
  for (const dir of readdirSync(RELEASES)) {
    const full = path.join(RELEASES, dir);
    if (dir.endsWith(".building") || (statSync(full).isDirectory() && !readRelease(dir))) rmSync(full, { recursive: true, force: true });
  }
  const active = currentCommit();
  for (const release of listReleases().slice(KEEP_RELEASES)) {
    if (release.commit === active) continue;
    rmSync(path.join(RELEASES, release.commit), { recursive: true, force: true });
    log(`Altes Release ${release.short} entfernt (behalten: ${KEEP_RELEASES})`);
  }
}

// A release that failed its migrations or its check after the switch is no fallback target: removed, so that it does
// not push a working release out of the KEEP_RELEASES (its build log stays in logs/)
export function removeRelease(commit) {
  if (commit === currentCommit()) return;
  rmSync(path.join(RELEASES, commit), { recursive: true, force: true });
  log(`Release ${commit.slice(0, 7)} verworfen`);
}

// Atomic switch: a new symlink is renamed over current, so the service never sees a missing link
export function switchTo(commit) {
  const temp = `${CURRENT}.tmp`;
  rmSync(temp, { force: true });
  symlinkSync(path.join(RELEASES, commit), temp);
  renameSync(temp, CURRENT);
}

export function serviceLoaded(label = LABEL) {
  try { run("launchctl", ["print", `gui/${process.getuid()}/${label}`], { stdio: "ignore" }); return true; } catch { return false; }
}

// Loads the service from PLIST (written by npm run prod:install); false if there is none
export function loadService() {
  if (!existsSync(PLIST)) return false;
  if (!serviceLoaded()) run("launchctl", ["bootstrap", `gui/${process.getuid()}`, PLIST]);
  return true;
}

export function restartService() {
  run("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LABEL}`]);
}

// Switch to a release and restart the service; if the app does not answer with it, back to the previous one.
// Returns { ok, previous, restored }.
export async function activate(commit) {
  const previous = currentCommit();
  if (previous === commit) {
    log(`Release ${commit.slice(0, 7)} ist bereits aktiv`);
    return { ok: true, previous, restored: false };
  }
  switchTo(commit);
  log(`current → ${commit.slice(0, 7)} (vorher ${previous?.slice(0, 7) ?? "keins"})`);
  const wasLoaded = serviceLoaded();
  if (!loadService()) {
    log("App-Dienst ist nicht eingerichtet; nach npm run prod:install startet er aus current.");
    return { ok: true, previous, restored: false };
  }
  if (wasLoaded) restartService();
  if (await waitForApp(commit)) {
    log(`App antwortet auf Port ${PORT} mit ${commit.slice(0, 7)}`);
    return { ok: true, previous, restored: false };
  }
  log(`FEHLER: App antwortet nicht mit ${commit.slice(0, 7)} (${path.join(LOGS, "web.log")})`);
  if (!previous || !readRelease(previous)) return { ok: false, previous, restored: false };
  switchTo(previous);
  restartService();
  const back = await waitForApp(previous);
  log(`Rückfall auf ${previous.slice(0, 7)}: ${back ? "App antwortet" : "App antwortet weiterhin nicht"}`);
  return { ok: false, previous, restored: back };
}

// One value of the environment or of shared/.env.local (prod:release runs without --env-file)
export function sharedEnv(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(SHARED_ENV)) return "";
  const line = readFileSync(SHARED_ENV, "utf8").split("\n").find((entry) => entry.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).trim() : "";
}

// The release answers when /api/health returns 200 with its commit (task-17-4), so a still running old process does
// not count. Releases from before task-17-4 have no /api/health (404): there /login with 200 is enough.
export async function waitForApp(commit, timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  const headers = { Authorization: `Bearer ${sharedEnv("HEALTH_TOKEN")}` };
  while (Date.now() < until) {
    try {
      const health = await fetch(`http://127.0.0.1:${PORT}/api/health`, { headers, signal: AbortSignal.timeout(5000) });
      if (health.status === 200 && (await health.json()).commit === commit) return true;
      if (health.status === 404) {
        const login = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
        if (login.status === 200) return true;
      }
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}

// Database as service_role (functions of task-17-2). Calls never throw: without the database the run goes on and
// only the record in the dashboard is missing.
let client = null;
export async function rpc(name, args = {}) {
  try {
    client ??= createClient(sharedEnv("NEXT_PUBLIC_SUPABASE_URL"), sharedEnv("SUPABASE_SECRET_KEY"), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  } catch (error) {
    console.error(`Datenbank (${name}): ${error.message}`);
    return null;
  }
}

// Mirror of releases/ for the dashboard (system_releases, system_status.current_commit)
export function syncReleases() {
  const releases = listReleases().map(({ commit, subject, committed_at, built_at, last_migration }) =>
    ({ commit, subject, committed_at, built_at, last_migration }));
  return rpc("sync_system_releases", { releases, active_commit: currentCommit() });
}
