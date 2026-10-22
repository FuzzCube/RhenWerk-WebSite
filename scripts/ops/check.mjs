// Requests of the dashboard (task-17-15, task-18-6 to 18-8): systemd timer rheinwerk-systemcheck every 20 seconds on
// the VPS. "Wiederherstellen" (claim_restore_request) restores a backup (scripts/ops/restore-run.mjs), "Update
// einspielen" (claim_image_update) starts new images with self test and return (scripts/ops/update-run.mjs), "Jetzt
// sichern" (claim_backup_request) runs a backup with restore check (scripts/ops/backup-run.mjs), "System prüfen"
// (claim_system_check) all checks (scripts/ops/checks.mjs, SMTP and provider backup included) and the versions
// (scripts/ops/versions.mjs). Without a request it ends after two small queries. By hand without request:
// npm run system:check
import { runBackup } from "./backup-run.mjs";
import { runRestore } from "./restore-run.mjs";
import { runImageUpdate } from "./update-run.mjs";
import { rpc } from "./lib.mjs";
import { runChecks } from "./checks.mjs";
import { refreshVersions } from "./versions-report.mjs";

const now = process.argv.includes("--now");
if (!now) {
  const restore = await rpc("claim_restore_request");
  if (restore?.id) {
    await runRestore(restore);
    // Afterwards the area "System" shows the state of every system again
    await runChecks({ force: true });
  }
  const update = await rpc("claim_image_update");
  if (update?.id) {
    await runImageUpdate(update);
    await Promise.all([runChecks({ force: true }), refreshVersions()]);
  }
  const requester = await rpc("claim_backup_request");
  if (requester) {
    try {
      await runBackup({ reason: "manual", requestedBy: requester });
    } finally {
      await rpc("finish_backup_request");
    }
    // Afterwards the area "System" shows the new backup without warning backup:stale
    await runChecks();
  }
}
if (!now && !(await rpc("claim_system_check"))) process.exit(0);
const started = Date.now();
try {
  await Promise.all([runChecks({ force: true }), refreshVersions()]);
} finally {
  if (!now) await rpc("finish_system_check");
}
console.log(`${new Date().toISOString()} Systemprüfung${now ? " (von Hand)" : ""} in ${Math.round((Date.now() - started) / 1000)} s`);
