// One round of checks (task-17-9 Mira, task-17-8 n8n, task-17-15 systems, task-18-6 backups), shared by the watchdog (every 5 minutes)
// and "System prüfen" (scripts/ops/check.mjs). Every failed check is a warning in system_alerts with e-mail to the
// admin, a check that passes again closes it (lib.mjs). Afterwards the e-mails still due go out: warnings the n8n error
// workflow raised itself (n8n does not send e-mails about its own failures) and reminders after 6 hours. The results go
// to system_status.monitoring for the area "System". Output only for failed checks, to keep the log short.
// force: also the checks that otherwise run less often (SMTP and the backup of the provider once an hour).
import { PROVIDER_CHECK_MINUTES, collectProvider, evaluateBackups } from "./backups.mjs";
import { latestBackup, notifyDue, pingDatabase, readMonitoring, report, reportWithoutDatabase, rpc } from "./lib.mjs";
import { collectMira, evaluateMira } from "./mira.mjs";
import { STARTUP_MINUTES, collectN8n, containerStartedAt, evaluateN8n } from "./n8n.mjs";
import { OPENAI_CHECK_MINUTES, collectOpenAI, evaluateOpenAI } from "./openai.mjs";
import { collectSystems, evaluateSystems } from "./systems.mjs";

const strip = (checks) => checks.map(({ key, label, ok, severity, title, detail }) => ({ key, label, ok, severity, title: ok === false ? title : null, detail }));

export async function runChecks({ force = false } = {}) {
  const previous = await readMonitoring();
  const providerDue = force || !previous.backup?.provider_checked_at
    || Date.now() - Date.parse(previous.backup.provider_checked_at) > (PROVIDER_CHECK_MINUTES - 3) * 60_000;
  // Costs of OpenAI (task-19-5) once an hour; in between the last figures stay
  const openaiDue = force || !previous.openai?.checked_at || Date.now() - Date.parse(previous.openai.checked_at) > (OPENAI_CHECK_MINUTES - 3) * 60_000;
  const [miraRaw, n8nRaw, systemsRaw, latest, provider, openaiRaw] = await Promise.all([
    collectMira(process.env, rpc), collectN8n(process.env, rpc),
    collectSystems(process.env, { pingDatabase, previous, force }),
    latestBackup(), providerDue ? collectProvider(process.env) : previous.backup?.provider ?? null,
    openaiDue ? collectOpenAI(process.env) : null,
  ]);
  const n8nStart = containerStartedAt(process.env);
  const n8nStarting = Boolean(n8nStart) && Date.now() - Date.parse(n8nStart) < STARTUP_MINUTES * 60_000;
  const mira = evaluateMira(miraRaw, { creditMin: process.env.MIRA_CREDIT_MIN, n8nStarting });
  const n8n = evaluateN8n(n8nRaw);
  const systems = evaluateSystems(systemsRaw, process.env);
  for (const check of mira.checks) await report("mira", check);
  for (const check of n8n.checks) await report("n8n", check);
  for (const system of Object.values(systems)) for (const check of system.checks) await report("system", check);
  // Without database the age of the backups is unknown: no warning, the database check reports the outage
  const backup = latest === undefined ? null : evaluateBackups({ latest, provider });
  if (backup) for (const check of backup.checks) await report("backup", check);
  await reportWithoutDatabase(systems.database.checks[0]);
  await notifyDue();

  await rpc("set_monitoring", { system_key: "mira", payload: { state: mira.state, credit: mira.credit, checks: strip(mira.checks) } });
  await rpc("set_monitoring", { system_key: "n8n", payload: { state: n8n.state, checks: strip(n8n.checks), errors: n8n.errors } });
  if (backup) {
    await rpc("set_monitoring", { system_key: "backup", payload: {
      state: backup.state, summary: backup.summary, checks: strip(backup.checks), provider: backup.provider,
      provider_checked_at: providerDue ? backup.provider_checked_at : previous.backup?.provider_checked_at ?? null,
    } });
  }
  if (openaiRaw) {
    const openai = evaluateOpenAI(openaiRaw, { budget: process.env.OPENAI_BUDGET_USD, budgetMin: process.env.OPENAI_BUDGET_MIN_USD });
    await rpc("set_monitoring", { system_key: "openai", payload: { ...openai, stale_after_minutes: OPENAI_CHECK_MINUTES * 2 + 15 } });
  }
  for (const [key, system] of Object.entries(systems)) {
    await rpc("set_monitoring", { system_key: key, payload: { ...system, checks: strip(system.checks) } });
  }
}
