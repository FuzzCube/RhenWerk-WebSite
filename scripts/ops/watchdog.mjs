// Watchdog (task-17-9; checks of n8n follow in task-17-8): launchd online.rheinwerk.watchdog every 5 minutes from the
// development folder, by hand: npm run watchdog
// Every failed check is a warning in system_alerts with e-mail to the admin, a check that passes again closes it
// (scripts/ops/lib.mjs). The result goes to system_status.monitoring for the area "System". Output only for failed
// checks, to keep the log short.
import { report, rpc } from "./lib.mjs";
import { collectMira, evaluateMira } from "./mira.mjs";

const mira = evaluateMira(await collectMira(process.env, rpc), { creditMin: process.env.MIRA_CREDIT_MIN });
for (const check of mira.checks) await report("mira", check);
await rpc("set_monitoring", {
  system_key: "mira",
  payload: {
    state: mira.state,
    credit: mira.credit,
    checks: mira.checks.map(({ key, label, ok, severity, title, detail }) => ({ key, label, ok, severity, title: ok === false ? title : null, detail })),
  },
});
