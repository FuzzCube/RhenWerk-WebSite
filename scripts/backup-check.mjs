// Restore check of a backup (task-12-11): unpacks the newest archive (or the one given as argument), checks the
// checksums, restores Postgres into a separate database "backup_check" in the same container and compares the row
// counts with the manifest, checks the Storage archive and the n8n database. The live data stays untouched;
// "backup_check" is dropped at the end.
// Usage: npm run backup:check [-- <archive>]   (BACKUP_DIR, BACKUP_PASSPHRASE, SUPABASE_DB_CONTAINER as for backup)
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
const OUT = process.env.BACKUP_DIR ?? path.join(homedir(), "RheinWerk-Backups");
const CHECK_DB = "backup_check";

const run = (command, args, options = {}) => execFileSync(command, args, { maxBuffer: 1024 * 1024 * 1024, ...options });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const psql = (database, sql) => run("docker", ["exec", DB, "psql", "-U", "supabase_admin", "-d", database, "-v", "ON_ERROR_STOP=1", "-Atqc", sql], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures += 1;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? ` – ${detail}` : ""}`);
};

const archive = process.argv[2] ?? (() => {
  const list = existsSync(OUT) ? readdirSync(OUT).filter((file) => /^rheinwerk-\d{8}T\d{6}Z\.tar\.gz(\.enc)?$/.test(file)).sort() : [];
  if (!list.length) { console.error(`Keine Sicherung in ${OUT}. Zuerst: npm run backup`); process.exit(1); }
  return path.join(OUT, list.at(-1));
})();

const work = mkdtempSync(path.join(tmpdir(), "rheinwerk-check-"));
const started = Date.now();
try {
  console.log(`Prüfe ${archive}`);
  let tarball = archive;
  if (archive.endsWith(".enc")) {
    if (!process.env.BACKUP_PASSPHRASE) { console.error("Verschlüsselte Sicherung: BACKUP_PASSPHRASE wird benötigt."); process.exit(1); }
    tarball = path.join(work, "backup.tar.gz");
    try {
      run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", archive, "-out", tarball, "-pass", "env:BACKUP_PASSPHRASE"], { stdio: ["ignore", "ignore", "pipe"] });
    } catch {
      console.error("✗ Entschlüsselung fehlgeschlagen – falsche BACKUP_PASSPHRASE?");
      process.exitCode = 1;
      throw new Error("decrypt");
    }
    check("entschlüsselt", true);
  }
  run("tar", ["-xzf", tarball, "-C", work]);
  const name = readdirSync(work).find((entry) => entry.startsWith("rheinwerk-") && !entry.includes("."));
  const dir = path.join(work, name);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  console.log(`  erstellt ${manifest.created_at}, Postgres ${manifest.postgres_version}`);

  // Checksums of every file
  const broken = Object.entries(manifest.files).filter(([file, info]) => !existsSync(path.join(dir, file)) || sha256(path.join(dir, file)) !== info.sha256);
  check(`Prüfsummen von ${Object.keys(manifest.files).length} Dateien`, broken.length === 0, broken.map(([file]) => file).join(", "));

  // Postgres into a separate database. pg_cron can only exist in the database "postgres", so its entries are skipped;
  // the jobs themselves are part of the dump and come back with a real restore into "postgres".
  psql("postgres", `drop database if exists ${CHECK_DB}`);
  psql("postgres", `create database ${CHECK_DB}`);
  try {
    run("docker", ["cp", path.join(dir, "postgres.dump"), `${DB}:/tmp/rheinwerk-check.dump`]);
    const list = run("docker", ["exec", DB, "pg_restore", "-l", "/tmp/rheinwerk-check.dump"]).toString()
      .split("\n").filter((line) => !/ cron | pg_cron|SCHEMA - cron/i.test(line)).join("\n");
    run("docker", ["exec", "-i", DB, "sh", "-c", "cat > /tmp/rheinwerk-check.list"], { input: list });
    let restoreErrors = "";
    try {
      run("docker", ["exec", DB, "pg_restore", "-U", "supabase_admin", "-d", CHECK_DB, "-L", "/tmp/rheinwerk-check.list", "/tmp/rheinwerk-check.dump"], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (error) {
      restoreErrors = String(error.stderr ?? error.message).split("\n").filter((line) => line.includes("error")).slice(0, 3).join(" | ");
    }
    check("Postgres in getrennte Datenbank wiederhergestellt", !restoreErrors, restoreErrors);
    for (const [table, expected] of Object.entries(manifest.counts)) {
      const actual = Number(psql(CHECK_DB, `select count(*) from ${table}`));
      check(`  ${table}`, actual === expected, `${actual} von ${expected} Zeilen`);
    }
    const login = psql(CHECK_DB, "select count(*) from auth.users where encrypted_password is not null");
    check("  Anmeldedaten vorhanden (Passwort-Hashes)", Number(login) > 0, `${login} Konten`);
  } finally {
    psql("postgres", `drop database if exists ${CHECK_DB}`);
    run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-check.dump", "/tmp/rheinwerk-check.list"]);
  }

  // Storage archive: number of files
  const storageFiles = run("tar", ["-tzf", path.join(dir, "storage.tar.gz")]).toString().split("\n").filter((line) => line && !line.endsWith("/")).length;
  check("Storage-Dateien im Archiv", storageFiles === manifest.storage_files, `${storageFiles} von ${manifest.storage_files}`);

  // n8n: SQLite intact, workflows readable, encryption key present
  const n8nDb = path.join(dir, "n8n-database.sqlite");
  check("n8n-Datenbank intakt", run("sqlite3", [n8nDb, "pragma integrity_check"]).toString().trim() === "ok");
  const workflows = Number(run("sqlite3", [n8nDb, "select count(*) from workflow_entity"]).toString().trim());
  const active = run("sqlite3", [n8nDb, "select count(*) from workflow_entity where name like 'RheinWerk%' and active = 1"]).toString().trim();
  check("  n8n-Workflows", workflows === manifest.n8n_workflows, `${workflows} gesamt, ${active} RheinWerk-Workflows aktiv`);
  if (manifest.encrypted) {
    const config = JSON.parse(readFileSync(path.join(dir, "n8n-config"), "utf8"));
    check("  n8n-Schlüssel für die Zugangsdaten enthalten", typeof config.encryptionKey === "string" && config.encryptionKey.length > 0);
  } else {
    console.log("  Hinweis: unverschlüsselte Sicherung ohne n8n-Schlüssel; Zugangsdaten müssten nach einer Wiederherstellung neu angelegt werden.");
  }
} catch (error) {
  if (error.message !== "decrypt") throw error;
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (process.exitCode) process.exit(process.exitCode);

console.log(failures ? `\n${failures} Prüfung(en) fehlgeschlagen.` : `\nSicherung ist wiederherstellbar (${((Date.now() - started) / 1000).toFixed(0)} s).`);
process.exit(failures ? 1 : 0);
