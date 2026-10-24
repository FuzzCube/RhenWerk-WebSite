import type { EmployeeRole } from "./auth/roles";
import type { CallbackAlert } from "./dashboard/callbacks";
import type { SendBacklog } from "./send-backlog";
import type { SystemAlert } from "./system-summary";

// info: a mere result (e.g. a rescheduled visit) that fades out by itself; everything else stays until handled.
export type DashboardEvent = { id: string; title: string; href: string; info?: true };
export type DashboardSnapshot = {
  employeeId: string;
  role: EmployeeRole;
  cursor: string;
  revision: string;
  counts: { inbox: number; newRequests: number; unreadRequests: number; changes: number; failedRequests: number; failedInbox: number };
  callbacks: CallbackAlert[];
  backlog: SendBacklog | null;
  systemAlerts: SystemAlert[];
  events: DashboardEvent[];
};

// Keep seen identities for the lifetime of this shell, including events that disappear after processing.
// Counts alone cannot distinguish two successive replies on the same unread request.
export function freshDashboardEvents(events: DashboardEvent[], seen: Set<string>): DashboardEvent[] {
  const fresh: DashboardEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    fresh.push(event);
  }
  return fresh;
}

// The user opened the event's target (path and every query parameter of the link match; the hash is ignored).
export function eventTargetOpen(href: string, pathname: string, search: URLSearchParams): boolean {
  const target = new URL(href, "http://x");
  return target.pathname === pathname && [...target.searchParams].every(([key, value]) => search.get(key) === value);
}

export function callbackEvent(alert: CallbackAlert, role: EmployeeRole): DashboardEvent {
  return {
    id: `callback:${alert.kind}:${alert.id}`,
    title: alert.kind === "call" ? "Dringender Anruf: bitte zurückrufen" : role === "dispatcher"
      ? "Dringend: Rückruf nicht bestätigt" : "Rückrufbitte: Kunde wartet",
    href: alert.kind === "call" ? `/dashboard/anrufe/${alert.id}` : role === "technician"
      ? `/dashboard/einsatz/${alert.visit_id}` : `/dashboard/anfragen/${alert.request_id}`,
  };
}
