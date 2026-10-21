// Shared helpers of the services on the host (task-17-17): database as service_role and warnings with e-mail. The
// services run from the development folder with its .env.local (node --env-file=.env.local), see scripts/ops/install.mjs.
import { createClient } from "@supabase/supabase-js";
import { sendAlert } from "../lib/notify.mjs";

export const DASHBOARD = "https://rheinwerk-service.online/dashboard/system";

// Calls never throw: without the database the service goes on and only the record in the dashboard is missing
let client = null;
export async function rpc(name, args = {}) {
  try {
    client ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.SUPABASE_SECRET_KEY ?? "", {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await client.rpc(name, args);
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
