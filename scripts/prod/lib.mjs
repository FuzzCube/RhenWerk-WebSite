// Production copy (task-17-1): operation runs from ~/RheinWerk-Prod, never from the development folder.
//   repo/                 clone of origin (source of every release)
//   releases/<commit>/    one built release per commit (git archive + npm ci + next build), release.json when complete
//   current               symlink to the active release; the launchd service starts next start from it
//   shared/.env.local     one environment for all releases (each release links to it)
//   logs/                 web.log (app service), release.log (switches)
// PROD_DIR (default ~/RheinWerk-Prod), PROD_PORT (default 3200), PROD_KEEP_RELEASES (default 3).
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PROD_DIR = process.env.PROD_DIR ?? path.join(homedir(), "RheinWerk-Prod");
export const PORT = Number(process.env.PROD_PORT ?? 3200);
export const KEEP_RELEASES = Number(process.env.PROD_KEEP_RELEASES ?? 3);
export const LABEL = "online.rheinwerk.web";
export const REPO = path.join(PROD_DIR, "repo");
export const RELEASES = path.join(PROD_DIR, "releases");
export const CURRENT = path.join(PROD_DIR, "current");
export const SHARED_ENV = path.join(PROD_DIR, "shared", ".env.local");
export const LOGS = path.join(PROD_DIR, "logs");
export const PLIST = path.join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);

export const run = (command, args, options = {}) =>
  execFileSync(command, args, { maxBuffer: 256 * 1024 * 1024, encoding: "utf8", ...options });

export function ensureLayout() {
  for (const dir of [RELEASES, path.dirname(SHARED_ENV), LOGS]) mkdirSync(dir, { recursive: true });
}

export function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(message);
  appendFileSync(path.join(LOGS, "release.log"), line + "\n");
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

// Atomic switch: a new symlink is renamed over current, so the service never sees a missing link
export function switchTo(commit) {
  const temp = `${CURRENT}.tmp`;
  rmSync(temp, { force: true });
  symlinkSync(path.join(RELEASES, commit), temp);
  renameSync(temp, CURRENT);
}

export function serviceLoaded() {
  try { run("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" }); return true; } catch { return false; }
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

// The app answers when /login returns 200 (task-17-4 replaces this with /api/health)
export async function waitForApp(timeoutMs = 90_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/login`, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (response.status === 200) return true;
    } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  return false;
}
