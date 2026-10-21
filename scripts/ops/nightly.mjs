// Nightly run (task-17-17): launchd online.rheinwerk.backup at 02:00 from the development folder (missed runs are
// made up by macOS after waking), by hand: npm run nightly
//   1. backup with restore check (scripts/backup.mjs, scripts/backup-check.mjs; keeps BACKUP_KEEP_DAYS days); a failure
//      is the warning backup:failed with e-mail, the next good run closes it
//   2. newer versions of npm packages and n8n for the area "System" (only shown, never installed)
import { execFileSync } from "node:child_process";
import { report, rpc } from "./lib.mjs";

const N8N = process.env.N8N_CONTAINER ?? "n8n";
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

// Only shown, never installed (user decision 21.10.2026)
const dependencies = { checked_at: new Date().toISOString(), npm: [], n8n: null };
try {
  let out = "";
  try { out = run("npm", ["outdated", "--json"]); } catch (error) { out = error.stdout ?? ""; }
  dependencies.npm = Object.entries(JSON.parse(out || "{}")).map(([name, info]) => ({ name, current: info.current, wanted: info.wanted, latest: info.latest }))
    .filter((entry) => entry.current !== entry.latest);
} catch { dependencies.npm = null; }
try {
  const current = run("docker", ["exec", N8N, "n8n", "--version"]).trim();
  const latest = run("npm", ["view", "n8n", "version"]).trim();
  dependencies.n8n = { current, latest, update: current !== latest };
} catch { /* n8n or registry not reachable */ }
await rpc("set_system_status", { payload: { dependency_updates: dependencies } });
process.exit(exitCode);
