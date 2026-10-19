import "server-only";
import type { DisplayStatus } from "@/lib/display-status";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Calls of the phone assistant (task-13-7), read with the user's rights (RLS: dispatcher, manager, admin). Listed are
// evaluated calls and calls with a callback the assistant asked for during the call (before the evaluation).
type Tables = Database["public"]["Tables"];
export type PhoneCall = Tables["phone_calls"]["Row"];
type LinkedRequest = Pick<Tables["requests"]["Row"], "id" | "request_number" | "company_name" | "intake_status" | "work_status" | "source" | "source_event_key">;
type LinkedCustomer = Pick<Tables["customers"]["Row"], "id" | "customer_number" | "company_name">;
export type CallListItem = Pick<PhoneCall, "id" | "conversation_id" | "started_at" | "duration_seconds" | "category" | "urgency" | "safety_risk" | "summary"
  | "callback_needed" | "callback_urgent" | "callback_done_at" | "in_service_hours" | "sentiment" | "analyzed_at" | "is_demo" | "caller_number" | "callback_number" | "forward_target"> & {
  company: string;
  contact: string | null;
  request: Pick<LinkedRequest, "id" | "request_number"> | null;
  createdRequest: boolean;
};
export type CallDetail = PhoneCall & { company: string; contact: string | null; request: LinkedRequest | null; customer: LinkedCustomer | null; createdRequest: boolean };

export const CALL_VIEWS = [
  { key: "alle", label: "Alle Anrufe" },
  { key: "rueckruf", label: "Rückruf offen" },
  { key: "notfall", label: "Notfälle und Dringendes" },
  { key: "anfrage", label: "Mit neuer Anfrage" },
] as const;
export type CallView = (typeof CALL_VIEWS)[number]["key"];

export const CALL_PAGE_SIZE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LISTED = "analyzed_at.not.is.null,callback_needed.eq.true";

export function parseCallFilters(query: Record<string, string | string[] | undefined>) {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const view = CALL_VIEWS.some((item) => item.key === one(query.ansicht)) ? (one(query.ansicht) as CallView) : "alle";
  const page = Math.max(1, Number.parseInt(one(query.seite), 10) || 1);
  return { q: one(query.suche).trim().slice(0, 80), view, page };
}
export type CallFilters = ReturnType<typeof parseCallFilters>;

const term = (q: string) => q.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim();
const text = (analysis: Json | null, key: string) => {
  const value = analysis && typeof analysis === "object" && !Array.isArray(analysis) ? analysis[key] : null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
};
// A request counts as created by the call when the assistant created it in this conversation
const created = (call: Pick<PhoneCall, "conversation_id">, request: Pick<LinkedRequest, "source" | "source_event_key"> | null) =>
  request?.source === "phone_agent" && request.source_event_key === `phone_agent:${call.conversation_id}`;
const companyOf = (call: Pick<PhoneCall, "analysis">, request: { company_name: string } | null, customer: { company_name: string } | null) =>
  request?.company_name ?? customer?.company_name ?? text(call.analysis, "firma") ?? "Ohne Firmenangabe";

type ViewQuery<T> = { eq(column: string, value: unknown): T; is(column: string, value: null): T; or(filter: string): T; not(column: string, op: string, value: unknown): T };
function applyView<T extends ViewQuery<T>>(query: T, view: CallView): T {
  if (view === "rueckruf") return query.eq("callback_needed", true).is("callback_done_at", null);
  if (view === "notfall") return query.or("category.eq.notfall,callback_urgent.eq.true");
  if (view === "anfrage") return query.not("request_id", "is", null).eq("category", "neue_anfrage");
  return query;
}

export async function listCalls(filters: CallFilters): Promise<{ rows: CallListItem[]; total: number; counts: Record<CallView, number>; error: boolean }> {
  const supabase = await createClient();
  const q = term(filters.q);
  let requestIds: string[] = [];
  if (q) {
    const { data } = await supabase.from("requests").select("id").or(`request_number.ilike.*${q}*,company_name.ilike.*${q}*`).limit(300);
    requestIds = (data ?? []).map((row) => row.id);
  }
  let query = supabase.from("phone_calls")
    .select("id, conversation_id, started_at, duration_seconds, category, urgency, safety_risk, summary, callback_needed, callback_urgent, callback_done_at, in_service_hours, sentiment, analyzed_at, is_demo, caller_number, callback_number, forward_target, analysis, requests(id, request_number, company_name, source, source_event_key), customers(company_name)", { count: "exact" })
    .or(LISTED);
  query = applyView(query, filters.view);
  if (q) {
    const ors = ["analysis->>firma", "analysis->>kontakt", "summary", "callback_number", "caller_number"].map((column) => `${column}.ilike.*${q}*`);
    if (requestIds.length > 0) ors.push(`request_id.in.(${requestIds.join(",")})`);
    query = query.or(ors.join(","));
  }
  const from = (filters.page - 1) * CALL_PAGE_SIZE;
  const head = (view: CallView) => applyView(supabase.from("phone_calls").select("id", { count: "exact", head: true }).or(LISTED), view);
  const [{ data, count, error }, ...counts] = await Promise.all([
    query.order("started_at", { ascending: false }).range(from, from + CALL_PAGE_SIZE - 1),
    ...CALL_VIEWS.map((view) => head(view.key)),
  ]);
  const rows = (data ?? []).map(({ analysis, requests: request, customers: customer, ...row }) => ({
    ...row,
    company: companyOf({ analysis }, request, customer),
    contact: text(analysis, "kontakt"),
    request: request ? { id: request.id, request_number: request.request_number } : null,
    createdRequest: created(row, request),
  }));
  return {
    rows,
    total: count ?? 0,
    counts: Object.fromEntries(CALL_VIEWS.map((view, index) => [view.key, counts[index].count ?? 0])) as Record<CallView, number>,
    error: Boolean(error),
  };
}

export async function getCall(id: string): Promise<CallDetail | null> {
  if (!UUID.test(id)) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.from("phone_calls")
    .select("*, requests(id, request_number, company_name, intake_status, work_status, source, source_event_key), customers(id, customer_number, company_name)")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("Anruf konnte nicht geladen werden.");
  if (!data) return null;
  const { requests: request, customers: customer, ...call } = data;
  return { ...call, company: companyOf(call, request, customer), contact: text(call.analysis, "kontakt"), request, customer, createdRequest: created(call, request) };
}

// Target of the demo transfer (task-13-11)
export const FORWARD_LABEL: Record<string, string> = { service_desk: "Service Desk", bereitschaft: "Bereitschaftsdienst" };

// "2:05 Min." for a call duration
export function formatCallDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "–";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} Min.`;
}

// One chip per call: who has to move (an open callback) or what happened
export function callStatus(call: Pick<PhoneCall, "callback_needed" | "callback_urgent" | "callback_done_at" | "analyzed_at">): DisplayStatus {
  if (call.callback_needed && !call.callback_done_at) return call.callback_urgent ? { key: "dringend", label: "Dringend: Rückruf offen", tone: "act" } : { key: "rueckruf", label: "Rückruf offen", tone: "act" };
  if (call.callback_needed) return { key: "zurueckgerufen", label: "Zurückgerufen", tone: "done" };
  if (!call.analyzed_at) return { key: "auswertung", label: "Auswertung folgt", tone: "run" };
  return { key: "erledigt", label: "Ohne Rückruf erledigt", tone: "closed" };
}
