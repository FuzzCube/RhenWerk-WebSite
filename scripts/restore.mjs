// Restore of a whole backup (task-18-7) into the running stack: Postgres (pg_restore --clean over the database
// "postgres"), Storage files (the folder is emptied first) and n8n (database and encryption key). Used by
// scripts/ops/restore-run.mjs for "Wiederherstellen" in the area "System" (with backup before, health check and return
// on failure); by hand only with the same steps around it (docs/betrieb.md 4.5).
// The rows of KEEP_TABLES stay as they are now: the list of backups, the restore requests, the warnings and the state of
// the services must not go back in time. The secret files of the archive (env, ops.env) are not restored, the
// server keeps its own.
// Privileges: pg_restore creates every object anew as supabase_admin, and the default privileges of Supabase give anon
// and authenticated everything on creation; the dump only holds the differences to the standard privileges, so the
// REVOKEs of the migrations (e.g. "revoke all on public.profiles from anon, authenticated") would be lost (found on
// 22.10.2026: since the import of task-18-3 on the VPS). applyDumpAcl therefore resets the privileges of the restored
// objects and applies the ones of the dump again.
// The backup must have the same migration state as the database (manifest.migration); with an older one the schema of
// the kept tables would no longer match.
//   SUPABASE_DB_CONTAINER, SUPABASE_STORAGE_CONTAINER, SUPABASE_STORAGE_PATH, N8N_CONTAINER, BACKUP_PASSPHRASE as for
//   scripts/backup.mjs. The containers auth, rest and storage are found by the name of the database container
//   (supabase_db_<x> → supabase_auth_<x>, …).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
const STORAGE = process.env.SUPABASE_STORAGE_CONTAINER ?? "supabase_storage_A.Sadkovojs_Project";
const N8N = process.env.N8N_CONTAINER ?? "n8n";
const N8N_HOME = "/home/node/.n8n";
const STORAGE_PATH = process.env.SUPABASE_STORAGE_PATH ?? "/mnt";
const SERVICES = ["auth", "rest", "storage"].map((service) => DB.replace(/^supabase_db_/, `supabase_${service}_`));
export const KEEP_TABLES = ["public.backups", "public.restores", "public.image_updates", "public.system_alerts", "public.system_status"];

const run = (command, args, options = {}) => execFileSync(command, args, { maxBuffer: 1024 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"], ...options });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const psql = (sql) => run("docker", ["exec", "-i", DB, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atq"], { input: sql }).toString().trim();
const running = (container) => {
  try { return run("docker", ["inspect", "-f", "{{.State.Running}}", container]).toString().trim() === "true"; } catch { return false; }
};

// Messages of pg_restore --clean over a Supabase database that are expected and harmless (betrieb.md 4.5, task-18-3):
// roles and schemas of the platform that stay in place, Realtime partitions, extensions owned by the platform
export const EXPECTED_RESTORE_ERRORS = [
  /supabase_realtime_admin/, /schema "?(storage|extensions|auth|realtime|graphql|graphql_public|vault|pgbouncer|_realtime)"? already exists/,
  /cannot drop inherited constraint/, /must be owner of (extension|schema|event trigger)/, /extension "[^"]+" (already exists|is not available)/,
];
export function unexpectedRestoreErrors(output) {
  return output.split("\n").filter((line) => /error:/i.test(line) && !EXPECTED_RESTORE_ERRORS.some((pattern) => pattern.test(line)));
}

// Archive → folder with checked files and manifest; the caller removes `work`
export function unpack(archive) {
  const work = mkdtempSync(path.join(tmpdir(), "rheinwerk-restore-"));
  let tarball = archive;
  if (archive.endsWith(".enc")) {
    if (!process.env.BACKUP_PASSPHRASE) throw new Error("Verschlüsselte Sicherung: BACKUP_PASSPHRASE wird benötigt.");
    tarball = path.join(work, "backup.tar.gz");
    run("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", archive, "-out", tarball, "-pass", "env:BACKUP_PASSPHRASE"]);
  }
  run("tar", ["-xzf", tarball, "-C", work]);
  rmSync(path.join(work, "backup.tar.gz"), { force: true });
  const name = readdirSync(work).find((entry) => entry.startsWith("rheinwerk-") && !entry.includes("."));
  const dir = path.join(work, name);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const broken = Object.entries(manifest.files).filter(([file, info]) => !existsSync(path.join(dir, file)) || sha256(path.join(dir, file)) !== info.sha256);
  if (broken.length) throw new Error(`Prüfsummen falsch: ${broken.map(([file]) => file).join(", ")}`);
  return { work, dir, manifest };
}

// Schemas in which the default privileges of the restoring role (supabase_admin) grant something on creation
const aclSchemas = () => psql("select string_agg(distinct n.nspname, ',') from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where d.defaclrole = 'supabase_admin'::regrole")
  .split(",").filter(Boolean);

// Privileges of tables, views, sequences and functions in `schemas` exactly as in the dump (a file in the database
// container): first back to the standard privileges (acl null), then the GRANT/REVOKE entries of the dump. Objects of
// extensions keep theirs (pg_init_privs, not created by pg_restore).
export function applyDumpAcl(containerDump, schemas = aclSchemas()) {
  if (!schemas.every((schema) => /^[a-z_][a-z0-9_]*$/.test(schema))) throw new Error(`Ungültiges Schema: ${schemas.join(", ")}`);
  const entries = run("docker", ["exec", DB, "pg_restore", "-l", containerDump]).toString().split("\n")
    .filter((line) => { const match = /^\d+; \d+ \d+ ACL (\S+) /.exec(line); return match && schemas.includes(match[1]); });
  run("docker", ["exec", "-i", DB, "sh", "-c", "cat > /tmp/rheinwerk-acl.list"], { input: entries.join("\n") + "\n" });
  const grants = run("docker", ["exec", DB, "pg_restore", "-L", "/tmp/rheinwerk-acl.list", "-f", "-", containerDump]).toString();
  run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-acl.list"]);
  const list = schemas.map((schema) => `'${schema}'`).join(", ");
  psql(`begin;
update pg_catalog.pg_class c set relacl = null from pg_catalog.pg_namespace n
where n.oid = c.relnamespace and n.nspname in (${list}) and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and c.relacl is not null
  and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_class'::regclass and d.objid = c.oid and d.deptype = 'e');
update pg_catalog.pg_proc p set proacl = null from pg_catalog.pg_namespace n
where n.oid = p.pronamespace and n.nspname in (${list}) and p.proacl is not null
  and not exists (select 1 from pg_catalog.pg_depend d where d.classid = 'pg_catalog.pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e');
${grants}
commit;`);
  return entries.length;
}

export const currentMigration = () => psql("select max(version) from supabase_migrations.schema_migrations");

// Copies the kept tables into the schema restore_keep (not part of any dump, so pg_restore --clean leaves it alone).
// fresh: a new restore drops what a broken earlier run left; the return after a failed step (fresh = false) keeps the
// copy of the first attempt, because the tables now hold the half-restored data.
function keepTables(fresh) {
  psql(`${fresh ? "drop schema if exists restore_keep cascade;" : ""} create schema if not exists restore_keep;
${KEEP_TABLES.map((table) => `create table if not exists restore_keep.${table.split(".")[1]} as table ${table};`).join("\n")}`);
}

// Writes the kept rows back. References to accounts that the restored data does not know are cleared; triggers and
// foreign keys are off for the copy (session_replication_role), the references are checked here instead.
function returnTables() {
  psql(`begin;
set local session_replication_role = replica;
do $$
declare
  t text;
  fk record;
begin
  foreach t in array array[${KEEP_TABLES.map((table) => `'${table}'`).join(", ")}] loop
    for fk in
      select a.attname as col, c.confrelid::regclass::text as target
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      where c.conrelid = t::regclass and c.contype = 'f'
    loop
      execute format('update restore_keep.%I k set %I = null where k.%I is not null and not exists (select 1 from %s r where r.id = k.%I)',
        split_part(t, '.', 2), fk.col, fk.col, fk.target, fk.col);
    end loop;
    execute format('delete from %s', t);
    execute format('insert into %s select * from restore_keep.%I', t, split_part(t, '.', 2));
  end loop;
end;
$$;
drop schema restore_keep cascade;
commit;`);
}

async function waitFor(label, test, seconds) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    if (await test()) return;
    if (Date.now() > until) throw new Error(`${label} antwortet nach ${seconds} Sekunden nicht`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// n8n answers /healthz inside its container (no published port needed)
export const n8nHealthy = () => {
  try {
    run("docker", ["exec", N8N, "node", "-e", "fetch('http://127.0.0.1:5678/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]);
    return true;
  } catch { return false; }
};

// The restore itself. log(message) for the steps; throws on the first failed step. fresh: false for the return to the
// backup before (keepTables). startN8n: n8n runs afterwards (default: when it ran before). failAfter (only for the probe
// on a copy, RESTORE_FAIL_AFTER): fails on purpose after that step to test the return.
export async function restoreArchive(archive, { log = console.log, fresh = true, startN8n, failAfter = process.env.RESTORE_FAIL_AFTER } = {}) {
  const { work, dir, manifest } = unpack(archive);
  const checkpoint = (step) => { if (failAfter === step) throw new Error(`Probe: Abbruch nach Schritt ${step} (RESTORE_FAIL_AFTER)`); };
  try {
    log(`Sicherung ${manifest.name} entpackt und geprüft`);
    const migration = currentMigration();
    if (manifest.migration !== migration) throw new Error(`Die Sicherung hat den Migrationsstand ${manifest.migration ?? "unbekannt"}, die Datenbank ${migration}`);

    const n8nAfter = startN8n ?? running(N8N);
    if (running(N8N)) run("docker", ["stop", N8N]);
    log("n8n angehalten");

    // 1. Postgres: services that write are stopped, the kept tables are set aside
    for (const service of SERVICES) if (running(service)) run("docker", ["stop", service]);
    keepTables(fresh);
    run("docker", ["cp", path.join(dir, "postgres.dump"), `${DB}:/tmp/rheinwerk-restore.dump`]);
    let output = "";
    try {
      output = run("docker", ["exec", DB, "pg_restore", "-U", "supabase_admin", "-d", "postgres", "--clean", "--if-exists", "/tmp/rheinwerk-restore.dump"]).toString();
    } catch (error) {
      output = String(error.stderr ?? error.message);
    }
    const unexpected = unexpectedRestoreErrors(output);
    if (unexpected.length) {
      run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-restore.dump"]);
      throw new Error(`pg_restore: ${unexpected.slice(0, 5).join(" | ")}`);
    }
    const acl = applyDumpAcl("/tmp/rheinwerk-restore.dump");
    run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-restore.dump"]);
    checkpoint("pg_restore");
    returnTables();
    for (const [table, expected] of Object.entries(manifest.counts)) {
      const actual = Number(psql(`select count(*) from ${table}`));
      if (actual !== expected) throw new Error(`${table}: ${actual} statt ${expected} Zeilen nach der Wiederherstellung`);
    }
    log(`Postgres wiederhergestellt (${Object.keys(manifest.counts).length} Tabellen mit gleicher Zeilenzahl, Rechte aus ${acl} Einträgen der Sicherung)`);
    checkpoint("postgres");

    // 2. Storage files: folder emptied, then the archive
    for (const service of SERVICES) run("docker", ["start", service]);
    await waitFor("Storage", () => running(STORAGE), 60);
    run("docker", ["exec", STORAGE, "sh", "-c", `find ${STORAGE_PATH} -mindepth 1 -delete`]);
    run("docker", ["exec", "-i", STORAGE, "tar", "-xzf", "-", "-C", STORAGE_PATH], { input: readFileSync(path.join(dir, "storage.tar.gz")) });
    const files = Number(run("docker", ["exec", STORAGE, "sh", "-c", `find ${STORAGE_PATH} -type f | wc -l`]).toString().trim());
    if (files !== manifest.storage_files) throw new Error(`Storage: ${files} statt ${manifest.storage_files} Dateien`);
    psql("notify pgrst, 'reload schema'");
    log(`Storage wiederhergestellt (${files} Dateien)`);
    checkpoint("storage");

    // 3. n8n: database and key into its volume through a helper container of the same image (as user node)
    const stage = path.join(work, "n8n");
    mkdirSync(stage);
    copyFileSync(path.join(dir, "n8n-database.sqlite"), path.join(stage, "database.sqlite"));
    if (existsSync(path.join(dir, "n8n-config"))) {
      copyFileSync(path.join(dir, "n8n-config"), path.join(stage, "config"));
      chmodSync(path.join(stage, "config"), 0o600);
    }
    const image = run("docker", ["inspect", "-f", "{{.Config.Image}}", N8N]).toString().trim();
    run("docker", ["run", "--rm", "-i", "--network", "none", "--volumes-from", N8N, "--entrypoint", "sh", image, "-c",
      `cd ${N8N_HOME} && rm -f database.sqlite database.sqlite-wal database.sqlite-shm && tar -xf -`],
    { input: run("tar", ["-cf", "-", "-C", stage, "."]) });
    if (n8nAfter) {
      run("docker", ["start", N8N]);
      await waitFor("n8n", n8nHealthy, 180);
    }
    log(`n8n wiederhergestellt (${manifest.n8n_workflows} Workflows${n8nAfter ? ", läuft" : ", bleibt angehalten"})`);
    checkpoint("n8n");
    return manifest;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// Brings the stack back up after a failed step, so the return to the backup before can run
export function startAll() {
  for (const service of SERVICES) if (!running(service)) run("docker", ["start", service]);
}
export function startN8n() {
  if (!running(N8N)) run("docker", ["start", N8N]);
}

// By hand: node scripts/restore.mjs <archive>, or only the privileges of schema public from an archive with the same
// migration state: node scripts/restore.mjs --acl <archive> (repair after an earlier pg_restore, docs/betrieb.md 4.5)
if (import.meta.url === `file://${process.argv[1]}`) {
  const acl = process.argv[2] === "--acl";
  const archive = process.argv[acl ? 3 : 2];
  if (!archive) { console.error("Aufruf: node scripts/restore.mjs [--acl] <archiv> (nur mit Sicherung davor, docs/betrieb.md 4.5)"); process.exit(2); }
  if (acl) {
    const { work, dir, manifest } = unpack(archive);
    try {
      if (manifest.migration !== currentMigration()) throw new Error(`Die Sicherung hat den Migrationsstand ${manifest.migration ?? "unbekannt"}, die Datenbank ${currentMigration()}`);
      run("docker", ["cp", path.join(dir, "postgres.dump"), `${DB}:/tmp/rheinwerk-acl.dump`]);
      console.log(`Rechte im Schema public aus ${applyDumpAcl("/tmp/rheinwerk-acl.dump", ["public"])} Einträgen von ${manifest.name} gesetzt`);
    } finally {
      run("docker", ["exec", DB, "rm", "-f", "/tmp/rheinwerk-acl.dump"]);
      rmSync(work, { recursive: true, force: true });
    }
  } else {
    await restoreArchive(archive);
  }
}
