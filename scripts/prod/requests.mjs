// Requests from the dashboard (task-17-6): "Jetzt aktualisieren" and "Wiederherstellen" are rows in update_requests;
// the web app never runs commands. launchd online.rheinwerk.requests starts this script every minute:
//   node --env-file=…/shared/.env.local …/tools/scripts/prod/requests.mjs
// While another run holds the lock (nightly update, prod:release) the request waits for the next minute.
// Without a request the script ends without any output.
import { acquireLock, ensureLayout, log, releaseLock, rpc, syncReleases } from "./lib.mjs";
import { excerpt, runRollback, runUpdate, warn } from "./runs.mjs";

ensureLayout();
if (!acquireLock()) process.exit(0);
let exitCode = 0;
let request = null;
try {
  await rpc("abandon_stale_runs");
  request = await rpc("claim_update_request");
  if (request?.id) {
    log(`Anfrage aus dem Dashboard: ${request.action === "update" ? "Jetzt aktualisieren" : `Wiederherstellen ${request.target_commit.slice(0, 7)}`}`);
    exitCode = request.action === "update"
      ? await runUpdate({ trigger: "dashboard", requestId: request.id })
      : await runRollback(request.target_commit, { trigger: "dashboard", requestId: request.id });
  }
} catch (error) {
  exitCode = 1;
  log(`FEHLER: ${error.message.split("\n")[0]}`);
  await warn("update:failed", "Anfrage aus dem Dashboard abgebrochen", `${error.message}\n\n${excerpt()}`);
} finally {
  if (request?.id) {
    await rpc("finish_update_request", { request_id: request.id, succeeded: exitCode === 0 });
    await syncReleases();
  }
  releaseLock();
}
process.exit(exitCode);
