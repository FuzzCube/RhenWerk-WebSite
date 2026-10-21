// Nightly update of the production copy (task-17-5, user decision 21.10.2026) and the same run by hand; the steps are in
// scripts/prod/runs.mjs. launchd online.rheinwerk.update 02:00:
//   node --env-file=…/shared/.env.local …/current/scripts/prod/update.mjs --nightly
// npm run prod:update [-- --dry-run]       by hand (trigger cli), environment from ~/RheinWerk-Prod/shared/.env.local
// npm run prod:update -- --ref <ref>       by hand: another ref of ~/RheinWerk-Prod/repo instead of origin/main
import { PROD_DIR, acquireLock, ensureLayout, log, releaseLock, rpc, syncReleases } from "./lib.mjs";
import { excerpt, runUpdate, warn } from "./runs.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const trigger = args.includes("--nightly") ? "nightly" : "cli";
// Only by hand: another ref of the clone instead of origin/main (tests of the failure paths with local commits)
const refIndex = args.indexOf("--ref");
const ref = trigger === "cli" && refIndex >= 0 ? args[refIndex + 1] : "origin/main";

ensureLayout();
if (!acquireLock()) {
  console.error(`Ein anderer Lauf ist aktiv (${PROD_DIR}/.lock).`);
  process.exit(1);
}
let exitCode = 0;
try {
  if (!dryRun) await rpc("abandon_stale_runs");
  exitCode = await runUpdate({ trigger, ref, dryRun });
} catch (error) {
  exitCode = 1;
  log(`FEHLER: ${error.message.split("\n")[0]}`);
  await warn("update:failed", "Update-Lauf abgebrochen", `${error.message}\n\n${excerpt()}`);
} finally {
  if (!dryRun) await syncReleases();
  releaseLock();
}
process.exit(exitCode);
