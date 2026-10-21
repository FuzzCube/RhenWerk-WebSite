// Build and activate a release in the production copy by hand (task-17-1, layout in scripts/prod/lib.mjs).
// The nightly run with backup, migrations and record in the dashboard is scripts/prod/update.mjs (task-17-5).
// npm run prod:release                 build origin/main (if not built yet), switch current, restart, check
// npm run prod:release -- <ref>        build another commit or branch of origin
// npm run prod:release -- --no-switch  only build
// npm run prod:release -- --switch <commit>  switch back to an existing release without building
// A failed build never touches current. If the app does not answer after a switch, the previous release is restored.
// No migrations: apply them with supabase migration up before switching.
import { existsSync } from "node:fs";
import {
  PROD_DIR, REPO, SHARED_ENV, acquireLock, activate, build, ensureLayout, fetchOrigin, listReleases, log, prune, readRelease,
  releaseLock, resolveCommit, syncReleases,
} from "./lib.mjs";

const args = process.argv.slice(2);
const noSwitch = args.includes("--no-switch");
const switchIndex = args.indexOf("--switch");
const switchOnly = switchIndex >= 0 ? args[switchIndex + 1] : null;
const ref = args.find((arg, index) => !arg.startsWith("--") && index !== switchIndex + 1) ?? "origin/main";

if (!existsSync(REPO) || !existsSync(SHARED_ENV)) {
  console.error(`Keine vollständige Produktionskopie unter ${PROD_DIR}. Zuerst: npm run prod:install`);
  process.exit(1);
}
ensureLayout();
if (!acquireLock()) {
  console.error(`Ein anderer Lauf ist aktiv (${PROD_DIR}/.lock).`);
  process.exit(1);
}

let exitCode = 0;
try {
  let commit = switchOnly;
  if (switchOnly) {
    if (!readRelease(switchOnly)) throw new Error(`Release ${switchOnly} ist nicht vorhanden (vorhanden: ${listReleases().map((r) => r.short).join(", ") || "keine"})`);
  } else {
    fetchOrigin();
    commit = resolveCommit(ref);
    if (readRelease(commit)) log(`Release ${commit.slice(0, 7)} ist bereits gebaut`);
    else build(commit);
  }
  if (!noSwitch && !(await activate(commit)).ok) exitCode = 1;
  prune();
  await syncReleases();
} catch (error) {
  exitCode = 1;
  log(`FEHLER: ${error.message.split("\n")[0]}`);
} finally {
  releaseLock();
}
process.exit(exitCode);
