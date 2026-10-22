// Results of the watchdog in the area "System" (task-17-9, task-17-8, task-17-15): state per system, the credit of
// external services and the versions.
// The watchdog (scripts/ops/watchdog.mjs) writes system_status.monitoring every 5 minutes; an entry older than
// 15 minutes (SMTP, checked once an hour: stale_after_minutes) means the watchdog itself does not run. Pure functions,
// shared by page and unit tests.
import type { DisplayStatus } from "./display-status";

export type MonitorCheck = { key: string; label: string; ok: boolean | null; severity: "warning" | "critical"; title: string | null; detail: string };
export type Credit = { used: number; limit: number; remaining: number; min: number; tier: string; reset_at: string | null };
// errors: open warnings of the n8n error workflow (failed executions), shown with the failed checks
// summary: short fact of a passing check ("Antwort in 82 ms", "12 GB von 926 GB frei")
export type MonitorEntry = {
  state: "off" | "ok" | "warning" | "critical";
  checked_at: string;
  summary?: string | null;
  stale_after_minutes?: number;
  checks?: MonitorCheck[];
  credit?: Credit | null;
  errors?: { title: string; severity: "warning" | "critical" }[];
};
// Order of the rows in "Zustand der Systeme"
export const MONITORED_SYSTEMS = [
  { key: "website", label: "Website und Dashboard" },
  { key: "database", label: "Datenbank (Supabase)" },
  { key: "n8n", label: "Automatisierung (n8n)" },
  { key: "mira", label: "Telefonassistent (Mira)" },
  { key: "tunnel", label: "Cloudflare-Tunnel" },
  { key: "smtp", label: "E-Mail-Versand (SMTP)" },
  { key: "docker", label: "Docker" },
  { key: "disk", label: "Speicherplatz" },
] as const;
export type Monitoring = Partial<Record<(typeof MONITORED_SYSTEMS)[number]["key"], MonitorEntry>>;

export const STALE_AFTER_MINUTES = 15;

const STATE: Record<MonitorEntry["state"] | "stale", DisplayStatus> = {
  ok: { key: "in-ordnung", label: "In Ordnung", tone: "done" },
  warning: { key: "warnung", label: "Warnung", tone: "wait" },
  critical: { key: "gestoert", label: "Gestört", tone: "act" },
  off: { key: "nicht-eingerichtet", label: "Nicht eingerichtet", tone: "closed" },
  stale: { key: "veraltet", label: "Prüfung veraltet", tone: "wait" },
};

export function isStale(entry: Pick<MonitorEntry, "checked_at" | "stale_after_minutes">, now: Date): boolean {
  return now.getTime() - Date.parse(entry.checked_at) > (entry.stale_after_minutes ?? STALE_AFTER_MINUTES) * 60_000;
}

export function monitorStatus(entry: MonitorEntry, now: Date): DisplayStatus {
  return isStale(entry, now) ? STATE.stale : STATE[entry.state];
}

// Failed checks and failed executions first (title), then skipped checks with their reason; passing checks are not
// listed
export function monitorNotes(entry: MonitorEntry): { text: string; tone: "bad" | "muted" }[] {
  const checks = entry.checks ?? [];
  return [
    ...checks.filter((c) => c.ok === false).map((c) => ({ text: c.title ?? c.label, tone: "bad" as const })),
    ...(entry.errors ?? []).map((e) => ({ text: e.title, tone: "bad" as const })),
    ...checks.filter((c) => c.ok === null).map((c) => ({ text: c.detail, tone: "muted" as const })),
  ];
}

export type CreditView = { share: number; low: boolean; empty: boolean };

export function creditView(credit: Credit): CreditView {
  return {
    share: credit.limit > 0 ? Math.min(1, Math.max(0, credit.remaining / credit.limit)) : 0,
    low: credit.remaining < credit.min,
    empty: credit.remaining <= 0,
  };
}

// Versions (task-17-15, scripts/ops/versions.mjs): only shown with a recommendation, never installed
export type VersionLevel = "current" | "update" | "major" | "unknown";
export type VersionItem = { name: string; current: string | null; latest: string | null; level?: VersionLevel; text?: string; notes?: string };
export type VersionRow = {
  key: string;
  label: string;
  current: string | null;
  latest: string | null;
  level: VersionLevel;
  text: string;
  notes: string;
  how: string;
  hint?: string;
  items?: VersionItem[];
};

const LEVEL: Record<VersionLevel, DisplayStatus> = {
  current: { key: "aktuell", label: "Aktuell", tone: "done" },
  update: { key: "update", label: "Update empfohlen", tone: "run" },
  major: { key: "hauptversion", label: "Neue Hauptversion", tone: "wait" },
  unknown: { key: "nicht-geprueft", label: "Nicht geprüft", tone: "closed" },
};

export const versionStatus = (level: VersionLevel): DisplayStatus => LEVEL[level] ?? LEVEL.unknown;

// "System prüfen" (task-17-15): the service online.rheinwerk.systemcheck picks a request up within 20 seconds; after
// 2 minutes without start it probably does not run
export type CheckRequest = { requested_at: string | null; started_at: string | null };
// A request is dropped after 10 minutes ("System prüfen") or 30 minutes ("Jetzt sichern", task-18-6)
export function checkRequestState(request: CheckRequest, now: Date, expireMinutes = 10): "idle" | "waiting" | "running" | "stuck" {
  if (!request.requested_at) return "idle";
  if (now.getTime() - Date.parse(request.requested_at) > expireMinutes * 60_000) return "idle";
  if (request.started_at) return "running";
  return now.getTime() - Date.parse(request.requested_at) > 2 * 60_000 ? "stuck" : "waiting";
}
