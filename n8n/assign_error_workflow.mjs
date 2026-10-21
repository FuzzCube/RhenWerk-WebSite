// Publishes the error workflow "RheinWerk · Fehlermeldung" (rwFehlerMeldung1, task-17-8) and sets it for every
// RheinWerk workflow in n8n/workflows/*.workflow.json: in the running n8n via its API and in the exports, so that an
// import keeps it.
// Other workflows in the same n8n stay untouched. Safe to run again.
//   node --env-file=.env.local n8n/assign_error_workflow.mjs   (N8N_API_KEY, N8N_API_URL default http://127.0.0.1:5678)
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ERROR_WORKFLOW = "rwFehlerMeldung1";
const DIR = new URL("./workflows/", import.meta.url).pathname;
const API = `${process.env.N8N_API_URL ?? "http://127.0.0.1:5678"}/api/v1/workflows/`;
const headers = { "X-N8N-API-KEY": process.env.N8N_API_KEY ?? "", "content-type": "application/json" };
if (!process.env.N8N_API_KEY) {
  console.error("N8N_API_KEY fehlt (n8n → Settings → n8n API).");
  process.exit(1);
}

let failed = 0;
// n8n 2.x calls an error workflow only while it is published (otherwise: "is not active and cannot be executed")
const own = await (await fetch(API + ERROR_WORKFLOW, { headers })).json();
if (!own.id) {
  console.error(`${ERROR_WORKFLOW} fehlt: n8n/workflows/rheinwerk-error-alerts.workflow.json importieren (docs/n8n-workflows.md 7).`);
  process.exit(1);
}
if (!own.active) {
  const response = await fetch(`${API}${ERROR_WORKFLOW}/activate`, { method: "POST", headers });
  console.log(`${own.name}: ${response.ok ? "veröffentlicht" : `FEHLER beim Veröffentlichen ${response.status}`}`);
  if (!response.ok) failed++;
}
for (const file of readdirSync(DIR).filter((name) => name.endsWith(".workflow.json")).sort()) {
  const full = path.join(DIR, file);
  const exported = JSON.parse(readFileSync(full, "utf8"));
  if (exported.id === ERROR_WORKFLOW) continue;
  if (exported.settings?.errorWorkflow !== ERROR_WORKFLOW) {
    exported.settings = { ...exported.settings, errorWorkflow: ERROR_WORKFLOW };
    writeFileSync(full, JSON.stringify(exported, null, 2) + "\n");
  }
  const live = await (await fetch(API + exported.id, { headers })).json();
  if (!live.id) { console.error(`${exported.id} ${exported.name}: in n8n nicht gefunden`); failed++; continue; }
  if (live.settings?.errorWorkflow === ERROR_WORKFLOW) { console.log(`${live.name}: bereits gesetzt`); continue; }
  // PUT keeps the workflow active and publishes the unchanged nodes again (checked with n8n 2.40.7)
  const response = await fetch(API + live.id, {
    method: "PUT", headers,
    body: JSON.stringify({ name: live.name, nodes: live.nodes, connections: live.connections, settings: { ...live.settings, errorWorkflow: ERROR_WORKFLOW } }),
  });
  const updated = await response.json();
  const ok = response.ok && updated.settings?.errorWorkflow === ERROR_WORKFLOW && updated.active === live.active;
  console.log(`${live.name}: ${ok ? "gesetzt" : `FEHLER ${response.status} ${updated.message ?? ""}`}`);
  if (!ok) failed++;
}
process.exit(failed ? 1 : 0);
