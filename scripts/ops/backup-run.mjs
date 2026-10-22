// One backup with restore check (task-17-17, task-18-6), shared by the daily run (nightly.mjs, reason "daily") and
// "Jetzt sichern" from the dashboard (check.mjs, reason "manual"): scripts/backup.mjs, then scripts/backup-check.mjs on
// the new archive, then the row in public.backups for the area "System". A failure is the warning backup:failed with
// e-mail, the next good backup closes it.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { report, rpc } from "./lib.mjs";

const run = (args, env = {}) => execFileSync(process.execPath, args, {
  encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env },
});
const stamp = (message) => console.log(`${new Date().toISOString()} ${message}`);

export async function runBackup({ reason, requestedBy = null }) {
  const startedAt = new Date().toISOString();
  const work = mkdtempSync(path.join(tmpdir(), "rheinwerk-backup-run-"));
  const summaryFile = path.join(work, "summary.json");
  const lines = [];
  let summary = null;
  try {
    lines.push(...run(["scripts/backup.mjs"], { BACKUP_SUMMARY_FILE: summaryFile }).trim().split("\n"));
    summary = JSON.parse(readFileSync(summaryFile, "utf8"));
    lines.push(run(["scripts/backup-check.mjs", summary.file]).trim().split("\n").at(-1));
    stamp(`Sicherung (${reason}): ${lines.join("\n  ")}`);
    await rpc("record_backup", {
      reason, status: "ok", started_at: startedAt, file_name: summary.file_name, size_bytes: summary.size_bytes,
      contents: summary.contents, verified: true, error: null, requested_by: requestedBy,
    });
    await report("backup", { key: "backup:failed", label: "Tägliche Sicherung", ok: true });
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message;
    const detail = [...lines, output].join("\n").slice(-3000);
    stamp(`FEHLER: Sicherung (${reason})\n${output}`);
    await rpc("record_backup", {
      reason, status: "failed", started_at: startedAt, file_name: summary?.file_name ?? null, size_bytes: summary?.size_bytes ?? null,
      contents: summary?.contents ?? {}, verified: summary ? false : null, error: detail || "Unbekannter Fehler", requested_by: requestedBy,
    });
    await report("backup", {
      key: "backup:failed", label: "Tägliche Sicherung", ok: false, severity: "critical", title: "Sicherung fehlgeschlagen",
      detail: `Die Sicherung oder ihre Probewiederherstellung ist fehlgeschlagen. Laufen alle Container (ops/vps/compose.sh ps)? Ist genug Speicherplatz frei (df -h)? Protokoll: journalctl -u rheinwerk-backup. Erneut: „Jetzt sichern“ im Bereich System oder sudo systemctl start rheinwerk-backup.service (docs/betrieb.md 4).\n\n${detail}`,
    });
    return false;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
