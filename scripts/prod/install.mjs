// Set up the production copy and the app service (task-17-1), safe to run again.
// npm run prod:install
//   1. ~/RheinWerk-Prod with repo/ (clone of origin), releases/, shared/, logs/
//   2. shared/.env.local as a copy of the .env.local of this folder (only if missing; mode 600)
//   3. LaunchAgents online.rheinwerk.web (app), online.rheinwerk.update (02:00), online.rheinwerk.requests (every
//      minute) and online.rheinwerk.watchdog (every 5 minutes, task-17-9) from ops/launchd/, loaded once a release is active
// Then: npm run prod:release (builds origin/main and starts the service).
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CURRENT, LABEL, LAUNCH_AGENTS, PORT, PROD_DIR, REPO, SHARED_ENV, REQUESTS_LABEL, TOOLS, UPDATE_LABEL, WATCHDOG_LABEL, ensureLayout, listReleases, run, serviceLoaded, switchTo } from "./lib.mjs";

ensureLayout();

if (existsSync(REPO)) {
  console.log(`Klon vorhanden: ${REPO}`);
} else {
  const url = process.env.PROD_REPO_URL ?? run("git", ["remote", "get-url", "origin"]).trim();
  run("git", ["clone", "--quiet", url, REPO]);
  console.log(`Geklont: ${url} → ${REPO}`);
}

if (existsSync(SHARED_ENV)) {
  console.log(`Umgebung vorhanden: ${SHARED_ENV}`);
} else if (existsSync(".env.local")) {
  copyFileSync(".env.local", SHARED_ENV);
  chmodSync(SHARED_ENV, 0o600);
  console.log(`Umgebung kopiert: .env.local → ${SHARED_ENV} (für den Betrieb dort anpassen, nicht im Entwicklungsordner)`);
} else {
  console.error(`.env.local fehlt; ${SHARED_ENV} von Hand anlegen.`);
  process.exit(1);
}

// LaunchAgents from ops/launchd/: the app service and the nightly update (task-17-5). An unchanged agent stays loaded
// as it is; a changed one is unloaded, rewritten and loaded again.
function installAgent(label, replacements) {
  let plist = readFileSync(path.join("ops", "launchd", `${label}.plist`), "utf8");
  for (const [key, value] of Object.entries(replacements)) plist = plist.replaceAll(key, value);
  const file = path.join(LAUNCH_AGENTS, `${label}.plist`);
  const changed = !existsSync(file) || readFileSync(file, "utf8") !== plist;
  if (changed) {
    if (serviceLoaded(label)) run("launchctl", ["bootout", `gui/${process.getuid()}`, file]);
    writeFileSync(file, plist);
    console.log(`Geschrieben: ${file}`);
  }
  if (existsSync(CURRENT) && !serviceLoaded(label)) run("launchctl", ["bootstrap", `gui/${process.getuid()}`, file]);
}

// The update and request agents run their scripts from tools (newest build); later runs keep it current
if (!existsSync(TOOLS) && listReleases()[0]) switchTo(listReleases()[0].commit, TOOLS);

installAgent(LABEL, { __PROD_DIR__: PROD_DIR, __PORT__: String(PORT) });
installAgent(UPDATE_LABEL, { __PROD_DIR__: PROD_DIR });
installAgent(REQUESTS_LABEL, { __PROD_DIR__: PROD_DIR });
installAgent(WATCHDOG_LABEL, { __PROD_DIR__: PROD_DIR });
if (!existsSync(CURRENT)) {
  console.log("Noch kein Release aktiv. Weiter mit: npm run prod:release, danach npm run prod:install");
} else {
  console.log(`App-Dienst ${LABEL} aus ${CURRENT} auf http://127.0.0.1:${PORT}`);
  console.log(`Nächtliches Update ${UPDATE_LABEL} täglich 02:00 (Protokoll ${path.join(PROD_DIR, "logs", "update.log")})`);
  console.log(`Anfragen aus dem Dashboard ${REQUESTS_LABEL} jede Minute (Protokoll ${path.join(PROD_DIR, "logs", "requests.log")})`);
  console.log(`Wächter ${WATCHDOG_LABEL} alle 5 Minuten (Protokoll ${path.join(PROD_DIR, "logs", "watchdog.log")})`);
}
