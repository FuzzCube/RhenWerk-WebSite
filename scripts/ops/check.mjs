// "System prüfen" (task-17-15): launchd online.rheinwerk.systemcheck every 20 seconds from the development folder. Picks
// up a request of the dashboard (claim_system_check) and runs all checks (scripts/ops/checks.mjs, SMTP included) and
// the versions (scripts/ops/versions.mjs). Without a request it ends after one small query. By hand without request:
// npm run system:check
import { rpc } from "./lib.mjs";
import { runChecks } from "./checks.mjs";
import { refreshVersions } from "./versions-report.mjs";

const now = process.argv.includes("--now");
if (!now && !(await rpc("claim_system_check"))) process.exit(0);
const started = Date.now();
try {
  await Promise.all([runChecks({ force: true }), refreshVersions()]);
} finally {
  if (!now) await rpc("finish_system_check");
}
console.log(`${new Date().toISOString()} Systemprüfung${now ? " (von Hand)" : ""} in ${Math.round((Date.now() - started) / 1000)} s`);
