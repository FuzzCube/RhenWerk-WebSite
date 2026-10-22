// Watchdog (task-17-9 Mira, task-17-8 n8n, task-17-15 systems): launchd online.rheinwerk.watchdog every 5 minutes from
// the development folder, by hand: npm run watchdog. The checks are in scripts/ops/checks.mjs.
import { runChecks } from "./checks.mjs";
import { maintenanceRunning } from "./lib.mjs";

// During a restore or system update (task-18-7, task-18-8) the services are stopped on purpose; both report their own result
if (maintenanceRunning()) console.log(`${new Date().toISOString()} Wiederherstellung oder Update läuft, keine Prüfung`);
else await runChecks();
