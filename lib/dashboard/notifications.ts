import "server-only";
import { createHash } from "node:crypto";
import type { Employee } from "@/lib/auth/session";
import { callbackEvent, type DashboardEvent, type DashboardSnapshot } from "@/lib/dashboard-notifications";
import { createClient } from "@/lib/supabase/server";
import { loadCallbackAlerts } from "./callbacks";
import { inboxCount } from "./inbox";
import { unreadRequestCount } from "./requests";
import { loadSendBacklog } from "./send-backlog";
import { loadOpenSystemAlerts } from "./system-alerts";

// Every query uses the cookie-bound publishable-key client: existing RLS, visibility and assignment rules apply.
// No service-role client, mail bodies, AI analysis or secrets are sent to the browser.
export async function loadDashboardSnapshot(employee: Employee, cursor?: string): Promise<DashboardSnapshot> {
  const supabase = await createClient();
  const now = new Date().toISOString();
  // Overlap accommodates transactions in flight. IDs, not timestamps or counts, deduplicate notifications.
  const since = new Date(Date.parse(cursor ?? now) - 60_000).toISOString();
  const staff = employee.role !== "technician";
  const manager = employee.role === "admin" || employee.role === "manager";
  const checked = <T,>(result: { data: T; error: unknown }): T => {
    if (result.error) throw new Error("Dashboard-Daten nicht verfügbar");
    return result.data;
  };
  // Page through event identities, so Supabase's max_rows does not silently drop events after an offline interval.
  async function pages<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 500) {
      const data = checked(await query(from, from + 499)) ?? [];
      rows.push(...data);
      if (data.length < 500) return rows;
    }
  }
  const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
    const result = await query;
    if (result.error || result.count === null) throw new Error("Dashboard-Zähler nicht verfügbar");
    return result.count;
  };
  // Revision high-water marks cover updates and removals even if the visible total is unchanged. Only a hash leaves
  // the server; clients never receive IDs of rows outside their RLS scope. Reads are uncached on every request.
  const revisionQueries = [
    supabase.from("requests").select("id, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id").limit(1),
    supabase.from("visits").select("id, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id").limit(1),
    supabase.from("request_events").select("id, seq", { count: "exact" }).order("seq", { ascending: false }).limit(1),
    ...(staff ? [
      supabase.from("messages").select("id, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id").limit(1),
      supabase.from("visit_holds").select("id, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id").limit(1),
      supabase.from("visit_change_requests").select("id, updated_at", { count: "exact" }).order("updated_at", { ascending: false }).order("id").limit(1),
    ] : []),
  ];
  const [inbox, unreadRequests, newRequests, changes, callbacks, backlog, systemAlerts, incoming, requests, activity, failed, revisions] = await Promise.all([
    staff ? inboxCount() : 0,
    staff ? unreadRequestCount() : 0,
    staff ? count(supabase.from("requests").select("id", { count: "exact", head: true })
      .or("intake_status.in.(new,analyzing,needs_review),and(intake_status.eq.processed,work_status.eq.not_planned)")) : 0,
    staff ? count(supabase.from("visit_change_requests").select("id", { count: "exact", head: true }).in("status", ["open", "offered"])) : 0,
    loadCallbackAlerts(employee.role, { strict: true }),
    staff ? loadSendBacklog({ strict: true }) : null,
    manager ? loadOpenSystemAlerts({ strict: true }) : [],
    staff ? pages((from, to) => supabase.from("messages")
      .select("id, request_id, inbox_root_id, created_at, received_at, requests!messages_request_id_fkey(created_at)")
      .eq("direction", "incoming").gte("created_at", since).order("created_at").order("id").range(from, to)) : [],
    staff ? pages((from, to) => supabase.from("requests").select("id, request_number, source")
      .gte("created_at", since).order("created_at").order("id").range(from, to)) : [],
    pages((from, to) => supabase.from("request_events").select("id, request_id, visit_id, event_type, to_value")
      .gte("created_at", since).order("created_at").order("id").range(from, to)),
    staff ? pages((from, to) => supabase.from("messages").select("id, request_id, inbox_root_id")
      .eq("direction", "outgoing").eq("status", "failed").is("archived_at", null).order("id").range(from, to)) : [],
    Promise.all(revisionQueries).then((results) => results.map((result) => {
      if (result.error) throw new Error("Dashboard-Stand nicht verfügbar");
      return { data: result.data, count: result.count };
    })),
  ]);
  if (inbox === null || unreadRequests === null) throw new Error("Dashboard-Zähler nicht verfügbar");
  const events: DashboardEvent[] = [];
  for (const row of incoming) {
    // The initial email from which a request was created is not a customer reply.
    if (row.request_id && row.requests && Date.parse(row.received_at ?? row.created_at) <= Date.parse(row.requests.created_at)) continue;
    events.push({ id: `message:${row.id}`, title: row.request_id ? "Neue Kundenantwort" : "Neue E-Mail im Posteingang",
      href: row.request_id ? `/dashboard/anfragen/${row.request_id}#korrespondenz` : `/dashboard/posteingang?nachricht=${row.inbox_root_id ?? row.id}` });
  }
  for (const row of requests) events.push({ id: `request:${row.id}`, title: `Neue Anfrage ${row.request_number}${row.source === "phone_agent" ? " von Mira" : ""}`, href: `/dashboard/anfragen/${row.id}` });
  const resultTitles: Record<string, string> = {
    visit_cancelled: "Termin storniert", visit_rescheduled: "Termin verschoben", visit_change_confirmed: "Terminwunsch bestätigt",
    visit_change_offered: "Alternativtermin angeboten", visit_change_closed: "Terminwunsch erledigt",
  };
  const replyTitles: Record<string, string> = { change_requested: "Neuer Verschiebewunsch", change_updated: "Verschiebewunsch ergänzt", flagged: "Terminantwort bitte prüfen", declined: "Terminvorschlag abgelehnt" };
  for (const row of activity) {
    const title = (row.event_type === "visit_status_changed" && row.to_value === "cancelled" ? "Termin storniert" : resultTitles[row.event_type])
      ?? (row.event_type === "visit_reply_analyzed" ? replyTitles[row.to_value ?? ""] : undefined);
    if (title) events.push({ id: `event:${row.id}`, title, href: staff ? `/dashboard/planung?anfrage=${row.request_id}` : `/dashboard/anfragen/${row.request_id}`,
      ...(row.event_type === "visit_reply_analyzed" ? {} : { info: true as const }) });
  }
  for (const row of failed) events.push({ id: `send-failed:${row.id}`, title: "E-Mail konnte nicht gesendet werden", href: row.request_id
    ? `/dashboard/anfragen/${row.request_id}#nachricht-${row.id}` : `/dashboard/posteingang?nachricht=${row.inbox_root_id ?? row.id}` });
  events.push(...callbacks.map((alert) => callbackEvent(alert, employee.role)));
  for (const alert of systemAlerts) events.push({ id: `system:${alert.id}`, title: alert.title, href: "/dashboard/system#system-warnungen" });
  if (backlog?.waiting) events.push({ id: `backlog:${backlog.oldestAt}`, title: "E-Mail-Versand hängt", href: manager ? "/dashboard/system" : "/dashboard/anfragen" });
  const counts = { inbox, unreadRequests, newRequests, changes,
    failedRequests: failed.filter((row) => row.request_id).length, failedInbox: failed.filter((row) => !row.request_id).length };
  const revision = createHash("sha256").update(JSON.stringify({ revisions, counts, callbacks, backlog, systemAlerts })).digest("hex");
  return { employeeId: employee.id, role: employee.role, cursor: now, revision, counts, callbacks, backlog, systemAlerts, events };
}
