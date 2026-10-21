// Set up the production copy and the app service (task-17-1), safe to run again.
// npm run prod:install
//   1. ~/RheinWerk-Prod with repo/ (clone of origin), releases/, shared/, logs/
//   2. shared/.env.local as a copy of the .env.local of this folder (only if missing; mode 600)
//   3. ~/Library/LaunchAgents/online.rheinwerk.web.plist from ops/launchd/, loaded once a release is active
// Then: npm run prod:release (builds origin/main and starts the service).
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CURRENT, PLIST, PORT, PROD_DIR, REPO, SHARED_ENV, ensureLayout, loadService, restartService, run, serviceLoaded } from "./lib.mjs";

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

const template = readFileSync(path.join("ops", "launchd", "online.rheinwerk.web.plist"), "utf8");
const plist = template.replaceAll("__PROD_DIR__", PROD_DIR).replaceAll("__PORT__", String(PORT));
const changed = !existsSync(PLIST) || readFileSync(PLIST, "utf8") !== plist;
if (changed) {
  if (serviceLoaded()) run("launchctl", ["bootout", `gui/${process.getuid()}`, PLIST]);
  writeFileSync(PLIST, plist);
  console.log(`Dienst geschrieben: ${PLIST} (Port ${PORT})`);
}

if (!existsSync(CURRENT)) {
  console.log("Noch kein Release aktiv. Weiter mit: npm run prod:release");
} else {
  const wasLoaded = serviceLoaded();
  loadService();
  if (wasLoaded && !changed) restartService();
  console.log(`Dienst läuft aus ${CURRENT} auf http://127.0.0.1:${PORT}`);
}
