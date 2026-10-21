// Summary at the top of the area "System" (task-17-12): open warnings decide whether everything is in order.
// Pure functions, shared by page and unit tests.
export type SystemAlert = {
  id: string;
  source: "n8n" | "mira" | "update" | "backup" | "app";
  severity: "warning" | "critical";
  title: string;
  first_seen_at: string;
};

export type SystemSummary = { ok: boolean; title: string; alerts: SystemAlert[] };

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
};

export const alertSourceLabel = (source: SystemAlert["source"]): string => SOURCE_LABEL[source];
