// Daily run (task-17-17): launchd online.rheinwerk.backup at 09:00 from the development folder (user decision
// 22.10.2026, the computer sleeps at night) (missed runs are
// made up by macOS after waking), by hand: npm run nightly
//   1. backup with restore check (scripts/backup.mjs, scripts/backup-check.mjs; keeps BACKUP_KEEP_DAYS days); a failure
//      is the warning backup:failed with e-mail, the next good run closes it
//   2. installed and available versions for the area "System" (scripts/ops/versions.mjs, only shown, never installed)
import { execFileSync } from "node:child_process";
import { report } from "./lib.mjs";
import { refreshVersions } from "./versions-report.mjs";

const run = (command, args) => execFileSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const stamp = (message) => console.log(`${new Date().toISOString()} ${message}`);

let exitCode = 0;
const lines = [];
try {
  const created = run(process.execPath, ["scripts/backup.mjs"]);
  lines.push(...created.trim().split("\n"));
  const file = created.match(/Sicherung erstellt: (\S+)/)?.[1];
  const checked = run(process.execPath, ["scripts/backup-check.mjs", ...(file ? [file] : [])]);
  lines.push(checked.trim().split("\n").at(-1));
  stamp(lines.join("\n  "));
  await report("backup", { key: "backup:failed", label: "Tägliche Sicherung", ok: true });
} catch (error) {
  exitCode = 1;
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || error.message;
  stamp(`FEHLER: Sicherung\n${output}`);
  await report("backup", {
    key: "backup:failed", label: "Tägliche Sicherung", ok: false, severity: "critical", title: "Tägliche Sicherung fehlgeschlagen",
    detail: `Die Sicherung oder ihre Prüfung ist fehlgeschlagen. Laufen Docker, Supabase und n8n (docker ps)? Ist genug Speicherplatz frei (df -h)? Von Hand wiederholen: npm run nightly\n\n${[...lines, output].join("\n").slice(-3000)}`,
  });
}

// Versions of Docker, Supabase, n8n, Node.js and npm packages for the area "System" (task-17-15): only shown, never
// installed (user decision 21.10.2026)
await refreshVersions();
process.exit(exitCode);
