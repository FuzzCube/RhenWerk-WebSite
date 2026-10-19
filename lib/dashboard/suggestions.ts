import "server-only";
import { rolesFor, type EmployeeRole } from "@/lib/auth/roles";
import { berlinDayKey, formatCurrency } from "@/lib/format";
import { invoiceDisplayStatus, requestDisplayStatus } from "@/lib/display-status";
import { createClient } from "@/lib/supabase/server";

// Suggestions while typing (task-12-4). Read with the user's rights (RLS), with the same search columns as the
// lists, so a suggestion never shows more than the list would. "value" is what a fill field takes over.
export type Suggestion = { id: string; title: string; meta: string; value: string; href: string | null };

export const SUGGEST_AREAS = ["anfragen", "kunden", "rechnungen", "posteingang", "kundennummer"] as const;
export type SuggestArea = (typeof SUGGEST_AREAS)[number];

export const SUGGEST_LIMIT = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AREA_ROLES: Record<SuggestArea, readonly EmployeeRole[]> = {
  anfragen: rolesFor("/dashboard/anfragen"),
  kunden: rolesFor("/dashboard/kunden"),
  rechnungen: rolesFor("/dashboard/rechnungen"),
  posteingang: rolesFor("/dashboard/posteingang"),
  kundennummer: ["dispatcher", "manager", "admin"],
};

export function mayUseArea(area: SuggestArea, role: EmployeeRole): boolean {
  return AREA_ROLES[area].includes(role);
}

// Same cleaning as the lists: characters with a meaning in PostgREST filters or LIKE patterns are removed
export function suggestTerm(q: string): string {
  return q.replace(/[,()*%_\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function requestSuggestions(term: string, href: (row: { id: string; request_number: string | null }) => string): Promise<Suggestion[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("requests").select("id, request_number, company_name, city, intake_status, work_status")
    .or(["request_number", "company_name", "contact_name", "city"].map((column) => `${column}.ilike.*${term}*`).join(","))
    .order("created_at", { ascending: false }).limit(SUGGEST_LIMIT);
  return (data ?? []).map((row) => ({
    id: row.id,
    title: `${row.request_number ?? "ohne Nummer"} · ${row.company_name}`,
    meta: `${row.city} · ${requestDisplayStatus(row.intake_status, row.work_status).label}`,
    value: row.request_number ?? "",
    href: href(row),
  }));
}

async function customerSuggestions(term: string, fill: boolean): Promise<Suggestion[]> {
  const supabase = await createClient();
  const { data: sites } = await supabase.from("customer_sites").select("customer_id")
    .or(`street_house_number.ilike.*${term}*,postal_code.ilike.${term}*,city.ilike.*${term}*`).limit(200);
  const ids = [...new Set((sites ?? []).map((row) => row.customer_id))];
  const ors = ["customer_number", "company_name", "contact_name", "business_email"].map((column) => `${column}.ilike.*${term}*`);
  if (ids.length > 0) ors.push(`id.in.(${ids.join(",")})`);
  let query = supabase.from("customers").select("id, customer_number, company_name, is_active, customer_sites(street_house_number, postal_code, city, is_active, created_at)").or(ors.join(","));
  // The phone assistant and new links only use active customers
  if (fill) query = query.eq("is_active", true);
  const { data } = await query.order("company_name").limit(SUGGEST_LIMIT);
  return (data ?? []).map((row) => {
    const site = [...row.customer_sites].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.created_at.localeCompare(b.created_at))[0];
    return {
      id: row.id,
      title: row.company_name,
      meta: [row.customer_number, site && `${site.street_house_number}, ${site.postal_code} ${site.city}`, !row.is_active && "inaktiv"].filter(Boolean).join(" · "),
      value: row.customer_number,
      href: fill ? null : `/dashboard/kunden/${row.id}`,
    };
  });
}

async function invoiceSuggestions(term: string): Promise<Suggestion[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select("id, request_id, invoice_number, status, payment_due_date, total, requests(company_name)")
    .ilike("invoice_number", `%${term}%`).order("issued_at", { ascending: false, nullsFirst: true }).limit(SUGGEST_LIMIT);
  const today = berlinDayKey(new Date());
  return (data ?? []).map((row) => {
    const request = Array.isArray(row.requests) ? row.requests[0] : row.requests;
    return {
      id: row.id,
      title: `${row.invoice_number ?? "Entwurf"} · ${request?.company_name ?? "–"}`,
      meta: `${invoiceDisplayStatus(row.status, row.payment_due_date, today).label} · ${formatCurrency(row.total)}`,
      value: row.invoice_number ?? "",
      href: `/dashboard/anfragen/${row.request_id}#rechnung`,
    };
  });
}

// message: the inbox e-mail the chosen request is offered for (posteingang)
export async function suggest(area: SuggestArea, q: string, message: string | null): Promise<Suggestion[]> {
  const term = suggestTerm(q);
  if (term.length < 2) return [];
  switch (area) {
    case "anfragen":
      return requestSuggestions(term, (row) => `/dashboard/anfragen/${row.id}`);
    case "posteingang":
      if (!message || !UUID.test(message)) return [];
      return requestSuggestions(term, (row) => `/dashboard/posteingang?${new URLSearchParams({ nachricht: message, suche: row.request_number ?? term, auswahl: row.id })}#nachricht`);
    case "kunden":
      return customerSuggestions(term, false);
    case "kundennummer":
      return customerSuggestions(term, true);
    case "rechnungen":
      return invoiceSuggestions(term);
  }
}
