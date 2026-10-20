import "server-only";
import { cache } from "react";
import { normalizeContractNumber } from "@/lib/service-contract";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";
import type { EmployeeRole } from "@/lib/auth/roles";
import { REQUEST_DISPLAY_STATUSES, requestStatusFilter } from "@/lib/display-status";
import { parseSort, sortParam, type RequestSort } from "@/lib/request-sort";
import type { ReminderState } from "@/lib/reminders";

// Reads for the request list and the request page. All queries run with the signed-in user's rights,
// so RLS decides which requests, messages, events and documents are returned.
type Tables = Database["public"]["Tables"];
type Enums = Database["public"]["Enums"];
export type RequestRow = Tables["requests"]["Row"];

export const PAGE_SIZE = 25;

export type RequestFilters = {
  q: string;
  intake: Enums["intake_status"] | "";
  work: Enums["work_status"] | "";
  priority: Enums["request_priority"] | "";
  // Time range on one timestamp column (links from the manager overview, task-7-2)
  field: DateField | "";
  from: string;
  to: string;
  mode: Enums["intake_mode"] | "";
  open: boolean;
  // Known or unclear safety risk (link from the overview)
  hazard: boolean;
  // Quick view (task-10-3) and displayed status from "Weitere Filter"
  view: RequestView;
  display: string;
  // Sorting (task-12-12), default newest receipt first
  sort: RequestSort;
  page: number;
};

// Quick views of the list (canvas "Anfragen – Liste"). Without any filter the list opens with "offen".
export const REQUEST_VIEWS = [
  { key: "offen", label: "Offen" },
  { key: "meine", label: "Meine offenen", roles: ["dispatcher"] },
  { key: "gefahr", label: "Sicherheitsgefahr", hazard: true },
  { key: "pruefung", label: "Prüfung" },
  { key: "kunde", label: "Wartet auf Kunde" },
  { key: "planen", label: "Zu planen" },
  { key: "alle", label: "Alle" },
] as const satisfies ReadonlyArray<{ key: string; label: string; roles?: readonly EmployeeRole[]; hazard?: boolean }>;
export type RequestView = (typeof REQUEST_VIEWS)[number]["key"];

const OPEN = "intake_status.not.in.(rejected,cancelled),work_status.not.in.(completed,cancelled)";

// PostgREST "or" expression of a view; null = no restriction
export function viewFilter(view: RequestView, userId: string): string | null {
  switch (view) {
    case "offen": return `and(${OPEN})`;
    case "meine": return `and(${OPEN},dispatcher_id.eq.${userId})`;
    case "gefahr": return `and(${OPEN},safety_risk.in.(known,unclear))`;
    case "pruefung": return requestStatusFilter("pruefung");
    case "kunde": return requestStatusFilter("wartet_kunde");
    case "planen": return requestStatusFilter("zu_planen");
    case "alle": return null;
  }
}

export function viewsFor(role: EmployeeRole) {
  return REQUEST_VIEWS.filter((view) => !("roles" in view) || (view.roles as readonly EmployeeRole[]).includes(role));
}

export const DATE_FIELDS = {
  eingang: { column: "created_at", label: "Eingang" },
  erstbearbeitung: { column: "intake_completed_at", label: "Erstbearbeitung abgeschlossen" },
  abschluss: { column: "completed_at", label: "Abgeschlossen" },
  antwortfrist: { column: "response_due_at", label: "Antwortfrist" },
} as const;
type DateField = keyof typeof DATE_FIELDS;
const MODES: readonly string[] = ["automatic", "human_review", "manual"];

const INTAKE: readonly string[] = ["new", "analyzing", "needs_review", "awaiting_customer", "processed", "rejected", "cancelled"];
const WORK: readonly string[] = ["not_planned", "scheduled", "in_progress", "waiting_parts", "completed", "cancelled"];
const PRIORITY: readonly string[] = ["low", "normal", "high", "critical"];

function single(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

// Unknown filter values are ignored instead of producing an error
export function parseRequestFilters(params: Record<string, string | string[] | undefined>): RequestFilters {
  const intake = single(params.erstbearbeitung);
  const work = single(params.arbeit);
  const priority = single(params.prioritaet);
  const page = Number.parseInt(single(params.seite), 10);
  const field = single(params.feld);
  const from = isoInstant(single(params.von));
  const to = isoInstant(single(params.bis));
  const mode = single(params.modus);
  const ranged = field in DATE_FIELDS && from && to;
  const view = single(params.ansicht);
  const display = single(params.anzeige);
  // Links with filters (overview, queues) show all matches; a plain visit opens the open requests
  const anyFilter = ["suche", "erstbearbeitung", "arbeit", "prioritaet", "feld", "modus", "status", "gefahr", "anzeige"].some((key) => single(params[key]));
  return {
    q: single(params.suche).slice(0, 100),
    intake: INTAKE.includes(intake) ? (intake as Enums["intake_status"]) : "",
    work: WORK.includes(work) ? (work as Enums["work_status"]) : "",
    priority: PRIORITY.includes(priority) ? (priority as Enums["request_priority"]) : "",
    field: ranged ? (field as DateField) : "",
    from: ranged ? from : "",
    to: ranged ? to : "",
    mode: MODES.includes(mode) ? (mode as Enums["intake_mode"]) : "",
    open: single(params.status) === "offen",
    hazard: single(params.gefahr) === "1",
    view: REQUEST_VIEWS.some((entry) => entry.key === view) ? (view as RequestView) : anyFilter ? "alle" : "offen",
    display: REQUEST_DISPLAY_STATUSES.some((status) => status.key === display) ? display : "",
    sort: parseSort(single(params.sortierung)),
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

// Accepts ISO timestamps only and returns them normalized (UTC), otherwise ""
export function isoInstant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})$/.test(value)) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function filterQuery(filters: RequestFilters, overrides: Partial<RequestFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("suche", merged.q);
  if (merged.intake) params.set("erstbearbeitung", merged.intake);
  if (merged.work) params.set("arbeit", merged.work);
  if (merged.priority) params.set("prioritaet", merged.priority);
  if (merged.field) {
    params.set("feld", merged.field);
    params.set("von", merged.from);
    params.set("bis", merged.to);
  }
  if (merged.mode) params.set("modus", merged.mode);
  if (merged.open) params.set("status", "offen");
  if (merged.hazard) params.set("gefahr", "1");
  if (merged.display) params.set("anzeige", merged.display);
  params.set("ansicht", merged.view);
  const sort = sortParam(merged.sort);
  if (sort) params.set("sortierung", sort);
  if (merged.page > 1) params.set("seite", String(merged.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

// The dispatcher name is embedded only so the list can be sorted by it (task-12-12)
const LIST_COLUMNS = "id, request_number, company_name, customer_number, city, service_kind, equipment_kind, intake_status, work_status, priority, created_at, dispatcher_id, technician_id, is_demo, safety_risk, dispatcher:profiles!requests_dispatcher_id_fkey(display_name)";
export type RequestListItem = Pick<RequestRow, "id" | "request_number" | "company_name" | "customer_number" | "city" | "service_kind" | "equipment_kind" | "intake_status" | "work_status" | "priority" | "created_at" | "dispatcher_id" | "technician_id" | "is_demo" | "safety_risk">;

// Requests with open customer suggestions (task-14-2): flag „Kunde prüfen“ in lists
export async function customerCheckIds(requestIds: string[]): Promise<Set<string>> {
  if (requestIds.length === 0) return new Set();
  const supabase = await createClient();
  const { data } = await supabase.from("request_customer_suggestions").select("request_id").in("request_id", requestIds);
  return new Set((data ?? []).map((row) => row.request_id));
}

// Requests with an open window hold of the phone assistant (task-13-3) → start of the held window
export async function openHoldStarts(requestIds: string[]): Promise<Map<string, string>> {
  if (requestIds.length === 0) return new Map();
  const supabase = await createClient();
  const { data } = await supabase.from("visit_holds").select("request_id, starts_at").eq("status", "open").in("request_id", requestIds);
  return new Map((data ?? []).map((row) => [row.request_id, row.starts_at]));
}

const SORT_COLUMNS = { prioritaet: "priority", anfrage: "request_number", kunde: "company_name", leistung: "service_kind", dispatcher: "dispatcher(display_name)" } as const;

export async function listRequests(filters: RequestFilters, userId: string): Promise<{ rows: RequestListItem[]; total: number; error: boolean }> {
  const supabase = await createClient();
  const from = (filters.page - 1) * PAGE_SIZE;
  const ascending = filters.sort.dir === "auf";
  let query = supabase.from("requests").select(LIST_COLUMNS, { count: "exact" });
  // Sorted column first (empty values last), then newest receipt and id, so pages stay stable
  if (filters.sort.key !== "eingang") query = query.order(SORT_COLUMNS[filters.sort.key], { ascending, nullsFirst: false });
  query = query.order("created_at", { ascending: filters.sort.key === "eingang" ? ascending : false }).order("id").range(from, from + PAGE_SIZE - 1);
  if (filters.intake) query = query.eq("intake_status", filters.intake);
  if (filters.work) query = query.eq("work_status", filters.work);
  if (filters.priority) query = query.eq("priority", filters.priority);
  if (filters.field) query = query.gte(DATE_FIELDS[filters.field].column, filters.from).lt(DATE_FIELDS[filters.field].column, filters.to);
  if (filters.mode) query = query.eq("intake_mode", filters.mode);
  if (filters.open) query = query.not("intake_status", "in", "(rejected,cancelled)").not("work_status", "in", "(completed,cancelled)");
  if (filters.hazard) query = query.in("safety_risk", ["known", "unclear"]);
  const view = viewFilter(filters.view, userId);
  if (view) query = query.or(view);
  const display = filters.display ? requestStatusFilter(filters.display) : null;
  if (display) query = query.or(display);
  if (filters.q) {
    // Characters with meaning in PostgREST filter syntax or LIKE patterns are removed
    const term = filters.q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim();
    if (term) query = query.or(["request_number", "company_name", "customer_number", "contact_name", "city"].map((column) => `${column}.ilike.*${term}*`).join(","));
  }
  const { data, count, error } = await query;
  // A page beyond the end (e.g. after narrowing a filter) is answered with 416 by PostgREST
  if (error && error.code !== "PGRST103") return { rows: [], total: 0, error: true };
  return { rows: data ?? [], total: count ?? 0, error: false };
}

// Number of requests per quick view (without search and further filters), with the user's rights
export async function countViews(role: EmployeeRole, userId: string): Promise<Partial<Record<RequestView, number>>> {
  const supabase = await createClient();
  const views = viewsFor(role);
  const results = await Promise.all(views.map((view) => {
    const query = supabase.from("requests").select("id", { count: "exact", head: true });
    const filter = viewFilter(view.key, userId);
    return filter ? query.or(filter) : query;
  }));
  return Object.fromEntries(views.map((view, index) => [view.key, results[index].error ? undefined : results[index].count ?? 0]));
}

// Names of all employees for display (profiles are readable for every active employee)
export const getEmployeeNames = cache(async (): Promise<Map<string, string>> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, display_name");
  return new Map((data ?? []).map((profile) => [profile.id, profile.display_name]));
});

// Sections of the request page per role. Messages and automation runs are not readable for
// technicians anyway (RLS); the page neither queries nor shows them.
export const REQUEST_SECTIONS = [
  { id: "zusammenfassung", label: "Anliegen", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "kontakt", label: "Kontakt", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "anlage", label: "Anlage", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "erstbearbeitung", label: "Erstbearbeitung", roles: ["admin", "manager", "dispatcher"] },
  { id: "korrespondenz", label: "Korrespondenz", roles: ["admin", "manager", "dispatcher"] },
  { id: "einsaetze", label: "Einsätze", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "arbeit", label: "Arbeit", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "dokumente", label: "Dokumente", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "rechnung", label: "Rechnung", roles: ["admin", "manager", "dispatcher", "technician"] },
  { id: "verlauf", label: "Verlauf", roles: ["admin", "manager", "dispatcher", "technician"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; roles: readonly EmployeeRole[] }>;

export type SectionId = (typeof REQUEST_SECTIONS)[number]["id"];

export function sectionsFor(role: EmployeeRole) {
  return REQUEST_SECTIONS.filter((section) => (section.roles as readonly EmployeeRole[]).includes(role));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RequestDetail = {
  request: RequestRow;
  messages: Tables["messages"]["Row"][] | null;
  automationRuns: Tables["automation_runs"]["Row"][] | null;
  visits: Tables["visits"]["Row"][];
  workEntries: Tables["work_entries"]["Row"][];
  attachments: Tables["attachments"]["Row"][];
  invoice: Tables["invoices"]["Row"] | null;
  invoiceItems: Tables["invoice_items"]["Row"][];
  reminderState: ReminderState | null;
  reminders: Array<Pick<Tables["invoice_reminders"]["Row"], "id" | "stage" | "trigger" | "created_at" | "created_by"> & { message_status: string | null; sent_at: string | null }>;
  events: Tables["request_events"]["Row"][];
  // Contract master data for the SLA number the customer gave (task-13-9); staff only, null without match or number
  contract: Tables["service_contracts"]["Row"] | null;
  // Linked customer of the master data with the linked site (task-13-10); staff only
  customer: (Tables["customers"]["Row"] & { site: Tables["customer_sites"]["Row"] | null; sites: Tables["customer_sites"]["Row"][] }) | null;
  // Possible existing customers when the automatic match was uncertain (task-14-2); staff only, empty once linked
  customerSuggestions: CustomerSuggestion[];
  // Window holds of the phone assistant (task-13-3), newest first; staff only
  holds: Tables["visit_holds"]["Row"][];
  // Calls of the phone assistant about this request (task-13-7); staff only
  calls: Array<Pick<Tables["phone_calls"]["Row"], "id" | "conversation_id" | "started_at" | "duration_seconds" | "category" | "summary" | "callback_needed" | "callback_done_at" | "in_service_hours" | "analyzed_at">>;
  failed: string[];
};

export type CustomerSuggestion = {
  reason: "mehrere_treffer" | "gleiche_firma" | "gleiche_domain" | "kunde_inaktiv" | "nummer_passt_nicht";
  customer: Pick<Tables["customers"]["Row"], "id" | "customer_number" | "company_name" | "is_active"> & { sites: Array<Pick<Tables["customer_sites"]["Row"], "street_house_number" | "postal_code" | "city" | "is_active">> };
};

// null = not found or no access (deliberately indistinguishable). Memoized per request (metadata and page).
export const getRequestDetail = cache(async (id: string, role: EmployeeRole): Promise<RequestDetail | null> => {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data: request, error } = await supabase.from("requests").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error("Anfrage konnte nicht geladen werden.");
  if (!request) return null;

  const staff = role !== "technician";
  const contractNumber = staff ? normalizeContractNumber(request.sla_contract_number) : null;
  const [messages, automationRuns, visits, workEntries, attachments, invoice, events, contract, holds, customer, calls, suggestions] = await Promise.all([
    staff ? supabase.from("messages").select("*").eq("request_id", id).order("created_at") : null,
    staff ? supabase.from("automation_runs").select("*").eq("request_id", id).order("started_at") : null,
    supabase.from("visits").select("*").eq("request_id", id).order("scheduled_start"),
    supabase.from("work_entries").select("*").eq("request_id", id).order("created_at"),
    supabase.from("attachments").select("*").eq("request_id", id).order("created_at"),
    supabase.from("invoices").select("*").eq("request_id", id).maybeSingle(),
    supabase.from("request_events").select("*").eq("request_id", id).order("occurred_at", { ascending: false }).order("seq", { ascending: false }),
    contractNumber ? supabase.from("service_contracts").select("*").eq("contract_number", contractNumber).maybeSingle() : null,
    staff ? supabase.from("visit_holds").select("*").eq("request_id", id).order("created_at", { ascending: false }) : null,
    staff && request.customer_id ? supabase.from("customers").select("*, customer_sites(*)").eq("id", request.customer_id).maybeSingle() : null,
    staff ? supabase.from("phone_calls").select("id, conversation_id, started_at, duration_seconds, category, summary, callback_needed, callback_done_at, in_service_hours, analyzed_at").eq("request_id", id).order("started_at") : null,
    staff && !request.customer_id
      ? supabase.from("request_customer_suggestions").select("reason, customers(id, customer_number, company_name, is_active, customer_sites(street_house_number, postal_code, city, is_active))").eq("request_id", id).order("created_at")
      : null,
  ]);
  const invoiceId = invoice?.data && invoice.data.status !== "draft" ? invoice.data.id : null;
  const [invoiceItems, reminderState, reminders] = invoice?.data
    ? await Promise.all([
      supabase.from("invoice_items").select("*").eq("invoice_id", invoice.data.id).order("position"),
      invoiceId ? supabase.from("invoice_reminder_states").select("last_stage, last_reminder_at, paused, next_stage, next_due_on").eq("invoice_id", invoiceId).maybeSingle() : null,
      invoiceId ? supabase.from("invoice_reminders").select("id, stage, trigger, created_at, created_by, messages(status, sent_at)").eq("invoice_id", invoiceId).order("stage") : null,
    ])
    : [null, null, null];

  // Partial failures are shown per section instead of failing the whole page
  const failed: string[] = [];
  const pick = <T,>(name: string, result: { data: T | null; error: unknown } | null, fallback: T): T => {
    if (!result) return fallback;
    if (result.error) failed.push(name);
    return result.data ?? fallback;
  };
  return {
    request,
    messages: messages ? pick("korrespondenz", messages, []) : null,
    automationRuns: automationRuns ? pick("erstbearbeitung", automationRuns, []) : null,
    visits: pick("einsaetze", visits, []),
    workEntries: pick("arbeit", workEntries, []),
    attachments: pick("dokumente", attachments, []),
    invoice: pick("rechnung", invoice, null),
    invoiceItems: pick("rechnung", invoiceItems, []),
    reminderState: pick("rechnung", reminderState, null) as ReminderState | null,
    reminders: pick("rechnung", reminders, []).map(({ messages: message, ...row }) => {
      const sent = Array.isArray(message) ? message[0] : message;
      return { ...row, message_status: sent?.status ?? null, sent_at: sent?.sent_at ?? null };
    }),
    events: pick("verlauf", events, []),
    contract: contract?.data ?? null,
    customer: customer?.data
      ? (({ customer_sites: sites, ...row }) => ({ ...row, sites, site: sites.find((site) => site.id === request.customer_site_id) ?? null }))(customer.data)
      : null,
    customerSuggestions: (suggestions?.data ?? []).flatMap((row) => row.customers
      ? [{ reason: row.reason as CustomerSuggestion["reason"], customer: (({ customer_sites: sites, ...rest }) => ({ ...rest, sites }))(row.customers) }]
      : []),
    holds: holds ? pick("einsaetze", holds, []) : [],
    calls: calls?.data ?? [],
    failed,
  };
});
