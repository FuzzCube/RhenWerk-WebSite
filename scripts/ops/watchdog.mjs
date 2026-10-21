// Watchdog (task-17-9 Mira, task-17-8 n8n): launchd online.rheinwerk.watchdog every 5 minutes from the development
// folder, by hand: npm run watchdog
// Every failed check is a warning in system_alerts with e-mail to the admin, a check that passes again closes it
// (scripts/ops/lib.mjs). Afterwards the e-mails still due go out: warnings the n8n error workflow raised itself
// (n8n does not send e-mails about its own failures) and reminders after 6 hours. The results go to
// system_status.monitoring for the area "System". Output only for failed checks, to keep the log short.
import { notifyDue, report, rpc } from "./lib.mjs";
import { collectMira, evaluateMira } from "./mira.mjs";
import { collectN8n, evaluateN8n } from "./n8n.mjs";

const strip = (checks) => checks.map(({ key, label, ok, severity, title, detail }) => ({ key, label, ok, severity, title: ok === false ? title : null, detail }));

const [miraRaw, n8nRaw] = await Promise.all([collectMira(process.env, rpc), collectN8n(process.env, rpc)]);
const mira = evaluateMira(miraRaw, { creditMin: process.env.MIRA_CREDIT_MIN });
const n8n = evaluateN8n(n8nRaw);
for (const check of mira.checks) await report("mira", check);
for (const check of n8n.checks) await report("n8n", check);
await notifyDue();

await rpc("set_monitoring", { system_key: "mira", payload: { state: mira.state, credit: mira.credit, checks: strip(mira.checks) } });
await rpc("set_monitoring", { system_key: "n8n", payload: { state: n8n.state, checks: strip(n8n.checks), errors: n8n.errors } });
