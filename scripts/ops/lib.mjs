// Shared helpers of the services on the host (task-17-17): database as service_role and warnings with e-mail. The
// services run from the development folder with its .env.local (node --env-file=.env.local), see scripts/ops/install.mjs.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { sendAlert } from "../lib/notify.mjs";

export const DASHBOARD = "https://rheinwerk-service.online/dashboard/system";
// OPS_LOG_DIR on the VPS (task-18-2: /opt/rheinwerk/state, logs in the journal of systemd)
export const LOG_DIR = process.env.OPS_LOG_DIR ?? path.join(homedir(), "Library", "Logs", "RheinWerk");

// Calls never throw: without the database the service goes on and only the record in the dashboard is missing
let client = null;
const db = () => (client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", {
  auth: { autoRefreshToken: false, persistSession: false },
}));

export async function rpc(name, args = {}) {
  try {
    const { data, error } = await db().rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  } catch (error) {
    console.error(`Datenbank (${name}): ${error.message}`);
    return null;
  }
}

// One check result → warning in system_alerts (one per key) or its all-clear. The database decides about the e-mail
// (new incident, reminder after 6 hours); without database there is no record, so no e-mail either (otherwise the
// watchdog would send one every 5 minutes). ok: null = check skipped, open warnings stay as they are.
export async function report(source, check) {
  if (check.ok === null) return;
  if (check.ok) {
    const cleared = await rpc("clear_alert", { alert_key: check.key });
    if (cleared?.notify) await sendAlert({ subject: `Wieder in Ordnung: ${check.title || check.label}`, text: `${check.label} arbeitet wieder fehlerfrei.\n\n${DASHBOARD}` });
    return;
  }
  console.log(`${new Date().toISOString()} ${check.key}: ${check.title}`);
  const alert = await rpc("raise_alert", { source, alert_key: check.key, severity: check.severity, title: check.title, detail: check.detail.slice(0, 4000) });
  if (!alert?.notify) return;
  const mail = await sendAlert({ subject: check.title, text: `${check.detail}\n\n${alert.reason === "reminder" ? "Erinnerung: besteht seit mehr als 6 Stunden.\n\n" : ""}${DASHBOARD}` });
  if (mail.ok) await rpc("mark_alert_notified", { alert_id: alert.alert_id });
}

// E-mails still due (alerts_to_notify): warnings raised without e-mail by the n8n error workflow, sends that failed
// and reminders after 6 hours. Runs after report(), whose e-mails are already marked.
export async function notifyDue() {
  for (const alert of (await rpc("alerts_to_notify")) ?? []) {
    console.log(`${new Date().toISOString()} E-Mail: ${alert.alert_key}`);
    const reminder = alert.notified_at ? "Erinnerung: besteht seit mehr als 6 Stunden.\n\n" : "";
    const repeated = alert.occurrences > 1 ? `${alert.occurrences}-mal seit ${alert.first_seen_at}.\n\n` : "";
    const mail = await sendAlert({ subject: alert.title, text: `${alert.detail ?? alert.title}\n\n${repeated}${reminder}${DASHBOARD}` });
    if (mail.ok) await rpc("mark_alert_notified", { alert_id: alert.id });
  }
}

// Previous results (task-17-15: SMTP is checked only once an hour); {} without database
export async function readMonitoring() {
  try {
    const { data, error } = await db().from("system_status").select("monitoring").single();
    if (error) throw new Error(error.message);
    return data.monitoring ?? {};
  } catch (error) {
    console.error(`Datenbank (system_status): ${error.message}`);
    return {};
  }
}

// Without database there is no warning record, so report() sends nothing. For the database itself (task-17-15) the
// e-mail goes out anyway, at most every 6 hours, remembered in a file next to the logs; "wieder in Ordnung" once the
// database answers again.
const OUTAGE_FILE = path.join(LOG_DIR, "datenbank-ausfall.json");
export async function reportWithoutDatabase(check) {
  if (check.ok === null) return;
  if (check.ok) {
    if (!existsSync(OUTAGE_FILE)) return;
    rmSync(OUTAGE_FILE);
    await sendAlert({ subject: `Wieder in Ordnung: ${check.label}`, text: `${check.label} arbeitet wieder fehlerfrei.\n\n${DASHBOARD}` });
    return;
  }
  let last = null;
  try { last = JSON.parse(readFileSync(OUTAGE_FILE, "utf8")).notified_at; } catch { /* first e-mail */ }
  if (last && Date.now() - Date.parse(last) < 6 * 60 * 60 * 1000) return;
  const mail = await sendAlert({ subject: check.title, text: `${check.detail}\n\n${last ? "Erinnerung: besteht seit mehr als 6 Stunden.\n\n" : ""}${DASHBOARD}` });
  if (!mail.ok) return;
  mkdirSync(LOG_DIR, { recursive: true });
  writeFileSync(OUTAGE_FILE, JSON.stringify({ notified_at: new Date().toISOString() }));
}

// System check "Datenbank" (task-17-15): one small read with its duration
export async function pingDatabase() {
  const started = performance.now();
  try {
    const { error } = await db().from("system_status").select("id").limit(1).abortSignal(AbortSignal.timeout(10_000));
    if (error) throw new Error(error.message || "Datenbankfehler");
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), error: error.name === "TimeoutError" ? "Zeitüberschreitung" : error.message };
  }
}
