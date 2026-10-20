// One-off back-fill of the customer master data (task-14-3): processed live requests without customer get the rules of
// task-14-1 (link, create customer, or suggestion for a human). Without argument a dry run: report only, nothing changes.
// With --apply the changes are written; that needs a backup from the last hour (npm run backup).
// Usage: npm run customers:backfill [-- --apply]   (SUPABASE_DB_CONTAINER, BACKUP_DIR as for backup)
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DB = process.env.SUPABASE_DB_CONTAINER ?? "supabase_db_A.Sadkovojs_Project";
const OUT = process.env.BACKUP_DIR ?? path.join(homedir(), "RheinWerk-Backups");
const MAX_BACKUP_AGE_MIN = 60;
const apply = process.argv.includes("--apply");

const LABEL = { anlegen: "Kunde anlegen", verknuepfen: "Verknüpfen", vorschlag: "Vorschlag", uebersprungen: "Übersprungen" };

if (apply) {
  const newest = existsSync(OUT) ? readdirSync(OUT).filter((file) => /^rheinwerk-\d{8}T\d{6}Z\.tar\.gz(\.enc)?$/.test(file)).sort().at(-1) : null;
  const stamp = newest?.match(/^rheinwerk-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z/);
  const age = stamp ? (Date.now() - Date.UTC(stamp[1], stamp[2] - 1, stamp[3], stamp[4], stamp[5], stamp[6])) / 60000 : Infinity;
  if (age > MAX_BACKUP_AGE_MIN) {
    console.error(`Keine Sicherung aus der letzten Stunde in ${OUT}. Zuerst: npm run backup`);
    process.exit(1);
  }
  console.log(`Sicherung vorhanden: ${newest} (vor ${Math.round(age)} min)`);
}

const sql = `select request_number, outcome, coalesce(customer_number, ''), coalesce(detail, '') from private.backfill_request_customers(apply => ${apply})`;
const rows = execFileSync("docker", ["exec", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-AtqF", "\t", "-c", sql], { encoding: "utf8" })
  .split("\n").filter(Boolean).map((line) => line.split("\t"));

console.log(apply ? "Nachzuordnung ausgeführt" : "Probelauf – es wurde nichts geändert");
if (!rows.length) console.log("Keine bearbeiteten Live-Anfragen ohne Kunden.");
for (const [number, outcome, customer, detail] of rows) {
  console.log(`  ${number}  ${(LABEL[outcome] ?? outcome).padEnd(13)} ${customer ? `${customer}  ` : ""}${detail}`);
}
const count = (outcome) => rows.filter((row) => row[1] === outcome).length;
console.log(`Summe: ${count("anlegen")} anlegen, ${count("verknuepfen")} verknüpfen, ${count("vorschlag")} Vorschlag, ${count("uebersprungen")} übersprungen`);
if (!apply && rows.length) console.log("Ausführen: npm run backup && npm run customers:backfill -- --apply");
