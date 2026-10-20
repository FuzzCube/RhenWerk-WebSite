// Backup of the local operation (task-12-11): Postgres (complete database incl. Auth and Storage metadata),
// Storage files, n8n database and n8n encryption key, optionally .env.local. Result is one archive
// rheinwerk-<timestamp>.tar.gz, encrypted to .tar.gz.enc (AES-256, PBKDF2) when BACKUP_PASSPHRASE is set.
// Secrets (n8n key, .env.local) only go into encrypted archives. Restore check: npm run backup:check.
// Usage: npm run backup
//   BACKUP_DIR (default ~/RheinWerk-Backups), BACKUP_KEEP (default 14 archives), BACKUP_PASSPHRASE,
//   N8N_CONTAINER (default n8n), SUPABASE_DB_CONTAINER, SUPABASE_STORAGE_CONTAINER
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
const STORAGE = process.env.SUPABASE_STORAGE_CONTAINER ?? "supabase_storage_A.Sadkovojs_Project";
const N8N = process.env.N8N_CONTAINER ?? "n8n";
const N8N_HOME = "/home/node/.n8n";
const OUT = process.env.BACKUP_DIR ?? path.join(homedir(), "RheinWerk-Backups");
const KEEP = Number(process.env.BACKUP_KEEP ?? 14);
const PASSPHRASE = process.env.BACKUP_PASSPHRASE ?? "";

// Row counts recorded at backup time; backup:check compares the restored database with them
const COUNTED_TABLES = ["public.requests", "public.customers", "public.messages", "public.visits", "public.invoices",
  "public.phone_calls", "public.attachments", "public.request_events", "auth.users", "storage.objects", "supabase_migrations.schema_migrations"];

const run = (command, args, options = {}) => execFileSync(command, args, { maxBuffer: 1024 * 1024 * 1024, ...options });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const psql = (sql) => run("docker", ["exec", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-Atc", sql]).toString().trim();

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const name = `rheinwerk-${stamp}`;
const work = mkdtempSync(path.join(tmpdir(), "rheinwerk-backup-"));
const dir = path.join(work, name);
mkdirSync(dir);
mkdirSync(OUT, { recursive: true });
const started = Date.now();

try {
  // 1. Postgres: consistent snapshot of the whole database in custom format (pg_dump runs in a single transaction)
  const counts = Object.fromEntries(COUNTED_TABLES.map((table) => [table, Number(psql(`select count(*) from ${table}`))]));
  run("docker", ["exec", DB, "pg_dump", "-U", "supabase_admin", "-d", "postgres", "-Fc", "-f", "/tmp/rheinwerk-backup.dump"]);
  run("docker", ["cp", `${DB}:/tmp/rheinwerk-backup.dump`, path.join(dir, "postgres.dump")]);
  run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-backup.dump"]);
  const postgresVersion = psql("show server_version");

  // 2. Storage files (bucket contents live in the volume of the storage container, metadata in Postgres)
  const storageFiles = Number(run("docker", ["exec", STORAGE, "sh", "-c", "find /mnt -type f | wc -l"]).toString().trim());
  writeFileSync(path.join(dir, "storage.tar.gz"), run("docker", ["exec", STORAGE, "tar", "-czf", "-", "-C", "/mnt", "."]));

  // 3. n8n: the live SQLite database is never opened from the host. In WAL mode a second process outside the Docker VM
  // cannot share the lock and index file reliably; on 20.10.2026 this left n8n stuck on its write lock for two hours.
  // The container is paused for the copy (a few seconds, schedules resume afterwards), the copy is then merged locally.
  const raw = path.join(work, "n8n-raw.sqlite");
  run("docker", ["pause", N8N]);
  try {
    run("docker", ["cp", `${N8N}:${N8N_HOME}/database.sqlite`, raw]);
    try { run("docker", ["cp", `${N8N}:${N8N_HOME}/database.sqlite-wal`, `${raw}-wal`], { stdio: "ignore" }); } catch { /* no WAL file */ }
    if (PASSPHRASE) run("docker", ["cp", `${N8N}:${N8N_HOME}/config`, path.join(dir, "n8n-config")]);
  } finally {
    run("docker", ["unpause", N8N]);
  }
  run("sqlite3", [raw, `.backup '${path.join(dir, "n8n-database.sqlite")}'`]);
  const n8nWorkflows = Number(run("sqlite3", [path.join(dir, "n8n-database.sqlite"), "select count(*) from workflow_entity"]).toString().trim());
  const secrets = [];
  if (PASSPHRASE) {
    secrets.push("n8n-config");
    if (existsSync(".env.local")) { copyFileSync(".env.local", path.join(dir, "env.local")); secrets.push("env.local"); }
  }

  const files = Object.fromEntries(readdirSync(dir).map((file) => [file, { bytes: statSync(path.join(dir, file)).size, sha256: sha256(path.join(dir, file)) }]));
  const manifest = { name, created_at: new Date().toISOString(), postgres_version: postgresVersion, counts, storage_files: storageFiles, n8n_workflows: n8nWorkflows, encrypted: Boolean(PASSPHRASE), secrets, files };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  // 4. One archive, encrypted when a passphrase is set (passed via the environment, not on the command line)
  const tarball = path.join(work, `${name}.tar.gz`);
  run("tar", ["-czf", tarball, "-C", work, name]);
  let target = path.join(OUT, `${name}.tar.gz`);
  if (PASSPHRASE) {
    target += ".enc";
    run("openssl", ["enc", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-salt", "-in", tarball, "-out", target, "-pass", "env:BACKUP_PASSPHRASE"]);
  } else {
    copyFileSync(tarball, target);
  }

  // 5. Retention: keep the newest KEEP archives
  const archives = readdirSync(OUT).filter((file) => /^rheinwerk-\d{8}T\d{6}Z\.tar\.gz(\.enc)?$/.test(file)).sort();
  const removed = archives.slice(0, Math.max(0, archives.length - KEEP));
  for (const file of removed) rmSync(path.join(OUT, file));

  const size = (statSync(target).size / 1024 / 1024).toFixed(1);
  console.log(`Sicherung erstellt: ${target} (${size} MB, ${((Date.now() - started) / 1000).toFixed(0)} s)`);
  console.log(`  Postgres ${postgresVersion}: ${counts["public.requests"]} Anfragen, ${counts["auth.users"]} Konten, ${counts["public.messages"]} Nachrichten`);
  console.log(`  Storage: ${storageFiles} Dateien · n8n: ${n8nWorkflows} Workflows`);
  if (PASSPHRASE) console.log(`  verschlüsselt (AES-256), enthält zusätzlich: ${secrets.join(", ")}`);
  else console.log("  WARNUNG: unverschlüsselt und ohne n8n-Schlüssel und .env.local. BACKUP_PASSPHRASE setzen, damit die Sicherung vollständig ist.");
  if (removed.length) console.log(`  ${removed.length} ältere Sicherung(en) entfernt (behalten: ${KEEP})`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
