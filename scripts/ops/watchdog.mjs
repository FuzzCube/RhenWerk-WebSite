// Watchdog (task-17-9 Mira, task-17-8 n8n, task-17-15 systems): launchd online.rheinwerk.watchdog every 5 minutes from
// the development folder, by hand: npm run watchdog. The checks are in scripts/ops/checks.mjs.
import { runChecks } from "./checks.mjs";

await runChecks();
