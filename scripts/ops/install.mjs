// Services on the host (task-17-17), safe to run again: npm run ops:install
//   online.rheinwerk.backup    02:00, backup with restore check and versions (scripts/ops/nightly.mjs)
//   online.rheinwerk.watchdog  every 5 minutes, checks of Mira, n8n and the systems (scripts/ops/watchdog.mjs)
//   online.rheinwerk.systemcheck  every 20 seconds, "System prüfen" from the dashboard (scripts/ops/check.mjs, task-17-15)
// All run from this development folder with its .env.local; logs in ~/Library/Logs/RheinWerk. Agents of the former
// production copy (online.rheinwerk.web, .update, .requests, task-17-1 to 17-6) are removed.
// npm run ops:install -- --remove unloads and removes the services.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const AGENTS = ["online.rheinwerk.backup", "online.rheinwerk.watchdog", "online.rheinwerk.systemcheck"];
const FORMER = ["online.rheinwerk.web", "online.rheinwerk.update", "online.rheinwerk.requests"];
const LAUNCH_AGENTS = path.join(homedir(), "Library", "LaunchAgents");
const LOG_DIR = path.join(homedir(), "Library", "Logs", "RheinWerk");
const domain = `gui/${process.getuid()}`;
const remove = process.argv.includes("--remove");

const loaded = (label) => {
  try { execFileSync("launchctl", ["print", `${domain}/${label}`], { stdio: "ignore" }); return true; } catch { return false; }
};
function unload(label) {
  const file = path.join(LAUNCH_AGENTS, `${label}.plist`);
  if (loaded(label)) execFileSync("launchctl", ["bootout", domain, file], { stdio: "ignore" });
  if (existsSync(file)) { rmSync(file); console.log(`Entfernt: ${label}`); }
}

for (const label of FORMER) unload(label);
if (remove) {
  for (const label of AGENTS) unload(label);
  process.exit(0);
}
if (!existsSync(".env.local")) {
  console.error(".env.local fehlt (docs/setup.md).");
  process.exit(1);
}
mkdirSync(LOG_DIR, { recursive: true });
// An unchanged agent stays loaded; a changed one is unloaded, rewritten and loaded again
for (const label of AGENTS) {
  const plist = readFileSync(path.join("ops", "launchd", `${label}.plist`), "utf8")
    .replaceAll("__PROJECT_DIR__", process.cwd()).replaceAll("__LOG_DIR__", LOG_DIR);
  const file = path.join(LAUNCH_AGENTS, `${label}.plist`);
  if (!existsSync(file) || readFileSync(file, "utf8") !== plist) {
    if (loaded(label)) execFileSync("launchctl", ["bootout", domain, file], { stdio: "ignore" });
    writeFileSync(file, plist);
    console.log(`Geschrieben: ${file}`);
  }
  if (!loaded(label)) execFileSync("launchctl", ["bootstrap", domain, file]);
}
console.log(`Sicherung online.rheinwerk.backup täglich 02:00 (Protokoll ${path.join(LOG_DIR, "backup.log")})`);
console.log(`Wächter online.rheinwerk.watchdog alle 5 Minuten (Protokoll ${path.join(LOG_DIR, "watchdog.log")})`);
console.log(`„System prüfen“ online.rheinwerk.systemcheck alle 20 Sekunden (Protokoll ${path.join(LOG_DIR, "systemcheck.log")})`);
