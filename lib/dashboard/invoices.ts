import "server-only";
import { isoInstant } from "@/lib/dashboard/requests";
import { addDays } from "@/lib/berlin-time";
import { berlinDayKey } from "@/lib/format";
import type { ReminderState } from "@/lib/reminders";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

// Invoice list for managers and admins (task-7-2), target of the finance KPIs. Reads with the user's
// rights (RLS). Issued is not collected: "offen" are issued invoices without payment, independent of sending.
type Invoice = Database["public"]["Tables"]["invoices"]["Row"];

export const INVOICE_PAGE_SIZE = 25;

export const INVOICE_DATE_FIELDS = {
  ausgestellt: { column: "issued_at", label: "Ausgestellt" },
  bezahlt: { column: "paid_at", label: "Bezahlt" },
} as const;

export const INVOICE_STATES = {
  erledigen: "Zu erledigen",
  bald: "Bald fällig",
  ueberfaellig: "Überfällig",
  offen: "Offen",
  bezahlt: "Bezahlt",
  entwurf: "Entwurf",
} as const;
// Tabs of the list (task-10-3); "alle" = no status filter
export const INVOICE_TABS = ["erledigen", "bald", "ueberfaellig", "offen", "bezahlt", "alle"] as const;

export type InvoiceFilters = {
  q: string;
  field: keyof typeof INVOICE_DATE_FIELDS | "";
  from: string;
  to: string;
  state: keyof typeof INVOICE_STATES | "";
  page: number;
};

const single = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

export function parseInvoiceFilters(params: Record<string, string | string[] | undefined>): InvoiceFilters {
  const field = single(params.feld);
  const from = isoInstant(single(params.von));
  const to = isoInstant(single(params.bis));
  const state = single(params.status);
  const page = Number.parseInt(single(params.seite), 10);
  const ranged = field in INVOICE_DATE_FIELDS && from && to;
  return {
    q: single(params.suche).slice(0, 60),
    field: ranged ? (field as InvoiceFilters["field"]) : "",
    from: ranged ? from : "",
    to: ranged ? to : "",
    // A plain visit opens "Zu erledigen"; "alle" (or links with a date range or search) show everything
    state: state in INVOICE_STATES ? (state as InvoiceFilters["state"]) : state || ranged || single(params.suche) ? "" : "erledigen",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

export function invoiceQuery(filters: InvoiceFilters, overrides: Partial<InvoiceFilters> = {}): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("suche", merged.q);
  if (merged.field) {
    params.set("feld", merged.field);
    params.set("von", merged.from);
    params.set("bis", merged.to);
  }
  params.set("status", merged.state || "alle");
  if (merged.page > 1) params.set("seite", String(merged.page));
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type InvoiceListItem = Pick<Invoice, "id" | "request_id" | "invoice_number" | "status" | "issue_date" | "payment_due_date" | "paid_at" | "subtotal" | "total" | "currency"> & {
  company_name: string;
  request_number: string;
  request_version: number;
  overdue: boolean;
  reminder: ReminderState | null;
};

const COLUMNS = "id, request_id, invoice_number, status, issue_date, payment_due_date, paid_at, subtotal, total, currency, requests(request_number, company_name, version)";

export async function listInvoices(filters: InvoiceFilters): Promise<{ rows: InvoiceListItem[]; total: number; sumGross: number; sumNet: number; error: boolean }> {
  const supabase = await createClient();
  const today = berlinDayKey(new Date());
  // Same filter for the page and for the totals over all matching invoices
  const apply = <Q extends { eq: (c: string, v: string) => Q; in: (c: string, v: string[]) => Q; is: (c: string, v: null) => Q; not: (c: string, o: string, v: null) => Q; lt: (c: string, v: string) => Q; lte: (c: string, v: string) => Q; gte: (c: string, v: string) => Q; ilike: (c: string, v: string) => Q }>(query: Q): Q => {
    let result = query;
    if (filters.field) result = result.gte(INVOICE_DATE_FIELDS[filters.field].column, filters.from).lt(INVOICE_DATE_FIELDS[filters.field].column, filters.to);
    if (filters.state === "offen") result = result.in("status", ["issued", "sent"]).is("paid_at", null);
    if (filters.state === "ueberfaellig") result = result.in("status", ["issued", "sent"]).is("paid_at", null).lt("payment_due_date", today);
    if (filters.state === "bezahlt") result = result.eq("status", "paid");
    if (filters.state === "entwurf") result = result.eq("status", "draft");
    if (filters.state === "erledigen") result = result.in("status", ["draft", "issued"]);
    if (filters.state === "bald") result = result.in("status", ["issued", "sent"]).is("paid_at", null).gte("payment_due_date", today).lte("payment_due_date", addDays(today, 7));
    if (filters.q) {
      const term = filters.q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim();
      if (term) result = result.ilike("invoice_number", `%${term}%`);
    }
    return result;
  };
  const from = (filters.page - 1) * INVOICE_PAGE_SIZE;
  const [page, sums] = await Promise.all([
    apply(supabase.from("invoices").select(COLUMNS, { count: "exact" })).order("issued_at", { ascending: false, nullsFirst: true }).order("id").range(from, from + INVOICE_PAGE_SIZE - 1),
    apply(supabase.from("invoices").select("subtotal, total")).limit(10000),
  ]);
  if ((page.error && page.error.code !== "PGRST103") || sums.error) return { rows: [], total: 0, sumGross: 0, sumNet: 0, error: true };
  // Reminder stage per row (task-10-2), from the same view as the daily run
  const ids = (page.data ?? []).filter((row) => row.status !== "draft").map((row) => row.id);
  const states = ids.length
    ? await supabase.from("invoice_reminder_states").select("invoice_id, last_stage, last_reminder_at, paused, next_stage, next_due_on").in("invoice_id", ids)
    : { data: [], error: null };
  const stateOf = new Map((states.data ?? []).map(({ invoice_id, ...state }) => [invoice_id, state as ReminderState]));
  const rows = (page.data ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    return {
      ...row,
      company_name: request?.company_name ?? "–",
      request_number: request?.request_number ?? "–",
      request_version: request?.version ?? 0,
      overdue: (row.status === "issued" || row.status === "sent") && !row.paid_at && !!row.payment_due_date && row.payment_due_date < today,
      reminder: stateOf.get(row.id) ?? null,
    };
  });
  const cents = (values: number[]) => values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0) / 100;
  return { rows, total: page.count ?? 0, sumGross: cents((sums.data ?? []).map((row) => row.total)), sumNet: cents((sums.data ?? []).map((row) => row.subtotal)), error: false };
}

// Summary blocks of the invoice page (task-10-3): counts per tab and all open invoices for aging
export async function invoiceSummary(): Promise<{ counts: Partial<Record<(typeof INVOICE_TABS)[number], number>>; open: Array<{ status: string; payment_due_date: string | null; total: number }>; todo: InvoiceListItem[]; error: boolean }> {
  const supabase = await createClient();
  const today = berlinDayKey(new Date());
  const head = () => supabase.from("invoices").select("id", { count: "exact", head: true });
  const [todo, soon, overdue, open, paid, all, openRows, todoRows] = await Promise.all([
    head().in("status", ["draft", "issued"]),
    head().in("status", ["issued", "sent"]).is("paid_at", null).gte("payment_due_date", today).lte("payment_due_date", addDays(today, 7)),
    head().in("status", ["issued", "sent"]).is("paid_at", null).lt("payment_due_date", today),
    head().in("status", ["issued", "sent"]).is("paid_at", null),
    head().eq("status", "paid"),
    head(),
    supabase.from("invoices").select("status, payment_due_date, total").in("status", ["issued", "sent"]).is("paid_at", null).limit(10000),
    supabase.from("invoices").select(COLUMNS).in("status", ["draft", "issued"]).order("created_at").limit(5),
  ]);
  const results = [todo, soon, overdue, open, paid, all, openRows, todoRows];
  return {
    counts: { erledigen: todo.count ?? 0, bald: soon.count ?? 0, ueberfaellig: overdue.count ?? 0, offen: open.count ?? 0, bezahlt: paid.count ?? 0, alle: all.count ?? 0 },
    open: (openRows.data ?? []).map((row) => ({ ...row, total: Number(row.total) })),
    todo: (todoRows.data ?? []).map((row) => {
      const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
      return { ...row, company_name: request?.company_name ?? "–", request_number: request?.request_number ?? "–", request_version: request?.version ?? 0, overdue: false, reminder: null };
    }),
    error: results.some((result) => result.error),
  };
}
