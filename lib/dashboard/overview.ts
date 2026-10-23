import "server-only";
import { cache } from "react";
import type { KpiRow, PeriodParams } from "@/lib/analytics";
import { addDays, berlinToInstant } from "@/lib/berlin-time";
import { berlinDayKey } from "@/lib/format";
import type { QueueRow as QueueHistoryRow } from "@/lib/insights";
import { createClient } from "@/lib/supabase/server";

// Data of the manager overview (task-7-2). KPIs, period and team come from the analytics functions
// (task-7-1); the attention list reads current data. Everything runs with the user's rights (RLS).

export type OverviewWindow = {
  current_start: string;
  current_end: string;
  period_end: string;
  previous_start: string;
  previous_end: string;
  is_complete: boolean;
  startDay: string;
  endDay: string;
};

export type TeamRow = {
  employee_id: string;
  display_name: string;
  role: "dispatcher" | "technician";
  is_active: boolean;
  intake_completed: number;
  visits_completed: number;
  work_minutes: number;
  requests_completed: number;
  open_requests: number;
};

export type AttentionReason = "response_overdue" | "service_overdue" | "safety" | "review_waiting" | "parts_waiting" | "invoice_overdue";

export const ATTENTION_LABELS: Record<AttentionReason, string> = {
  safety: "Sicherheitsgefahr offen",
  response_overdue: "Antwortfrist überschritten",
  service_overdue: "Servicefrist überschritten",
  review_waiting: "Prüfung wartet seit über 24 h",
  parts_waiting: "Wartet seit über 5 Tagen auf Teile",
  invoice_overdue: "Rechnung überfällig",
};
const SEVERITY: AttentionReason[] = ["safety", "response_overdue", "service_overdue", "review_waiting", "parts_waiting", "invoice_overdue"];

export type AttentionItem = {
  reason: AttentionReason;
  requestId: string;
  requestNumber: string;
  company: string;
  // Deadline or start of waiting; oldest first within a reason
  since: string;
  detail: string | null;
};

export type Overview = {
  window: OverviewWindow;
  kpis: KpiRow[];
  team: TeamRow[];
  idleEmployees: number;
  attention: { items: AttentionItem[]; counts: Partial<Record<AttentionReason, number>>; checkedAt: string };
};

const LIMIT = 50;

const active = (row: TeamRow) => row.intake_completed + row.visits_completed + row.requests_completed + row.open_requests > 0;

export async function getOverview(period: PeriodParams): Promise<Overview> {
  const supabase = await createClient();
  const args = { kind: period.kind, ...(period.anchor ? { anchor: period.anchor } : {}) };
  const [windowResult, kpiResult, teamResult, attention] = await Promise.all([
    supabase.rpc("analytics_window", args).single(),
    supabase.rpc("analytics_kpis", args),
    supabase.rpc("analytics_team", args),
    getAttention(),
  ]);
  if (windowResult.error || kpiResult.error || teamResult.error || !windowResult.data) throw new Error("Kennzahlen konnten nicht geladen werden.");
  const w = windowResult.data;
  // Last local day of the period (period_end is the exclusive next midnight)
  const endDay = berlinDayKey(new Date(new Date(w.period_end).getTime() - 1));
  return {
    window: { ...w, startDay: berlinDayKey(w.current_start), endDay },
    kpis: kpiResult.data as KpiRow[],
    // Only employees with activity in the period or open assignments; the rest is counted
    team: (teamResult.data as TeamRow[]).filter(active),
    idleEmployees: (teamResult.data as TeamRow[]).filter((row) => row.is_active && !active(row)).length,
    attention,
  };
}

async function getAttention(): Promise<Overview["attention"]> {
  const supabase = await createClient();
  const now = new Date();
  const today = berlinDayKey(now);
  const iso = (offsetHours: number) => new Date(now.getTime() - offsetHours * 3600_000).toISOString();
  const open = <Q extends { not: (c: string, o: string, v: string) => Q }>(query: Q) => query.not("intake_status", "in", "(rejected,cancelled)").not("work_status", "in", "(completed,cancelled)");
  const columns = "id, request_number, company_name";

  const [responses, services, safety, reviews, parts, invoices] = await Promise.all([
    open(supabase.from("requests").select(`${columns}, response_due_at`))
      .lt("response_due_at", now.toISOString()).is("first_substantive_response_at", null).is("intake_completed_at", null)
      .order("response_due_at").limit(LIMIT),
    open(supabase.from("requests").select(`${columns}, service_due_at`))
      .lt("service_due_at", now.toISOString()).order("service_due_at").limit(LIMIT),
    open(supabase.from("requests").select(`${columns}, safety_risk, created_at`))
      .neq("safety_risk", "none_known").order("created_at").limit(LIMIT),
    supabase.from("dispatcher_queue").select("id, request_number, company_name, waiting_since, queue")
      .in("queue", ["review", "reply_received"]).lt("waiting_since", iso(24)).order("waiting_since").limit(LIMIT),
    supabase.from("visits").select("request_id, updated_at, waiting_reason, requests(request_number, company_name)")
      .eq("status", "waiting_parts").lt("updated_at", iso(24 * 5)).order("updated_at").limit(LIMIT),
    supabase.from("invoices").select("request_id, invoice_number, payment_due_date, total, requests(request_number, company_name)")
      .in("status", ["issued", "sent"]).is("paid_at", null).lt("payment_due_date", today).order("payment_due_date").limit(LIMIT),
  ]);
  for (const result of [responses, services, safety, reviews, parts, invoices]) {
    if (result.error) throw new Error("Aufmerksamkeitsliste konnte nicht geladen werden.");
  }
  const related = (value: unknown) => (Array.isArray(value) ? value[0] : value) as { request_number: string; company_name: string } | null;

  const items: AttentionItem[] = [
    ...(responses.data ?? []).map((row) => ({ reason: "response_overdue" as const, requestId: row.id, requestNumber: row.request_number, company: row.company_name, since: row.response_due_at!, detail: null })),
    ...(services.data ?? []).map((row) => ({ reason: "service_overdue" as const, requestId: row.id, requestNumber: row.request_number, company: row.company_name, since: row.service_due_at!, detail: null })),
    ...(safety.data ?? []).map((row) => ({ reason: "safety" as const, requestId: row.id, requestNumber: row.request_number, company: row.company_name, since: row.created_at, detail: row.safety_risk })),
    ...(reviews.data ?? []).map((row) => ({ reason: "review_waiting" as const, requestId: row.id!, requestNumber: row.request_number!, company: row.company_name!, since: row.waiting_since!, detail: row.queue })),
    ...(parts.data ?? []).map((row) => ({ reason: "parts_waiting" as const, requestId: row.request_id, requestNumber: related(row.requests)?.request_number ?? "–", company: related(row.requests)?.company_name ?? "–", since: row.updated_at, detail: row.waiting_reason })),
    ...(invoices.data ?? []).map((row) => ({ reason: "invoice_overdue" as const, requestId: row.request_id, requestNumber: related(row.requests)?.request_number ?? "–", company: related(row.requests)?.company_name ?? "–", since: row.payment_due_date!, detail: row.invoice_number })),
  ];
  const counts: Partial<Record<AttentionReason, number>> = {};
  for (const item of items) counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  items.sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason) || a.since.localeCompare(b.since));
  return { items, counts, checkedAt: now.toISOString() };
}

// "Stand jetzt" of the redesigned overview (task-10-3): independent of the selected period.
export type OverdueInvoice = { id: string; requestId: string; invoiceNumber: string | null; requestNumber: string; company: string; status: string; dueDate: string | null; total: number; currency: string };
// All overdue invoices, oldest due date first (details of the tile "Überfällige Forderungen")
export type OverdueReceivables = { total: number; count: number; oldestDue: string | null; invoices: OverdueInvoice[] };
export type NowData = {
  checkedAt: string;
  today: string;
  openRequests: number;
  // Queue lengths per day over the last 90 days (today = current state)
  queueHistory: QueueHistoryRow[];
  overdue: OverdueReceivables;
};

// Memoized per request: several blocks of one page read the same state
export const getNow = cache(async (): Promise<NowData> => {
  const supabase = await createClient();
  const now = new Date();
  const today = berlinDayKey(now);
  const [open, history, invoices] = await Promise.all([
    supabase.from("requests").select("id", { count: "exact", head: true })
      .not("intake_status", "in", "(rejected,cancelled)").not("work_status", "in", "(completed,cancelled)"),
    supabase.rpc("analytics_queue_history", { from_date: addDays(today, -89), to_date: today }),
    supabase.from("invoices").select("id, request_id, invoice_number, status, total, currency, payment_due_date, requests(request_number, company_name)")
      .in("status", ["issued", "sent"]).is("paid_at", null).lt("payment_due_date", today).order("payment_due_date"),
  ]);
  if (open.error || history.error || invoices.error) throw new Error("Aktueller Stand konnte nicht geladen werden.");
  const rows = invoices.data ?? [];
  return {
    checkedAt: now.toISOString(),
    today,
    openRequests: open.count ?? 0,
    queueHistory: (history.data ?? []) as QueueHistoryRow[],
    overdue: {
      total: Math.round(rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0) * 100) / 100,
      count: rows.length,
      oldestDue: rows[0]?.payment_due_date ?? null,
      invoices: rows.map((row) => {
        const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
        return {
          id: row.id, requestId: row.request_id, invoiceNumber: row.invoice_number, status: row.status, dueDate: row.payment_due_date,
          total: Number(row.total ?? 0), currency: row.currency, requestNumber: request?.request_number ?? "–", company: request?.company_name ?? "–",
        };
      }),
    },
  };
});

export const getAttentionNow = cache((): Promise<Overview["attention"]> => getAttention());

// Manager view: team of the current month, technicians today and tomorrow, requests to plan
export type TechnicianDay = { visits: Array<{ requestId: string; requestNumber: string; start: string; end: string }>; absent: boolean };
export type TechnicianNow = { id: string; name: string; today: TechnicianDay; tomorrow: TechnicianDay; visitsCompleted: number; workMinutes: number; open: number };
export type PlanningItem = {
  id: string;
  requestNumber: string;
  company: string;
  city: string | null;
  serviceKind: string | null;
  priority: string | null;
  // Follow-up visit (an earlier visit exists) or waiting for parts
  note: "follow_up" | "waiting_parts" | null;
};
export type TeamNow = { month: TeamRow[]; monthStart: string; technicians: TechnicianNow[]; toPlan: PlanningItem[]; tomorrow: string };

export const getTeamNow = cache(async (): Promise<TeamNow> => {
  const supabase = await createClient();
  const now = new Date();
  const today = berlinDayKey(now);
  const tomorrow = addDays(today, 1);
  const from = berlinToInstant(today, "00:00").toISOString();
  const to = berlinToInstant(addDays(today, 2), "00:00").toISOString();
  const [team, technicians, visits, busy, planning] = await Promise.all([
    supabase.rpc("analytics_team", { kind: "month" }),
    supabase.from("profiles").select("id, display_name").eq("role", "technician").eq("is_active", true).order("display_name"),
    supabase.from("visits").select("request_id, technician_id, scheduled_start, scheduled_end, status, requests(request_number)")
      .in("status", ["scheduled", "in_progress", "completed", "waiting_parts"]).lt("scheduled_start", to).gt("scheduled_end", from).order("scheduled_start"),
    supabase.rpc("technician_busy_intervals", { range_start: from, range_end: to }),
    supabase.from("dispatcher_queue").select("id, request_number, company_name, city, service_kind, priority, work_status")
      .eq("queue", "planning").order("priority_rank").order("due_at", { ascending: true, nullsFirst: false }).order("waiting_since").order("id"),
  ]);
  for (const result of [team, technicians, visits, busy, planning]) {
    if (result.error) throw new Error("Team konnte nicht geladen werden.");
  }
  const planRows = planning.data ?? [];
  const planIds = planRows.map((row) => row.id!).filter(Boolean);
  // Hundreds of queued requests exceed the gateway's URL limit in one PostgREST `in` filter (HTTP 414).
  const earlier = await Promise.all(Array.from({ length: Math.ceil(planIds.length / 100) }, (_, index) =>
    supabase.from("visits").select("request_id").in("request_id", planIds.slice(index * 100, (index + 1) * 100)).neq("status", "cancelled")));
  if (earlier.some((result) => result.error)) throw new Error("Team konnte nicht geladen werden.");
  const withVisit = new Set(earlier.flatMap((result) => (result.data ?? []).map((row) => row.request_id)));

  const monthRows = (team.data ?? []) as TeamRow[];
  const byEmployee = new Map(monthRows.map((row) => [row.employee_id, row]));
  const related = (value: unknown) => (Array.isArray(value) ? value[0] : value) as { request_number: string } | null;
  const dayOf = (technicianId: string, day: string): TechnicianDay => ({
    visits: (visits.data ?? [])
      .filter((visit) => visit.technician_id === technicianId && berlinDayKey(visit.scheduled_start) === day)
      .map((visit) => ({ requestId: visit.request_id, requestNumber: related(visit.requests)?.request_number ?? "–", start: visit.scheduled_start, end: visit.scheduled_end })),
    absent: (busy.data ?? []).some((block) => block.technician_id === technicianId && block.busy_kind === "absence"
      && berlinDayKey(block.starts_at) <= day && berlinDayKey(new Date(new Date(block.ends_at).getTime() - 1)) >= day),
  });

  return {
    month: monthRows,
    monthStart: `${today.slice(0, 7)}-01`,
    tomorrow,
    technicians: (technicians.data ?? []).map((tech) => {
      const row = byEmployee.get(tech.id);
      return {
        id: tech.id,
        name: tech.display_name,
        today: dayOf(tech.id, today),
        tomorrow: dayOf(tech.id, tomorrow),
        visitsCompleted: row?.visits_completed ?? 0,
        workMinutes: row?.work_minutes ?? 0,
        open: row?.open_requests ?? 0,
      };
    }),
    toPlan: planRows.map((row) => ({
      id: row.id!,
      requestNumber: row.request_number!,
      company: row.company_name!,
      city: row.city,
      serviceKind: row.service_kind,
      priority: row.priority,
      note: row.work_status === "waiting_parts" ? "waiting_parts" : withVisit.has(row.id!) ? "follow_up" : null,
    })),
  };
});
