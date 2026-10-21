// Summary at the top of the area "System" (task-17-12) and banner on every page (task-17-10): open warnings decide
// whether everything is in order. Pure functions, shared by page, layout and unit tests.
import type { DisplayStatus } from "./display-status";

export type SystemAlert = {
  id: string;
  source: "n8n" | "mira" | "update" | "backup" | "app" | "system";
  severity: "warning" | "critical";
  title: string;
  first_seen_at: string;
};

export type SystemSummary = { ok: boolean; title: string; alerts: SystemAlert[] };

// Banner on every dashboard page for admin and manager (task-17-10): count and the most serious warning
export function systemBanner(alerts: SystemAlert[]): { title: string; worst: SystemAlert; critical: boolean } | null {
  if (alerts.length === 0) return null;
  const [worst] = sortAlerts(alerts);
  return { title: alerts.length === 1 ? "1 Warnung im System" : `${alerts.length} Warnungen im System`, worst, critical: worst.severity === "critical" };
}

const SEVERITY_RANK: Record<SystemAlert["severity"], number> = { critical: 0, warning: 1 };

// Critical first, within a severity the oldest first
export function sortAlerts(alerts: SystemAlert[]): SystemAlert[] {
  return [...alerts].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.first_seen_at.localeCompare(b.first_seen_at));
}

export function systemSummary(alerts: SystemAlert[]): SystemSummary {
  if (alerts.length === 0) return { ok: true, title: "Alles in Ordnung", alerts: [] };
  const title = alerts.length === 1 ? "1 Punkt braucht Aufmerksamkeit" : `${alerts.length} Punkte brauchen Aufmerksamkeit`;
  return { ok: false, title, alerts: sortAlerts(alerts) };
}

const SOURCE_LABEL: Record<SystemAlert["source"], string> = {
  n8n: "Automatisierung (n8n)",
  mira: "Telefonassistent",
  update: "Nächtliches Update",
  backup: "Datensicherung",
  app: "Website und Dashboard",
  system: "Zustand der Systeme",
};

export const alertSourceLabel = (source: SystemAlert["source"]): string => SOURCE_LABEL[source];

// Full row for the list of warnings in the area "System" (task-17-10)
export type SystemAlertRow = SystemAlert & {
  detail: string | null;
  last_seen_at: string;
  occurrences: number;
  resolved_at: string | null;
  resolved_reason: "auto" | "manual" | null;
  resolver: string | null;
};

export function severityStatus(alert: Pick<SystemAlert, "severity">): DisplayStatus {
  return alert.severity === "critical" ? { key: "kritisch", label: "Kritisch", tone: "act" } : { key: "warnung", label: "Warnung", tone: "wait" };
}

// "automatisch behoben" (the next check passed) or "erledigt von <name>" (admin by hand)
export function resolvedLabel(alert: Pick<SystemAlertRow, "resolved_reason" | "resolver">): string {
  return alert.resolved_reason === "manual" ? `erledigt von ${alert.resolver ?? "Admin"}` : "automatisch behoben";
}
