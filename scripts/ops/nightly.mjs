// Daily run (task-17-17, task-18-6): systemd timer rheinwerk-backup at 03:00 on the VPS (ops/vps/systemd), by hand:
// npm run nightly
//   1. backup with restore check and its row in public.backups (scripts/ops/backup-run.mjs; keeps BACKUP_KEEP_DAYS
//      days); a failure is the warning backup:failed with e-mail, the next good run closes it
//   2. installed and available versions for the area "System" (scripts/ops/versions.mjs, only shown, never installed)
import { runBackup } from "./backup-run.mjs";
import { maintenanceRunning } from "./lib.mjs";
import { refreshVersions } from "./versions-report.mjs";

// Not during a restore or system update (task-18-7, task-18-8): they make their own backup before, and a backup now would catch a half-restored state
if (maintenanceRunning()) {
  console.log(`${new Date().toISOString()} Wiederherstellung oder Update läuft, Sicherung ausgelassen (nächster Lauf morgen oder „Jetzt sichern“)`);
  process.exit(0);
}
const ok = await runBackup({ reason: "daily" });
await refreshVersions();
process.exit(ok ? 0 : 1);
