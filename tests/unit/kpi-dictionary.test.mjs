// Keeps the documentation in sync with the code (task-9-1): every KPI of the overview and every field of the
// time series is defined in docs/kpi-dictionary.md; the n8n contract covers all flows of spec section 8 and its
// "vorhanden"/"zu bauen" labels match the migrations.
// Run with: npm run test:unit
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { KPI_GROUPS, KPI_INFO } from "../../lib/analytics.ts";

const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const dictionary = read("docs/kpi-dictionary.md");
const contract = read("docs/n8n-contract.md");
const migrations = readdirSync(new URL("../../supabase/migrations/", import.meta.url)).map((file) => read(`supabase/migrations/${file}`)).join("\n");
const row = (key) => new RegExp(`^\\| \`${key}\` \\|`, "m");

test("jede Kennzahl der Übersicht steht im Wörterbuch", () => {
  const keys = new Set([...KPI_GROUPS.events, ...KPI_GROUPS.snapshots, ...KPI_GROUPS.finance, ...Object.keys(KPI_INFO)]);
  assert.equal(keys.size, 16);
  for (const key of keys) assert.match(dictionary, row(key), `${key} fehlt im Wörterbuch`);
});

test("Ereignis und Momentaufnahme stimmen mit der Gruppierung der Übersicht überein", () => {
  for (const key of KPI_GROUPS.snapshots) assert.match(dictionary, new RegExp(`^\\| \`${key}\` \\| [^|]+ \\| M \\|`, "m"), key);
  for (const key of KPI_GROUPS.events) assert.match(dictionary, new RegExp(`^\\| \`${key}\` \\| [^|]+ \\| E \\|`, "m"), key);
});

test("jedes Feld der Zeitreihe ist erklärt", () => {
  for (const field of ["received", "intake_completed", "automatic_completed", "completed", "invoiced_gross", "payments_received", "baseline_minutes"]) {
    assert.match(dictionary, new RegExp(`^\\| \`${field}\``, "m"), field);
  }
  assert.match(dictionary, /`saved_requests`, `saved_minutes`/);
});

test("n8n-Vertrag deckt Abschnitt 8 ab und trennt echte Tests von offener Aktivierung", () => {
  for (const heading of ["## 1. Einreichung", "## 2. Analyse", "## 3. Eingehende Gmail-Nachrichten", "## 4. Ausgehende Gmail-Nachrichten", "## 5. Auslöser und Rekursion"]) {
    assert.ok(contract.includes(heading), heading);
  }
  for (const topic of ["source_event_key", "expected_version", "contract_version", "operation_key", "Unklarer Versandausgang", "mailbox_key, gmail_message_id"]) {
    assert.ok(contract.includes(topic), topic);
  }
  assert.match(contract, /Gmail-Versand ist für die freigegebene Testnachricht \*\*echt nachgewiesen\*\*/);
  assert.match(contract, /Der Versandzeitplan ist veröffentlicht/);
  assert.match(contract, /Alle sechs Workflows sind veröffentlicht/);
  assert.match(contract, /Die öffentliche Website wurde nicht umgestellt/);
});

test("Stand der Funktionen im n8n-Vertrag entspricht den Migrationen", () => {
  const lines = contract.split("\n").filter((line) => /^\| `[a-z_]+\(/.test(line));
  assert.ok(lines.length >= 10);
  for (const line of lines) {
    const name = line.match(/^\| `([a-z_]+)\(/)[1];
    const exists = new RegExp(`create (or replace )?function public\\.${name}\\(`).test(migrations);
    if (line.includes("**vorhanden**")) assert.ok(exists, `${name} als vorhanden beschrieben, fehlt aber`);
    else if (line.includes("zu bauen")) assert.ok(!exists, `${name} existiert bereits, ist aber als „zu bauen“ beschrieben`);
    else assert.fail(`${name}: Stand fehlt`);
  }
});
