// Watchdog (task-17-9; checks of n8n follow in task-17-8): launchd online.rheinwerk.watchdog every 5 minutes
//   node --env-file=…/shared/.env.local …/tools/scripts/prod/watchdog.mjs
// Every failed check is a warning in system_alerts (one per key); the database decides about the e-mail to the admin
// (new incident, reminder after 6 hours), a check that passes again closes it with an all-clear e-mail. Skipped checks
// (missing access or setting) leave open warnings as they are. The result goes to system_status.monitoring for the
// area "System". Without database no warning can be recorded, so no e-mail either (that outage is reported by
// /api/health). Output only for failed checks, to keep logs/watchdog.log short.
import { sendAlert } from "../lib/notify.mjs";
import { rpc } from "./lib.mjs";
import { collectMira, evaluateMira } from "./mira.mjs";

const DASHBOARD = "https://rheinwerk-service.online/dashboard/system";

async function report(source, checks) {
  for (const check of checks) {
    if (check.ok === null) continue;
    if (check.ok) {
      const cleared = await rpc("clear_alert", { alert_key: check.key });
      if (cleared?.notify) await sendAlert({ subject: `Wieder in Ordnung: ${check.title || check.label}`, text: `${check.label} arbeitet wieder fehlerfrei.\n\n${DASHBOARD}` });
      continue;
    }
    console.log(`${new Date().toISOString()} ${check.key}: ${check.title}`);
    const alert = await rpc("raise_alert", { source, alert_key: check.key, severity: check.severity, title: check.title, detail: check.detail.slice(0, 4000) });
    if (!alert?.notify) continue;
    const mail = await sendAlert({ subject: check.title, text: `${check.detail}\n\n${alert.reason === "reminder" ? "Erinnerung: besteht seit mehr als 6 Stunden.\n\n" : ""}${DASHBOARD}` });
    if (mail.ok) await rpc("mark_alert_notified", { alert_id: alert.alert_id });
  }
}

const mira = evaluateMira(await collectMira(process.env, rpc), { creditMin: process.env.MIRA_CREDIT_MIN });
await report("mira", mira.checks);
await rpc("set_monitoring", {
  system_key: "mira",
  payload: {
    state: mira.state,
    credit: mira.credit,
    checks: mira.checks.map(({ key, label, ok, severity, title, detail }) => ({ key, label, ok, severity, title: ok === false ? title : null, detail })),
  },
});
