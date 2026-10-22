// "Wiederherstellen" in the area "System" (task-18-7), picked up by scripts/ops/check.mjs (rheinwerk-systemcheck):
//   1. backup of the current state with restore check (backup-run.mjs, reason pre_restore); without it nothing changes
//   2. restore of the chosen archive (scripts/restore.mjs: n8n stopped, Postgres, Storage, n8n)
//   3. health check: Auth, REST and Storage answer through the gateway, n8n /healthz
//   4. on a failure in 2 or 3: the same restore with the backup of step 1 and its health check (status rolled_back)
//   5. e-mail to the admin; a failure is the warning restore:failed (critical), the next good restore closes it
// While it runs, the maintenance lock (lib.mjs) keeps the watchdog and the daily backup away.
import { existsSync } from "node:fs";
import path from "node:path";
import { sendAlert } from "../lib/notify.mjs";
import { restoreArchive, startAll, startN8n } from "../restore.mjs";
import { runBackup } from "./backup-run.mjs";
import { DASHBOARD, endMaintenance, report, rpc, startMaintenance } from "./lib.mjs";

const BACKUP_DIR = process.env.BACKUP_DIR;
const stamp = (message) => console.log(`${new Date().toISOString()} ${message}`);

async function healthy() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SECRET_KEY ?? "";
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const probe = async (label, url) => {
    const until = Date.now() + 90_000;
    let last = "";
    while (Date.now() < until) {
      try {
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
        if (response.ok) return;
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = error.message;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    throw new Error(`${label} antwortet nicht (${last})`);
  };
  await probe("Anmeldung (Auth)", `${base}/auth/v1/health`);
  await probe("Datenbank (REST)", `${base}/rest/v1/system_status?select=id&limit=1`);
  await probe("Dateien (Storage)", `${base}/storage/v1/bucket`);
}

export async function runRestore(request) {
  startMaintenance("restore", request.id);
  const steps = [];
  const log = (message) => { steps.push(message); stamp(`Wiederherstellung: ${message}`); };
  const archive = path.join(BACKUP_DIR ?? "", request.file_name);
  let pre = null;
  let status = "ok";
  let error = null;
  try {
    if (!BACKUP_DIR || !existsSync(archive)) throw Object.assign(new Error(`Archiv ${request.file_name} liegt nicht mehr auf dem Server (aufbewahrt 14 Tage)`), { untouched: true });
    log(`Sicherung vom ${request.backup_finished_at} angefordert`);
    pre = await runBackup({ reason: "pre_restore", requestedBy: request.requested_by });
    if (!pre) throw Object.assign(new Error("Die Sicherung des aktuellen Stands ist fehlgeschlagen, es wurde nichts verändert"), { untouched: true });
    log(`Aktueller Stand gesichert: ${pre.file_name}`);
    try {
      await restoreArchive(archive, { log, startN8n: true });
      await healthy();
      log("Gesundheitsprüfung bestanden");
    } catch (failure) {
      log(`FEHLER: ${failure.message}`);
      log("Rückkehr zum Stand davor");
      try {
        startAll();
        await restoreArchive(pre.file, { log, fresh: false, startN8n: true, failAfter: null });
        await healthy();
        log("Stand davor wiederhergestellt, Gesundheitsprüfung bestanden");
        status = "rolled_back";
        error = failure.message;
      } catch (returnFailure) {
        log(`FEHLER bei der Rückkehr: ${returnFailure.message}`);
        throw new Error(`${failure.message}; Rückkehr fehlgeschlagen: ${returnFailure.message}`);
      }
    }
  } catch (failure) {
    status = "failed";
    error = failure.message;
    if (!failure.untouched) {
      try { startAll(); startN8n(); } catch { /* reported below */ }
    }
  } finally {
    endMaintenance();
  }

  const detail = steps.join("\n");
  await rpc("finish_restore_request", { restore_id: request.id, status, pre_backup_file: pre?.file_name ?? null, error: error ? `${error}\n\n${detail}`.slice(0, 4000) : null });
  if (status === "ok") {
    await report("backup", { key: "restore:failed", label: "Wiederherstellung", ok: true });
    await sendAlert({
      subject: "Wiederherstellung abgeschlossen",
      text: `Die Daten wurden aus der Sicherung vom ${request.backup_finished_at} wiederhergestellt (${request.file_name}).\nDer Stand davor ist gesichert: ${pre.file_name}.\n\n${detail}\n\n${DASHBOARD}`,
    });
  } else {
    const rolledBack = status === "rolled_back";
    await report("backup", {
      key: "restore:failed", label: "Wiederherstellung", ok: false, severity: "critical",
      title: rolledBack ? "Wiederherstellung fehlgeschlagen, Stand davor zurück" : "Wiederherstellung fehlgeschlagen",
      detail: `${rolledBack
        ? "Die Wiederherstellung ist fehlgeschlagen; der Stand davor wurde wiederhergestellt und läuft."
        : pre ? "Die Wiederherstellung und die Rückkehr zum Stand davor sind fehlgeschlagen. Sofort prüfen: ops/vps/compose.sh ps, journalctl -u rheinwerk-systemcheck, Wiederherstellung von Hand nach docs/betrieb.md 4.5 mit der Sicherung " + pre.file_name + "."
          : "Es wurde nichts verändert."}\n\n${error}\n\n${detail}`,
    });
  }
  stamp(`Wiederherstellung: ${status}${error ? ` (${error})` : ""}`);
  return status;
}
