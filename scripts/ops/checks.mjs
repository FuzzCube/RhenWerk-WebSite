// One round of checks (task-17-9 Mira, task-17-8 n8n, task-17-15 systems), shared by the watchdog (every 5 minutes)
// and "System prüfen" (scripts/ops/check.mjs). Every failed check is a warning in system_alerts with e-mail to the
// admin, a check that passes again closes it (lib.mjs). Afterwards the e-mails still due go out: warnings the n8n error
// workflow raised itself (n8n does not send e-mails about its own failures) and reminders after 6 hours. The results go
// to system_status.monitoring for the area "System". Output only for failed checks, to keep the log short.
// force: also the checks that otherwise run less often (SMTP once an hour).
import { notifyDue, pingDatabase, readMonitoring, report, reportWithoutDatabase, rpc } from "./lib.mjs";
import { collectMira, evaluateMira } from "./mira.mjs";
import { collectN8n, evaluateN8n } from "./n8n.mjs";
import { collectSystems, evaluateSystems } from "./systems.mjs";

const strip = (checks) => checks.map(({ key, label, ok, severity, title, detail }) => ({ key, label, ok, severity, title: ok === false ? title : null, detail }));

export async function runChecks({ force = false } = {}) {
  const previous = await readMonitoring();
  const [miraRaw, n8nRaw, systemsRaw] = await Promise.all([
    collectMira(process.env, rpc), collectN8n(process.env, rpc),
    collectSystems(process.env, { pingDatabase, previous, force }),
  ]);
  const mira = evaluateMira(miraRaw, { creditMin: process.env.MIRA_CREDIT_MIN });
  const n8n = evaluateN8n(n8nRaw);
  const systems = evaluateSystems(systemsRaw, process.env);
  for (const check of mira.checks) await report("mira", check);
  for (const check of n8n.checks) await report("n8n", check);
  for (const system of Object.values(systems)) for (const check of system.checks) await report("system", check);
  await reportWithoutDatabase(systems.database.checks[0]);
  await notifyDue();

  await rpc("set_monitoring", { system_key: "mira", payload: { state: mira.state, credit: mira.credit, checks: strip(mira.checks) } });
  await rpc("set_monitoring", { system_key: "n8n", payload: { state: n8n.state, checks: strip(n8n.checks), errors: n8n.errors } });
  for (const [key, system] of Object.entries(systems)) {
    await rpc("set_monitoring", { system_key: key, payload: { ...system, checks: strip(system.checks) } });
  }
}
