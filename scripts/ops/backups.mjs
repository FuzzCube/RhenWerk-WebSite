// State of the backups for the watchdog (task-18-6): the newest checked own backup (public.backups, daily at 03:00 or
// "Jetzt sichern") must not be older than 26 hours, and the daily backup of the provider (OVHcloud, whole server) must
// be enabled with a restore point of the last 48 hours. collectProvider asks the OVHcloud API (read-only key, at most
// once an hour or on "System prüfen"), evaluateBackups is pure (unit tests in tests/unit/backups-monitor.test.mjs).
//   OVH_APPLICATION_KEY, OVH_APPLICATION_SECRET, OVH_CONSUMER_KEY (eu.api.ovh.com/createToken, only GET on
//   /vps/<name>/automatedBackup*), OVH_VPS_NAME (default vps-0fcb2edf.vps.ovh.net), OVH_ENDPOINT (default eu)
import { createHash } from "node:crypto";

export const BACKUP_MAX_HOURS = 26;
export const PROVIDER_MAX_HOURS = 48;
export const PROVIDER_CHECK_MINUTES = 60;
const HOUR = 60 * 60 * 1000;

async function ovh(env, method, route) {
  const base = `https://${env.OVH_ENDPOINT ?? "eu"}.api.ovh.com/1.0`;
  const time = await fetch(`${base}/auth/time`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.text());
  const url = `${base}${route}`;
  const signature = createHash("sha1").update([env.OVH_APPLICATION_SECRET, env.OVH_CONSUMER_KEY, method, url, "", time].join("+")).digest("hex");
  const response = await fetch(url, {
    method, signal: AbortSignal.timeout(15_000),
    headers: { "X-Ovh-Application": env.OVH_APPLICATION_KEY, "X-Ovh-Consumer": env.OVH_CONSUMER_KEY, "X-Ovh-Timestamp": time.trim(), "X-Ovh-Signature": `$1$${signature}` },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}${body?.message ? `: ${body.message}` : ""}`);
  return body;
}

// null: no key configured; { error }: API not reachable or key rejected
export async function collectProvider(env) {
  if (!env.OVH_APPLICATION_KEY || !env.OVH_APPLICATION_SECRET || !env.OVH_CONSUMER_KEY) return null;
  const vps = env.OVH_VPS_NAME ?? "vps-0fcb2edf.vps.ovh.net";
  try {
    const [service, points] = await Promise.all([
      ovh(env, "GET", `/vps/${vps}/automatedBackup`),
      ovh(env, "GET", `/vps/${vps}/automatedBackup/restorePoints?state=available`),
    ]);
    const sorted = (points ?? []).slice().sort();
    return { state: service?.state ?? null, schedule: service?.schedule ?? null, restore_points: sorted.length, last_restore_point: sorted.at(-1) ?? null, checked_at: new Date().toISOString() };
  } catch (error) {
    return { error: error.name === "TimeoutError" ? "Zeitüberschreitung" : error.message, checked_at: new Date().toISOString() };
  }
}

const check = (key, label, ok, severity = "warning", title = "", detail = "") => ({ key, label, ok, severity, title, detail });

// latest: newest row of public.backups with status ok and verified (reason daily or manual), lastFailed: newest row
// overall when it failed; provider: result of collectProvider (or the previous one between the hourly checks)
export function evaluateBackups({ latest, provider }, now = new Date()) {
  const checks = [];
  const age = latest ? (now.getTime() - Date.parse(latest.finished_at)) / HOUR : null;
  if (!latest) {
    checks.push(check("backup:stale", "Eigene Sicherung", false, "critical", "Keine geprüfte Sicherung vorhanden",
      "In der Datenbank steht keine Sicherung mit bestandener Probewiederherstellung. „Jetzt sichern“ im Bereich System oder sudo systemctl start rheinwerk-backup.service (docs/betrieb.md 4)."));
  } else if (age > BACKUP_MAX_HOURS) {
    checks.push(check("backup:stale", "Eigene Sicherung", false, "critical", `Letzte Sicherung vor ${Math.floor(age)} Stunden`,
      `Die letzte geprüfte Sicherung ist vom ${latest.finished_at} (erwartet täglich um 03:00, Warnung nach ${BACKUP_MAX_HOURS} Stunden). Läuft der Timer (systemctl list-timers rheinwerk-backup)? Protokoll: journalctl -u rheinwerk-backup.`));
  } else {
    checks.push(check("backup:stale", "Eigene Sicherung", true));
  }

  let providerState = null;
  if (!provider) {
    checks.push(check("backup:provider", "Sicherung des Anbieters", null, "warning", "", "Kein OVHcloud-API-Schlüssel hinterlegt: Zustand der Sicherung des Anbieters wird nicht geprüft."));
  } else if (provider.error) {
    checks.push(check("backup:provider", "Sicherung des Anbieters", false, "warning", "Sicherung des Anbieters nicht abrufbar",
      `Die OVHcloud-API antwortet nicht wie erwartet (${provider.error}). Schlüssel in /opt/rheinwerk/ops.env (OVH_*) prüfen oder neu anlegen (docs/betrieb.md 4).`));
  } else {
    const pointAge = provider.last_restore_point ? (now.getTime() - Date.parse(provider.last_restore_point)) / HOUR : null;
    if (provider.state !== "enabled") {
      checks.push(check("backup:provider", "Sicherung des Anbieters", false, "warning", "Sicherung des Anbieters ausgeschaltet",
        `OVHcloud meldet für die automatische Sicherung den Zustand „${provider.state ?? "unbekannt"}“. Im OVHcloud-Kundencenter unter VPS → Automatische Sicherung einschalten.`));
    } else if (pointAge === null || pointAge > PROVIDER_MAX_HOURS) {
      checks.push(check("backup:provider", "Sicherung des Anbieters", false, "warning", "Kein aktueller Sicherungspunkt beim Anbieter",
        `Der letzte Sicherungspunkt von OVHcloud ist ${provider.last_restore_point ? `vom ${provider.last_restore_point}` : "nicht vorhanden"} (erwartet täglich).`));
    } else {
      checks.push(check("backup:provider", "Sicherung des Anbieters", true));
    }
    providerState = { state: provider.state, schedule: provider.schedule, restore_points: provider.restore_points, last_restore_point: provider.last_restore_point };
  }

  const failed = checks.filter((c) => c.ok === false);
  const state = failed.some((c) => c.severity === "critical") ? "critical" : failed.length ? "warning" : "ok";
  const summary = latest ? `Letzte geprüfte Sicherung ${latest.finished_at}` : null;
  return { state, summary, checks, provider: providerState ?? (provider?.error ? { error: provider.error } : null), provider_checked_at: provider?.checked_at ?? null };
}
